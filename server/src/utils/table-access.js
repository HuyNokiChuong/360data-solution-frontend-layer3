const { query } = require('../config/db');

const normalizeIdentity = (value) => String(value || '').trim().toLowerCase();

const isAdminUser = (user) => String(user?.role || '').trim().toLowerCase() === 'admin';

const normalizeTargetType = (value) => {
    const raw = normalizeIdentity(value);
    return raw === 'group' ? 'group' : 'user';
};

const normalizeTargetId = (value) => normalizeIdentity(value);

const normalizeTableAccessEntries = (entries) => {
    if (!Array.isArray(entries)) {
        const err = new Error('entries must be an array');
        err.status = 400;
        throw err;
    }

    const dedup = new Map();
    entries.forEach((entry, index) => {
        const targetType = normalizeTargetType(entry?.targetType);
        const fallbackId = targetType === 'group' ? entry?.groupId : entry?.userId;
        const targetId = normalizeTargetId(entry?.targetId || fallbackId);

        if (!targetId) {
            const err = new Error(`entries[${index}].targetId is required`);
            err.status = 400;
            throw err;
        }

        const key = `${targetType}:${targetId}`;
        dedup.set(key, { targetType, targetId });
    });

    return Array.from(dedup.values());
};

const isMissingTableAccessTableError = (err) => (
    err?.code === '42P01' && /table_view_permissions/i.test(String(err?.message || ''))
);

const loadTablePermissionCounts = async ({ workspaceId, tableIds }) => {
    if (!Array.isArray(tableIds) || tableIds.length === 0) return new Map();

    try {
        const result = await query(
            `SELECT synced_table_id, COUNT(*)::int AS permission_count
             FROM table_view_permissions
             WHERE workspace_id = $1
               AND synced_table_id = ANY($2::uuid[])
             GROUP BY synced_table_id`,
            [workspaceId, tableIds]
        );

        return new Map(result.rows.map((row) => [row.synced_table_id, Number(row.permission_count || 0)]));
    } catch (err) {
        if (isMissingTableAccessTableError(err)) {
            return new Map();
        }
        throw err;
    }
};

const getAccessibleTableIds = async ({ workspaceId, user, tableIds }) => {
    const ids = Array.isArray(tableIds)
        ? Array.from(new Set(tableIds.map((id) => String(id || '').trim()).filter(Boolean)))
        : [];
    if (ids.length === 0) return new Set();
    if (isAdminUser(user)) return new Set(ids);

    const email = normalizeTargetId(user?.email);
    const groupName = normalizeTargetId(user?.group_name || user?.groupName || '');

    try {
        const result = await query(
            `SELECT st.id
             FROM synced_tables st
             JOIN connections c ON c.id = st.connection_id
             WHERE c.workspace_id = $1
               AND c.is_deleted = FALSE
               AND st.is_deleted = FALSE
               AND st.id = ANY($2::uuid[])
               AND (
                    NOT EXISTS (
                        SELECT 1
                        FROM table_view_permissions tvp
                        WHERE tvp.workspace_id = c.workspace_id
                          AND tvp.synced_table_id = st.id
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM table_view_permissions tvp
                        WHERE tvp.workspace_id = c.workspace_id
                          AND tvp.synced_table_id = st.id
                          AND (
                                (tvp.target_type = 'user' AND LOWER(tvp.target_id) = $3)
                                OR (tvp.target_type = 'group' AND $4 <> '' AND LOWER(tvp.target_id) = $4)
                          )
                    )
               )`,
            [workspaceId, ids, email, groupName]
        );

        return new Set(result.rows.map((row) => String(row.id || '').trim()).filter(Boolean));
    } catch (err) {
        if (isMissingTableAccessTableError(err)) {
            return new Set(ids);
        }
        throw err;
    }
};

const hasTableAccess = async ({ workspaceId, user, tableId }) => {
    const targetId = String(tableId || '').trim();
    if (!targetId) return false;
    if (isAdminUser(user)) return true;
    const allowed = await getAccessibleTableIds({ workspaceId, user, tableIds: [targetId] });
    return allowed.has(targetId);
};

module.exports = {
    normalizeTargetType,
    normalizeTargetId,
    normalizeTableAccessEntries,
    isMissingTableAccessTableError,
    loadTablePermissionCounts,
    getAccessibleTableIds,
    hasTableAccess,
    isAdminUser,
};
