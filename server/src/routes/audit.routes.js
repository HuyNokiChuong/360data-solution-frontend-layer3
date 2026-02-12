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
 * Query params: userId, action, entityType, limit, offset
 */
router.get('/', async (req, res) => {
    try {
        const { userId, action, entityType, limit = 100, offset = 0 } = req.query;
        const workspaceId = req.user.workspace_id;
        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 1000);
        const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

        const conditions = ['workspace_id = $1'];
        const values = [workspaceId];
        let idx = 2;

        if (userId) {
            conditions.push(`user_id = $${idx++}`);
            values.push(userId);
        }
        if (action) {
            conditions.push(`action ILIKE $${idx++}`);
            values.push(`%${action}%`);
        }
        if (entityType) {
            conditions.push(`entity_type = $${idx++}`);
            values.push(entityType);
        }

        let countResult;
        let logsResult;
        try {
            countResult = await query(
                `SELECT COUNT(*) FROM audit_logs WHERE ${conditions.join(' AND ')}`,
                values
            );

            logsResult = await query(
                `SELECT al.*, u.email as user_email, u.name as user_name 
                 FROM audit_logs al
                 LEFT JOIN users u ON al.user_id = u.id
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY al.created_at DESC
                 LIMIT $${idx++} OFFSET $${idx++}`,
                [...values, safeLimit, safeOffset]
            );
        } catch (tableErr) {
            // Backward-compatible fallback if audit_logs table is unavailable.
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

        res.json({
            success: true,
            data: logsResult.rows,
            pagination: {
                total: parseInt(countResult.rows[0].count),
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
