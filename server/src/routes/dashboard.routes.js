// ============================================
// Dashboard Routes - CRUD + Share
// ============================================
const express = require('express');
const { query, getClient, isValidUUID } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { normalizeIdentity, normalizeSharePermission, normalizeSharePermissions } = require('../utils/share-permissions');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/dashboards - List workspace dashboards
 */
router.get('/', async (req, res) => {
    try {
        let result;
        try {
            // Preferred query for latest schema.
            result = await query(
                `SELECT d.*, 
            COALESCE(
              (SELECT json_agg(json_build_object(
                'userId', ds.user_id,
                'permission', ds.permission,
                'sharedAt', ds.shared_at,
                'allowedPageIds', COALESCE(to_jsonb(ds)->'allowed_page_ids', '[]'::jsonb),
                'rls', COALESCE(to_jsonb(ds)->'rls_config', '{}'::jsonb)
              ))
               FROM dashboard_shares ds WHERE ds.dashboard_id = d.id), '[]'
            ) as shared_with
           FROM dashboards d 
           WHERE d.workspace_id = $1 AND COALESCE(d.is_deleted, FALSE) = FALSE
           ORDER BY d.updated_at DESC`,
                [req.user.workspace_id]
            );
        } catch (primaryErr) {
            // Fallback for older DB schemas (missing is_deleted / dashboard_shares / RLS columns).
            result = await query(
                `SELECT d.*, '[]'::json as shared_with
                 FROM dashboards d
                 WHERE d.workspace_id = $1
                 ORDER BY d.updated_at DESC`,
                [req.user.workspace_id]
            );
        }

        res.json({ success: true, data: result.rows.map(formatDashboard).map((d) => applyPageAccessConstraint(d, req.user.email)) });
    } catch (err) {
        console.error('List dashboards error:', err);
        res.status(500).json({ success: false, message: 'Failed to list dashboards' });
    }
});

/**
 * POST /api/dashboards - Create dashboard
 */
