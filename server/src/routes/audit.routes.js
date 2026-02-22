// ============================================
// Audit Log Routes - Read Only
// ============================================
const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/logs - List audit logs
 * Query params: userId, action, entityType, limit, offset, scope
 */
router.get('/', async (req, res) => {
    try {
        const {
            userId,
            action,
            entityType,
            scope = 'workspace',
            includeSystem = 'false',
            limit = 100,
            offset = 0
        } = req.query;

        const workspaceId = req.user.workspace_id || null;
        const currentUserId = req.user.id || null;
        const normalizedRole = String(req.user.role || '').toLowerCase();
        const normalizedEmail = String(req.user.email || '').toLowerCase();
        const canViewAllScopes = normalizedEmail === 'admin@360data-solutions.ai' || normalizedRole.includes('super');
        const wantsAllScope = String(scope).toLowerCase() === 'all';
        const wantsSystemLogsRaw = ['1', 'true', 'yes'].includes(String(includeSystem).toLowerCase());
        const wantsSystemLogs = wantsSystemLogsRaw && canViewAllScopes;

        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
        const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

        const conditions = [];
        const values = [];
        let idx = 1;

        if (!(wantsAllScope && canViewAllScopes)) {
            if (wantsSystemLogs) {
                conditions.push(`(al.workspace_id = $${idx++} OR al.user_id = $${idx++} OR al.workspace_id IS NULL)`);
            } else {
                conditions.push(`(al.workspace_id = $${idx++} OR al.user_id = $${idx++})`);
            }
            values.push(workspaceId);
            values.push(currentUserId);
        }

        if (userId) {
            conditions.push(`al.user_id = $${idx++}`);
            values.push(userId);
        }
        if (action) {
            conditions.push(`al.action ILIKE $${idx++}`);
            values.push(`%${action}%`);
        }
        if (entityType) {
            conditions.push(`al.entity_type = $${idx++}`);
            values.push(entityType);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        let countResult;
        let logsResult;
        try {
            countResult = await query(
                `SELECT COUNT(*) FROM audit_logs al ${whereClause}`,
                values
            );

            logsResult = await query(
                `SELECT al.*, u.email as user_email, u.name as user_name 
                 FROM audit_logs al
                 LEFT JOIN users u ON al.user_id = u.id
                 ${whereClause}
                 ORDER BY al.created_at DESC
                 LIMIT $${idx++} OFFSET $${idx++}`,
                [...values, safeLimit, safeOffset]
            );
        } catch (tableErr) {
            const message = String(tableErr?.message || '').toLowerCase();
            // Backward-compatible fallback only when table truly does not exist.
            if (message.includes('audit_logs') && message.includes('does not exist')) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: {
                        total: 0,
                        limit: safeLimit,
                        offset: safeOffset,
                    }
                });
            }
            throw tableErr;
        }

        res.json({
            success: true,
            data: logsResult.rows,
            pagination: {
                total: parseInt(countResult.rows[0].count, 10),
                limit: safeLimit,
                offset: safeOffset,
            }
        });
    } catch (err) {
        console.error('List audit logs error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch logs' });
    }
});

module.exports = router;
