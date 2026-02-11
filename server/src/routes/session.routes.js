// ============================================
// Session Routes - Ask AI History
// ============================================
const express = require('express');
const { query, getClient, isValidUUID } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/sessions - List user's AI sessions
 */
router.get('/', async (req, res) => {
    try {
        const result = await query(
            `SELECT s.*,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'id', m.id, 'role', m.role, 'content', m.content,
            'visualData', m.visual_data, 'sqlTrace', m.sql_trace,
            'executionTime', m.execution_time
          ) ORDER BY m.created_at ASC)
          FROM ai_messages m WHERE m.session_id = s.id), '[]'
        ) as messages
       FROM ai_sessions s
       WHERE s.workspace_id = $1 AND s.user_id = $2
       ORDER BY s.updated_at DESC`,
            [req.user.workspace_id, req.user.id]
        );

        res.json({
            success: true,
            data: result.rows.map(formatSession),
        });
    } catch (err) {
        console.error('List sessions error:', err);
        res.status(500).json({ success: false, message: 'Failed to list sessions' });
    }
});

/**
 * POST /api/sessions - Create a new session
 */
router.post('/', async (req, res) => {
    try {
        const { id: frontendId, title } = req.body;

        // Validate frontendId
        const validFrontendId = isValidUUID(frontendId) ? frontendId : null;

        // Idempotent check (only if valid)
        if (validFrontendId) {
            const existing = await query('SELECT id FROM ai_sessions WHERE id = $1', [validFrontendId]);
            if (existing.rows.length > 0) {
                return res.json({ success: true, data: { id: validFrontendId } });
            }
        }

        const result = await query(
            `INSERT INTO ai_sessions (id, workspace_id, user_id, title)
       VALUES (COALESCE($1, uuid_generate_v4()), $2, $3, $4)
       RETURNING *`,
            [validFrontendId, req.user.workspace_id, req.user.id, title || 'Data Exploration Hub']
        );

        res.status(201).json({ success: true, data: formatSession(result.rows[0]) });
    } catch (err) {
        console.error('Create session error:', err);
        res.status(500).json({ success: false, message: 'Failed to create session' });
    }
});

/**
 * PUT /api/sessions/:id - Update session title
 */
router.put('/:id', async (req, res) => {
    try {
        const { title } = req.body;

        const result = await query(
            'UPDATE ai_sessions SET title = COALESCE($1, title) WHERE id = $2 AND user_id = $3 RETURNING *',
            [title, req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        res.json({ success: true, data: formatSession(result.rows[0]) });
    } catch (err) {
        console.error('Update session error:', err);
        res.status(500).json({ success: false, message: 'Failed to update session' });
    }
});

/**
 * POST /api/sessions/:id/messages - Add message to session
 */
router.post('/:id/messages', async (req, res) => {
    try {
        const { id: frontendId, role, content, visualData, sqlTrace, executionTime } = req.body;

        const validFrontendId = isValidUUID(frontendId) ? frontendId : null;

        // Idempotent
        if (validFrontendId) {
            const existing = await query('SELECT id FROM ai_messages WHERE id = $1', [validFrontendId]);
            if (existing.rows.length > 0) {
                return res.json({ success: true, data: { id: validFrontendId } });
            }
        }

        const result = await query(
            `INSERT INTO ai_messages (id, session_id, role, content, visual_data, sql_trace, execution_time)
       VALUES (COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6, $7)
       RETURNING *`,
            [
                validFrontendId,
                req.params.id,
                role,
                content,
                visualData ? JSON.stringify(visualData) : null,
                sqlTrace,
                executionTime,
            ]
        );

        // Update session timestamp
        await query('UPDATE ai_sessions SET updated_at = NOW() WHERE id = $1', [req.params.id]);

        res.status(201).json({ success: true, data: formatMessage(result.rows[0]) });
    } catch (err) {
        console.error('Add message error:', err);
        res.status(500).json({ success: false, message: 'Failed to add message' });
    }
});

/**
 * GET /api/sessions/:id/messages
 */
router.get('/:id/messages', async (req, res) => {
    try {
        const result = await query(
            'SELECT * FROM ai_messages WHERE session_id = $1 ORDER BY created_at ASC',
            [req.params.id]
        );

        res.json({ success: true, data: result.rows.map(formatMessage) });
    } catch (err) {
        console.error('List messages error:', err);
        res.status(500).json({ success: false, message: 'Failed to list messages' });
    }
});

/**
 * DELETE /api/sessions/:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const result = await query(
            'DELETE FROM ai_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        res.json({ success: true, message: 'Session deleted' });
    } catch (err) {
        console.error('Delete session error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete session' });
    }
});

function formatSession(row) {
    return {
        id: row.id,
        title: row.title,
        timestamp: row.created_at,
        messages: (row.messages || []).map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            visualData: m.visualData || m.visual_data || undefined,
            sqlTrace: m.sqlTrace || m.sql_trace || undefined,
            executionTime: m.executionTime || m.execution_time || undefined,
        })),
    };
}

function formatMessage(row) {
    return {
        id: row.id,
        role: row.role,
        content: row.content,
        visualData: typeof row.visual_data === 'string' ? JSON.parse(row.visual_data) : (row.visual_data || undefined),
        sqlTrace: row.sql_trace || undefined,
        executionTime: row.execution_time || undefined,
    };
}

module.exports = router;
