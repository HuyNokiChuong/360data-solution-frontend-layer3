// ============================================
// Connection Routes - CRUD + Tables
// ============================================
const express = require('express');
const { query, getClient } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/connections - List workspace connections
 */
router.get('/', async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, type, auth_type, email, status, project_id, 
              table_count, created_at, config
       FROM connections WHERE workspace_id = $1 AND is_deleted = FALSE ORDER BY created_at DESC`,
            [req.user.workspace_id]
        );

        res.json({
            success: true,
            data: result.rows.map(formatConnection),
        });
    } catch (err) {
        console.error('List connections error:', err);
        res.status(500).json({ success: false, message: 'Failed to list connections' });
    }
});

/**
 * POST /api/connections - Create connection
 */
router.post('/', async (req, res) => {
    const client = await getClient();
    try {
        const { id: frontendId, name, type, authType, email, status, projectId, serviceAccountKey, tableCount } = req.body;

        // Validate UUID format — frontend may send non-UUID IDs like "conn-123456"
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const validUUID = frontendId && UUID_RE.test(frontendId) ? frontendId : null;

        await client.query('BEGIN');

        // Idempotent: check if this exact connection already exists (only for valid UUIDs)
        if (validUUID) {
            const existing = await client.query(
                'SELECT id FROM connections WHERE id = $1',
                [validUUID]
            );
            if (existing.rows.length > 0) {
                await client.query('COMMIT');
                const fetch = await client.query('SELECT * FROM connections WHERE id = $1', [validUUID]);
                return res.json({ success: true, data: formatConnection(fetch.rows[0]) });
            }
        }

        const result = await client.query(
            `INSERT INTO connections (id, workspace_id, created_by, name, type, auth_type, email, status, project_id, service_account_key, table_count)
       VALUES (COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
            [
                validUUID,
                req.user.workspace_id,
                req.user.id,
                name,
                type || 'BigQuery',
                authType || 'GoogleMail',
                email,
                status || 'Connected',
                projectId,
                serviceAccountKey,
                tableCount || 0,
            ]
        );

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            data: formatConnection(result.rows[0]),
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Create connection error:', err);
        res.status(500).json({ success: false, message: 'Failed to create connection' });
    } finally {
        client.release();
    }
});

/**
 * PUT /api/connections/:id - Update connection
 */
router.put('/:id', async (req, res) => {
    try {
        const { name, type, authType, email, status, projectId, serviceAccountKey, tableCount } = req.body;

        const result = await query(
            `UPDATE connections SET
         name = COALESCE($1, name),
         type = COALESCE($2, type),
         auth_type = COALESCE($3, auth_type),
         email = COALESCE($4, email),
         status = COALESCE($5, status),
         project_id = COALESCE($6, project_id),
         service_account_key = COALESCE($7, service_account_key),
         table_count = COALESCE($8, table_count)
       WHERE id = $9 AND workspace_id = $10
       RETURNING *`,
            [name, type, authType, email, status, projectId, serviceAccountKey, tableCount, req.params.id, req.user.workspace_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Connection not found' });
        }

        res.json({ success: true, data: formatConnection(result.rows[0]) });
    } catch (err) {
        console.error('Update connection error:', err);
        res.status(500).json({ success: false, message: 'Failed to update connection' });
    }
});

/**
 * DELETE /api/connections/:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const result = await query(
            'UPDATE connections SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1 AND workspace_id = $2 RETURNING id',
            [req.params.id, req.user.workspace_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Connection not found' });
        }

        // Cascade Soft Delete to Tables
        await query(
            'UPDATE synced_tables SET is_deleted = TRUE, updated_at = NOW() WHERE connection_id = $1',
            [req.params.id]
        );

        res.json({ success: true, message: 'Connection deleted' });
    } catch (err) {
        console.error('Delete connection error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete connection' });
    }
});

/**
 * POST /api/connections/:id/tables - Bulk upsert tables
 */
router.post('/:id/tables', async (req, res) => {
    const client = await getClient();
    try {
        const { tables } = req.body;
        const connectionId = req.params.id;

        if (!tables || !Array.isArray(tables)) {
            return res.status(400).json({ success: false, message: 'tables array is required' });
        }

        await client.query('BEGIN');

        const results = [];
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const t of tables) {
            const validTableId = t.id && UUID_RE.test(t.id) ? t.id : null;
            const result = await client.query(
                `INSERT INTO synced_tables (id, connection_id, table_name, dataset_name, row_count, status, schema_def, is_deleted)
         VALUES (COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6, $7, FALSE)
         ON CONFLICT (connection_id, dataset_name, table_name) 
         DO UPDATE SET row_count = EXCLUDED.row_count, status = EXCLUDED.status, schema_def = EXCLUDED.schema_def, last_sync = NOW(), is_deleted = FALSE
         RETURNING *`,
                [
                    validTableId,
                    connectionId,
                    t.tableName,
                    t.datasetName,
                    t.rowCount || 0,
                    t.status || 'Active',
                    JSON.stringify(t.schema || []),
                ]
            );
            results.push(result.rows[0]);
        }

        // Update table count on connection (active only)
        await client.query(
            'UPDATE connections SET table_count = (SELECT COUNT(*) FROM synced_tables WHERE connection_id = $1 AND is_deleted = FALSE) WHERE id = $1',
            [connectionId]
        );

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            data: results.map(formatTable),
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Upsert tables error:', err);
        res.status(500).json({ success: false, message: 'Failed to save tables' });
    } finally {
        client.release();
    }
});

/**
 * DELETE /api/connections/tables/:id — Soft delete a synced table
 */
router.delete('/tables/:id', async (req, res) => {
    try {
        const result = await query(
            'UPDATE synced_tables SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1 RETURNING id',
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Table not found' });
        }

        // Update connection table count
        await query(
            `UPDATE connections 
             SET table_count = (SELECT COUNT(*) FROM synced_tables WHERE connection_id = (SELECT connection_id FROM synced_tables WHERE id = $1) AND is_deleted = FALSE)
             WHERE id = (SELECT connection_id FROM synced_tables WHERE id = $1)`,
            [req.params.id]
        );

        res.json({ success: true, message: 'Table deleted' });
    } catch (err) {
        console.error('Delete table error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete table' });
    }
});

/**
 * GET /api/connections/:id/tables
 */
router.get('/:id/tables', async (req, res) => {
    try {
        const result = await query(
            'SELECT * FROM synced_tables WHERE connection_id = $1 AND is_deleted = FALSE ORDER BY dataset_name, table_name',
            [req.params.id]
        );

        res.json({ success: true, data: result.rows.map(formatTable) });
    } catch (err) {
        console.error('List tables error:', err);
        res.status(500).json({ success: false, message: 'Failed to list tables' });
    }
});

function formatConnection(row) {
    return {
        id: row.id,
        name: row.name,
        type: row.type,
        authType: row.auth_type,
        email: row.email || undefined,
        status: row.status,
        projectId: row.project_id || undefined,
        serviceAccountKey: row.service_account_key || undefined,
        tableCount: row.table_count,
        createdAt: row.created_at,
    };
}

function formatTable(row) {
    return {
        id: row.id,
        connectionId: row.connection_id,
        tableName: row.table_name,
        datasetName: row.dataset_name,
        rowCount: row.row_count,
        status: row.status,
        lastSync: row.last_sync,
        schema: typeof row.schema_def === 'string' ? JSON.parse(row.schema_def) : (row.schema_def || []),
    };
}

module.exports = router;
