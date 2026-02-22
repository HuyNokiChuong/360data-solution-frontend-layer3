// ============================================
// Audit Log Middleware
// ============================================
const { query } = require('../config/db');

const EXCLUDED_PATH_PREFIXES = ['/api/logs', '/api/health'];

const getRequestPath = (originalUrl) => String(originalUrl || '/').split('?')[0] || '/';

const isAuditableRequest = (req) => {
    if (!req || req.method === 'OPTIONS') return false;
    const path = getRequestPath(req.originalUrl);
    if (!path.startsWith('/api/')) return false;
    return !EXCLUDED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
};

/**
 * Middleware: Audit all API actions (read + write) to audit_logs.
 */
const auditLog = (req, res, next) => {
    if (!isAuditableRequest(req)) return next();

    const requestPath = getRequestPath(req.originalUrl);
    const requestBodyKeys = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? Object.keys(req.body).slice(0, 50)
        : [];
    const queryKeys = req.query && typeof req.query === 'object'
        ? Object.keys(req.query).slice(0, 50)
        : [];

    // Capture JSON payload if response uses res.json
    const originalJson = res.json.bind(res);
    res.json = (body) => {
        res.locals.__auditResponseBody = body;
        return originalJson(body);
    };

    res.on('finish', () => {
        setImmediate(async () => {
            try {
                const body = res.locals.__auditResponseBody;
                const entityType = extractEntityType(requestPath);
                const entityId = extractEntityId(requestPath, body);
                const success = typeof body?.success === 'boolean' ? body.success : res.statusCode < 400;

                const action = `${req.method} ${requestPath}`.slice(0, 50);
                await query(
                    `INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, details, ip_address, user_agent)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        req.user?.workspace_id || null,
                        req.user?.id || null,
                        action,
                        entityType,
                        entityId,
                        JSON.stringify({
                            success,
                            status_code: res.statusCode,
                            request_body_keys: requestBodyKeys,
                            query_keys: queryKeys,
                        }),
                        req.ip || req.connection?.remoteAddress || null,
                        String(req.headers['user-agent'] || '').substring(0, 255),
                    ]
                );
            } catch (err) {
                console.error('⚠️ Audit log error (non-blocking):', err.message);
            }
        });
    });

    next();
};

function extractEntityType(path) {
    const parts = String(path || '/').split('/').filter(Boolean);
    // e.g. /api/connections/123 => "connection"
    if (parts.length >= 2 && parts[0] === 'api') {
        return parts[1].replace(/s$/, '');
    }
    return parts[0] || 'unknown';
}

function extractEntityId(path, body) {
    const parts = String(path || '/').split('/').filter(Boolean);
    for (const part of parts) {
        if (/^[0-9a-f-]{36}$/i.test(part) || /^[a-z]-\d+/i.test(part)) {
            return part;
        }
    }
    return body?.data?.id || null;
}

module.exports = { auditLog };
