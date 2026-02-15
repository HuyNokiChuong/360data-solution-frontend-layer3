// ============================================
// Folder Routes - CRUD + Share
// ============================================
const express = require('express');
const { query, getClient, isValidUUID } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { normalizeIdentity, normalizeSharePermission, normalizeSharePermissions } = require('../utils/share-permissions');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/folders - List workspace folders
 */
router.get('/', async (req, res) => {
    try {
        const result = await query(
            `SELECT f.*,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'targetType', COALESCE((to_jsonb(fs)->>'target_type'), 'user'),
            'targetId', COALESCE((to_jsonb(fs)->>'target_id'), fs.user_id),
            'userId', fs.user_id,
            'groupId', CASE
              WHEN COALESCE((to_jsonb(fs)->>'target_type'), 'user') = 'group'
              THEN COALESCE((to_jsonb(fs)->>'target_id'), fs.user_id)
              ELSE NULL
            END,
            'permission', fs.permission,
            'sharedAt', fs.shared_at,
            'rls', COALESCE(to_jsonb(fs)->'rls_config', '{}'::jsonb)
          ))
           FROM folder_shares fs WHERE fs.folder_id = f.id), '[]'
        ) as shared_with
       FROM folders f
       WHERE f.workspace_id = $1 AND f.is_deleted = FALSE ORDER BY f.name`,
            [req.user.workspace_id]
        );

        res.json({ success: true, data: result.rows.map(formatFolder) });
    } catch (err) {
        console.error('List folders error:', err);
        res.status(500).json({ success: false, message: 'Failed to list folders' });
    }
});

/**
 * POST /api/folders - Create folder
 */
router.post('/', async (req, res) => {
    try {
        const { name, parentId, icon, color } = req.body;

        // Validate parentId
        const validParentId = isValidUUID(parentId) ? parentId : null;

        const result = await query(
            `INSERT INTO folders (workspace_id, created_by, name, parent_id, icon, color)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
            [req.user.workspace_id, req.user.id, name || 'New Folder', validParentId, icon, color]
        );

        // Auto-share with creator
        try {
            await query(
                `INSERT INTO folder_shares (folder_id, user_id, target_type, target_id, permission)
                 VALUES ($1, $2, 'user', $2, 'admin')
                 ON CONFLICT (folder_id, target_type, target_id) DO NOTHING`,
                [result.rows[0].id, req.user.email]
            );
        } catch (err) {
            if (err.code !== '42703' && err.code !== '42P10') throw err;
            await query(
                `INSERT INTO folder_shares (folder_id, user_id, permission) VALUES ($1, $2, 'admin')
                 ON CONFLICT (folder_id, user_id) DO NOTHING`,
                [result.rows[0].id, req.user.email]
            );
        }

        res.status(201).json({ success: true, data: formatFolder(result.rows[0]) });
    } catch (err) {
        console.error('Create folder error:', err);
        res.status(500).json({ success: false, message: 'Failed to create folder' });
    }
});


/**
 * PUT /api/folders/:id - Update folder
 */
router.put('/:id', async (req, res) => {
    try {
        const { name, parentId, icon, color } = req.body;
        const folderId = req.params.id;
        const workspaceId = req.user.workspace_id;

        // Build dynamic update query
        const fields = [];
        const values = [];
        let idx = 1;

        if (name !== undefined) {
            fields.push(`name = $${idx++}`);
            values.push(name);
        }
        if (parentId !== undefined) {
            // Prevent self-parenting
            if (parentId === folderId) {
                return res.status(400).json({ success: false, message: 'Folder cannot be its own parent' });
            }
            fields.push(`parent_id = $${idx++}`);
            // Validate UUID: if invalid string or null, set to null
            values.push(isValidUUID(parentId) ? parentId : null);
        }
        if (icon !== undefined) {
            fields.push(`icon = $${idx++}`);
            values.push(icon);
        }
        if (color !== undefined) {
            fields.push(`color = $${idx++}`);
            values.push(color);
        }

        if (fields.length === 0) {
            // Nothing to update, check existence and return
            const existing = await query('SELECT * FROM folders WHERE id = $1 AND workspace_id = $2', [folderId, workspaceId]);
            if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Folder not found' });
            return res.json({ success: true, data: formatFolder(existing.rows[0]) });
        }

        values.push(folderId);
        values.push(workspaceId);

        const result = await query(
            `UPDATE folders SET ${fields.join(', ')}
             WHERE id = $${idx++} AND workspace_id = $${idx++}
             RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Folder not found' });
        }

        res.json({ success: true, data: formatFolder(result.rows[0]) });
    } catch (err) {
        console.error('Update folder error:', err);
        res.status(500).json({ success: false, message: 'Failed to update folder' });
    }
});

/**
 * DELETE /api/folders/:id - Delete folder (cascade children)
 */
