const { query, getClient } = require('../config/db');
const { ensureAccessToken } = require('./google-sheets-auth.service');
const { importGoogleSheetsToDatabase } = require('./google-sheets.service');

const SCHEDULER_POLL_MS = 60 * 1000;
const connectionLocks = new Set();

let schedulerTimer = null;
let schedulerIsTicking = false;

const clampSyncInterval = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 15;
    return Math.min(Math.max(Math.floor(num), 5), 1440);
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

const getGoogleSheetsConfig = (config) => {
    const root = toObject(config);
    const gs = toObject(root.googleSheets);
    return {
        ...gs,
        oauth: toObject(gs.oauth),
        sync: {
            mode: 'manual',
            intervalMinutes: 15,
            ...toObject(gs.sync),
        },
        imports: Array.isArray(gs.imports) ? gs.imports : [],
    };
};

const mergeGoogleSheetsConfig = (config, nextGoogleSheetsConfig) => {
    const root = toObject(config);
    return {
        ...root,
        googleSheets: nextGoogleSheetsConfig,
    };
};

const shouldRunNow = (syncConfig) => {
    if (syncConfig.mode !== 'interval') return false;
    const intervalMinutes = clampSyncInterval(syncConfig.intervalMinutes);
    const now = Date.now();
    const nextRunAt = Date.parse(syncConfig.nextRunAt || '');
    if (Number.isFinite(nextRunAt)) {
        return now >= nextRunAt;
    }
    const lastRunAt = Date.parse(syncConfig.lastRunAt || '');
    if (!Number.isFinite(lastRunAt)) return true;
    return now >= (lastRunAt + intervalMinutes * 60 * 1000);
};

const applySyncSuccess = (syncConfig) => {
    const intervalMinutes = clampSyncInterval(syncConfig.intervalMinutes);
    const now = new Date();
    return {
        ...syncConfig,
        mode: 'interval',
        intervalMinutes,
        lastRunAt: now.toISOString(),
        nextRunAt: new Date(now.getTime() + intervalMinutes * 60 * 1000).toISOString(),
        lastError: null,
        lastErrorAt: null,
    };
};

const applySyncFailure = (syncConfig, message) => ({
    ...syncConfig,
    mode: syncConfig.mode || 'interval',
    intervalMinutes: clampSyncInterval(syncConfig.intervalMinutes),
    lastError: message,
    lastErrorAt: new Date().toISOString(),
});

