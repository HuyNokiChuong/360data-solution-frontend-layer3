const PERMISSION_ALIASES = {
    view: 'view',
    viewer: 'view',
    read: 'view',
    edit: 'edit',
    editor: 'edit',
    write: 'edit',
    admin: 'admin',
    owner: 'admin',
};

const normalizeIdentity = (value) => String(value || '').trim().toLowerCase();
const normalizeShareTargetType = (value) => (normalizeIdentity(value) === 'group' ? 'group' : 'user');

const normalizeSharePermission = (value) => {
    const key = normalizeIdentity(value);
    return PERMISSION_ALIASES[key] || null;
};

const normalizeShareTargetId = (value) => String(value || '').trim();

const ensureObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const normalizeAllowedPageIds = (value) => {
    if (!Array.isArray(value)) return [];
    const ids = value
        .map((id) => String(id || '').trim())
        .filter(Boolean);
    return Array.from(new Set(ids));
};

const normalizeSharePermissions = (permissions, options = {}) => {
    const includeAllowedPages = options.includeAllowedPages === true;
    const includeRls = options.includeRls !== false;

    if (!Array.isArray(permissions)) {
        const err = new Error('permissions must be an array');
        err.status = 400;
        throw err;
    }

    const byUser = new Map();

    permissions.forEach((entry, index) => {
        const targetType = normalizeShareTargetType(entry?.targetType);
        const fallbackId = targetType === 'group' ? entry?.groupId : entry?.userId;
        const targetId = normalizeShareTargetId(entry?.targetId || fallbackId);
        const permission = normalizeSharePermission(entry?.permission);

        if (!targetId) {
            const err = new Error(`permissions[${index}].targetId is required`);
            err.status = 400;
            throw err;
        }

        if (!permission) {
            const err = new Error(`permissions[${index}].permission is invalid`);
            err.status = 400;
            throw err;
        }

        const normalized = {
            targetType,
            targetId,
            userId: targetType === 'user' ? targetId : undefined,
            groupId: targetType === 'group' ? targetId : undefined,
            permission,
        };

        if (includeAllowedPages) {
            normalized.allowedPageIds = normalizeAllowedPageIds(entry?.allowedPageIds);
        }

        if (includeRls) {
            normalized.rls = ensureObject(entry?.rls);
        }

        byUser.set(`${targetType}:${normalizeIdentity(targetId)}`, normalized);
    });

    return Array.from(byUser.values());
};

module.exports = {
    normalizeIdentity,
    normalizeShareTargetType,
    normalizeShareTargetId,
    normalizeSharePermission,
    normalizeSharePermissions,
};