router.post('/', async (req, res) => {
    try {
        const { title, description, folderId, dataSourceId, dataSourceName, pages, widgets, activePageId, enableCrossFilter } = req.body;

        const pageId = `pg-${Date.now()}`;
        const defaultPages = pages || [{ id: pageId, title: 'Page 1', widgets: [] }];

        // Validate folderId: if valid UUID use it, otherwise NULL
        const validFolderId = isValidUUID(folderId) ? folderId : null;

        const result = await query(
            `INSERT INTO dashboards (workspace_id, created_by, folder_id, title, description, data_source_id, data_source_name, enable_cross_filter, pages, widgets, active_page_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
            [
                req.user.workspace_id,
                req.user.id,
                validFolderId,
                title || 'Untitled Dashboard',
                description,
                dataSourceId,
                dataSourceName,
                enableCrossFilter ?? true,
                JSON.stringify(defaultPages),
                JSON.stringify(widgets || []),
                activePageId || defaultPages[0]?.id || pageId,
            ]
        );

        // Auto-share with creator as admin
        await query(
            `INSERT INTO dashboard_shares (dashboard_id, user_id, permission) VALUES ($1, $2, 'admin')
       ON CONFLICT (dashboard_id, user_id) DO NOTHING`,
            [result.rows[0].id, req.user.email]
        );

        res.status(201).json({ success: true, data: formatDashboard(result.rows[0]) });
    } catch (err) {
        console.error('Create dashboard error:', err);
        res.status(500).json({ success: false, message: 'Failed to create dashboard' });
    }
});

/**
 * PUT /api/dashboards/:id - Update dashboard
 */
router.put('/:id', async (req, res) => {
    try {
        const { title, description, folderId, dataSourceId, dataSourceName, enableCrossFilter, pages, widgets, activePageId, globalFilters, calculatedFields, quickMeasures, layout, theme } = req.body;
        const dashboardId = req.params.id;
        const workspaceId = req.user.workspace_id;

        // Build dynamic update query
        const fields = [];
        const values = [];
        let idx = 1;

        if (title !== undefined) {
            fields.push(`title = $${idx++}`);
            values.push(title);
        }
        if (description !== undefined) {
            fields.push(`description = $${idx++}`);
            values.push(description);
        }
        if (folderId !== undefined) {
            fields.push(`folder_id = $${idx++}`);
            // Validate UUID: if invalid string or null, set to null
            values.push(isValidUUID(folderId) ? folderId : null);
        }
        if (dataSourceId !== undefined) {
            fields.push(`data_source_id = $${idx++}`);
            values.push(dataSourceId);
        }
        if (dataSourceName !== undefined) {
            fields.push(`data_source_name = $${idx++}`);
            values.push(dataSourceName);
        }
        if (enableCrossFilter !== undefined) {
            fields.push(`enable_cross_filter = $${idx++}`);
            values.push(enableCrossFilter);
        }
        if (pages !== undefined) {
            fields.push(`pages = $${idx++}`);
            values.push(JSON.stringify(pages));
        }
        if (widgets !== undefined) {
            fields.push(`widgets = $${idx++}`);
            values.push(JSON.stringify(widgets));
        }
        if (activePageId !== undefined) {
            fields.push(`active_page_id = $${idx++}`);
            values.push(activePageId);
        }
        if (globalFilters !== undefined) {
            fields.push(`global_filters = $${idx++}`);
            values.push(JSON.stringify(globalFilters));
        }
        if (calculatedFields !== undefined) {
            fields.push(`calculated_fields = $${idx++}`);
            values.push(JSON.stringify(calculatedFields));
        }
        if (quickMeasures !== undefined) {
            fields.push(`quick_measures = $${idx++}`);
            values.push(JSON.stringify(quickMeasures));
        }
        if (layout !== undefined) {
            fields.push(`layout = $${idx++}`);
            values.push(JSON.stringify(layout));
        }
        if (theme !== undefined) {
            fields.push(`theme = $${idx++}`);
            values.push(JSON.stringify(theme));
        }

        if (fields.length === 0) {
            // Nothing to update, check existence and return
            const existing = await query('SELECT * FROM dashboards WHERE id = $1 AND workspace_id = $2', [dashboardId, workspaceId]);
            if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Dashboard not found' });
            return res.json({ success: true, data: formatDashboard(existing.rows[0]) });
        }

        values.push(dashboardId);
        values.push(workspaceId);

        const result = await query(
            `UPDATE dashboards SET ${fields.join(', ')}
             WHERE id = $${idx++} AND workspace_id = $${idx++}
             RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Dashboard not found' });
        }

        res.json({ success: true, data: formatDashboard(result.rows[0]) });
    } catch (err) {
        console.error('Update dashboard error:', err);
        res.status(500).json({ success: false, message: 'Failed to update dashboard' });
    }
});

/**
 * DELETE /api/dashboards/:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const result = await query(
            'UPDATE dashboards SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1 AND workspace_id = $2 RETURNING id',
            [req.params.id, req.user.workspace_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Dashboard not found' });
        }

        res.json({ success: true, message: 'Dashboard deleted' });
    } catch (err) {
        console.error('Delete dashboard error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete dashboard' });
    }
});

/**
 * POST /api/dashboards/:id/share - Update share permissions
 */
