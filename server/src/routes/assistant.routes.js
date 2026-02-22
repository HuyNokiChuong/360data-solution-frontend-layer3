const express = require('express');
const { query, isValidUUID } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { getAccessibleTableIds } = require('../utils/table-access');
const {
    ACTION_STATUSES,
    MESSAGE_STATUSES,
    deriveAssistantMessageStatus,
} = require('../services/assistant-policy.service');
const { planAssistantActions } = require('../services/assistant-orchestrator.service');
const { executeAssistantServerAction } = require('../services/assistant-server-actions.service');

const router = express.Router();
router.use(authenticate);

let assistantSchemaReady = false;
let assistantSchemaPromise = null;

const ensureAssistantRuntimeSchema = async () => {
    if (assistantSchemaReady) return;
    if (assistantSchemaPromise) return assistantSchemaPromise;

    assistantSchemaPromise = (async () => {
        await query(`
            CREATE TABLE IF NOT EXISTS assistant_sessions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                channel VARCHAR(20) NOT NULL CHECK (channel IN ('global', 'bi')),
                title VARCHAR(500) NOT NULL DEFAULT 'Assistant Session',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_assistant_sessions_workspace_user
                ON assistant_sessions(workspace_id, user_id);
            CREATE INDEX IF NOT EXISTS idx_assistant_sessions_workspace_user_created
                ON assistant_sessions(workspace_id, user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_assistant_sessions_channel
                ON assistant_sessions(channel, created_at DESC);

            CREATE TABLE IF NOT EXISTS assistant_messages (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                session_id UUID NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
                role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'planned' CHECK (
                    status IN ('planned', 'running', 'waiting_input', 'waiting_confirm', 'done', 'failed')
                ),
                model_provider VARCHAR(50),
                model_id VARCHAR(120),
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_assistant_messages_session
                ON assistant_messages(session_id, created_at ASC);
            CREATE INDEX IF NOT EXISTS idx_assistant_messages_session_created
                ON assistant_messages(session_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_assistant_messages_status
                ON assistant_messages(status, created_at DESC);

            CREATE TABLE IF NOT EXISTS assistant_actions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                session_id UUID NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
                message_id UUID NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
                step_index INTEGER NOT NULL,
                target VARCHAR(20) NOT NULL CHECK (target IN ('server', 'client')),
                action_type VARCHAR(120) NOT NULL,
                risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
                requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
                args_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                status VARCHAR(30) NOT NULL DEFAULT 'planned' CHECK (
                    status IN ('planned', 'waiting_input', 'waiting_confirm', 'running', 'approved', 'done', 'failed', 'cancelled', 'undone')
                ),
                result_json JSONB,
                error_message TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_assistant_actions_workspace_like
                ON assistant_actions(session_id, message_id, created_at ASC);
            CREATE INDEX IF NOT EXISTS idx_assistant_actions_session_created
                ON assistant_actions(session_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_assistant_actions_status
                ON assistant_actions(status, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_assistant_actions_action_type
                ON assistant_actions(action_type);
        `);

        assistantSchemaReady = true;
    })();

    try {
        await assistantSchemaPromise;
    } catch (err) {
        assistantSchemaReady = false;
        throw err;
    } finally {
        assistantSchemaPromise = null;
    }
};

router.use(async (req, res, next) => {
    try {
        await ensureAssistantRuntimeSchema();
        next();
    } catch (err) {
        console.error('Assistant runtime schema error:', err);
        res.status(500).json({
            success: false,
            message: 'Assistant runtime is not ready. Please run backend migrations and retry.',
        });
    }
});

const toObject = (value) => (value && typeof value === 'object' ? value : {});

