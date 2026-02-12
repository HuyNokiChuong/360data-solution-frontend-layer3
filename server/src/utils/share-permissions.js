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

const normalizeSharePermission = (value) => {
    const key = normalizeIdentity(value);
    return PERMISSION_ALIASES[key] || null;
};

const normalizeShareUserId = (value) => String(value || '').trim();

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
        const userId = normalizeShareUserId(entry?.userId);
        const permission = normalizeSharePermission(entry?.permission);

        if (!userId) {
            const err = new Error(`permissions[${index}].userId is required`);
            err.status = 400;
            throw err;
        }

        if (!permission) {
            const err = new Error(`permissions[${index}].permission is invalid`);
            err.status = 400;
            throw err;
        }

        const normalized = {
            userId,
            permission,
        };

        if (includeAllowedPages) {
            normalized.allowedPageIds = normalizeAllowedPageIds(entry?.allowedPageIds);
        }

        if (includeRls) {
            normalized.rls = ensureObject(entry?.rls);
        }

        byUser.set(normalizeIdentity(userId), normalized);
    });

    return Array.from(byUser.values());
};

module.exports = {
    normalizeIdentity,
    normalizeSharePermission,
    normalizeSharePermissions,
};