router.post('/:id/share', async (req, res) => {
    const client = await getClient();
    try {
        const { permissions } = req.body; // Array of { userId, permission }
        const dashboardId = req.params.id;
        const normalizedPermissions = normalizeSharePermissions(permissions, {
            includeAllowedPages: true,
            includeRls: true,
        });
        const targetUsers = normalizedPermissions.map((p) => normalizeIdentity(p.userId));

        await client.query('BEGIN');

        const dashboardCheck = await client.query(
            'SELECT id FROM dashboards WHERE id = $1 AND workspace_id = $2 AND COALESCE(is_deleted, FALSE) = FALSE',
            [dashboardId, req.user.workspace_id]
        );
        if (dashboardCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Dashboard not found' });
        }

        if (targetUsers.length > 0) {
            const usersInWorkspace = await client.query(
                `SELECT LOWER(email) AS email
                 FROM users
                 WHERE workspace_id = $1
                   AND LOWER(email) = ANY($2::text[])`,
                [req.user.workspace_id, targetUsers]
            );
            const allowedSet = new Set(usersInWorkspace.rows.map((r) => r.email));
            const unknown = normalizedPermissions
                .map((p) => p.userId)
                .filter((email) => !allowedSet.has(normalizeIdentity(email)));
            if (unknown.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Users not found in this workspace: ${unknown.join(', ')}`,
                });
            }
        }

        // Remove existing shares (except self)
        await client.query(
            'DELETE FROM dashboard_shares WHERE dashboard_id = $1',
            [dashboardId]
        );

        // Insert new shares
        for (const perm of normalizedPermissions) {
            const allowedPageIds = Array.isArray(perm?.allowedPageIds) ? perm.allowedPageIds : [];
            const rlsConfig = perm?.rls && typeof perm.rls === 'object' ? perm.rls : {};
            try {
                await client.query(
                    `INSERT INTO dashboard_shares (dashboard_id, user_id, permission, allowed_page_ids, rls_config) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
             ON CONFLICT (dashboard_id, user_id) DO UPDATE
             SET permission = EXCLUDED.permission,
                 allowed_page_ids = EXCLUDED.allowed_page_ids,
                 rls_config = EXCLUDED.rls_config,
                 shared_at = NOW()`,
                    [dashboardId, perm.userId, perm.permission, JSON.stringify(allowedPageIds), JSON.stringify(rlsConfig)]
                );
            } catch (err) {
                if (err.code !== '42703') throw err;
                // Backward-compatible fallback when RLS columns are not migrated yet.
                await client.query(
                    `INSERT INTO dashboard_shares (dashboard_id, user_id, permission) VALUES ($1, $2, $3)
             ON CONFLICT (dashboard_id, user_id) DO UPDATE
             SET permission = EXCLUDED.permission,
                 shared_at = NOW()`,
                    [dashboardId, perm.userId, perm.permission]
                );
            }
        }

        await client.query('COMMIT');

        res.json({ success: true, message: 'Permissions updated' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Share dashboard error:', err);
        res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Failed to share dashboard' });
    } finally {
        client.release();
    }
});

function formatDashboard(row) {
    const shares = Array.isArray(row.shared_with) ? row.shared_with : [];
    return {
        id: row.id,
        title: row.title,
        description: row.description || undefined,
        folderId: row.folder_id || undefined,
        dataSourceId: row.data_source_id || undefined,
        dataSourceName: row.data_source_name || undefined,
        enableCrossFilter: row.enable_cross_filter,
        pages: parseJsonArrayValue(row.pages),
        widgets: parseJsonArrayValue(row.widgets),
        activePageId: row.active_page_id || '',
        globalFilters: parseJsonArrayValue(row.global_filters),
        calculatedFields: parseJsonArrayValue(row.calculated_fields),
        quickMeasures: parseJsonArrayValue(row.quick_measures),
        layout: parseJsonObjectValue(row.layout),
        theme: parseJsonObjectValue(row.theme),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        createdBy: row.created_by,
        sharedWith: shares.map((share) => ({
            ...share,
            permission: normalizeSharePermission(share?.permission) || share?.permission,
        })),
    };
}

function applyPageAccessConstraint(dashboard, email) {
    const shares = Array.isArray(dashboard.sharedWith) ? dashboard.sharedWith : [];
    const currentUser = normalizeIdentity(email);
    const currentShare = shares.find((s) => normalizeIdentity(s?.userId) === currentUser);
    if (!currentShare || currentShare.permission === 'admin') return dashboard;

    const allowed = Array.isArray(currentShare.allowedPageIds) ? currentShare.allowedPageIds : [];
    if (allowed.length === 0) return dashboard;

    const filteredPages = (dashboard.pages || []).filter((p) => allowed.includes(p.id));
    return {
        ...dashboard,
        pages: filteredPages,
        activePageId: filteredPages.some((p) => p.id === dashboard.activePageId)
            ? dashboard.activePageId
            : (filteredPages[0]?.id || ''),
    };
}

function parseJsonArrayValue(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            return [];
        }
    }
    return [];
}

function parseJsonObjectValue(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (err) {
            return {};
        }
    }
    return {};
}

module.exports = router;