const sanitizePlannerContext = async ({ context, user }) => {
    const nextContext = toObject(context);
    const contextTables = Array.isArray(nextContext.tables) ? nextContext.tables : [];
    if (contextTables.length === 0) return nextContext;

    const contextTableIds = contextTables
        .map((table) => String(table?.id || '').trim())
        .filter(Boolean);
    if (contextTableIds.length === 0) {
        return {
            ...nextContext,
            tables: [],
            tableCount: 0,
        };
    }

    const allowedTableIds = await getAccessibleTableIds({
        workspaceId: user.workspace_id,
        user,
        tableIds: contextTableIds,
    });
    const filteredTables = contextTables.filter((table) => allowedTableIds.has(String(table?.id || '').trim()));

    const reportsContext = toObject(nextContext.reportsContext);
    const selectedTableIds = Array.isArray(reportsContext.selectedTableIds)
        ? reportsContext.selectedTableIds.filter((id) => allowedTableIds.has(String(id || '').trim()))
        : [];

    return {
        ...nextContext,
        tableCount: filteredTables.length,
        tables: filteredTables,
        reportsContext: {
            ...reportsContext,
            selectedTableIds,
        },
    };
};

const parseJson = (value, fallback = null) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (_err) {
            return fallback;
        }
    }
    return value;
};

