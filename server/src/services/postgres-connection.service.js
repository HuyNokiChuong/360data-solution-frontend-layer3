const { Pool } = require('pg');
const { decryptString } = require('./crypto.service');

const sourcePoolCache = new Map();

const toObject = (value) => {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (err) {
            return {};
        }
    }
    return value && typeof value === 'object' ? value : {};
};

const toBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1';

const normalizePort = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 5432;
    return Math.min(Math.max(Math.floor(parsed), 1), 65535);
};

const parsePostgresConfig = (configValue) => {
    const root = toObject(configValue);
    const postgres = toObject(root.postgres);
    return {
        host: postgres.host ? String(postgres.host).trim() : '',
        port: normalizePort(postgres.port),
        databaseName: postgres.databaseName ? String(postgres.databaseName).trim() : '',
        username: postgres.username ? String(postgres.username).trim() : '',
        ssl: toBoolean(postgres.ssl),
        passwordEncrypted: postgres.passwordEncrypted ? String(postgres.passwordEncrypted) : '',
        updatedAt: postgres.updatedAt || null,
    };
};

const sanitizePostgresConfig = (postgresConfig) => ({
    host: postgresConfig.host || '',
    port: normalizePort(postgresConfig.port),
    databaseName: postgresConfig.databaseName || '',
    username: postgresConfig.username || '',
    ssl: toBoolean(postgresConfig.ssl),
    hasPassword: Boolean(postgresConfig.passwordEncrypted),
});

const validatePostgresConfigInput = (input, { allowMissingPassword = false } = {}) => {
    const raw = toObject(input);
    const host = raw.host ? String(raw.host).trim() : '';
    const databaseName = raw.databaseName ? String(raw.databaseName).trim() : '';
    const username = raw.username ? String(raw.username).trim() : '';
    const password = raw.password !== undefined && raw.password !== null ? String(raw.password) : '';
    const ssl = toBoolean(raw.ssl);
    const port = normalizePort(raw.port);

    if (!host) throw new Error('Host is required');
    if (!databaseName) throw new Error('Database Name is required');
    if (!username) throw new Error('Username is required');
    if (!allowMissingPassword && !password) {
        throw new Error('Password is required');
    }

    return {
        host,
        port,
        databaseName,
        username,
        password,
        ssl,
    };
};

const buildSourcePoolFingerprint = (config) => JSON.stringify({
    host: config.host,
    port: config.port,
    databaseName: config.databaseName,
    username: config.username,
    ssl: config.ssl,
    password: config.password,
});

