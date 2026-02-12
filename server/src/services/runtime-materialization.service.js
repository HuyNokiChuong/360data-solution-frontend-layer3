const crypto = require('crypto');

const SNAPSHOT_SCHEMA = 'ingestion_snapshots';

const quoteIdent = (value) => `"${String(value || '').replace(/"/g, '""')}"`;

const hashText = (value, len = 10) => crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, len);

const sanitizeNamePart = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const buildExternalSnapshotTableName = (syncedTableId, datasetName, tableName) => {
    const datasetPart = sanitizeNamePart(datasetName).slice(0, 16) || 'dataset';
    const tablePart = sanitizeNamePart(tableName).slice(0, 24) || 'table';
    const digest = hashText(syncedTableId || `${datasetName}.${tableName}`, 12);
    return `ext_${datasetPart}_${tablePart}_${digest}`.slice(0, 63);
};

const parseSchemaDef = (schemaDef) => {
    if (!schemaDef) return [];
    if (Array.isArray(schemaDef)) return schemaDef;
    if (typeof schemaDef === 'string') {
        try {
            const parsed = JSON.parse(schemaDef);
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            return [];
        }
    }
    return [];
};

const resolvePgType = (rawType) => {
    const t = String(rawType || '').trim().toUpperCase();
    if (!t) return 'TEXT';

    if (t.includes('BOOL')) return 'BOOLEAN';
    if (t === 'DATE') return 'DATE';
    if (t.includes('TIMESTAMP') || t.includes('DATETIME') || (t.includes('TIME') && !t.includes('WITHOUT'))) {
        return 'TIMESTAMPTZ';
    }
    if (t.includes('INT')) return 'BIGINT';
    if (t.includes('NUMERIC') || t.includes('DECIMAL')) return 'NUMERIC';
    if (t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('REAL') || t.includes('NUMBER')) return 'DOUBLE PRECISION';
    return 'TEXT';
};

const coerceValueForType = (raw, pgType) => {
    if (raw === undefined || raw === null || raw === '') return null;

    if (pgType === 'BOOLEAN') {
        if (typeof raw === 'boolean') return raw;
        const s = String(raw).trim().toLowerCase();
        if (['true', 't', '1', 'yes', 'y'].includes(s)) return true;
        if (['false', 'f', '0', 'no', 'n'].includes(s)) return false;
        return null;
    }

    if (pgType === 'BIGINT') {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return null;
        return Math.trunc(parsed);
    }

    if (pgType === 'NUMERIC' || pgType === 'DOUBLE PRECISION') {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    }

    if (pgType === 'DATE') {
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString().slice(0, 10);
    }

    if (pgType === 'TIMESTAMPTZ') {
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString();
    }

    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object') return JSON.stringify(raw);
    return String(raw);
};

const upsertModelRuntimeTable = async (client, payload) => {
    await client.query(
        `INSERT INTO model_runtime_tables (
            workspace_id,
            synced_table_id,
            connection_id,
            source_type,
            runtime_engine,
            runtime_schema,
            runtime_table,
            runtime_ref,
            is_executable,
            executable_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (synced_table_id)
        DO UPDATE SET
            workspace_id = EXCLUDED.workspace_id,
            connection_id = EXCLUDED.connection_id,
            source_type = EXCLUDED.source_type,
            runtime_engine = EXCLUDED.runtime_engine,
            runtime_schema = EXCLUDED.runtime_schema,
            runtime_table = EXCLUDED.runtime_table,
            runtime_ref = EXCLUDED.runtime_ref,
            is_executable = EXCLUDED.is_executable,
            executable_reason = EXCLUDED.executable_reason,
            updated_at = NOW()`,
        [
            payload.workspaceId,
            payload.syncedTableId,
            payload.connectionId || null,
            payload.sourceType,
            payload.runtimeEngine,
            payload.runtimeSchema || null,
            payload.runtimeTable || null,
            payload.runtimeRef || null,
            payload.isExecutable !== false,
            payload.executableReason || null,
        ]
    );
};

const registerBigQueryRuntime = async (client, {
    workspaceId,
    syncedTableId,
    connectionId,
    sourceType,
    projectId,
    datasetName,
    tableName,
}) => {
    const hasRuntimeRef = Boolean(projectId && datasetName && tableName);
    const runtimeRef = hasRuntimeRef
        ? `\`${projectId}.${datasetName}.${tableName}\``
        : null;

    await upsertModelRuntimeTable(client, {
        workspaceId,
        syncedTableId,
        connectionId,
        sourceType: sourceType || 'BigQuery',
        runtimeEngine: 'bigquery',
        runtimeSchema: null,
        runtimeTable: null,
        runtimeRef,
        isExecutable: hasRuntimeRef,
        executableReason: hasRuntimeRef ? null : 'Missing BigQuery runtime reference',
    });
};