const formatActionRow = (row) => ({
    id: row.id,
    stepIndex: row.step_index,
    target: row.target,
    actionType: row.action_type,
    riskLevel: row.risk_level,
    requiresConfirmation: row.requires_confirmation,
    args: parseJson(row.args_json, {}) || {},
    status: row.status,
    result: parseJson(row.result_json, null),
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const formatMessageRow = (row) => {
    const metadata = parseJson(row.metadata, {}) || {};
    const actions = Array.isArray(row.actions) ? row.actions.map(formatActionRow) : [];
    const pendingConfirmations = actions.filter((action) => action.status === ACTION_STATUSES.WAITING_CONFIRM);

    return {
        id: row.id,
        role: row.role,
        content: row.content,
        status: row.status,
        modelProvider: row.model_provider || null,
        modelId: row.model_id || null,
        missingInputs: Array.isArray(metadata.missingInputs) ? metadata.missingInputs : [],
        actionPlan: actions,
        pendingConfirmations,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const ensureSessionOwnership = async (sessionId, user) => {
    const sessionRes = await query(
        `SELECT *
         FROM assistant_sessions
         WHERE id = $1
           AND workspace_id = $2
           AND user_id = $3
         LIMIT 1`,
        [sessionId, user.workspace_id, user.id]
    );

    return sessionRes.rows[0] || null;
};

const updateSessionHeartbeat = async (sessionId) => {
    await query('UPDATE assistant_sessions SET updated_at = NOW() WHERE id = $1', [sessionId]);
};

const loadActionsByMessage = async (messageId) => {
    const result = await query(
        `SELECT *
         FROM assistant_actions
         WHERE message_id = $1
         ORDER BY step_index ASC, created_at ASC`,
        [messageId]
    );

    return result.rows.map(formatActionRow);
};

const setActionStatus = async ({ actionId, status, result = null, errorMessage = null }) => {
    const updated = await query(
        `UPDATE assistant_actions
         SET status = $2,
             result_json = $3,
             error_message = $4,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
            actionId,
            status,
            result === null ? null : JSON.stringify(result),
            errorMessage,
        ]
    );

    return updated.rows[0] ? formatActionRow(updated.rows[0]) : null;
};

const syncAssistantMessageStatus = async (messageId, missingInputs = []) => {
    const actions = await loadActionsByMessage(messageId);
    const status = deriveAssistantMessageStatus({ missingInputs, actions });

    const updated = await query(
        `UPDATE assistant_messages
         SET status = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [messageId, status]
    );

    return {
        message: updated.rows[0] ? formatMessageRow({ ...updated.rows[0], actions: [] }) : null,
        actions,
        status,
    };
};

const executeServerActions = async ({ actionRows, authHeader, user }) => {
    const executed = [];

    for (const action of actionRows) {
        if (action.target !== 'server') continue;
        if (action.requiresConfirmation) continue;
        if (action.status === ACTION_STATUSES.WAITING_INPUT) continue;

        await setActionStatus({ actionId: action.id, status: ACTION_STATUSES.RUNNING });

        try {
            const result = await executeAssistantServerAction({
                action: {
                    actionType: action.actionType,
                    args: action.args,
                },
                authHeader,
                user,
            });

            const updated = await setActionStatus({
                actionId: action.id,
                status: ACTION_STATUSES.DONE,
                result,
            });
            if (updated) executed.push(updated);
        } catch (err) {
            const updated = await setActionStatus({
                actionId: action.id,
                status: ACTION_STATUSES.FAILED,
                errorMessage: err.message || 'Action execution failed',
                result: err.payload || null,
            });
            if (updated) executed.push(updated);
        }
    }

    return executed;
};

/**
 * POST /api/assistant/sessions
 */
router.post('/sessions', async (req, res) => {
    try {
        const channel = ['global', 'bi'].includes(String(req.body?.channel || '').trim())
            ? String(req.body.channel).trim()
            : 'global';
        const title = String(req.body?.title || 'Assistant Session').trim() || 'Assistant Session';

        const inserted = await query(
            `INSERT INTO assistant_sessions (workspace_id, user_id, channel, title)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [req.user.workspace_id, req.user.id, channel, title]
        );

        res.status(201).json({
            success: true,
            data: {
                sessionId: inserted.rows[0].id,
                channel: inserted.rows[0].channel,
                title: inserted.rows[0].title,
            },
        });
    } catch (err) {
        console.error('Create assistant session error:', err);
        res.status(500).json({ success: false, message: 'Failed to create assistant session' });
    }
});

/**
 * GET /api/assistant/sessions?channel=global|bi
 */
router.get('/sessions', async (req, res) => {
    try {
        const channel = String(req.query?.channel || '').trim();
        const hasChannel = channel === 'global' || channel === 'bi';

        const values = [req.user.workspace_id, req.user.id];
        const where = hasChannel ? 'AND s.channel = $3' : '';
        if (hasChannel) values.push(channel);

        const result = await query(
            `SELECT s.*,
                    (SELECT COUNT(*) FROM assistant_messages m WHERE m.session_id = s.id) AS message_count
             FROM assistant_sessions s
             WHERE s.workspace_id = $1
               AND s.user_id = $2
               ${where}
             ORDER BY s.updated_at DESC`,
            values
        );

        res.json({
            success: true,
            data: result.rows.map((row) => ({
                id: row.id,
                channel: row.channel,
                title: row.title,
                messageCount: Number(row.message_count || 0),
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            })),
        });
    } catch (err) {
        console.error('List assistant sessions error:', err);
        res.status(500).json({ success: false, message: 'Failed to list assistant sessions' });
    }
});

/**
 * POST /api/assistant/messages
 */
router.post('/messages', async (req, res) => {
    try {
        const sessionId = String(req.body?.sessionId || '').trim();
        const text = String(req.body?.text || '').trim();
        const context = await sanitizePlannerContext({
            context: req.body?.context,
            user: req.user,
        });
        const autoExecute = req.body?.autoExecute !== false;

        if (!isValidUUID(sessionId)) {
            return res.status(400).json({ success: false, message: 'sessionId must be UUID' });
        }
        if (!text) {
            return res.status(400).json({ success: false, message: 'text is required' });
        }

        const session = await ensureSessionOwnership(sessionId, req.user);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Assistant session not found' });
        }

        await query(
            `INSERT INTO assistant_messages (session_id, role, content, status, metadata)
             VALUES ($1, 'user', $2, $3, $4::jsonb)`,
            [sessionId, text, MESSAGE_STATUSES.DONE, JSON.stringify({ context })]
        );

        const planned = await planAssistantActions({
            text,
            context,
            user: req.user,
        });

        const missingInputs = Array.isArray(planned.missingInputs) ? planned.missingInputs : [];
        const baseActions = Array.isArray(planned.actions) ? planned.actions : [];

        const initialMessageStatus = missingInputs.length > 0
            ? MESSAGE_STATUSES.WAITING_INPUT
            : (baseActions.some((action) => action.requiresConfirmation) ? MESSAGE_STATUSES.WAITING_CONFIRM : MESSAGE_STATUSES.RUNNING);

        const assistantMessageRes = await query(
            `INSERT INTO assistant_messages (
                session_id, role, content, status, model_provider, model_id, metadata
             )
             VALUES ($1, 'assistant', $2, $3, $4, $5, $6::jsonb)
             RETURNING *`,
            [
                sessionId,
                String(planned.assistantText || '').trim() || 'Đã nhận yêu cầu.',
                initialMessageStatus,
                planned.modelProvider || null,
                planned.modelId || null,
                JSON.stringify({
                    missingInputs,
                }),
            ]
        );

        const assistantMessage = assistantMessageRes.rows[0];

        const insertedActions = [];
        for (const action of baseActions) {
            let status = ACTION_STATUSES.PLANNED;
            if (missingInputs.length > 0) status = ACTION_STATUSES.WAITING_INPUT;
            else if (action.requiresConfirmation) status = ACTION_STATUSES.WAITING_CONFIRM;
            else if (autoExecute && action.target === 'server') status = ACTION_STATUSES.RUNNING;

            const inserted = await query(
                `INSERT INTO assistant_actions (
                    session_id, message_id, step_index, target, action_type,
                    risk_level, requires_confirmation, args_json, status
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
                 RETURNING *`,
                [
                    sessionId,
                    assistantMessage.id,
                    action.stepIndex,
                    action.target,
                    action.actionType,
                    action.riskLevel,
                    action.requiresConfirmation,
                    JSON.stringify(action.args || {}),
                    status,
                ]
            );

            insertedActions.push(formatActionRow(inserted.rows[0]));
        }

        if (autoExecute && missingInputs.length === 0) {
            await executeServerActions({
                actionRows: insertedActions,
                authHeader: req.headers.authorization,
                user: req.user,
            });
        }

        const sync = await syncAssistantMessageStatus(assistantMessage.id, missingInputs);
        await updateSessionHeartbeat(sessionId);

        const pendingConfirmations = sync.actions.filter((action) => action.status === ACTION_STATUSES.WAITING_CONFIRM);

        res.json({
            success: true,
            data: {
                messageId: assistantMessage.id,
                assistantText: assistantMessage.content,
                status: sync.status,
                missingInputs,
                pendingConfirmations,
                actionPlan: sync.actions,
            },
        });
    } catch (err) {
        console.error('Assistant message error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to process assistant message' });
    }
});

/**
 * POST /api/assistant/messages/:messageId/confirm
 */
router.post('/messages/:messageId/confirm', async (req, res) => {
    try {
        const messageId = String(req.params.messageId || '').trim();
        const approve = req.body?.approve === true;
        const actionIds = Array.isArray(req.body?.actionIds)
            ? req.body.actionIds.filter((id) => isValidUUID(String(id || '')))
            : [];

        if (!isValidUUID(messageId)) {
            return res.status(400).json({ success: false, message: 'messageId must be UUID' });
        }

        const ownership = await query(
            `SELECT m.*, s.workspace_id, s.user_id, s.id AS session_id
             FROM assistant_messages m
             JOIN assistant_sessions s ON s.id = m.session_id
             WHERE m.id = $1
               AND s.workspace_id = $2
               AND s.user_id = $3
             LIMIT 1`,
            [messageId, req.user.workspace_id, req.user.id]
        );

        if (ownership.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Assistant message not found' });
        }

        const targetActionsRes = await query(
            `SELECT *
             FROM assistant_actions
             WHERE message_id = $1
               AND ($2::boolean = TRUE OR id = ANY($3::uuid[]))
             ORDER BY step_index ASC`,
            [messageId, actionIds.length === 0, actionIds]
        );

        const targetActions = targetActionsRes.rows.map(formatActionRow)
            .filter((action) => action.requiresConfirmation === true);

        if (targetActions.length === 0) {
            return res.status(400).json({ success: false, message: 'No confirmable actions found' });
        }

        if (!approve) {
            for (const action of targetActions) {
                await setActionStatus({
                    actionId: action.id,
                    status: ACTION_STATUSES.CANCELLED,
                    result: { approved: false },
                });
            }
        } else {
            for (const action of targetActions) {
                if (action.target === 'server') {
                    await setActionStatus({ actionId: action.id, status: ACTION_STATUSES.RUNNING });
                    try {
                        const result = await executeAssistantServerAction({
                            action: {
                                actionType: action.actionType,
                                args: action.args,
                            },
                            authHeader: req.headers.authorization,
                            user: req.user,
                        });

                        await setActionStatus({
                            actionId: action.id,
                            status: ACTION_STATUSES.DONE,
                            result,
                        });
                    } catch (err) {
                        await setActionStatus({
                            actionId: action.id,
                            status: ACTION_STATUSES.FAILED,
                            errorMessage: err.message || 'Action execution failed',
                            result: err.payload || null,
                        });
                    }
                } else {
                    await setActionStatus({
                        actionId: action.id,
                        status: ACTION_STATUSES.APPROVED,
                        result: { approved: true },
                    });
                }
            }
        }

        const metadata = parseJson(ownership.rows[0].metadata, {}) || {};
        const missingInputs = Array.isArray(metadata.missingInputs) ? metadata.missingInputs : [];
        const sync = await syncAssistantMessageStatus(messageId, missingInputs);
        await updateSessionHeartbeat(ownership.rows[0].session_id);

        res.json({
            success: true,
            data: {
                messageId,
                approve,
                status: sync.status,
                actionPlan: sync.actions,
                pendingConfirmations: sync.actions.filter((action) => action.status === ACTION_STATUSES.WAITING_CONFIRM),
            },
        });
    } catch (err) {
        console.error('Confirm assistant actions error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to confirm actions' });
    }
});

/**
 * POST /api/assistant/actions/:actionId/client-result
 */
router.post('/actions/:actionId/client-result', async (req, res) => {
    try {
        const actionId = String(req.params.actionId || '').trim();
        const success = req.body?.success === true;
        const resultPayload = req.body?.result;
        const error = req.body?.error ? String(req.body.error) : null;

        if (!isValidUUID(actionId)) {
            return res.status(400).json({ success: false, message: 'actionId must be UUID' });
        }

        const ownership = await query(
            `SELECT a.*, s.workspace_id, s.user_id, m.metadata
             FROM assistant_actions a
             JOIN assistant_sessions s ON s.id = a.session_id
             JOIN assistant_messages m ON m.id = a.message_id
             WHERE a.id = $1
               AND s.workspace_id = $2
               AND s.user_id = $3
             LIMIT 1`,
            [actionId, req.user.workspace_id, req.user.id]
        );

        if (ownership.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Action not found' });
        }

        const row = ownership.rows[0];
        const updated = await setActionStatus({
            actionId,
            status: success ? ACTION_STATUSES.DONE : ACTION_STATUSES.FAILED,
            result: success ? resultPayload || {} : null,
            errorMessage: success ? null : (error || 'Client action failed'),
        });

        const metadata = parseJson(row.metadata, {}) || {};
        const missingInputs = Array.isArray(metadata.missingInputs) ? metadata.missingInputs : [];
        const sync = await syncAssistantMessageStatus(row.message_id, missingInputs);
        await updateSessionHeartbeat(row.session_id);

        res.json({
            success: true,
            data: {
                action: updated,
                messageStatus: sync.status,
                actionPlan: sync.actions,
            },
        });
    } catch (err) {
        console.error('Client action result error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to update action result' });
    }
});

/**
 * GET /api/assistant/sessions/:id/timeline
 */
router.get('/sessions/:id/timeline', async (req, res) => {
    try {
        const sessionId = String(req.params.id || '').trim();
        if (!isValidUUID(sessionId)) {
            return res.status(400).json({ success: false, message: 'Session id must be UUID' });
        }

        const session = await ensureSessionOwnership(sessionId, req.user);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Assistant session not found' });
        }

        const messagesRes = await query(
            `SELECT m.*,
                    COALESCE(
                        (
                            SELECT json_agg(a ORDER BY a.step_index ASC, a.created_at ASC)
                            FROM assistant_actions a
                            WHERE a.message_id = m.id
                        ),
                        '[]'::json
                    ) AS actions
             FROM assistant_messages m
             WHERE m.session_id = $1
             ORDER BY m.created_at ASC`,
            [sessionId]
        );

        res.json({
            success: true,
            data: {
                session: {
                    id: session.id,
                    channel: session.channel,
                    title: session.title,
                    createdAt: session.created_at,
                    updatedAt: session.updated_at,
                },
                messages: messagesRes.rows.map(formatMessageRow),
            },
        });
    } catch (err) {
        console.error('Assistant timeline error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to fetch assistant timeline' });
    }
});

module.exports = router;
