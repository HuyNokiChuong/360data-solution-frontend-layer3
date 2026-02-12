const crypto = require('crypto');
const { getClient } = require('../config/db');
const {
    listColumns,
    fetchPrimaryKey,
    runInReadOnlyTransaction,
} = require('./postgres-connection.service');
const { registerPostgresSnapshotRuntime } = require('./runtime-materialization.service');

const SNAPSHOT_SCHEMA = 'ingestion_snapshots';
const DEFAULT_BATCH_SIZE = 500;

const quoteIdent = (value) => `"${String(value).replace(/"/g, '""')}"`;

const hashText = (value, len = 12) => crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, len);

const sanitizeNamePart = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const buildSnapshotTableName = (connectionId, schemaName, tableName) => {
    const schemaPart = sanitizeNamePart(schemaName).slice(0, 16) || 'schema';
    const tablePart = sanitizeNamePart(tableName).slice(0, 24) || 'table';
    const digest = hashText(`${connectionId}:${schemaName}.${tableName}`, 12);
    const raw = `pg_${schemaPart}_${tablePart}_${digest}`;
    return raw.slice(0, 63);
};

const qualifySnapshotTable = (tableName) => `${quoteIdent(SNAPSHOT_SCHEMA)}.${quoteIdent(tableName)}`;

const classifyIncrementalKindFromType = (typeExpression) => {
    const t = String(typeExpression || '').toLowerCase();
    if (
        t.includes('timestamp') ||
        t.includes('date') ||
        t.includes('time')
    ) {
        return 'timestamp';
    }
    if (
        t.includes('int') ||
        t.includes('numeric') ||
        t.includes('decimal') ||
        t.includes('serial') ||
        t.includes('bigserial')
    ) {
        return 'id';
    }
    return null;
};

const createSnapshotTable = async (client, tableName, columns) => {
    if (!Array.isArray(columns) || columns.length === 0) {
        throw new Error('Source table has no columns');
    }

    const columnDefs = columns.map((col) => {
        const nullable = col.isNullable ? '' : ' NOT NULL';
        return `${quoteIdent(col.name)} ${col.typeExpression}${nullable}`;
    });

    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(SNAPSHOT_SCHEMA)}`);
    await client.query(`CREATE TABLE ${qualifySnapshotTable(tableName)} (${columnDefs.join(', ')})`);
};

const createSnapshotTableIfNotExists = async (client, tableName, columns) => {
    if (!Array.isArray(columns) || columns.length === 0) {
        throw new Error('Source table has no columns');
    }

    const columnDefs = columns.map((col) => {
        const nullable = col.isNullable ? '' : ' NOT NULL';
        return `${quoteIdent(col.name)} ${col.typeExpression}${nullable}`;
    });

    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(SNAPSHOT_SCHEMA)}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${qualifySnapshotTable(tableName)} (${columnDefs.join(', ')})`);
};

const getUniqueIndexName = (tableName, keyColumns) => {
    const digest = hashText(`${tableName}:${(keyColumns || []).join(',')}`, 10);
    const base = sanitizeNamePart(tableName).slice(0, 32) || 'snapshot';
    return `ux_${base}_${digest}`.slice(0, 63);
};

