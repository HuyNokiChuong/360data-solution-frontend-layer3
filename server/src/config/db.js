// ============================================
// Database Configuration - PostgreSQL Pool
// ============================================
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || '103.249.116.116',
    port: parseInt(process.env.DB_PORT || '5433'),
    database: process.env.DB_NAME || 'bidata',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'admin123',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
    console.error('❌ Unexpected PostgreSQL pool error:', err);
});

pool.on('connect', () => {
    console.log('✅ New PostgreSQL client connected');
});

/**
 * Execute a query with automatic client checkout/return
 */
const query = async (text, params) => {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        if (duration > 1000) {
            console.warn(`⚠️ Slow query (${duration}ms):`, text.substring(0, 80));
        }
        return result;
    } catch (err) {
        console.error('❌ Query error:', { text: text.substring(0, 100), error: err.message });
        throw err;
    }
};

/**
 * Get a client for transactions
 */
const getClient = async () => {
    const client = await pool.connect();
    return client;
};

/**
 * Validate UUID format
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUUID = (str) => str && UUID_RE.test(str);

module.exports = { pool, query, getClient, isValidUUID };