const buildSourcePoolConfig = (config) => ({
    host: config.host,
    port: config.port,
    database: config.databaseName,
    user: config.username,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    max: 6,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

const getOrCreateSourcePool = (connectionId, sourceConfig) => {
    const fingerprint = buildSourcePoolFingerprint(sourceConfig);
    const cached = sourcePoolCache.get(connectionId);

    if (cached && cached.fingerprint === fingerprint) {
        return cached.pool;
    }

    if (cached) {
        cached.pool.end().catch(() => undefined);
        sourcePoolCache.delete(connectionId);
    }

    const pool = new Pool(buildSourcePoolConfig(sourceConfig));
    pool.on('error', (err) => {
        console.error(`[postgres-source:${connectionId}] pool error`, err.message);
    });

    sourcePoolCache.set(connectionId, {
        fingerprint,
        pool,
    });

    return pool;
};

const getSourceConfigFromConnectionRow = (connectionRow) => {
    const postgres = parsePostgresConfig(connectionRow?.config);

    if (!postgres.host || !postgres.databaseName || !postgres.username) {
        throw new Error('PostgreSQL connection is not fully configured');
    }

    if (!postgres.passwordEncrypted) {
        throw new Error('PostgreSQL connection password is missing');
    }

    let password = '';
    try {
        password = decryptString(postgres.passwordEncrypted);
    } catch (err) {
        throw new Error('Failed to decrypt PostgreSQL connection password');
    }

    if (!password) {
        throw new Error('PostgreSQL connection password is empty');
    }

    return {
        host: postgres.host,
        port: normalizePort(postgres.port),
        databaseName: postgres.databaseName,
        username: postgres.username,
        password,
        ssl: toBoolean(postgres.ssl),
    };
};

const runInReadOnlyTransaction = async (connectionRow, callback) => {
    const sourceConfig = getSourceConfigFromConnectionRow(connectionRow);
    const pool = getOrCreateSourcePool(connectionRow.id, sourceConfig);
    const client = await pool.connect();

    try {
        await client.query('BEGIN READ ONLY');
        const result = await callback(client, sourceConfig);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

const testPostgresConnection = async (inputConfig, options = {}) => {
    const normalized = validatePostgresConfigInput(inputConfig, {
        allowMissingPassword: Boolean(options.existingPasswordEncrypted),
    });

    let password = normalized.password;
    if (!password && options.existingPasswordEncrypted) {
        try {
            password = decryptString(options.existingPasswordEncrypted);
        } catch (err) {
            throw new Error('Unable to decrypt saved password');
        }
    }

    if (!password) {
        throw new Error('Password is required');
    }

    const tempPool = new Pool({
        ...buildSourcePoolConfig({ ...normalized, password }),
        max: 1,
        idleTimeoutMillis: 5000,
    });

    try {
        const client = await tempPool.connect();
        try {
            await client.query('BEGIN READ ONLY');
            const result = await client.query(
                'SELECT current_database() AS database_name, current_user AS user_name, version() AS server_version'
            );
            await client.query('COMMIT');
            return result.rows[0] || {};
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } finally {
        await tempPool.end().catch(() => undefined);
    }
};

const listSchemas = async (connectionRow) => runInReadOnlyTransaction(connectionRow, async (client) => {
    const result = await client.query(
        `SELECT schema_name
         FROM information_schema.schemata
         WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
           AND schema_name NOT LIKE 'pg_temp_%'
         ORDER BY schema_name ASC`
    );

    return result.rows.map((row) => row.schema_name);
});

const listTablesAndViews = async (connectionRow, options = {}) => {
    const includeViews = toBoolean(options.includeViews);

    return runInReadOnlyTransaction(connectionRow, async (client) => {
        let schemas = Array.isArray(options.schemas)
            ? options.schemas.map((item) => String(item || '').trim()).filter(Boolean)
            : [];

        if (schemas.length === 0) {
            const schemaRows = await client.query(
                `SELECT schema_name
                 FROM information_schema.schemata
                 WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                   AND schema_name NOT LIKE 'pg_temp_%'
                 ORDER BY schema_name ASC`
            );
            schemas = schemaRows.rows.map((row) => row.schema_name);
        }

        if (schemas.length === 0) return [];

        const tableTypes = includeViews ? ['BASE TABLE', 'VIEW'] : ['BASE TABLE'];
        const result = await client.query(
            `SELECT table_schema, table_name, table_type
             FROM information_schema.tables
             WHERE table_schema = ANY($1::text[])
               AND table_type = ANY($2::text[])
             ORDER BY table_schema ASC, table_name ASC`,
            [schemas, tableTypes]
        );

        return result.rows.map((row) => ({
            schemaName: row.table_schema,
            tableName: row.table_name,
            objectType: row.table_type === 'VIEW' ? 'view' : 'table',
        }));
    });
};

const listColumns = async (connectionRow, schemaName, tableName) => {
    const schema = String(schemaName || '').trim();
    const table = String(tableName || '').trim();
    if (!schema || !table) {
        throw new Error('schemaName and tableName are required');
    }

    return runInReadOnlyTransaction(connectionRow, async (client) => {
        const result = await client.query(
            `SELECT
                a.attname AS column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS type_expression,
                CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
                a.attnum AS ordinal_position
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1
               AND c.relname = $2
               AND a.attnum > 0
               AND NOT a.attisdropped
             ORDER BY a.attnum ASC`,
            [schema, table]
        );

        return result.rows.map((row) => ({
            name: row.column_name,
            typeExpression: row.type_expression,
            isNullable: row.is_nullable === 'YES',
            ordinalPosition: Number(row.ordinal_position),
        }));
    });
};

const fetchPrimaryKey = async (connectionRow, schemaName, tableName) => {
    const schema = String(schemaName || '').trim();
    const table = String(tableName || '').trim();
    if (!schema || !table) {
        throw new Error('schemaName and tableName are required');
    }

    return runInReadOnlyTransaction(connectionRow, async (client) => {
        const result = await client.query(
            `SELECT a.attname AS column_name
             FROM pg_index i
             JOIN pg_class c ON c.oid = i.indrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN unnest(i.indkey) WITH ORDINALITY AS key_col(attnum, ordinality) ON TRUE
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = key_col.attnum
             WHERE n.nspname = $1
               AND c.relname = $2
               AND i.indisprimary
             ORDER BY key_col.ordinality ASC`,
            [schema, table]
        );

        return result.rows.map((row) => row.column_name);
    });
};

const closeAllSourcePools = async () => {
    const pools = Array.from(sourcePoolCache.values()).map((item) => item.pool);
    sourcePoolCache.clear();
    await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
};

module.exports = {
    parsePostgresConfig,
    sanitizePostgresConfig,
    validatePostgresConfigInput,
    getSourceConfigFromConnectionRow,
    runInReadOnlyTransaction,
    testPostgresConnection,
    listSchemas,
    listTablesAndViews,
    listColumns,
    fetchPrimaryKey,
    closeAllSourcePools,
};
