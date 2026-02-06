
import { useDataStore } from '../store/dataStore';
import { fetchTableData } from '../../../services/bigquery';
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
        const { appendTableData, clearTableData, setTableLoadingState, getDataSource, updateDataSource, addLog } = useDataStore.getState();
        const ds = getDataSource(dsId);

        if (!ds || ds.type !== 'bigquery') return;
        if (this.activeSyncs.has(dsId)) return;

        this.activeSyncs.add(dsId);

        const tableName = ds.tableName || ds.name;
        const isRecovery = !ds.isLoaded && (ds.data?.length || 0) > 0;

        addLog({
            type: 'info',
            message: isRecovery
                ? `Phát hiện tiến trình ${tableName} bị gián đoạn. Đang kết nối lại và đồng bộ...`
                : `Bắt đầu đồng bộ bảng ${tableName}...`,
            target: tableName
        });

        try {
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

            const gcsBucket = process.env.NEXT_PUBLIC_GCS_CACHE_BUCKET;

            if (gcsBucket) {
                const { fetchTableDataViaExport } = await import('../../../services/bigquery');
                await fetchTableDataViaExport(
                    token,
                    connection.projectId || '',
                    ds.datasetName || '',
                    ds.tableName || '',
                    gcsBucket,
                    {
                        signal: options.signal,
                        onPartialResults: (rows, totalRows) => {
                            appendTableData(dsId, rows, totalRows);
                            if (options.onProgress) {
                                options.onProgress(rows.length, totalRows);
                            }
                        }
                    }
                );
            } else {
                await fetchTableData(
                    token,
                    connection.projectId || '',
                    ds.datasetName || '',
                    ds.tableName || '',
                    {
                        signal: options.signal,
                        limit: options.limit, // No default limit, fetch all unless specified
                        onPartialResults: (rows, totalRows) => {
                            appendTableData(dsId, rows, totalRows);
                            if (options.onProgress) {
                                options.onProgress(rows.length, totalRows);
                            }
                        }
                    }
                );
            }


            // Verify data integrity
            const finalDs = useDataStore.getState().getDataSource(dsId);
            const loadedCount = finalDs?.data?.length || 0;
            const expectedTotal = finalDs?.totalRows || 0;

            // Allow a small margin of error? No, exact match required based on user request "100%"
            // But only if we didn't specify a limit
            if (!options.limit && expectedTotal > 0 && loadedCount < expectedTotal) {
                // Double check if data is in a "capped" state due to memory limits? 
                // For now, treat as error.
                throw new Error(`Data verification failed: Loaded ${loadedCount} rows but expected ${expectedTotal}.`);
            }

            updateDataSource(dsId, {
                syncStatus: 'ready',
                lastSyncAt: new Date().toISOString(),
                isLoaded: true,
                isLoadingPartial: false // Clear loading state BEFORE save for faster UI response
            });

            addLog({
                type: 'success',
                message: `Đồng bộ thành công bảng ${tableName}`,
                target: tableName
            });

            // Persist to IndexedDB after successful sync - DO NOT await to prevent blocking the worker queue
            const { commitDataToStorage } = useDataStore.getState();
            commitDataToStorage(dsId).catch(err => console.error('Background save failed', err));
        } catch (error: any) {
            console.error(`Sync failed for ${ds.name}:`, error);

            addLog({
                type: 'error',
                message: `Lỗi đồng bộ bảng ${tableName}: ${error.message}`,
                target: tableName
            });

            updateDataSource(dsId, {
                syncStatus: 'error',
                syncError: error.message,
                isLoadingPartial: false // Ensure loading state is cleared even on error
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
