// ============================================
// Data Store - Zustand State Management
// ============================================

import { create } from 'zustand';
import { DataSource, Field, SystemLog } from '../types';
import { parseCSV, parseJSON, detectSchema } from '../engine/dataProcessing';
import { PersistentStorage } from '../../../services/storage';

interface DataState {
    // Data
    dataSources: DataSource[];
    selectedDataSourceId: string | null;
    loading: boolean;
    error: string | null;
    domain: string | null;
    systemLogs: SystemLog[];

    // Actions
    setSelectedDataSource: (id: string | null) => void;
    setDomain: (domain: string) => void;

    // Data source actions
    addDataSource: (dataSource: Omit<DataSource, 'id' | 'createdAt'>) => void;
    updateDataSource: (id: string, updates: Partial<DataSource>) => void;
    deleteDataSource: (id: string) => void;

    // Load data from file
    loadCSVFile: (file: File) => Promise<void>;
    loadJSONFile: (file: File) => Promise<void>;

    // Load data from BigQuery table
    loadBigQueryTable: (connectionId: string, tableName: string, datasetName: string, data: any[] | null, schema: Field[], totalRows?: number) => string;

    // Load data for existing source (full or partial)
    loadTableData: (id: string, rows: any[]) => void;
    appendTableData: (id: string, newRows: any[], totalRows?: number) => void;
    clearTableData: (id: string) => void;
    setTableLoadingState: (id: string, isLoading: boolean) => void;

    // Utility
    getDataSource: (id: string) => DataSource | undefined;
    getSelectedDataSource: () => DataSource | undefined;
    getFieldsForDataSource: (id: string) => Field[];
    clearAllBigQueryData: () => void;
    loadFromStorage: (domain: string) => void;
    setSyncStatus: (id: string, status: DataSource['syncStatus'], error?: string | null) => void;
    commitDataToStorage: (id: string) => Promise<void>;

    // Logging
    addLog: (log: Omit<SystemLog, 'id' | 'timestamp'>) => void;
    clearLogs: () => void;
}

const getStorageKey = (domain: string | null) => domain ? `${domain}_bi_data_sources` : 'bi_data_sources';

const saveToStorage = async (dataSources: DataSource[], selectedDataSourceId: string | null, domain: string | null, systemLogs: SystemLog[], specificId?: string | 'metadata-only') => {
    try {
        // 1. Always save metadata to localStorage
        const metadata = dataSources.map(ds => {
            const { data, ...rest } = ds;
            return rest;
        });
        localStorage.setItem(getStorageKey(domain), JSON.stringify({
            dataSources: metadata,
            selectedDataSourceId,
            systemLogs
        }));

        // 2. Only save data arrays to IndexedDB if a specific ID is provided (and it's not metadata-only)
        if (specificId && specificId !== 'metadata-only') {
            const ds = dataSources.find(d => d.id === specificId);
            if (ds) {
                if (ds.data && ds.data.length > 0) {
                    await PersistentStorage.set(`ds_data_${ds.id}`, ds.data);
                } else {
                    await PersistentStorage.delete(`ds_data_${ds.id}`);
                }
            }
        }
    } catch (e) {
        console.error('Failed to save data sources', e);
    }
};

