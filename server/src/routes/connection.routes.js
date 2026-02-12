// ============================================
// Connection Routes - CRUD + Tables
// ============================================
const express = require('express');
const { query, getClient } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { encryptString } = require('../services/crypto.service');
const {
    MAX_EXCEL_FILE_SIZE_BYTES,
    parseWorkbookForPreview,
    parseWorkbookForImport,
    chunkArray,
    createValidationError,
} = require('../services/excel.service');
const {
    exchangeAuthCode,
    ensureAccessToken,
    buildOAuthConfig,
} = require('../services/google-sheets-auth.service');
const {
    listSpreadsheetFiles,
    resolveSpreadsheetUrl,
    listSpreadsheetSheets,
    preflightGoogleSheetsImport,
    importGoogleSheetsToDatabase,
    findExistingGoogleSheetTables,
    createGoogleSheetsError,
} = require('../services/google-sheets.service');
const {
    parsePostgresConfig,
    sanitizePostgresConfig,
    validatePostgresConfigInput,
    testPostgresConnection,
    listSchemas: listPostgresSchemas,
    listTablesAndViews: listPostgresTablesAndViews,
    listColumns: listPostgresColumns,
    fetchPrimaryKey: fetchPostgresPrimaryKey,
} = require('../services/postgres-connection.service');
const {
    classifyIncrementalKindFromType,
    ingestPostgresTable,
    markSyncStateFailed,
    quoteIdent,
    SNAPSHOT_SCHEMA,
} = require('../services/postgres-ingestion.service');
const {
    materializeSyncedTableToSnapshot,
    registerBigQueryRuntime,
    registerPostgresSnapshotRuntime,
    upsertModelRuntimeTable,
} = require('../services/runtime-materialization.service');

const router = express.Router();

router.use(authenticate);

let multerLib = null;
try {
    // Optional runtime dependency, can fallback to JSON base64 upload when unavailable.
    multerLib = require('multer');
} catch (err) {
    console.warn('[connections] multer not found. Excel upload will use JSON base64 payload.');
}

const excelUpload = multerLib
    ? multerLib({
        storage: multerLib.memoryStorage(),
        limits: { fileSize: MAX_EXCEL_FILE_SIZE_BYTES },
        fileFilter: (req, file, cb) => {
            if (!file || !file.originalname) return cb(null, false);
            const lowered = file.originalname.toLowerCase();
            if (lowered.endsWith('.xlsx') || lowered.endsWith('.xls')) return cb(null, true);
            return cb(createValidationError('Định dạng file không được hỗ trợ. Chỉ chấp nhận .xlsx hoặc .xls'));
        },
    }).single('file')
    : (req, res, next) => next();

const runExcelUpload = (req, res) => new Promise((resolve, reject) => {
    excelUpload(req, res, (err) => {
        if (err) return reject(err);
        return resolve();
    });
});

const parseSheetNamesInput = (rawSheetNames) => {
    if (Array.isArray(rawSheetNames)) return rawSheetNames;
    if (typeof rawSheetNames === 'string') {
        try {
            const parsed = JSON.parse(rawSheetNames);
            if (Array.isArray(parsed)) return parsed;
        } catch (err) {
            // Fallback to comma-separated input.
            return rawSheetNames
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
        }
    }
    return [];
};

const extractExcelFilePayload = (req) => {
    if (req.file?.buffer && req.file?.originalname) {
        return {
            fileName: req.file.originalname,
            buffer: req.file.buffer,
        };
    }

    const fileName = req.body?.fileName;
    const fileBase64 = req.body?.fileBase64;
    if (!fileName || !fileBase64) {
        throw createValidationError('Thiếu dữ liệu file upload. Cần gửi file hoặc { fileName, fileBase64 }');
    }

    const normalizedBase64 = typeof fileBase64 === 'string' && fileBase64.includes(',')
        ? fileBase64.split(',').pop()
        : fileBase64;

    let buffer;
    try {
        buffer = Buffer.from(normalizedBase64, 'base64');
    } catch (err) {
        throw createValidationError('Không thể giải mã nội dung file');
    }

    if (!buffer || buffer.length === 0) {
        throw createValidationError('File upload rỗng hoặc không hợp lệ');
    }

    return { fileName, buffer };
};

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

const normalizeGoogleSheetsSyncConfig = (sync) => {
    const mode = sync?.mode === 'interval' ? 'interval' : 'manual';
    const interval = Number(sync?.intervalMinutes);
    const intervalMinutes = Number.isFinite(interval) ? Math.min(Math.max(Math.floor(interval), 5), 1440) : 15;
    return {
        mode,
        intervalMinutes,
        lastRunAt: sync?.lastRunAt || null,
        nextRunAt: sync?.nextRunAt || null,
        lastError: sync?.lastError || null,
        lastErrorAt: sync?.lastErrorAt || null,
    };
};

const getGoogleSheetsConfig = (configValue) => {
    const config = toObject(configValue);
    const googleSheets = toObject(config.googleSheets);
    return {
        ...googleSheets,
        oauth: toObject(googleSheets.oauth),
        sync: normalizeGoogleSheetsSyncConfig(toObject(googleSheets.sync)),
        imports: Array.isArray(googleSheets.imports) ? googleSheets.imports : [],
    };
};

const mergeGoogleSheetsConfig = (configValue, nextGoogleSheetsConfig) => {
    const base = toObject(configValue);
    return {
        ...base,
        googleSheets: nextGoogleSheetsConfig,
    };
};

const loadWorkspaceConnection = async (client, connectionId, workspaceId) => {
    const result = await client.query(
        `SELECT *
         FROM connections
         WHERE id = $1
           AND workspace_id = $2
           AND is_deleted = FALSE`,
        [connectionId, workspaceId]
    );
    return result.rows[0] || null;
};

const persistConnectionConfig = async (client, connectionId, nextConfig, status) => {
    const params = [JSON.stringify(nextConfig), connectionId];
    if (status) {
        await client.query(
            `UPDATE connections
             SET config = $1::jsonb,
                 status = $3
             WHERE id = $2`,
            [...params, status]
        );
        return;
    }

    await client.query(
        `UPDATE connections
         SET config = $1::jsonb
         WHERE id = $2`,
        params
    );
};

const ensureConnectionGoogleAccessToken = async (client, connectionRow) => {
    const googleConfig = getGoogleSheetsConfig(connectionRow.config);
    const tokenState = await ensureAccessToken(googleConfig.oauth);
    if (tokenState.refreshed) {
        const nextGoogle = {
            ...googleConfig,
            oauth: tokenState.oauthConfig,
        };
        const nextConfig = mergeGoogleSheetsConfig(connectionRow.config, nextGoogle);
        await persistConnectionConfig(client, connectionRow.id, nextConfig);
        connectionRow.config = nextConfig;
    }
    return tokenState.accessToken;
};

const normalizeSheetSelections = (rawSelections) => {
    if (!Array.isArray(rawSelections)) return [];
    return rawSelections
        .map((item) => ({
            sheetId: item?.sheetId !== undefined && item?.sheetId !== null ? Number(item.sheetId) : null,
            sheetName: item?.sheetName ? String(item.sheetName) : '',
            headerMode: item?.headerMode === 'auto_columns' ? 'auto_columns' : 'first_row',
        }))
        .filter((item) => Number.isFinite(item.sheetId) || item.sheetName);
};

const normalizeImportTarget = (target) => ({
    fileId: String(target?.fileId || ''),
    fileName: target?.fileName ? String(target.fileName) : '',
    allowEmptySheets: target?.allowEmptySheets === true,
    sheets: normalizeSheetSelections(target?.sheets || []),
    lastSyncTime: target?.lastSyncTime || null,
});

const upsertGoogleSheetsImportConfig = (googleConfig, payload) => {
    const imports = Array.isArray(googleConfig.imports) ? [...googleConfig.imports] : [];
    const normalized = normalizeImportTarget(payload);
    const idx = imports.findIndex((item) => String(item?.fileId || '') === normalized.fileId);
    if (idx >= 0) imports[idx] = { ...imports[idx], ...normalized };
    else imports.push(normalized);
    return {
        ...googleConfig,
        imports,
    };
};

const requireGoogleSheetsConnection = async (client, connectionId, workspaceId) => {
    const connection = await loadWorkspaceConnection(client, connectionId, workspaceId);
    if (!connection) {
        throw createGoogleSheetsError('Connection not found', { status: 404 });
    }
    if (connection.type !== 'GoogleSheets') {
        throw createGoogleSheetsError('Connection type must be GoogleSheets', { status: 400 });
    }
    return connection;
};

const POSTGRES_JOB_STATUS = {
    QUEUED: 'queued',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
};

const POSTGRES_JOB_STAGE = {
    CONNECTING: 'connecting',
    FETCHING_SCHEMA: 'fetching_schema',
    READING_TABLE: 'reading_table',
    IMPORTING: 'importing',
    COMPLETED: 'completed',
};

