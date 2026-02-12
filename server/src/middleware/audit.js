// ============================================
// Audit Log Middleware
// ============================================
const { query } = require('../config/db');

/**
 * Middleware: Log all write operations (POST/PUT/DELETE) to audit_logs
 */
const auditLog = async (req, res, next) => {
    // Only audit write operations
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        return next();
    }

    // Store original res.json to intercept response
    const originalJson = res.json.bind(res);

    res.json = (body) => {
        // Log asynchronously (don't block response)
        setImmediate(async () => {
            try {
                const entityType = extractEntityType(req.path);
                const entityId = extractEntityId(req.path, body);

                const action = `${req.method} ${req.path}`.slice(0, 50);
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
                            status_code: res.statusCode,
                            success: body?.success,
                            request_body_keys: req.body ? Object.keys(req.body) : [],
                        }),
                        req.ip || req.connection?.remoteAddress,
                        req.headers['user-agent']?.substring(0, 255),
                    ]
                );
            } catch (err) {
                console.error('⚠️ Audit log error (non-blocking):', err.message);
            }
        });

        return originalJson(body);
    };

    next();
};

function extractEntityType(path) {
    const parts = path.split('/').filter(Boolean);
    // e.g. /api/connections/123 → "connection"
    // e.g. /api/auth/register → "auth"
    if (parts.length >= 2) {
        const entity = parts[1]; // 'connections', 'dashboards', etc.
        return entity.replace(/s$/, ''); // singularize
    }
    return 'unknown';
}

function extractEntityId(path, body) {
    const parts = path.split('/').filter(Boolean);
    // Try to find UUID-like segment
    for (const part of parts) {
        if (part.match(/^[0-9a-f-]{36}$/i) || part.match(/^[a-z]-\d+/)) {
            return part;
        }
    }
    // Fallback: try response body
    return body?.data?.id || null;
}

module.exports = { auditLog };