export const useDataStore = create<DataState>((set, get) => ({
    // Initial state
    dataSources: [],
    selectedDataSourceId: null,
    loading: false,
    error: null,
    domain: null,
    systemLogs: [],

    // Setters
    setDomain: (domain) => set({ domain }),
    setSelectedDataSource: (id) => set((state) => {
        saveToStorage(state.dataSources, id, state.domain, state.systemLogs, 'metadata-only');
        return { selectedDataSourceId: id };
    }),

    // Data source actions
    addDataSource: (dataSource) => set((state) => {
        const newDataSource: DataSource = {
            ...dataSource,
            id: `ds-${Date.now()}`,
            createdAt: new Date().toISOString()
        };

        const newState = {
            dataSources: [...state.dataSources, newDataSource],
            selectedDataSourceId: newDataSource.id
        };
        saveToStorage(newState.dataSources, newState.selectedDataSourceId, state.domain, state.systemLogs, newDataSource.id);
        return newState;
    }),

    updateDataSource: (id, updates) => set((state) => {
        const newDataSources = state.dataSources.map(ds =>
            ds.id === id ? { ...ds, ...updates } : ds
        );
        saveToStorage(newDataSources, state.selectedDataSourceId, state.domain, state.systemLogs, id);
        return { dataSources: newDataSources };
    }),

    deleteDataSource: (id) => set((state) => {
        const newDataSources = state.dataSources.filter(ds => ds.id !== id);
        const newSelectedId = state.selectedDataSourceId === id ? null : state.selectedDataSourceId;
        saveToStorage(newDataSources, newSelectedId, state.domain, state.systemLogs, 'metadata-only');
        PersistentStorage.delete(`ds_data_${id}`);
        return {
            dataSources: newDataSources,
            selectedDataSourceId: newSelectedId
        };
    }),

    // Load CSV file
    loadCSVFile: async (file) => {
        set({ loading: true, error: null });

        try {
            const text = await file.text();
            const { data, schema } = parseCSV(text);

            const dataSource: DataSource = {
                id: `ds-${Date.now()}`,
                name: file.name.replace('.csv', ''),
                type: 'csv',
                data,
                schema,
                createdAt: new Date().toISOString()
            };

            const newState = {
                dataSources: [...get().dataSources, dataSource],
                selectedDataSourceId: dataSource.id,
                loading: false
            };
            saveToStorage(newState.dataSources, newState.selectedDataSourceId, get().domain, get().systemLogs, dataSource.id);
            set(newState);
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to load CSV file',
                loading: false
            });
        }
    },

    // Load JSON file
    loadJSONFile: async (file) => {
        set({ loading: true, error: null });

        try {
            const text = await file.text();
            const { data, schema } = parseJSON(text);

            const dataSource: DataSource = {
                id: `ds-${Date.now()}`,
                name: file.name.replace('.json', ''),
                type: 'json',
                data,
                schema,
                createdAt: new Date().toISOString()
            };

            const newState = {
                dataSources: [...get().dataSources, dataSource],
                selectedDataSourceId: dataSource.id,
                loading: false
            };
            saveToStorage(newState.dataSources, newState.selectedDataSourceId, get().domain, get().systemLogs, dataSource.id);
            set(newState);
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to load JSON file',
                loading: false
            });
        }
    },

    // Load BigQuery table
    loadBigQueryTable: (connectionId, tableName, datasetName, data, schema, totalRows) => {
        const { dataSources, domain } = get();

        // Find existing data source for this specific table
        const existingId = dataSources.find(ds =>
            ds.type === 'bigquery' &&
            ds.connectionId === connectionId &&
            ds.tableName === tableName &&
            ds.datasetName === datasetName
        )?.id;

        if (existingId) {
            // Update existing
            const updates: Partial<DataSource> = { schema };
            if (data !== null) {
                updates.data = data;
                updates.isLoaded = true;
            }
            if (totalRows !== undefined) {
                updates.totalRows = totalRows;
            }
            get().updateDataSource(existingId, updates);
            return existingId;
        } else {
            // Add new
            const dataSource: DataSource = {
                id: `bq:${connectionId}:${datasetName}:${tableName}`,
                name: `${datasetName}.${tableName}`,
                type: 'bigquery',
                data: data || [],
                schema,
                connectionId,
                tableName,
                datasetName,
                totalRows,
                isLoaded: data !== null,
                syncStatus: data !== null ? 'ready' : undefined,
                createdAt: new Date().toISOString()
            };

            const newDataSources = [...get().dataSources, dataSource];
            saveToStorage(newDataSources, get().selectedDataSourceId, domain, get().systemLogs, dataSource.id);
            set({
                dataSources: newDataSources,
            });

            return dataSource.id;
        }
    },

    setSyncStatus: (id, status, error = null) => {
        set((state) => ({
            dataSources: state.dataSources.map(ds =>
                ds.id === id ? { ...ds, syncStatus: status, syncError: error } : ds
            )
        }));
    },

    // Load data for existing source
    loadTableData: (id, rows) => {
        set((state) => ({
            dataSources: state.dataSources.map(ds =>
                ds.id === id ? { ...ds, data: rows, isLoaded: true, isLoadingPartial: false } : ds
            )
        }));
    },

    // Append partial data
    appendTableData: (id, newRows, totalRows) => {
        set((state) => {
            const dsIndex = state.dataSources.findIndex(ds => ds.id === id);
            if (dsIndex === -1) return state;

            const ds = state.dataSources[dsIndex];
            const finalTotal = totalRows !== undefined ? totalRows : (ds.totalRows || 0);

            // Optimization: Avoid large array spreads/concat if possible
            // In a real app with 8M rows, we'd use a different storage model, 
            // but for now let's at least make the state update cleaner
            const combinedData = [...ds.data, ...newRows];

            // CAPPING & DEDUPLICATION GUARD
            const results = finalTotal > 0 && combinedData.length > finalTotal
                ? combinedData.slice(0, finalTotal)
                : combinedData;

            const isLoaded = finalTotal > 0 ? results.length >= finalTotal : ds.isLoaded;

            const updatedDs = {
                ...ds,
                data: results,
                totalRows: finalTotal,
                isLoaded,
                lastRefresh: new Date().toISOString()
            };

            const newDataSources = [...state.dataSources];
            newDataSources[dsIndex] = updatedDs;

            // Save progress metadata to localStorage (so it survives F5)
            saveToStorage(newDataSources, state.selectedDataSourceId, state.domain, state.systemLogs, 'metadata-only');

            // PERIODIC IDB SAVE: Save to IndexedDB every ~50k rows (approx every append if chunk is 50k)
            // ensuring we don't lose too much progress on F5
            PersistentStorage.set(`ds_data_${id}`, results).catch(e => console.error("Periodic IDB save failed", e));

            return { dataSources: newDataSources };
        });
    },

    clearTableData: (id) => {
        set((state) => {
            const newDataSources = state.dataSources.map(ds =>
                ds.id === id ? { ...ds, data: [], isLoaded: false, isLoadingPartial: false, totalRows: 0 } : ds
            );
            saveToStorage(newDataSources, state.selectedDataSourceId, state.domain, state.systemLogs, 'metadata-only');
            return { dataSources: newDataSources };
        });
    },

    setTableLoadingState: (id, isLoading) => {
        set((state) => ({
            dataSources: state.dataSources.map(ds =>
                ds.id === id ? { ...ds, isLoadingPartial: isLoading } : ds
            )
        }));
    },

    // Utility getters
    getDataSource: (id) => {
        return get().dataSources.find(ds => ds.id === id);
    },

    getSelectedDataSource: () => {
        const { dataSources, selectedDataSourceId } = get();
        return dataSources.find(ds => ds.id === selectedDataSourceId);
    },

    getFieldsForDataSource: (id) => {
        const dataSource = get().dataSources.find(ds => ds.id === id);
        return dataSource?.schema || [];
    },

    clearAllBigQueryData: () => {
        set((state) => {
            const newDataSources = state.dataSources.map(ds =>
                ds.type === 'bigquery' ? { ...ds, isLoaded: false, data: [], isLoadingPartial: false, totalRows: 0 } : ds
            );
            saveToStorage(newDataSources, state.selectedDataSourceId, state.domain, state.systemLogs, 'metadata-only');
            return { dataSources: newDataSources };
        });
    },

    loadFromStorage: async (domain) => {
        try {
            const data = localStorage.getItem(getStorageKey(domain));
            if (data) {
                const parsed = JSON.parse(data);
                const metadataSources = parsed.dataSources || (Array.isArray(parsed) ? parsed : []);
                const selectedDataSourceId = parsed.selectedDataSourceId || null;
                const systemLogs = parsed.systemLogs || [];

                // Restore data from IndexedDB in parallel
                const fullSources = await Promise.all(metadataSources.map(async (ds: any) => {
                    const cachedData = await PersistentStorage.get(`ds_data_${ds.id}`);
                    return {
                        ...ds,
                        data: cachedData || [],
                        isLoaded: ds.isLoaded && !!cachedData,
                        isLoadingPartial: ds.syncStatus === 'syncing' // Recovery mode: active if it was syncing
                    };
                }));

                set({ dataSources: fullSources, selectedDataSourceId, domain, systemLogs });
            } else {
                set({ dataSources: [], selectedDataSourceId: null, domain });
            }
        } catch (e) {
            console.error('Failed to load data sources', e);
        }
    },

    commitDataToStorage: async (id) => {
        const { dataSources, selectedDataSourceId, domain, systemLogs } = get();
        await saveToStorage(dataSources, selectedDataSourceId, domain, systemLogs, id);
    },

    addLog: (log) => {
        const newLog: SystemLog = {
            ...log,
            id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString()
        };
        set((state) => {
            const nextLogs = [newLog, ...state.systemLogs].slice(0, 100);
            saveToStorage(state.dataSources, state.selectedDataSourceId, state.domain, nextLogs, 'metadata-only');
            return { systemLogs: nextLogs };
        });
    },

    clearLogs: () => set((state) => {
        saveToStorage(state.dataSources, state.selectedDataSourceId, state.domain, [], 'metadata-only');
        return { systemLogs: [] };
    })
}));
