
import { useDataStore } from '../store/dataStore';
import { Connection } from '../../../types';

export interface SyncOptions {
    limit?: number;
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
}

export class DataAssetService {
    private static activeSyncs = new Set<string>();

    /**
     * Synchronizes a BigQuery table to the local persistent store.
     */
    static async syncTable(
        dsId: string,
        token: string,
        connection: Connection,
        options: SyncOptions = {}
    ): Promise<void> {
        const { clearTableData, setTableLoadingState, getDataSource, updateDataSource, addLog } = useDataStore.getState();
        const ds = getDataSource(dsId);
        const { signal } = options;

        const throwIfAborted = () => {
            if (!signal?.aborted) return;
            throw new DOMException('Sync aborted', 'AbortError');
        };

        if (!ds || ds.type !== 'bigquery') return;
        if (this.activeSyncs.has(dsId)) return;

        throwIfAborted();
        this.activeSyncs.add(dsId);

        const tableName = ds.tableName || ds.name;
        const gcsBucket = process.env.NEXT_PUBLIC_GCS_CACHE_BUCKET;
        const logFile = `${tableName}/_sync_status.log`;

        let logBuffer = `[${new Date().toISOString()}] SYNC START: ${tableName}\n`;

        const logEntry = async (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
            const entry = `[${new Date().toISOString()}] [${type.toUpperCase()}] ${msg}\n`;
            logBuffer += entry;
            addLog({ type, message: msg, target: tableName });

            // Persist to GCS immediately if bucket exists
            if (gcsBucket) {
                const { writeGCSFile } = await import('../../../services/bigquery');
                writeGCSFile(token, gcsBucket, logFile, logBuffer).catch(() => { });
            }
        };

        const isRecovery = !ds.isLoaded && (ds.data?.length || 0) > 0;

        await logEntry(isRecovery
            ? `Phát hiện tiến trình ${tableName} bị gián đoạn. Đang kết nối lại và đồng bộ...`
            : `Bắt đầu đồng bộ bảng ${tableName}...`
        );

        try {
            throwIfAborted();

            // ONLY clear if it's NOT a recovery (fresh start)
            if (!isRecovery) {
                clearTableData(dsId);
            }

            setTableLoadingState(dsId, true);

            // Reset state for new sync
            updateDataSource(dsId, {
                syncStatus: 'syncing',
                syncError: null
            });

            // METADATA ONLY SYNC
            const { fetchTableSchema } = await import('../../../services/bigquery');

            // 1. Fetch Schema
            const schemaFields = await fetchTableSchema(
                token,
                connection.projectId || '',
                ds.datasetName || '',
                ds.tableName || '',
                signal
            );
            throwIfAborted();

            // 2. Fetch Row Count (using aggregation query for speed)
            const { runQuery } = await import('../../../services/bigquery');
            let totalRows = 0;
            try {
                const countQuery = `SELECT count(*) as count FROM \`${connection.projectId}.${ds.datasetName}.${ds.tableName}\``;
                const countResult = await runQuery(token, connection.projectId || '', countQuery, signal);
                if (countResult && countResult.length > 0) {
                    totalRows = countResult[0].count;
                }
            } catch (e: any) {
                if (e?.name === 'AbortError' || signal?.aborted) {
                    throw e;
                }
                console.warn("Could not fetch row count", e);
            }

            // 3. Update Data Source with Metadata ONLY
            const normalizeType = (type: string): 'string' | 'number' | 'boolean' | 'date' => {
                const lower = type.toLowerCase();
                if (['integer', 'int64', 'float', 'float64', 'numeric', 'bignumeric'].includes(lower)) return 'number';
                if (['boolean', 'bool'].includes(lower)) return 'boolean';
                if (['date', 'datetime', 'timestamp', 'time'].includes(lower)) return 'date';
                return 'string';
            };

            const normalizedSchema = schemaFields.map(f => ({
                name: f.name,
                type: normalizeType(f.type)
            }));

            const { loadBigQueryTable } = useDataStore.getState();
            loadBigQueryTable(
                connection.id,
                tableName,
                ds.datasetName || '',
                [], // Empty data
                normalizedSchema,
                totalRows
            );

            // Force state update to "ready"
            updateDataSource(dsId, {
                syncStatus: 'ready',
                lastSyncAt: new Date().toISOString(),
                isLoaded: true, // Mark as loaded so UI allows selection
                isLoadingPartial: false,
                data: [], // Ensure data is empty to save memory
                totalRows: totalRows
            });

            await logEntry(`Đã kết nối bảng ${tableName}. Metadata ready. Rows: ${totalRows}`, 'success');

            // Persist to IndexedDB (Metadata only)
            const { commitDataToStorage } = useDataStore.getState();
            commitDataToStorage(dsId).catch(err => console.error('Background save failed', err));
        } catch (error: any) {
            if (error?.name === 'AbortError' || signal?.aborted) {
                await logEntry(`Tiến trình đồng bộ bảng ${tableName} đã bị hủy`, 'info');
                updateDataSource(dsId, {
                    syncStatus: 'ready',
                    syncError: null,
                    isLoadingPartial: false
                });
                throw error?.name === 'AbortError' ? error : new DOMException('Sync aborted', 'AbortError');
            }

            console.error(`Sync failed for ${ds.name}:`, error);

            await logEntry(`Lỗi kết nối bảng ${tableName}: ${error.message}`, 'error');

            updateDataSource(dsId, {
                syncStatus: 'error',
                syncError: error.message,
                isLoadingPartial: false
            });
            throw error;
        } finally {
            this.activeSyncs.delete(dsId);
            setTableLoadingState(dsId, false);
        }
    }

    /**
     * Checks if a table needs synchronization
     */
    static needsSync(dsId: string): boolean {
        const ds = useDataStore.getState().getDataSource(dsId);
        if (!ds) return false;
        if (ds.type !== 'bigquery') return false;

        // If never loaded OR specifically marked as not loaded (interrupted/stale)
        // This ensures if a user refreshes during a sync, it will be picked up again
        if (!ds.isLoaded) return true;

        // If sync failed previously
        if (ds.syncStatus === 'error') return true;

        return false;
    }
}