const ensureUniqueIndex = async (client, tableName, keyColumns) => {
    const keys = Array.isArray(keyColumns) ? keyColumns.filter(Boolean) : [];
    if (keys.length === 0) return;

    const indexName = getUniqueIndexName(tableName, keys);
    const keySql = keys.map((col) => quoteIdent(col)).join(', ');
    await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(indexName)}
         ON ${qualifySnapshotTable(tableName)} (${keySql})`
    );
};

const insertRowsBatch = async (client, tableName, columns, rows, options = {}) => {
    if (!rows || rows.length === 0) return;

    const keyColumns = Array.isArray(options.keyColumns) ? options.keyColumns : [];
    const upsert = options.upsert === true && keyColumns.length > 0;

    const colSql = columns.map((col) => quoteIdent(col.name)).join(', ');
    const values = [];
    const placeholders = [];
    const colCount = columns.length;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] || {};
        const rowPlaceholders = [];

        for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
            const paramIndex = rowIndex * colCount + colIndex + 1;
            rowPlaceholders.push(`$${paramIndex}`);
            const colName = columns[colIndex].name;
            const rawValue = row[colName] !== undefined ? row[colName] : null;
            const typeExpression = String(columns[colIndex].typeExpression || '').toLowerCase();

            // Node pg serializes JS arrays as PostgreSQL array literals, which breaks json/jsonb columns.
            // Force JSON serialization for source json/jsonb to preserve exact JSON values.
            if (rawValue !== null && rawValue !== undefined && (typeExpression === 'json' || typeExpression === 'jsonb')) {
                values.push(JSON.stringify(rawValue));
            } else {
                values.push(rawValue);
            }
        }

        placeholders.push(`(${rowPlaceholders.join(', ')})`);
    }

    let sql = `INSERT INTO ${qualifySnapshotTable(tableName)} (${colSql}) VALUES ${placeholders.join(', ')}`;

    if (upsert) {
        const conflictSql = keyColumns.map((col) => quoteIdent(col)).join(', ');
        const updatable = columns
            .map((col) => col.name)
            .filter((name) => !keyColumns.includes(name));

        if (updatable.length === 0) {
            sql += ` ON CONFLICT (${conflictSql}) DO NOTHING`;
        } else {
            const setSql = updatable
                .map((name) => `${quoteIdent(name)} = EXCLUDED.${quoteIdent(name)}`)
                .join(', ');
            sql += ` ON CONFLICT (${conflictSql}) DO UPDATE SET ${setSql}`;
        }
    }

    await client.query(sql, values);
};

const toWatermarkString = (value) => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
};

const getSourceRowsBatch = async ({
    sourceClient,
    schemaName,
    tableName,
    columns,
    limit,
    offset,
    incrementalColumn,
    watermark,
}) => {
    const selectSql = columns.map((col) => quoteIdent(col.name)).join(', ');
    const sourceTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;

    const params = [limit, offset];
    let whereClause = '';
    let orderClause = '';

    if (incrementalColumn) {
        orderClause = ` ORDER BY ${quoteIdent(incrementalColumn)} ASC`;
        if (watermark !== null && watermark !== undefined && watermark !== '') {
            whereClause = ` WHERE ${quoteIdent(incrementalColumn)} > $3`;
            params.push(watermark);
        }
    }

    const sql = `SELECT ${selectSql}
                 FROM ${sourceTable}${whereClause}${orderClause}
                 LIMIT $1 OFFSET $2`;

    const result = await sourceClient.query(sql, params);
    return result.rows || [];
};

const getTableCount = async (client, tableName) => {
    const result = await client.query(
        `SELECT COUNT(*)::bigint AS total FROM ${qualifySnapshotTable(tableName)}`
    );
    return Number(result.rows[0]?.total || 0);
};

const getMaxColumnValue = async (client, tableName, columnName) => {
    if (!columnName) return null;
    const result = await client.query(
        `SELECT MAX(${quoteIdent(columnName)}) AS max_value
         FROM ${qualifySnapshotTable(tableName)}`
    );
    return result.rows[0]?.max_value ?? null;
};

const ensureSyncStateRow = async ({
    client,
    connectionId,
    schemaName,
    tableName,
    snapshotTableName,
    jobId,
}) => {
    await client.query(
        `INSERT INTO postgres_table_sync_state (
            connection_id, schema_name, table_name, snapshot_table_name,
            status, last_job_id
         )
         VALUES ($1, $2, $3, $4, 'syncing', $5)
         ON CONFLICT (connection_id, schema_name, table_name)
         DO UPDATE SET
            snapshot_table_name = EXCLUDED.snapshot_table_name,
            status = 'syncing',
            last_job_id = EXCLUDED.last_job_id,
            updated_at = NOW()`,
        [connectionId, schemaName, tableName, snapshotTableName, jobId || null]
    );
};

const saveSyncedTable = async ({
    client,
    connectionId,
    schemaName,
    tableName,
    rowCount,
    columnCount,
    schemaDefinition,
}) => {
    const result = await client.query(
        `INSERT INTO synced_tables (
            connection_id, table_name, dataset_name,
            row_count, column_count, status,
            last_sync, schema_def, is_deleted
         )
         VALUES ($1, $2, $3, $4, $5, 'Active', NOW(), $6::jsonb, FALSE)
         ON CONFLICT (connection_id, dataset_name, table_name)
         DO UPDATE SET
            row_count = EXCLUDED.row_count,
            column_count = EXCLUDED.column_count,
            status = 'Active',
            last_sync = NOW(),
            schema_def = EXCLUDED.schema_def,
            is_deleted = FALSE
         RETURNING *`,
        [
            connectionId,
            tableName,
            schemaName,
            rowCount,
            columnCount,
            JSON.stringify(schemaDefinition || []),
        ]
    );

    await client.query(
        `UPDATE connections
         SET table_count = (
            SELECT COUNT(*) FROM synced_tables WHERE connection_id = $1 AND is_deleted = FALSE
         )
         WHERE id = $1`,
        [connectionId]
    );

    return result.rows[0];
};

const saveSyncStateSuccess = async ({
    client,
    connectionId,
    schemaName,
    tableName,
    snapshotTableName,
    incrementalColumn,
    incrementalKind,
    primaryKeyColumns,
    upsertKeyColumns,
    lastSyncValue,
    jobId,
}) => {
    await client.query(
        `INSERT INTO postgres_table_sync_state (
            connection_id,
            schema_name,
            table_name,
            snapshot_table_name,
            incremental_column,
            incremental_kind,
            pk_columns,
            upsert_key_columns,
            last_sync_time,
            last_sync_value,
            last_job_id,
            status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, NOW(), $9, $10, 'success')
         ON CONFLICT (connection_id, schema_name, table_name)
         DO UPDATE SET
            snapshot_table_name = EXCLUDED.snapshot_table_name,
            incremental_column = EXCLUDED.incremental_column,
            incremental_kind = EXCLUDED.incremental_kind,
            pk_columns = EXCLUDED.pk_columns,
            upsert_key_columns = EXCLUDED.upsert_key_columns,
            last_sync_time = EXCLUDED.last_sync_time,
            last_sync_value = EXCLUDED.last_sync_value,
            last_job_id = EXCLUDED.last_job_id,
            status = 'success',
            updated_at = NOW()`,
        [
            connectionId,
            schemaName,
            tableName,
            snapshotTableName,
            incrementalColumn || null,
            incrementalKind || null,
            JSON.stringify(primaryKeyColumns || []),
            JSON.stringify(upsertKeyColumns || []),
            lastSyncValue,
            jobId || null,
        ]
    );
};

const markSyncStateFailed = async ({
    connectionId,
    schemaName,
    tableName,
    jobId,
}) => {
    const client = await getClient();
    try {
        await client.query(
            `UPDATE postgres_table_sync_state
             SET status = 'failed',
                 last_job_id = $4,
                 updated_at = NOW()
             WHERE connection_id = $1
               AND schema_name = $2
               AND table_name = $3`,
            [connectionId, schemaName, tableName, jobId || null]
        );
    } finally {
        client.release();
    }
};

const getExistingSyncState = async (client, connectionId, schemaName, tableName) => {
    const result = await client.query(
        `SELECT *
         FROM postgres_table_sync_state
         WHERE connection_id = $1
           AND schema_name = $2
           AND table_name = $3
         FOR UPDATE`,
        [connectionId, schemaName, tableName]
    );

    return result.rows[0] || null;
};

const ingestPostgresTable = async ({
    connectionRow,
    connectionId,
    schemaName,
    tableName,
    importMode,
    incrementalColumn,
    incrementalKind,
    upsert,
    keyColumns,
    jobId,
    batchSize = DEFAULT_BATCH_SIZE,
    onBatch,
}) => {
    const mode = importMode === 'incremental' ? 'incremental' : 'full';
    const normalizedBatchSize = Number.isFinite(Number(batchSize))
        ? Math.max(1, Math.min(5000, Math.floor(Number(batchSize))))
        : DEFAULT_BATCH_SIZE;

    const columns = await listColumns(connectionRow, schemaName, tableName);
    if (!columns || columns.length === 0) {
        throw new Error(`No columns found for ${schemaName}.${tableName}`);
    }

    const primaryKeyColumns = await fetchPrimaryKey(connectionRow, schemaName, tableName);
    const schemaDefinition = columns.map((col) => ({
        name: col.name,
        type: col.typeExpression,
    }));

    const internalClient = await getClient();
    let importedRows = 0;

    try {
        await internalClient.query('BEGIN');

        const existingState = await getExistingSyncState(internalClient, connectionId, schemaName, tableName);
        const snapshotTableName = existingState?.snapshot_table_name || buildSnapshotTableName(connectionId, schemaName, tableName);

        await ensureSyncStateRow({
            client: internalClient,
            connectionId,
            schemaName,
            tableName,
            snapshotTableName,
            jobId,
        });

        let effectiveIncrementalColumn = incrementalColumn ? String(incrementalColumn).trim() : null;
        let effectiveIncrementalKind = incrementalKind ? String(incrementalKind).trim() : null;

        if (!effectiveIncrementalColumn && existingState?.incremental_column) {
            effectiveIncrementalColumn = String(existingState.incremental_column);
            effectiveIncrementalKind = effectiveIncrementalKind || existingState.incremental_kind || null;
        }

        const availableColumnNames = new Set(columns.map((col) => col.name));
        if (effectiveIncrementalColumn && !availableColumnNames.has(effectiveIncrementalColumn)) {
            if (mode === 'incremental') {
                throw new Error(`Incremental column "${effectiveIncrementalColumn}" does not exist in ${schemaName}.${tableName}`);
            }
            effectiveIncrementalColumn = null;
            effectiveIncrementalKind = null;
        }

        if (mode === 'incremental' && !effectiveIncrementalColumn) {
            throw new Error(`Incremental column is required for incremental import (${schemaName}.${tableName})`);
        }

        if (effectiveIncrementalColumn && !effectiveIncrementalKind) {
            const matched = columns.find((col) => col.name === effectiveIncrementalColumn);
            effectiveIncrementalKind = classifyIncrementalKindFromType(matched?.typeExpression);
        }

        const requestedKeyColumns = Array.isArray(keyColumns)
            ? keyColumns.map((item) => String(item || '').trim()).filter(Boolean)
            : [];

        let resolvedUpsertKeyColumns = [];
        if (mode === 'incremental' && upsert === true) {
            resolvedUpsertKeyColumns = primaryKeyColumns.length > 0 ? primaryKeyColumns : requestedKeyColumns;
            if (resolvedUpsertKeyColumns.length === 0) {
                throw new Error(`No upsert key columns provided for ${schemaName}.${tableName}`);
            }
            const invalid = resolvedUpsertKeyColumns.filter((key) => !availableColumnNames.has(key));
            if (invalid.length > 0) {
                throw new Error(`Invalid upsert key column(s): ${invalid.join(', ')}`);
            }
        }

        let watermark = existingState?.last_sync_value || null;

        if (mode === 'full') {
            const tmpName = `tmp_${snapshotTableName.slice(0, 36)}_${hashText(Date.now(), 8)}`.slice(0, 63);
            await internalClient.query(`DROP TABLE IF EXISTS ${qualifySnapshotTable(tmpName)} CASCADE`);
            await createSnapshotTable(internalClient, tmpName, columns);

            await runInReadOnlyTransaction(connectionRow, async (sourceClient) => {
                let offset = 0;
                while (true) {
                    const rows = await getSourceRowsBatch({
                        sourceClient,
                        schemaName,
                        tableName,
                        columns,
                        limit: normalizedBatchSize,
                        offset,
                        incrementalColumn: null,
                        watermark: null,
                    });

                    if (!rows || rows.length === 0) break;
                    await insertRowsBatch(internalClient, tmpName, columns, rows, { upsert: false });

                    importedRows += rows.length;
                    offset += rows.length;
                    if (typeof onBatch === 'function') {
                        await onBatch(importedRows);
                    }
                }
            });

            await internalClient.query(`DROP TABLE IF EXISTS ${qualifySnapshotTable(snapshotTableName)} CASCADE`);
            await internalClient.query(
                `ALTER TABLE ${qualifySnapshotTable(tmpName)} RENAME TO ${quoteIdent(snapshotTableName)}`
            );
        } else {
            await createSnapshotTableIfNotExists(internalClient, snapshotTableName, columns);

            if (resolvedUpsertKeyColumns.length > 0) {
                await ensureUniqueIndex(internalClient, snapshotTableName, resolvedUpsertKeyColumns);
            }

            await runInReadOnlyTransaction(connectionRow, async (sourceClient) => {
                let offset = 0;
                while (true) {
                    const rows = await getSourceRowsBatch({
                        sourceClient,
                        schemaName,
                        tableName,
                        columns,
                        limit: normalizedBatchSize,
                        offset,
                        incrementalColumn: effectiveIncrementalColumn,
                        watermark,
                    });

                    if (!rows || rows.length === 0) break;

                    await insertRowsBatch(internalClient, snapshotTableName, columns, rows, {
                        upsert: upsert === true,
                        keyColumns: resolvedUpsertKeyColumns,
                    });

                    importedRows += rows.length;
                    offset += rows.length;
                    if (typeof onBatch === 'function') {
                        await onBatch(importedRows);
                    }
                }
            });
        }

        const rowCount = await getTableCount(internalClient, snapshotTableName);
        const columnCount = columns.length;

        let lastSyncValue = null;
        if (effectiveIncrementalColumn) {
            const maxValue = await getMaxColumnValue(internalClient, snapshotTableName, effectiveIncrementalColumn);
            lastSyncValue = toWatermarkString(maxValue);
            if (!lastSyncValue && mode === 'incremental') {
                lastSyncValue = watermark;
            }
        }

        const syncedTable = await saveSyncedTable({
            client: internalClient,
            connectionId,
            schemaName,
            tableName,
            rowCount,
            columnCount,
            schemaDefinition,
        });

        await saveSyncStateSuccess({
            client: internalClient,
            connectionId,
            schemaName,
            tableName,
            snapshotTableName,
            incrementalColumn: effectiveIncrementalColumn,
            incrementalKind: effectiveIncrementalKind,
            primaryKeyColumns,
            upsertKeyColumns: resolvedUpsertKeyColumns,
            lastSyncValue,
            jobId,
        });

        await registerPostgresSnapshotRuntime(internalClient, {
            workspaceId: connectionRow.workspace_id,
            syncedTableId: syncedTable.id,
            connectionId,
            sourceType: connectionRow.type || 'PostgreSQL',
            snapshotTableName,
        });

        await internalClient.query('COMMIT');

        return {
            schemaName,
            tableName,
            snapshotTableName,
            rowCount,
            columnCount,
            schemaDefinition,
            primaryKeyColumns,
            upsertKeyColumns: resolvedUpsertKeyColumns,
            incrementalColumn: effectiveIncrementalColumn,
            incrementalKind: effectiveIncrementalKind,
            lastSyncValue,
            importedRows,
            syncedTable,
        };
    } catch (err) {
        await internalClient.query('ROLLBACK');
        throw err;
    } finally {
        internalClient.release();
    }
};

module.exports = {
    SNAPSHOT_SCHEMA,
    DEFAULT_BATCH_SIZE,
    quoteIdent,
    buildSnapshotTableName,
    classifyIncrementalKindFromType,
    ingestPostgresTable,
    markSyncStateFailed,
};