const processConnectionSync = async (connectionRow) => {
    if (connectionLocks.has(connectionRow.id)) return;
    connectionLocks.add(connectionRow.id);

    const client = await getClient();
    try {
        await client.query('BEGIN');

        const freshConnection = await client.query(
            `SELECT id, workspace_id, status, config
             FROM connections
             WHERE id = $1 AND is_deleted = FALSE
             FOR UPDATE`,
            [connectionRow.id]
        );

        if (freshConnection.rows.length === 0) {
            await client.query('ROLLBACK');
            return;
        }

        const connection = freshConnection.rows[0];
        const googleConfig = getGoogleSheetsConfig(connection.config);
        const syncConfig = toObject(googleConfig.sync);
        const imports = Array.isArray(googleConfig.imports) ? googleConfig.imports : [];

        if (syncConfig.mode !== 'interval' || imports.length === 0 || !shouldRunNow(syncConfig)) {
            await client.query('ROLLBACK');
            return;
        }

        const oauth = toObject(googleConfig.oauth);
        const tokenState = await ensureAccessToken(oauth);
        const accessToken = tokenState.accessToken;

        const nextGoogleConfig = {
            ...googleConfig,
            oauth: tokenState.oauthConfig,
            sync: syncConfig,
            imports: [...imports],
        };

        const importResults = [];
        for (const importTarget of imports) {
            const fileId = String(importTarget?.fileId || '').trim();
            const sheetSelections = Array.isArray(importTarget?.sheets) ? importTarget.sheets : [];
            if (!fileId || sheetSelections.length === 0) continue;

            const imported = await importGoogleSheetsToDatabase({
                client,
                connectionId: connection.id,
                accessToken,
                fileId,
                fileName: importTarget.fileName || importTarget.googleFileName || fileId,
                sheetSelections,
                allowEmptySheets: importTarget.allowEmptySheets === true,
                strictHeader: true,
            });
            importResults.push(imported);

            const importIndex = nextGoogleConfig.imports.findIndex((i) => String(i?.fileId || '') === fileId);
            if (importIndex !== -1) {
                nextGoogleConfig.imports[importIndex] = {
                    ...nextGoogleConfig.imports[importIndex],
                    lastSyncTime: new Date().toISOString(),
                    fileName: imported.fileName || nextGoogleConfig.imports[importIndex].fileName,
                    sheets: imported.sheets.map((sheet) => ({
                        sheetId: sheet.sheetId,
                        sheetName: sheet.sheetName,
                        headerMode: sheet.headerMode,
                        lastSyncTime: new Date().toISOString(),
                    })),
                };
            }
        }

        nextGoogleConfig.sync = applySyncSuccess(syncConfig);
        const nextConfig = mergeGoogleSheetsConfig(connection.config, nextGoogleConfig);

        await client.query(
            `UPDATE connections
             SET config = $1::jsonb,
                 status = 'Connected'
             WHERE id = $2`,
            [JSON.stringify(nextConfig), connection.id]
        );

        await client.query('COMMIT');
        console.log(`[google-sheets-sync] synced connection=${connection.id} imports=${importResults.length}`);
    } catch (error) {
        await client.query('ROLLBACK');
        const safeMessage = error?.message || 'Unknown scheduler error';
        console.error(`[google-sheets-sync] failed connection=${connectionRow.id}`, error);

        try {
            const current = await query('SELECT config FROM connections WHERE id = $1', [connectionRow.id]);
            if (current.rows.length > 0) {
                const googleConfig = getGoogleSheetsConfig(current.rows[0].config);
                googleConfig.sync = applySyncFailure(toObject(googleConfig.sync), safeMessage);
                const nextConfig = mergeGoogleSheetsConfig(current.rows[0].config, googleConfig);
                await query(
                    `UPDATE connections
                     SET config = $1::jsonb,
                         status = 'Error'
                     WHERE id = $2`,
                    [JSON.stringify(nextConfig), connectionRow.id]
                );
            }
        } catch (nestedErr) {
            console.error('[google-sheets-sync] failed to persist sync error', nestedErr);
        }
    } finally {
        client.release();
        connectionLocks.delete(connectionRow.id);
    }
};

const tickScheduler = async () => {
    if (schedulerIsTicking) return;
    schedulerIsTicking = true;
    try {
        const result = await query(
            `SELECT id, workspace_id, config
             FROM connections
             WHERE type = 'GoogleSheets'
               AND is_deleted = FALSE`
        );

        for (const row of result.rows) {
            const googleConfig = getGoogleSheetsConfig(row.config);
            const sync = toObject(googleConfig.sync);
            const hasImports = Array.isArray(googleConfig.imports) && googleConfig.imports.length > 0;

            if (sync.mode !== 'interval' || !hasImports) continue;
            if (!shouldRunNow(sync)) continue;

            await processConnectionSync(row);
        }
    } catch (error) {
        console.error('[google-sheets-sync] scheduler tick failed', error);
    } finally {
        schedulerIsTicking = false;
    }
};

const startGoogleSheetsScheduler = () => {
    if (schedulerTimer) return;
    schedulerTimer = setInterval(() => {
        tickScheduler().catch((err) => {
            console.error('[google-sheets-sync] unexpected tick failure', err);
        });
    }, SCHEDULER_POLL_MS);

    setTimeout(() => {
        tickScheduler().catch((err) => {
            console.error('[google-sheets-sync] initial tick failed', err);
        });
    }, 5000);
    console.log('[google-sheets-sync] scheduler started');
};

const stopGoogleSheetsScheduler = () => {
    if (!schedulerTimer) return;
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[google-sheets-sync] scheduler stopped');
};

module.exports = {
    startGoogleSheetsScheduler,
    stopGoogleSheetsScheduler,
};