router.delete('/:id', async (req, res) => {
    try {
        const result = await query(
            'UPDATE folders SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1 AND workspace_id = $2 RETURNING id',
            [req.params.id, req.user.workspace_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Folder not found' });
        }

        res.json({ success: true, message: 'Folder deleted' });
    } catch (err) {
        console.error('Delete folder error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete folder' });
    }
});

/**
 * POST /api/folders/:id/share
 */
router.post('/:id/share', async (req, res) => {
    const client = await getClient();
    try {
        const { permissions } = req.body;
        const folderId = req.params.id;
        const normalizedPermissions = normalizeSharePermissions(permissions, { includeRls: true });
        const targetUsers = normalizedPermissions
            .filter((p) => p.targetType === 'user')
            .map((p) => normalizeIdentity(p.targetId));
        const targetGroups = normalizedPermissions
            .filter((p) => p.targetType === 'group')
            .map((p) => normalizeIdentity(p.targetId))
            .filter(Boolean);

        await client.query('BEGIN');

        const folderCheck = await client.query(
            'SELECT id FROM folders WHERE id = $1 AND workspace_id = $2 AND is_deleted = FALSE',
            [folderId, req.user.workspace_id]
        );
        if (folderCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Folder not found' });
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
                .filter((p) => p.targetType === 'user')
                .map((p) => p.targetId)
                .filter((email) => !allowedSet.has(normalizeIdentity(email)));
            if (unknown.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Users not found in this workspace: ${unknown.join(', ')}`,
                });
            }
        }

        if (targetGroups.length > 0) {
            const groupsInWorkspace = await client.query(
                `SELECT DISTINCT LOWER(group_name) AS group_name
                 FROM users
                 WHERE workspace_id = $1
                   AND group_name IS NOT NULL
                   AND group_name <> ''
                   AND LOWER(group_name) = ANY($2::text[])`,
                [req.user.workspace_id, targetGroups]
            );
            const allowedGroupSet = new Set(groupsInWorkspace.rows.map((row) => row.group_name));
            const unknownGroups = normalizedPermissions
                .filter((p) => p.targetType === 'group')
                .map((p) => p.targetId)
                .filter((groupId) => !allowedGroupSet.has(normalizeIdentity(groupId)));
            if (unknownGroups.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Groups not found in this workspace: ${unknownGroups.join(', ')}`,
                });
            }
        }

        await client.query('DELETE FROM folder_shares WHERE folder_id = $1', [folderId]);

        for (const perm of normalizedPermissions) {
            const rlsConfig = perm?.rls && typeof perm.rls === 'object' ? perm.rls : {};
            try {
                await client.query(
                    `INSERT INTO folder_shares (folder_id, user_id, target_type, target_id, permission, rls_config)
                     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                     ON CONFLICT (folder_id, target_type, target_id)
                     DO UPDATE SET permission = EXCLUDED.permission, rls_config = EXCLUDED.rls_config, shared_at = NOW()`,
                    [
                        folderId,
                        perm.targetType === 'user' ? perm.targetId : null,
                        perm.targetType,
                        perm.targetId,
                        perm.permission,
                        JSON.stringify(rlsConfig),
                    ]
                );
            } catch (err) {
                if (err.code !== '42703' && err.code !== '42P10') throw err;
                if (perm.targetType === 'group') {
                    const fallbackErr = new Error('Group sharing requires migration 010_groups_and_table_access.sql');
                    fallbackErr.status = 400;
                    throw fallbackErr;
                }
                await client.query(
                    `INSERT INTO folder_shares (folder_id, user_id, permission) VALUES ($1, $2, $3)
             ON CONFLICT (folder_id, user_id) DO UPDATE SET permission = EXCLUDED.permission, shared_at = NOW()`,
                    [folderId, perm.targetId, perm.permission]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Folder permissions updated' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Share folder error:', err);
        res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Failed to share folder' });
    } finally {
        client.release();
    }
});

function formatFolder(row) {
    const shares = Array.isArray(row.shared_with) ? row.shared_with : [];
    return {
        id: row.id,
        name: row.name,
        parentId: row.parent_id || undefined,
        icon: row.icon || undefined,
        color: row.color || undefined,
        createdAt: row.created_at,
        createdBy: row.created_by,
        sharedWith: shares.map((share) => {
            const targetType = normalizeIdentity(share?.targetType) === 'group' ? 'group' : 'user';
            const targetId = String(share?.targetId || (targetType === 'group' ? share?.groupId : share?.userId) || '').trim();
            return {
                ...share,
                targetType,
                targetId,
                userId: targetType === 'user' ? (targetId || share?.userId) : undefined,
                groupId: targetType === 'group' ? (targetId || share?.groupId) : undefined,
                permission: normalizeSharePermission(share?.permission) || share?.permission,
            };
        }),
    };
}

module.exports = router;