const POSTGRES_IMPORT_MODES = new Set(['full', 'incremental']);
const POSTGRES_IMPORT_STAGE_ORDER = [
    POSTGRES_JOB_STAGE.CONNECTING,
    POSTGRES_JOB_STAGE.FETCHING_SCHEMA,
    POSTGRES_JOB_STAGE.READING_TABLE,
    POSTGRES_JOB_STAGE.IMPORTING,
    POSTGRES_JOB_STAGE.COMPLETED,
];

const parsePostgresSchemasQuery = (rawSchemas) => {
    if (Array.isArray(rawSchemas)) {
        return rawSchemas.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (typeof rawSchemas === 'string' && rawSchemas.trim()) {
        return rawSchemas
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
};

const registerRuntimeCatalogForTable = async ({
    client,
    workspaceId,
    connectionRow,
    syncedTableRow,
}) => {
    if (!connectionRow || !syncedTableRow) return;

    if (connectionRow.type === 'BigQuery') {
        await registerBigQueryRuntime(client, {
            workspaceId,
            syncedTableId: syncedTableRow.id,
            connectionId: connectionRow.id,
            sourceType: connectionRow.type,
            projectId: connectionRow.project_id,
            datasetName: syncedTableRow.dataset_name,
            tableName: syncedTableRow.table_name,
        });
        return;
    }

    if (connectionRow.type === 'PostgreSQL') {
        const snapshotState = await client.query(
            `SELECT snapshot_table_name
             FROM postgres_table_sync_state
             WHERE connection_id = $1
               AND schema_name = $2
               AND table_name = $3
             LIMIT 1`,
            [connectionRow.id, syncedTableRow.dataset_name, syncedTableRow.table_name]
        );
        await registerPostgresSnapshotRuntime(client, {
            workspaceId,
            syncedTableId: syncedTableRow.id,
            connectionId: connectionRow.id,
            sourceType: connectionRow.type,
            snapshotTableName: snapshotState.rows[0]?.snapshot_table_name || null,
        });
        return;
    }

    if (connectionRow.type === 'Excel' || connectionRow.type === 'GoogleSheets') {
        await materializeSyncedTableToSnapshot(client, {
            workspaceId,
            connectionId: connectionRow.id,
            sourceType: connectionRow.type,
            syncedTable: syncedTableRow,
        });
        return;
    }

    await upsertModelRuntimeTable(client, {
        workspaceId,
        syncedTableId: syncedTableRow.id,
        connectionId: connectionRow.id,
        sourceType: connectionRow.type || 'Unknown',
        runtimeEngine: 'postgres',
        runtimeSchema: null,
        runtimeTable: null,
        runtimeRef: null,
        isExecutable: false,
        executableReason: `Source type ${connectionRow.type} is not executable yet`,
    });
};

const normalizePostgresImportMode = (value) => {
    const mode = String(value || '').trim().toLowerCase();
    return POSTGRES_IMPORT_MODES.has(mode) ? mode : 'full';
};

const normalizePostgresImportTable = (item, defaultMode) => {
    const schemaName = String(item?.schemaName || '').trim();
    const tableName = String(item?.tableName || '').trim();
    const objectType = item?.objectType === 'view' ? 'view' : 'table';
    const incrementalColumn = item?.incrementalColumn ? String(item.incrementalColumn).trim() : null;
    const incrementalKindRaw = item?.incrementalKind ? String(item.incrementalKind).trim().toLowerCase() : '';
    const incrementalKind = incrementalKindRaw === 'timestamp' || incrementalKindRaw === 'id'
        ? incrementalKindRaw
        : null;
    const upsert = item?.upsert === true;
    const keyColumns = Array.isArray(item?.keyColumns)
        ? item.keyColumns.map((col) => String(col || '').trim()).filter(Boolean)
        : [];

    if (!schemaName || !tableName) {
        throw new Error('Each table selection must include schemaName and tableName');
    }

    if (defaultMode === 'incremental' && !incrementalColumn) {
        throw new Error(`incrementalColumn is required for incremental mode (${schemaName}.${tableName})`);
    }

    return {
        schemaName,
        tableName,
        objectType,
        incrementalColumn,
        incrementalKind,
        upsert,
        keyColumns,
    };
};

const getPostgresConfig = (configValue) => parsePostgresConfig(configValue);

const mergePostgresConnectionConfig = (configValue, nextPostgresConfig) => {
    const base = toObject(configValue);
    return {
        ...base,
        postgres: nextPostgresConfig,
    };
};

const requirePostgresConnection = async (client, connectionId, workspaceId) => {
    const connection = await loadWorkspaceConnection(client, connectionId, workspaceId);
    if (!connection) {
        const err = new Error('Connection not found');
        err.status = 404;
        throw err;
    }
    if (connection.type !== 'PostgreSQL') {
        const err = new Error('Connection type must be PostgreSQL');
        err.status = 400;
        throw err;
    }
    return connection;
};

const parsePostgresImportPayload = (payloadRaw) => {
    const payload = toObject(payloadRaw);
    const importMode = normalizePostgresImportMode(payload.importMode);
    const tablesRaw = Array.isArray(payload.tables) ? payload.tables : [];
    if (tablesRaw.length === 0) {
        throw new Error('At least one table must be selected for import');
    }

    const tables = tablesRaw.map((item) => normalizePostgresImportTable(item, importMode));
    return {
        importMode,
        batchSize: Number(payload.batchSize) > 0 ? Number(payload.batchSize) : 500,
        tables,
    };
};

const parseJobProgress = (rawProgress) => {
    const progress = toObject(rawProgress);
    return {
        totalTables: Number(progress.totalTables || 0),
        completedTables: Number(progress.completedTables || 0),
        currentTable: progress.currentTable || null,
        importedRows: Number(progress.importedRows || 0),
        currentStage: progress.currentStage || null,
        percentage: Number(progress.percentage || 0),
    };
};

const getStageOrderIndex = (stage) => {
    const idx = POSTGRES_IMPORT_STAGE_ORDER.indexOf(stage);
    return idx === -1 ? 0 : idx;
};

const formatPostgresImportJob = (row) => ({
    id: row.id,
    connectionId: row.connection_id,
    workspaceId: row.workspace_id,
    status: row.status,
    stage: row.stage,
    stageOrder: getStageOrderIndex(row.stage),
    importMode: row.import_mode,
    payload: toObject(row.payload),
    progress: parseJobProgress(row.progress),
    attemptCount: Number(row.attempt_count || 0),
    errorMessage: row.error_message || undefined,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const formatPostgresImportRun = (row) => ({
    id: row.id,
    jobId: row.job_id,
    connectionId: row.connection_id,
    host: row.host,
    databaseName: row.database_name,
    schemaName: row.schema_name,
    tableName: row.table_name,
    rowCount: Number(row.row_count || 0),
    columnCount: Number(row.column_count || 0),
    importMode: row.import_mode,
    lastSyncTime: row.last_sync_time || null,
    status: row.status,
    errorMessage: row.error_message || undefined,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    createdAt: row.created_at,
});

const isTransientImportError = (error) => {
    if (!error) return false;
    const transientCodes = new Set([
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EPIPE',
        '57P01',
        '53300',
        '40001',
        '40P01',
    ]);

    if (error.code && transientCodes.has(String(error.code))) return true;
    const msg = String(error.message || '').toLowerCase();
    return msg.includes('timeout') ||
        msg.includes('temporar') ||
        msg.includes('connection reset') ||
        msg.includes('network');
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const updatePostgresImportJob = async (jobId, patch) => {
    const sets = [];
    const values = [];
    let idx = 1;
    Object.entries(patch).forEach(([key, value]) => {
        sets.push(`${key} = $${idx}`);
        values.push(value);
        idx += 1;
    });
    sets.push('updated_at = NOW()');

    values.push(jobId);
    const result = await query(
        `UPDATE postgres_import_jobs
         SET ${sets.join(', ')}
         WHERE id = $${idx}
         RETURNING *`,
        values
    );
    return result.rows[0] || null;
};

const insertPostgresImportRun = async ({
    jobId,
    connectionId,
    host,
    databaseName,
    schemaName,
    tableName,
    rowCount,
    columnCount,
    importMode,
    lastSyncTime,
    status,
    errorMessage,
    startedAt,
    finishedAt,
}) => {
    await query(
        `INSERT INTO postgres_import_runs (
            job_id, connection_id, host, database_name, schema_name, table_name,
            row_count, column_count, import_mode, last_sync_time, status, error_message,
            started_at, finished_at
         )
         VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12,
            $13, $14
         )`,
        [
            jobId,
            connectionId,
            host,
            databaseName,
            schemaName,
            tableName,
            rowCount || 0,
            columnCount || 0,
            importMode,
            lastSyncTime || null,
            status,
            errorMessage || null,
            startedAt || new Date().toISOString(),
            finishedAt || new Date().toISOString(),
        ]
    );
};

const runPostgresImportJob = async (jobId) => {
    try {
        const startRes = await query(
            `UPDATE postgres_import_jobs
             SET status = $2,
                 stage = $3,
                 started_at = COALESCE(started_at, NOW()),
                 attempt_count = 0,
                 error_message = NULL,
                 updated_at = NOW()
             WHERE id = $1
               AND status = $4
             RETURNING *`,
            [jobId, POSTGRES_JOB_STATUS.RUNNING, POSTGRES_JOB_STAGE.CONNECTING, POSTGRES_JOB_STATUS.QUEUED]
        );

        if (startRes.rows.length === 0) return;
        const jobRow = startRes.rows[0];

        const connectionRes = await query(
            `SELECT *
             FROM connections
             WHERE id = $1
               AND workspace_id = $2
               AND is_deleted = FALSE`,
            [jobRow.connection_id, jobRow.workspace_id]
        );
        const connectionRow = connectionRes.rows[0];
        if (!connectionRow || connectionRow.type !== 'PostgreSQL') {
            throw new Error('PostgreSQL connection not found for import job');
        }

        const payload = parsePostgresImportPayload(jobRow.payload);
        const totalTables = payload.tables.length;
        let completedTables = 0;
        let totalAttempts = 0;

        await updatePostgresImportJob(jobId, {
            progress: JSON.stringify({
                totalTables,
                completedTables,
                currentTable: null,
                importedRows: 0,
                percentage: 0,
                currentStage: POSTGRES_JOB_STAGE.CONNECTING,
            }),
        });

        await updatePostgresImportJob(jobId, { stage: POSTGRES_JOB_STAGE.FETCHING_SCHEMA });
        await listPostgresSchemas(connectionRow);

        const postgresConfig = getPostgresConfig(connectionRow.config);
        const host = postgresConfig.host || '';
        const databaseName = postgresConfig.databaseName || '';

        for (const table of payload.tables) {
            const tableLabel = `${table.schemaName}.${table.tableName}`;
            const startedAt = new Date().toISOString();

            await updatePostgresImportJob(jobId, {
                stage: POSTGRES_JOB_STAGE.READING_TABLE,
                progress: JSON.stringify({
                    totalTables,
                    completedTables,
                    currentTable: tableLabel,
                    importedRows: 0,
                    percentage: totalTables > 0 ? Math.floor((completedTables / totalTables) * 100) : 0,
                    currentStage: POSTGRES_JOB_STAGE.READING_TABLE,
                }),
            });

            const maxAttempts = 3;
            const backoffMs = [1000, 2000, 4000];
            let result = null;
            let lastError = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                totalAttempts += 1;
                await updatePostgresImportJob(jobId, { attempt_count: totalAttempts });
                try {
                    result = await ingestPostgresTable({
                        connectionRow,
                        connectionId: connectionRow.id,
                        schemaName: table.schemaName,
                        tableName: table.tableName,
                        importMode: payload.importMode,
                        incrementalColumn: table.incrementalColumn,
                        incrementalKind: table.incrementalKind,
                        upsert: table.upsert,
                        keyColumns: table.keyColumns,
                        jobId,
                        batchSize: payload.batchSize,
                        onBatch: async (importedRows) => {
                            await updatePostgresImportJob(jobId, {
                                stage: POSTGRES_JOB_STAGE.IMPORTING,
                                progress: JSON.stringify({
                                    totalTables,
                                    completedTables,
                                    currentTable: tableLabel,
                                    importedRows,
                                    percentage: totalTables > 0
                                        ? Math.min(99, Math.floor(((completedTables + 0.5) / totalTables) * 100))
                                        : 0,
                                    currentStage: POSTGRES_JOB_STAGE.IMPORTING,
                                }),
                            });
                        },
                    });
                    break;
                } catch (error) {
                    lastError = error;
                    if (!isTransientImportError(error) || attempt === maxAttempts) {
                        break;
                    }
                    await sleep(backoffMs[attempt - 1] || 4000);
                }
            }

            if (!result) {
                await markSyncStateFailed({
                    connectionId: connectionRow.id,
                    schemaName: table.schemaName,
                    tableName: table.tableName,
                    jobId,
                });

                await insertPostgresImportRun({
                    jobId,
                    connectionId: connectionRow.id,
                    host,
                    databaseName,
                    schemaName: table.schemaName,
                    tableName: table.tableName,
                    rowCount: 0,
                    columnCount: 0,
                    importMode: payload.importMode,
                    lastSyncTime: null,
                    status: 'failed',
                    errorMessage: String(lastError?.message || 'Import failed'),
                    startedAt,
                    finishedAt: new Date().toISOString(),
                });

                throw lastError || new Error(`Import failed for ${tableLabel}`);
            }

            completedTables += 1;

            await insertPostgresImportRun({
                jobId,
                connectionId: connectionRow.id,
                host,
                databaseName,
                schemaName: table.schemaName,
                tableName: table.tableName,
                rowCount: result.rowCount,
                columnCount: result.columnCount,
                importMode: payload.importMode,
                lastSyncTime: new Date().toISOString(),
                status: 'success',
                errorMessage: null,
                startedAt,
                finishedAt: new Date().toISOString(),
            });

            await updatePostgresImportJob(jobId, {
                stage: POSTGRES_JOB_STAGE.IMPORTING,
                progress: JSON.stringify({
                    totalTables,
                    completedTables,
                    currentTable: tableLabel,
                    importedRows: result.importedRows || 0,
                    percentage: totalTables > 0 ? Math.floor((completedTables / totalTables) * 100) : 100,
                    currentStage: POSTGRES_JOB_STAGE.IMPORTING,
                }),
            });
        }

        await updatePostgresImportJob(jobId, {
            status: POSTGRES_JOB_STATUS.SUCCESS,
            stage: POSTGRES_JOB_STAGE.COMPLETED,
            finished_at: new Date().toISOString(),
            progress: JSON.stringify({
                totalTables,
                completedTables,
                currentTable: null,
                importedRows: 0,
                percentage: 100,
                currentStage: POSTGRES_JOB_STAGE.COMPLETED,
            }),
        });
    } catch (err) {
        const message = String(err?.message || 'PostgreSQL import job failed');
        console.error('[postgres-import-job] failed', { jobId, error: message });
        await updatePostgresImportJob(jobId, {
            status: POSTGRES_JOB_STATUS.FAILED,
            stage: POSTGRES_JOB_STAGE.IMPORTING,
            error_message: message,
            finished_at: new Date().toISOString(),
        }).catch(() => undefined);
    }
};

const enqueuePostgresImportJob = (jobId) => {
    setImmediate(() => {
        runPostgresImportJob(jobId).catch((error) => {
            console.error('[postgres-import-job] unhandled failure', { jobId, error: error?.message });
        });
    });
};

/**
 * GET /api/connections - List workspace connections
 */
router.get('/', async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, type, auth_type, email, status, project_id, 
              service_account_key, table_count, created_at, config
       FROM connections WHERE workspace_id = $1 AND is_deleted = FALSE ORDER BY created_at DESC`,
            [req.user.workspace_id]
        );

        res.json({
            success: true,
            data: result.rows.map(formatConnection),
        });
    } catch (err) {
        console.error('List connections error:', err);
        res.status(500).json({ success: false, message: 'Failed to list connections' });
    }
});

/**
 * POST /api/connections/postgres/test
 * Test PostgreSQL connectivity without persisting connection.
 */
router.post('/postgres/test', async (req, res) => {
    try {
        const rawConfig = toObject(req.body?.config || req.body);
        const connectionId = req.body?.connectionId ? String(req.body.connectionId) : '';

        let existingPasswordEncrypted = null;
        if (connectionId) {
            const existing = await query(
                `SELECT id, type, config
                 FROM connections
                 WHERE id = $1
                   AND workspace_id = $2
                   AND is_deleted = FALSE`,
                [connectionId, req.user.workspace_id]
            );
            if (existing.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Connection not found' });
            }
            if (existing.rows[0].type !== 'PostgreSQL') {
                return res.status(400).json({ success: false, message: 'Connection type must be PostgreSQL' });
            }
            const postgresConfig = getPostgresConfig(existing.rows[0].config);
            existingPasswordEncrypted = postgresConfig.passwordEncrypted || null;
        }

        const validated = validatePostgresConfigInput(rawConfig, {
            allowMissingPassword: Boolean(existingPasswordEncrypted),
        });
        const testResult = await testPostgresConnection(validated, { existingPasswordEncrypted });

        res.json({
            success: true,
            data: {
                databaseName: testResult.database_name || validated.databaseName,
                userName: testResult.user_name || validated.username,
                serverVersion: testResult.server_version || '',
                host: validated.host,
                port: validated.port,
                ssl: validated.ssl,
            },
        });
    } catch (err) {
        const status = Number(err?.status || 400);
        res.status(Number.isFinite(status) ? status : 400).json({
            success: false,
            message: err.message || 'Failed to test PostgreSQL connection',
        });
    }
});

/**
 * POST /api/connections/postgres
 * Create a PostgreSQL connection with encrypted password.
 */
router.post('/postgres', async (req, res) => {
    const client = await getClient();
    try {
        const name = String(req.body?.name || '').trim() || 'PostgreSQL Connection';
        const validated = validatePostgresConfigInput(req.body?.config || {}, {
            allowMissingPassword: false,
        });

        const postgresConfig = {
            host: validated.host,
            port: validated.port,
            databaseName: validated.databaseName,
            username: validated.username,
            ssl: validated.ssl,
            passwordEncrypted: encryptString(validated.password),
            updatedAt: new Date().toISOString(),
        };

        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO connections (
                workspace_id, created_by, name,
                type, auth_type, status, table_count, config
             )
             VALUES ($1, $2, $3, 'PostgreSQL', 'Password', 'Connected', 0, $4::jsonb)
             RETURNING *`,
            [
                req.user.workspace_id,
                req.user.id,
                name,
                JSON.stringify(mergePostgresConnectionConfig({}, postgresConfig)),
            ]
        );
        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            data: formatConnection(result.rows[0]),
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Create PostgreSQL connection error:', err);
        res.status(400).json({
            success: false,
            message: err.message || 'Failed to create PostgreSQL connection',
        });
    } finally {
        client.release();
    }
});

/**
 * PUT /api/connections/:id/postgres
 * Update PostgreSQL connection config. Reuses existing password if omitted.
 */
router.put('/:id/postgres', async (req, res) => {
    const client = await getClient();
    try {
        const connection = await requirePostgresConnection(client, req.params.id, req.user.workspace_id);
        const existingConfig = getPostgresConfig(connection.config);

        const validated = validatePostgresConfigInput(req.body?.config || {}, {
            allowMissingPassword: Boolean(existingConfig.passwordEncrypted),
        });

        const passwordEncrypted = validated.password
            ? encryptString(validated.password)
            : existingConfig.passwordEncrypted;

        if (!passwordEncrypted) {
            return res.status(400).json({
                success: false,
                message: 'Password is required for PostgreSQL connection',
            });
        }

        const postgresConfig = {
            host: validated.host,
            port: validated.port,
            databaseName: validated.databaseName,
            username: validated.username,
            ssl: validated.ssl,
            passwordEncrypted,
            updatedAt: new Date().toISOString(),
        };

        const nextName = String(req.body?.name || '').trim() || connection.name;

        await client.query(
            `UPDATE connections
             SET name = $1,
                 auth_type = 'Password',
                 status = 'Connected',
                 config = $2::jsonb
             WHERE id = $3
             RETURNING *`,
            [
                nextName,
                JSON.stringify(mergePostgresConnectionConfig(connection.config, postgresConfig)),
                req.params.id,
            ]
        );

        const refreshed = await client.query('SELECT * FROM connections WHERE id = $1', [req.params.id]);
        res.json({
            success: true,
            data: formatConnection(refreshed.rows[0]),
        });
    } catch (err) {
        const status = Number(err?.status || 400);
        res.status(Number.isFinite(status) ? status : 400).json({
            success: false,
            message: err.message || 'Failed to update PostgreSQL connection',
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/connections/:id/postgres/schemas
 */
router.get('/:id/postgres/schemas', async (req, res) => {
    const client = await getClient();
    try {
        const connection = await requirePostgresConnection(client, req.params.id, req.user.workspace_id);
        const schemas = await listPostgresSchemas(connection);
        res.json({ success: true, data: schemas });
    } catch (err) {
        const status = Number(err?.status || 400);
        res.status(Number.isFinite(status) ? status : 400).json({
            success: false,
            message: err.message || 'Failed to list PostgreSQL schemas',
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/connections/:id/postgres/objects?schemas=a,b&includeViews=true
 */
router.get('/:id/postgres/objects', async (req, res) => {
    const client = await getClient();
    try {
        const connection = await requirePostgresConnection(client, req.params.id, req.user.workspace_id);
        const schemas = parsePostgresSchemasQuery(req.query.schemas);
        const includeViews = req.query.includeViews === 'true';
        const objects = await listPostgresTablesAndViews(connection, { schemas, includeViews });
        res.json({ success: true, data: objects });
    } catch (err) {
        const status = Number(err?.status || 400);
        res.status(Number.isFinite(status) ? status : 400).json({
            success: false,
            message: err.message || 'Failed to list PostgreSQL objects',
        });
    } finally {
        client.release();
    }
});

/**
 * POST /api/connections/:id/postgres/columns/batch
 */
router.post('/:id/postgres/columns/batch', async (req, res) => {
    const client = await getClient();
    try {
        const connection = await requirePostgresConnection(client, req.params.id, req.user.workspace_id);
        const objects = Array.isArray(req.body?.objects) ? req.body.objects : [];
        if (objects.length === 0) {
            return res.status(400).json({ success: false, message: 'objects array is required' });
        }

        const data = [];
        for (const object of objects) {
            const schemaName = String(object?.schemaName || '').trim();
            const tableName = String(object?.tableName || '').trim();
            const objectType = object?.objectType === 'view' ? 'view' : 'table';
            if (!schemaName || !tableName) {
                return res.status(400).json({ success: false, message: 'schemaName and tableName are required' });
            }

            const columns = await listPostgresColumns(connection, schemaName, tableName);
            const primaryKeyColumns = await fetchPostgresPrimaryKey(connection, schemaName, tableName);
            data.push({
                schemaName,
                tableName,
                objectType,
                columns: columns.map((col) => ({
                    name: col.name,
                    type: col.typeExpression,
                    ordinalPosition: col.ordinalPosition,
                    isNullable: col.isNullable,
                })),
                primaryKeyColumns,
            });
        }

        res.json({ success: true, data });
    } catch (err) {
        const status = Number(err?.status || 400);
        res.status(Number.isFinite(status) ? status : 400).json({
            success: false,
            message: err.message || 'Failed to fetch PostgreSQL columns',
        });
    } finally {
        client.release();
    }
});

/**
 * POST /api/connections/:id/postgres/import-jobs
 */
router.post('/:id/postgres/import-jobs', async (req, res) => {
    const client = await getClient();
    try {
        const connection = await requirePostgresConnection(client, req.params.id, req.user.workspace_id);
        const payload = parsePostgresImportPayload(req.body || {});

        const activeJobs = await client.query(
            `SELECT id
             FROM postgres_import_jobs
             WHERE connection_id = $1
               AND status IN ('queued', 'running')
             LIMIT 1`,
            [connection.id]
        );
        if (activeJobs.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Another PostgreSQL import job is already running for this connection',
            });
        }

        const inserted = await client.query(
            `INSERT INTO postgres_import_jobs (
                workspace_id, connection_id, created_by, status, stage, import_mode, payload, progress
             )
             VALUES ($1, $2, $3, 'queued', $4, $5, $6::jsonb, $7::jsonb)
             RETURNING *`,
            [
                req.user.workspace_id,
                connection.id,
                req.user.id,
                POSTGRES_JOB_STAGE.CONNECTING,
                payload.importMode,
                JSON.stringify(payload),
                JSON.stringify({
                    totalTables: payload.tables.length,
                    completedTables: 0,
                    currentTable: null,
                    importedRows: 0,
                    percentage: 0,
                    currentStage: POSTGRES_JOB_STAGE.CONNECTING,
                }),
            ]
        );

        const job = inserted.rows[0];
        enqueuePostgresImportJob(job.id);

        res.status(202).json({
            success: true,
            data: formatPostgresImportJob(job),
        });
    } catch (err) {
        const status = Number(err?.status || 400);
        res.status(Number.isFinite(status) ? status : 400).json({
            success: false,
            message: err.message || 'Failed to create PostgreSQL import job',
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/connections/:id/postgres/import-jobs/:jobId
 */
router.get('/:id/postgres/import-jobs/:jobId', async (req, res) => {
    try {
        const result = await query(
            `SELECT j.*
             FROM postgres_import_jobs j
             JOIN connections c ON c.id = j.connection_id
             WHERE j.id = $1
               AND j.connection_id = $2
               AND c.workspace_id = $3
               AND c.is_deleted = FALSE
             LIMIT 1`,
            [req.params.jobId, req.params.id, req.user.workspace_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Import job not found' });
        }

        res.json({ success: true, data: formatPostgresImportJob(result.rows[0]) });
    } catch (err) {
        console.error('Get PostgreSQL import job error:', err);
        res.status(500).json({ success: false, message: 'Failed to get PostgreSQL import job' });
    }
});

/**
 * GET /api/connections/:id/postgres/import-history
 */
router.get('/:id/postgres/import-history', async (req, res) => {
    try {
        const result = await query(
            `SELECT r.*
             FROM postgres_import_runs r
             JOIN connections c ON c.id = r.connection_id
             WHERE r.connection_id = $1
               AND c.workspace_id = $2
               AND c.is_deleted = FALSE
             ORDER BY r.created_at DESC
             LIMIT 200`,
            [req.params.id, req.user.workspace_id]
        );

        res.json({
            success: true,
            data: result.rows.map(formatPostgresImportRun),
        });
    } catch (err) {
        console.error('List PostgreSQL import history error:', err);
        res.status(500).json({ success: false, message: 'Failed to list PostgreSQL import history' });
    }
});

/**
 * GET /api/connections/excel/datasets - Distinct dataset names in workspace
 */
router.get('/excel/datasets', async (req, res) => {
    try {
        const result = await query(
            `SELECT DISTINCT st.dataset_name
             FROM synced_tables st
             JOIN connections c ON c.id = st.connection_id
             WHERE c.workspace_id = $1
               AND c.is_deleted = FALSE
               AND st.is_deleted = FALSE
               AND st.dataset_name IS NOT NULL
               AND st.dataset_name <> ''
             ORDER BY st.dataset_name ASC`,
            [req.user.workspace_id]
        );

        const datasets = result.rows.map((row) => row.dataset_name);
        if (datasets.length === 0) datasets.push('excel_default');

        res.json({ success: true, data: datasets });
    } catch (err) {
        console.error('List Excel datasets error:', err);
        res.status(500).json({ success: false, message: 'Failed to list Excel datasets' });
    }
});

/**
 * POST /api/connections/excel/upload - Validate and parse Excel sheets for preview
 */
router.post('/excel/upload', async (req, res) => {
    try {
        await runExcelUpload(req, res);
        const filePayload = extractExcelFilePayload(req);
        const preview = parseWorkbookForPreview(filePayload);
        res.json({ success: true, data: preview });
    } catch (err) {
        if (err?.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'File vượt quá giới hạn 50MB' });
        }
        if (err?.code === 'EXCEL_VALIDATION_ERROR') {
            return res.status(400).json({ success: false, message: err.message, details: err.details || undefined });
        }
        console.error('Excel upload preview error:', err);
        res.status(500).json({ success: false, message: 'Failed to parse Excel file' });
    }
});

/**
 * POST /api/connections/google-sheets/oauth/connect
 * Exchange Google OAuth code and create/update a Google Sheets connection.
 */
router.post('/google-sheets/oauth/connect', async (req, res) => {
    const client = await getClient();
    try {
        const { authCode, connectionId, connectionName } = req.body || {};
        const exchangeResult = await exchangeAuthCode(authCode);

        await client.query('BEGIN');

        let connection = null;
        if (connectionId) {
            connection = await loadWorkspaceConnection(client, connectionId, req.user.workspace_id);
            if (!connection) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Connection not found' });
            }
            if (connection.type !== 'GoogleSheets') {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Connection type must be GoogleSheets' });
            }
        } else {
            const created = await client.query(
                `INSERT INTO connections (
                    workspace_id, created_by, name, type, auth_type, status, table_count, config
                )
                VALUES ($1, $2, $3, 'GoogleSheets', 'GoogleMail', 'Connected', 0, '{}'::jsonb)
                RETURNING *`,
                [
                    req.user.workspace_id,
                    req.user.id,
                    String(connectionName || 'Google Sheets Connection').trim() || 'Google Sheets Connection',
                ]
            );
            connection = created.rows[0];
        }

        const googleConfig = getGoogleSheetsConfig(connection.config);
        const oauthConfig = buildOAuthConfig({
            currentOAuth: googleConfig.oauth,
            exchangeResult,
        });

        if (!oauthConfig.refreshTokenEncrypted) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'Google did not return refresh token. Please re-consent with prompt=consent.',
            });
        }

        const nextGoogleConfig = {
            ...googleConfig,
            oauth: oauthConfig,
            sync: normalizeGoogleSheetsSyncConfig(googleConfig.sync),
            imports: Array.isArray(googleConfig.imports) ? googleConfig.imports : [],
        };

        const nextConfig = mergeGoogleSheetsConfig(connection.config, nextGoogleConfig);
        await persistConnectionConfig(client, connection.id, nextConfig, 'Connected');

        if (connectionName && connectionId) {
            await client.query(
                `UPDATE connections
                 SET name = $1
                 WHERE id = $2`,
                [String(connectionName).trim() || connection.name, connection.id]
            );
        }

        const refreshed = await client.query(
            `SELECT * FROM connections WHERE id = $1`,
            [connection.id]
        );

        await client.query('COMMIT');
        res.status(201).json({
            success: true,
            data: formatConnection(refreshed.rows[0]),
        });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err?.code === 'GOOGLE_AUTH_ERROR') {
            return res.status(400).json({
                success: false,
                message: err.message,
                details: err.details || undefined,
            });
        }
        console.error('Google Sheets OAuth connect error:', err);
        res.status(500).json({ success: false, message: 'Failed to connect Google Sheets account' });
    } finally {
        client.release();
    }
});

/**
 * GET /api/connections/:id/google-sheets/files
 */
router.get('/:id/google-sheets/files', async (req, res) => {
    const client = await getClient();
    try {
        const connection = await requireGoogleSheetsConnection(client, req.params.id, req.user.workspace_id);
        const accessToken = await ensureConnectionGoogleAccessToken(client, connection);

        const result = await listSpreadsheetFiles(accessToken, {
            search: req.query.search || '',
            pageToken: req.query.pageToken || '',
            pageSize: req.query.pageSize || 25,
        });

        res.json({
            success: true,
            data: result.files,
            nextPageToken: result.nextPageToken,
        });
    } catch (err) {
        if (err?.code === 'GOOGLE_SHEETS_ERROR' || err?.code === 'GOOGLE_AUTH_ERROR') {
            const status = Number(err?.details?.status || err?.details?.code || 400);
            return res.status(Number.isFinite(status) ? status : 400).json({
                success: false,
                message: err.message,
                details: err.details || undefined,
            });
        }
        console.error('List Google Sheets files error:', err);
        res.status(500).json({ success: false, message: 'Failed to list Google Sheets files' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/connections/:id/google-sheets/resolve-url
 */
router.post('/:id/google-sheets/resolve-url', async (req, res) => {
    const client = await getClient();
    try {
        const { url } = req.body || {};
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ success: false, message: 'url is required' });
        }

        const connection = await requireGoogleSheetsConnection(client, req.params.id, req.user.workspace_id);
        const accessToken = await ensureConnectionGoogleAccessToken(client, connection);
        const file = await resolveSpreadsheetUrl(accessToken, url);

        res.json({ success: true, data: file });
    } catch (err) {
        if (err?.code === 'GOOGLE_SHEETS_ERROR' || err?.code === 'GOOGLE_AUTH_ERROR') {
            const status = Number(err?.details?.status || err?.details?.code || 400);
            return res.status(Number.isFinite(status) ? status : 400).json({
                success: false,
                message: err.message,
                details: err.details || undefined,
            });
        }
        console.error('Resolve Google Sheets URL error:', err);
        res.status(500).json({ success: false, message: 'Failed to resolve Google Sheets URL' });
    } finally {
        client.release();
    }
});

/**
 * GET /api/connections/:id/google-sheets/files/:fileId/sheets
 */
router.get('/:id/google-sheets/files/:fileId/sheets', async (req, res) => {
    const client = await getClient();
    try {
        const connection = await requireGoogleSheetsConnection(client, req.params.id, req.user.workspace_id);
        const accessToken = await ensureConnectionGoogleAccessToken(client, connection);
        const response = await listSpreadsheetSheets(accessToken, req.params.fileId);

        res.json({
            success: true,
            data: {
                spreadsheetId: response.spreadsheetId,
                spreadsheetTitle: response.title,
                sheets: response.sheets,
            },
        });
    } catch (err) {
        if (err?.code === 'GOOGLE_SHEETS_ERROR' || err?.code === 'GOOGLE_AUTH_ERROR') {
            const status = Number(err?.details?.status || err?.details?.code || 400);
            return res.status(Number.isFinite(status) ? status : 400).json({
                success: false,
                message: err.message,
                details: err.details || undefined,
            });
        }
        console.error('List Google Sheets tabs error:', err);
        res.status(500).json({ success: false, message: 'Failed to list Google Sheets tabs' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/connections/:id/google-sheets/preflight
 */
router.post('/:id/google-sheets/preflight', async (req, res) => {
    const client = await getClient();
    try {
        const fileId = String(req.body?.fileId || '').trim();
        const sheetSelections = normalizeSheetSelections(req.body?.sheets || []);
        if (!fileId) {
            return res.status(400).json({ success: false, message: 'fileId is required' });
        }
        if (sheetSelections.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one sheet must be selected' });
        }

        const connection = await requireGoogleSheetsConnection(client, req.params.id, req.user.workspace_id);
        const accessToken = await ensureConnectionGoogleAccessToken(client, connection);

        const preflight = await preflightGoogleSheetsImport({
            accessToken,
            fileId,
            sheetSelections,
        });

        res.json({
            success: true,
            data: preflight,
        });
    } catch (err) {
        if (err?.code === 'GOOGLE_SHEETS_ERROR' || err?.code === 'GOOGLE_AUTH_ERROR') {
            const status = Number(err?.details?.status || err?.details?.code || 400);
            return res.status(Number.isFinite(status) ? status : 400).json({
                success: false,
                message: err.message,
                details: err.details || undefined,
            });
        }
        console.error('Google Sheets preflight error:', err);
        res.status(500).json({ success: false, message: 'Failed to run Google Sheets preflight' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/connections/:id/google-sheets/import
 */
router.post('/:id/google-sheets/import', async (req, res) => {
    const client = await getClient();
    try {
        const fileId = String(req.body?.fileId || '').trim();
        const fileName = String(req.body?.fileName || '').trim();
        const sheetSelections = normalizeSheetSelections(req.body?.sheets || []);
        const allowEmptySheets = req.body?.allowEmptySheets === true;
        const confirmOverwrite = req.body?.confirmOverwrite === true;
        const syncMode = req.body?.syncMode === 'interval' ? 'interval' : 'manual';
        const syncIntervalMinutesRaw = Number(req.body?.syncIntervalMinutes);
        const syncIntervalMinutes = Number.isFinite(syncIntervalMinutesRaw)
            ? Math.min(Math.max(Math.floor(syncIntervalMinutesRaw), 5), 1440)
            : 15;

        if (!fileId) {
            return res.status(400).json({ success: false, message: 'fileId is required' });
        }
        if (sheetSelections.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one sheet must be selected' });
        }

        await client.query('BEGIN');

        const connection = await requireGoogleSheetsConnection(client, req.params.id, req.user.workspace_id);
        const accessToken = await ensureConnectionGoogleAccessToken(client, connection);

        const existing = await findExistingGoogleSheetTables({
            client,
            connectionId: connection.id,
            fileId,
            sheetSelections,
        });
        if (existing.length > 0 && !confirmOverwrite) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: 'Import would overwrite existing synced tables. Confirmation required.',
                details: { existingTables: existing },
            });
        }

        const imported = await importGoogleSheetsToDatabase({
            client,
            connectionId: connection.id,
            accessToken,
            fileId,
            fileName,
            sheetSelections,
            allowEmptySheets,
            strictHeader: true,
        });

        for (const syncedTable of imported.tables || []) {
            await registerRuntimeCatalogForTable({
                client,
                workspaceId: req.user.workspace_id,
                connectionRow: connection,
                syncedTableRow: syncedTable,
            });
        }

        const googleConfig = getGoogleSheetsConfig(connection.config);
        const withImportTarget = upsertGoogleSheetsImportConfig(googleConfig, {
            fileId,
            fileName: imported.fileName || fileName || fileId,
            allowEmptySheets,
            sheets: imported.sheets.map((sheet) => ({
                sheetId: sheet.sheetId,
                sheetName: sheet.sheetName,
                headerMode: sheet.headerMode,
                lastSyncTime: new Date().toISOString(),
            })),
            lastSyncTime: new Date().toISOString(),
        });

        withImportTarget.sync = {
            ...normalizeGoogleSheetsSyncConfig(withImportTarget.sync),
            mode: syncMode,
            intervalMinutes: syncIntervalMinutes,
            nextRunAt: syncMode === 'interval'
                ? new Date(Date.now() + syncIntervalMinutes * 60 * 1000).toISOString()
                : null,
            lastError: null,
            lastErrorAt: null,
        };

        const nextConfig = mergeGoogleSheetsConfig(connection.config, withImportTarget);
        await persistConnectionConfig(client, connection.id, nextConfig, 'Connected');

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            data: imported.tables.map(formatTable),
            warnings: imported.warnings || [],
            metadata: {
                google_file_id: fileId,
                google_file_name: imported.fileName || fileName || fileId,
                import_time: new Date().toISOString(),
                last_sync_time: new Date().toISOString(),
            },
        });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err?.code === 'GOOGLE_SHEETS_ERROR' || err?.code === 'GOOGLE_AUTH_ERROR') {
            const status = Number(err?.details?.status || err?.details?.code || 400);
            return res.status(Number.isFinite(status) ? status : 400).json({
                success: false,
                message: err.message,
                details: err.details || undefined,
            });
        }
        console.error('Google Sheets import error:', err);
        res.status(500).json({ success: false, message: 'Failed to import Google Sheets data' });
    } finally {
        client.release();
    }
});

/**
 * PUT /api/connections/:id/google-sheets/sync-settings
 */
router.put('/:id/google-sheets/sync-settings', async (req, res) => {
    const client = await getClient();
    try {
        const mode = req.body?.mode === 'interval' ? 'interval' : 'manual';
        const intervalRaw = Number(req.body?.intervalMinutes);
        const intervalMinutes = Number.isFinite(intervalRaw)
            ? Math.min(Math.max(Math.floor(intervalRaw), 5), 1440)
            : 15;

        await client.query('BEGIN');
        const connection = await requireGoogleSheetsConnection(client, req.params.id, req.user.workspace_id);
        const googleConfig = getGoogleSheetsConfig(connection.config);
        const nextGoogleConfig = {
            ...googleConfig,
            sync: {
                ...normalizeGoogleSheetsSyncConfig(googleConfig.sync),
                mode,
                intervalMinutes,
                nextRunAt: mode === 'interval'
                    ? new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString()
                    : null,
            },
        };

        const nextConfig = mergeGoogleSheetsConfig(connection.config, nextGoogleConfig);
        await persistConnectionConfig(client, connection.id, nextConfig);
        await client.query('COMMIT');

        res.json({
            success: true,
            data: nextGoogleConfig.sync,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err?.code === 'GOOGLE_SHEETS_ERROR') {
            const status = Number(err?.details?.status || 400);
            return res.status(Number.isFinite(status) ? status : 400).json({
                success: false,
                message: err.message,
                details: err.details || undefined,
            });
        }
        console.error('Update Google Sheets sync settings error:', err);
        res.status(500).json({ success: false, message: 'Failed to update sync settings' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/connections/:id/google-sheets/manual-sync
 */
router.post('/:id/google-sheets/manual-sync', async (req, res) => {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const connection = await requireGoogleSheetsConnection(client, req.params.id, req.user.workspace_id);
        const accessToken = await ensureConnectionGoogleAccessToken(client, connection);
        const googleConfig = getGoogleSheetsConfig(connection.config);
        const existingImports = Array.isArray(googleConfig.imports)
            ? googleConfig.imports.map(normalizeImportTarget)
            : [];
        const hasManualTarget = req.body?.fileId && Array.isArray(req.body?.sheets) && req.body.sheets.length > 0;

        let targets = existingImports;
        if (hasManualTarget) {
            targets = [
                normalizeImportTarget({
                    fileId: String(req.body.fileId),
                    fileName: req.body.fileName ? String(req.body.fileName) : '',
                    sheets: normalizeSheetSelections(req.body.sheets),
                    allowEmptySheets: req.body.allowEmptySheets === true,
                }),
            ];
        }

        if (targets.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'No synced import targets found for this connection',
            });
        }

        const aggregatedWarnings = [];
        const syncedTables = [];
        const syncedTargetsByFile = new Map();

        for (const target of targets) {
            const fileId = String(target?.fileId || '').trim();
            const sheets = normalizeSheetSelections(target?.sheets || []);
            if (!fileId || sheets.length === 0) continue;

            const imported = await importGoogleSheetsToDatabase({
                client,
                connectionId: connection.id,
                accessToken,
                fileId,
                fileName: target.fileName || fileId,
                sheetSelections: sheets,
                allowEmptySheets: target.allowEmptySheets === true,
                strictHeader: true,
            });

            for (const syncedTable of imported.tables || []) {
                await registerRuntimeCatalogForTable({
                    client,
                    workspaceId: req.user.workspace_id,
                    connectionRow: connection,
                    syncedTableRow: syncedTable,
                });
            }

            syncedTables.push(...imported.tables);
            aggregatedWarnings.push(...(imported.warnings || []));
            syncedTargetsByFile.set(fileId, {
                fileId,
                fileName: imported.fileName || target.fileName || fileId,
                allowEmptySheets: target.allowEmptySheets === true,
                sheets: imported.sheets.map((sheet) => ({
                    sheetId: sheet.sheetId,
                    sheetName: sheet.sheetName,
                    headerMode: sheet.headerMode,
                })),
            });
        }

        if (syncedTables.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'No valid import targets were found to sync',
            });
        }

        const nowIso = new Date().toISOString();
        let nextGoogleConfig = {
            ...googleConfig,
            imports: existingImports,
        };
        for (const syncedTarget of syncedTargetsByFile.values()) {
            nextGoogleConfig = upsertGoogleSheetsImportConfig(nextGoogleConfig, {
                ...syncedTarget,
                lastSyncTime: nowIso,
                sheets: (syncedTarget.sheets || []).map((sheet) => ({
                    ...sheet,
                    lastSyncTime: nowIso,
                })),
            });
        }

        // Keep all existing import targets when syncing one ad-hoc target.
        if (!hasManualTarget && syncedTargetsByFile.size === 0) {
            nextGoogleConfig.imports = existingImports;
        }

        nextGoogleConfig = {
            ...nextGoogleConfig,
            sync: {
                ...normalizeGoogleSheetsSyncConfig(googleConfig.sync),
                lastRunAt: nowIso,
                lastError: null,
                lastErrorAt: null,
                nextRunAt: googleConfig.sync?.mode === 'interval'
                    ? new Date(Date.now() + Math.min(Math.max(Number(googleConfig.sync?.intervalMinutes || 15), 5), 1440) * 60 * 1000).toISOString()
                    : null,
            },
        };

        const nextConfig = mergeGoogleSheetsConfig(connection.config, nextGoogleConfig);
        await persistConnectionConfig(client, connection.id, nextConfig, 'Connected');
        await client.query('COMMIT');

        res.json({
            success: true,
            data: syncedTables.map(formatTable),
            warnings: aggregatedWarnings,
            last_sync_time: nowIso,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err?.code === 'GOOGLE_SHEETS_ERROR' || err?.code === 'GOOGLE_AUTH_ERROR') {
            const status = Number(err?.details?.status || err?.details?.code || 400);
            return res.status(Number.isFinite(status) ? status : 400).json({
                success: false,
                message: err.message,
                details: err.details || undefined,
            });
        }
        console.error('Google Sheets manual sync error:', err);
        res.status(500).json({ success: false, message: 'Failed to run manual sync' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/connections - Create connection
 */
router.post('/', async (req, res) => {
    const client = await getClient();
    try {
        const { id: frontendId, name, type, authType, email, status, projectId, serviceAccountKey, tableCount } = req.body;

        // Validate UUID format — frontend may send non-UUID IDs like "conn-123456"
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const validUUID = frontendId && UUID_RE.test(frontendId) ? frontendId : null;

        await client.query('BEGIN');

        // Idempotent: check if this exact connection already exists (only for valid UUIDs)
        if (validUUID) {
            const existing = await client.query(
                'SELECT id FROM connections WHERE id = $1',
                [validUUID]
            );
            if (existing.rows.length > 0) {
                await client.query('COMMIT');
                const fetch = await client.query('SELECT * FROM connections WHERE id = $1', [validUUID]);
                return res.json({ success: true, data: formatConnection(fetch.rows[0]) });
            }
        }

        const result = await client.query(
            `INSERT INTO connections (id, workspace_id, created_by, name, type, auth_type, email, status, project_id, service_account_key, table_count)
       VALUES (COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
            [
                validUUID,
                req.user.workspace_id,
                req.user.id,
                name,
                type || 'BigQuery',
                authType || 'GoogleMail',
                email,
                status || 'Connected',
                projectId,
                serviceAccountKey,
                tableCount || 0,
            ]
        );

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            data: formatConnection(result.rows[0]),
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Create connection error:', err);
        res.status(500).json({ success: false, message: 'Failed to create connection' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/connections/:id/excel/import - Import selected Excel sheets into synced_tables
 */
router.post('/:id/excel/import', async (req, res) => {
    const client = await getClient();
    try {
        await runExcelUpload(req, res);

        const datasetName = String(req.body?.datasetName || '').trim();
        const selectedSheetNames = parseSheetNamesInput(req.body?.sheetNames);
        if (!datasetName) {
            return res.status(400).json({ success: false, message: 'datasetName là bắt buộc' });
        }

        const filePayload = extractExcelFilePayload(req);
        const parsedWorkbook = parseWorkbookForImport({
            ...filePayload,
            selectedSheetNames,
        });

        const connCheck = await client.query(
            `SELECT id, type
             FROM connections
             WHERE id = $1 AND workspace_id = $2 AND is_deleted = FALSE`,
            [req.params.id, req.user.workspace_id]
        );
        if (connCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Connection not found' });
        }
        if (connCheck.rows[0].type !== 'Excel') {
            return res.status(400).json({ success: false, message: 'Connection type phải là Excel' });
        }

        await client.query('BEGIN');

        const upsertedTables = [];
        for (const sheet of parsedWorkbook.sheets) {
            const upsertResult = await client.query(
                `INSERT INTO synced_tables (
                    connection_id, table_name, dataset_name,
                    row_count, column_count, status,
                    last_sync, schema_def, is_deleted,
                    source_file_name, upload_time, source_sheet_name
                )
                VALUES ($1, $2, $3, $4, $5, 'Active', NOW(), $6, FALSE, $7, NOW(), $8)
                ON CONFLICT (connection_id, dataset_name, table_name)
                DO UPDATE SET
                    row_count = EXCLUDED.row_count,
                    column_count = EXCLUDED.column_count,
                    status = 'Active',
                    schema_def = EXCLUDED.schema_def,
                    last_sync = NOW(),
                    is_deleted = FALSE,
                    source_file_name = EXCLUDED.source_file_name,
                    upload_time = EXCLUDED.upload_time,
                    source_sheet_name = EXCLUDED.source_sheet_name
                RETURNING *`,
                [
                    req.params.id,
                    sheet.sheetName,
                    datasetName,
                    sheet.rowCount,
                    sheet.columnCount,
                    JSON.stringify(sheet.schema || []),
                    parsedWorkbook.fileName,
                    sheet.sheetName,
                ]
            );

            const syncedTable = upsertResult.rows[0];
            await client.query('DELETE FROM excel_sheet_rows WHERE synced_table_id = $1', [syncedTable.id]);

            const rowChunks = chunkArray(sheet.rows || [], 500);
            let rowIndexOffset = 0;
            for (const chunk of rowChunks) {
                const values = [];
                const params = [];
                chunk.forEach((rowData, rowIdx) => {
                    const baseIndex = rowIdx * 3;
                    values.push(`($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}::jsonb)`);
                    params.push(
                        syncedTable.id,
                        rowIndexOffset + rowIdx + 1,
                        JSON.stringify(rowData || {})
                    );
                });

                if (values.length > 0) {
                    await client.query(
                        `INSERT INTO excel_sheet_rows (synced_table_id, row_index, row_data)
                         VALUES ${values.join(', ')}`,
                        params
                    );
                    rowIndexOffset += chunk.length;
                }
            }

            await registerRuntimeCatalogForTable({
                client,
                workspaceId: req.user.workspace_id,
                connectionRow: connCheck.rows[0],
                syncedTableRow: syncedTable,
            });

            upsertedTables.push(syncedTable);
        }

        await client.query(
            `UPDATE connections
             SET table_count = (
                SELECT COUNT(*) FROM synced_tables WHERE connection_id = $1 AND is_deleted = FALSE
             )
             WHERE id = $1`,
            [req.params.id]
        );

        await client.query('COMMIT');

        const warnings = parsedWorkbook.sheets
            .filter((sheet) => sheet.isEmpty)
            .map((sheet) => `Sheet "${sheet.sheetName}" rỗng`);

        res.status(201).json({
            success: true,
            data: upsertedTables.map(formatTable),
            warnings,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        if (err?.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'File vượt quá giới hạn 50MB' });
        }
        if (err?.code === 'EXCEL_VALIDATION_ERROR') {
            return res.status(400).json({ success: false, message: err.message, details: err.details || undefined });
        }
        console.error('Excel import error:', err);
        res.status(500).json({ success: false, message: 'Failed to import Excel data' });
    } finally {
        client.release();
    }
});

/**
 * PUT /api/connections/:id - Update connection
 */
router.put('/:id', async (req, res) => {
    try {
        const { name, type, authType, email, status, projectId, serviceAccountKey, tableCount } = req.body;

        const result = await query(
            `UPDATE connections SET
         name = COALESCE($1, name),
         type = COALESCE($2, type),
         auth_type = COALESCE($3, auth_type),
         email = COALESCE($4, email),
         status = COALESCE($5, status),
         project_id = COALESCE($6, project_id),
         service_account_key = COALESCE($7, service_account_key),
         table_count = COALESCE($8, table_count)
       WHERE id = $9 AND workspace_id = $10
       RETURNING *`,
            [name, type, authType, email, status, projectId, serviceAccountKey, tableCount, req.params.id, req.user.workspace_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Connection not found' });
        }

        res.json({ success: true, data: formatConnection(result.rows[0]) });
    } catch (err) {
        console.error('Update connection error:', err);
        res.status(500).json({ success: false, message: 'Failed to update connection' });
    }
});

/**
 * DELETE /api/connections/:id
 */
router.delete('/:id', async (req, res) => {
    try {
        const result = await query(
            'UPDATE connections SET is_deleted = TRUE, updated_at = NOW() WHERE id = $1 AND workspace_id = $2 RETURNING id',
            [req.params.id, req.user.workspace_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Connection not found' });
        }

        // Cascade Soft Delete to Tables
        await query(
            'UPDATE synced_tables SET is_deleted = TRUE, updated_at = NOW() WHERE connection_id = $1',
            [req.params.id]
        );

        res.json({ success: true, message: 'Connection deleted' });
    } catch (err) {
        console.error('Delete connection error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete connection' });
    }
});

/**
 * POST /api/connections/:id/tables - Bulk upsert tables
 */
router.post('/:id/tables', async (req, res) => {
    const client = await getClient();
    try {
        const { tables } = req.body;
        const connectionId = req.params.id;

        if (!tables || !Array.isArray(tables)) {
            return res.status(400).json({ success: false, message: 'tables array is required' });
        }

        await client.query('BEGIN');

        const connectionResult = await client.query(
            `SELECT *
             FROM connections
             WHERE id = $1
               AND workspace_id = $2
               AND is_deleted = FALSE
             LIMIT 1`,
            [connectionId, req.user.workspace_id]
        );
        if (connectionResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Connection not found' });
        }
        const connectionRow = connectionResult.rows[0];

        const results = [];
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const t of tables) {
            const validTableId = t.id && UUID_RE.test(t.id) ? t.id : null;
            const result = await client.query(
                `INSERT INTO synced_tables (id, connection_id, table_name, dataset_name, row_count, column_count, status, schema_def, is_deleted)
         VALUES (COALESCE($1, uuid_generate_v4()), $2, $3, $4, $5, $6, $7, $8, FALSE)
         ON CONFLICT (connection_id, dataset_name, table_name) 
         DO UPDATE SET row_count = EXCLUDED.row_count, column_count = EXCLUDED.column_count, status = EXCLUDED.status, schema_def = EXCLUDED.schema_def, last_sync = NOW(), is_deleted = FALSE
         RETURNING *`,
                [
                    validTableId,
                    connectionId,
                    t.tableName,
                    t.datasetName,
                    t.rowCount || 0,
                    t.columnCount || (Array.isArray(t.schema) ? t.schema.length : 0),
                    t.status || 'Active',
                    JSON.stringify(t.schema || []),
                ]
            );
            const syncedTableRow = result.rows[0];
            await registerRuntimeCatalogForTable({
                client,
                workspaceId: req.user.workspace_id,
                connectionRow,
                syncedTableRow,
            });
            results.push(syncedTableRow);
        }

        // Update table count on connection (active only)
        await client.query(
            'UPDATE connections SET table_count = (SELECT COUNT(*) FROM synced_tables WHERE connection_id = $1 AND is_deleted = FALSE) WHERE id = $1',
            [connectionId]
        );

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            data: results.map(formatTable),
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Upsert tables error:', err);
        res.status(500).json({ success: false, message: 'Failed to save tables' });
    } finally {
        client.release();
    }
});

/**
 * DELETE /api/connections/tables/:id — Soft delete a synced table
 */
router.delete('/tables/:id', async (req, res) => {
    try {
        const result = await query(
            `UPDATE synced_tables st
             SET is_deleted = TRUE,
                 updated_at = NOW()
             FROM connections c
             WHERE st.id = $1
               AND st.connection_id = c.id
               AND c.workspace_id = $2
               AND c.is_deleted = FALSE
             RETURNING st.id, st.connection_id`,
            [req.params.id, req.user.workspace_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Table not found' });
        }

        const connectionId = result.rows[0].connection_id;

        // Update connection table count
        await query(
            `UPDATE connections
             SET table_count = (
                SELECT COUNT(*)
                FROM synced_tables
                WHERE connection_id = $1
                  AND is_deleted = FALSE
             )
             WHERE id = $1`,
            [connectionId]
        );

        await query('DELETE FROM model_runtime_tables WHERE synced_table_id = $1', [req.params.id]);

        res.json({ success: true, message: 'Table deleted' });
    } catch (err) {
        console.error('Delete table error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete table' });
    }
});

/**
 * GET /api/connections/tables/:id/data?offset=<n>&limit=<n>
 */
router.get('/tables/:id/data', async (req, res) => {
    try {
        const rawOffset = parseInt(req.query.offset, 10);
        const rawLimit = parseInt(req.query.limit, 10);
        const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 200;

        const tableResult = await query(
            `SELECT st.*, c.type AS connection_type
             FROM synced_tables st
             JOIN connections c ON c.id = st.connection_id
             WHERE st.id = $1
               AND st.is_deleted = FALSE
               AND c.workspace_id = $2
               AND c.is_deleted = FALSE`,
            [req.params.id, req.user.workspace_id]
        );

        if (tableResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Table not found' });
        }

        const table = tableResult.rows[0];
        const totalRows = table.row_count || 0;
        let rows = [];

        if (table.connection_type === 'Excel' || table.connection_type === 'GoogleSheets') {
            const rowsResult = await query(
                `SELECT row_index, row_data
                 FROM excel_sheet_rows
                 WHERE synced_table_id = $1
                 ORDER BY row_index ASC
                 OFFSET $2 LIMIT $3`,
                [req.params.id, offset, limit]
            );
            rows = rowsResult.rows.map((row) => row.row_data || {});
        } else if (table.connection_type === 'PostgreSQL') {
            const syncState = await query(
                `SELECT snapshot_table_name
                 FROM postgres_table_sync_state
                 WHERE connection_id = $1
                   AND schema_name = $2
                   AND table_name = $3
                 LIMIT 1`,
                [table.connection_id, table.dataset_name, table.table_name]
            );

            if (syncState.rows.length === 0 || !syncState.rows[0].snapshot_table_name) {
                return res.status(404).json({ success: false, message: 'PostgreSQL snapshot table not found' });
            }

            const snapshotTableName = syncState.rows[0].snapshot_table_name;
            const snapshotSql = `SELECT * FROM ${quoteIdent(SNAPSHOT_SCHEMA)}.${quoteIdent(snapshotTableName)} OFFSET $1 LIMIT $2`;
            const rowsResult = await query(snapshotSql, [offset, limit]);
            rows = rowsResult.rows || [];
        } else {
            return res.status(400).json({
                success: false,
                message: `Table preview is not supported for source type: ${table.connection_type}`,
            });
        }

        res.json({
            success: true,
            data: {
                tableId: req.params.id,
                offset,
                limit,
                totalRows,
                hasMore: offset + rows.length < totalRows,
                schema: typeof table.schema_def === 'string' ? JSON.parse(table.schema_def) : (table.schema_def || []),
                rows,
            },
        });
    } catch (err) {
        console.error('Get imported table data error:', err);
        res.status(500).json({ success: false, message: 'Failed to get table data' });
    }
});

/**
 * GET /api/connections/:id/tables
 */
router.get('/:id/tables', async (req, res) => {
    try {
        const result = await query(
            `SELECT st.*
             FROM synced_tables st
             JOIN connections c ON c.id = st.connection_id
             WHERE st.connection_id = $1
               AND st.is_deleted = FALSE
               AND c.workspace_id = $2
               AND c.is_deleted = FALSE
             ORDER BY st.dataset_name, st.table_name`,
            [req.params.id, req.user.workspace_id]
        );

        res.json({ success: true, data: result.rows.map(formatTable) });
    } catch (err) {
        console.error('List tables error:', err);
        res.status(500).json({ success: false, message: 'Failed to list tables' });
    }
});

function formatConnection(row) {
    const rootConfig = toObject(row.config);
    const formatted = {
        id: row.id,
        name: row.name,
        type: row.type,
        authType: row.auth_type,
        email: row.email || undefined,
        status: row.status,
        projectId: row.project_id || undefined,
        // NOTE: This value is sensitive. It is returned because the current frontend
        // generates BigQuery access tokens client-side. If we later move BigQuery
        // token minting to the backend, we should remove this from list responses.
        serviceAccountKey: row.service_account_key || undefined,
        hasServiceAccountKey: Boolean(row.service_account_key),
        tableCount: row.table_count,
        createdAt: row.created_at,
    };

    if (row.type === 'PostgreSQL') {
        const postgresConfig = getPostgresConfig(row.config);
        formatted.config = {
            postgres: sanitizePostgresConfig(postgresConfig),
        };
    }

    if (row.type === 'GoogleSheets') {
        const googleConfig = getGoogleSheetsConfig(rootConfig);
        const oauth = toObject(googleConfig.oauth);
        formatted.config = {
            ...(formatted.config || {}),
            googleSheets: {
                sync: googleConfig.sync,
                imports: googleConfig.imports,
                hasRefreshToken: Boolean(oauth.refreshTokenEncrypted),
                expiresAt: oauth.expiresAt || null,
            },
        };
    }

    if (row.type === 'Excel') {
        const excelConfig = toObject(rootConfig.excel);
        formatted.config = {
            ...(formatted.config || {}),
            excel: {
                ...excelConfig,
            },
        };
    }

    return formatted;
}

function formatTable(row) {
    let schema = [];
    try {
        schema = typeof row.schema_def === 'string' ? JSON.parse(row.schema_def) : (row.schema_def || []);
    } catch (err) {
        schema = [];
    }

    return {
        id: row.id,
        connectionId: row.connection_id,
        tableName: row.table_name,
        datasetName: row.dataset_name,
        rowCount: row.row_count,
        columnCount: row.column_count || 0,
        status: row.status,
        lastSync: row.last_sync,
        schema,
        fileName: row.source_file_name || undefined,
        uploadTime: row.upload_time || undefined,
        sheetName: row.source_sheet_name || undefined,
        sourceFileId: row.source_file_id || undefined,
        sourceFileName: row.source_file_name || undefined,
        sourceSheetId: row.source_sheet_id || undefined,
        importTime: row.upload_time || undefined,
        lastSyncTime: row.last_sync || undefined,
    };
}

module.exports = router;