const registerPostgresSnapshotRuntime = async (client, {
    workspaceId,
    syncedTableId,
    connectionId,
    sourceType,
    snapshotTableName,
}) => {
    const hasSnapshot = Boolean(snapshotTableName);
    await upsertModelRuntimeTable(client, {
        workspaceId,
        syncedTableId,
        connectionId,
        sourceType: sourceType || 'PostgreSQL',
        runtimeEngine: 'postgres',
        runtimeSchema: hasSnapshot ? SNAPSHOT_SCHEMA : null,
        runtimeTable: hasSnapshot ? snapshotTableName : null,
        runtimeRef: hasSnapshot ? `${quoteIdent(SNAPSHOT_SCHEMA)}.${quoteIdent(snapshotTableName)}` : null,
        isExecutable: hasSnapshot,
        executableReason: hasSnapshot ? null : 'PostgreSQL snapshot chưa sẵn sàng',
    });
};

const materializeSyncedTableToSnapshot = async (client, {
    workspaceId,
    connectionId,
    sourceType,
    syncedTable,
}) => {
    const schemaDef = parseSchemaDef(syncedTable.schema_def);
    const columns = schemaDef
        .map((field) => ({
            name: String(field?.name || '').trim(),
            pgType: resolvePgType(field?.type),
        }))
        .filter((field) => field.name);

    const snapshotTableName = buildExternalSnapshotTableName(
        syncedTable.id,
        syncedTable.dataset_name,
        syncedTable.table_name
    );

    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(SNAPSHOT_SCHEMA)}`);

    const columnSql = columns.length > 0
        ? columns.map((field) => `${quoteIdent(field.name)} ${field.pgType}`).join(', ')
        : `${quoteIdent('__empty__')} TEXT`;

    await client.query(`DROP TABLE IF EXISTS ${quoteIdent(SNAPSHOT_SCHEMA)}.${quoteIdent(snapshotTableName)} CASCADE`);
    await client.query(
        `CREATE TABLE ${quoteIdent(SNAPSHOT_SCHEMA)}.${quoteIdent(snapshotTableName)} (
            ${quoteIdent('__row_index__')} BIGINT NOT NULL,
            ${columnSql}
        )`
    );

    const rowsResult = await client.query(
        `SELECT row_index, row_data
         FROM excel_sheet_rows
         WHERE synced_table_id = $1
         ORDER BY row_index ASC`,
        [syncedTable.id]
    );

    const rows = rowsResult.rows || [];
    if (rows.length > 0) {
        const chunkSize = 200;
        for (let offset = 0; offset < rows.length; offset += chunkSize) {
            const chunk = rows.slice(offset, offset + chunkSize);
            const values = [];
            const placeholders = [];

            chunk.forEach((row, idx) => {
                const rowData = typeof row.row_data === 'string'
                    ? JSON.parse(row.row_data)
                    : (row.row_data || {});

                const rowValues = [row.row_index];
                columns.forEach((col) => {
                    rowValues.push(coerceValueForType(rowData[col.name], col.pgType));
                });

                rowValues.forEach((val) => values.push(val));

                const base = idx * (columns.length + 1);
                const rowPlaceholders = new Array(columns.length + 1)
                    .fill(0)
                    .map((_, pos) => `$${base + pos + 1}`)
                    .join(', ');
                placeholders.push(`(${rowPlaceholders})`);
            });

            const columnList = [quoteIdent('__row_index__'), ...columns.map((col) => quoteIdent(col.name))].join(', ');
            await client.query(
                `INSERT INTO ${quoteIdent(SNAPSHOT_SCHEMA)}.${quoteIdent(snapshotTableName)} (${columnList})
                 VALUES ${placeholders.join(', ')}`,
                values
            );
        }
    }

    await upsertModelRuntimeTable(client, {
        workspaceId,
        syncedTableId: syncedTable.id,
        connectionId,
        sourceType,
        runtimeEngine: 'postgres',
        runtimeSchema: SNAPSHOT_SCHEMA,
        runtimeTable: snapshotTableName,
        runtimeRef: `${quoteIdent(SNAPSHOT_SCHEMA)}.${quoteIdent(snapshotTableName)}`,
        isExecutable: true,
        executableReason: null,
    });

    return {
        snapshotTableName,
        runtimeRef: `${quoteIdent(SNAPSHOT_SCHEMA)}.${quoteIdent(snapshotTableName)}`,
    };
};

module.exports = {
    SNAPSHOT_SCHEMA,
    quoteIdent,
    upsertModelRuntimeTable,
    registerBigQueryRuntime,
    registerPostgresSnapshotRuntime,
    materializeSyncedTableToSnapshot,
};
