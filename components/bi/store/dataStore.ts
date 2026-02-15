// ============================================
// Data Store - Zustand State Management
// ============================================

import { create } from 'zustand';
import { DataSource, Field, SystemLog } from '../types';
import { parseCSV, parseJSON, detectSchema } from '../engine/dataProcessing';
import { PersistentStorage } from '../../../services/storage';
import { isAssistantGeneratedDataSource } from '../utils/dataSourceVisibility';

interface DataState {
    // Data
    dataSources: DataSource[];
    selectedDataSourceId: string | null;
    loading: boolean;
    error: string | null;
    domain: string | null;
    systemLogs: SystemLog[];
    isHydrated: boolean;

    // Actions
    setSelectedDataSource: (id: string | null) => void;
    setDomain: (domain: string) => void;

    // Data source actions
    addDataSource: (dataSource: Omit<DataSource, 'id' | 'createdAt'>) => void;
    upsertDataSource: (dataSource: DataSource) => void;
    updateDataSource: (id: string, updates: Partial<DataSource>) => void;
    deleteDataSource: (id: string) => void;

    // Load data from file
    loadCSVFile: (file: File) => Promise<void>;
    loadJSONFile: (file: File) => Promise<void>;

    // Load data from BigQuery table
    loadBigQueryTable: (connectionId: string, tableName: string, datasetName: string, data: any[] | null, schema: Field[], totalRows?: number) => string;
    loadExcelTable: (syncedTableId: string, connectionId: string, tableName: string, datasetName: string, schema: Field[], totalRows?: number) => string;

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

    // BigQuery Auth & Connections
    googleToken: string | null;
    connections: any[]; // Using any[] for now to match BIMain's Connection[]
    setGoogleToken: (token: string | null) => void;
    setConnections: (connections: any[]) => void;

    // Logging
    addLog: (log: Omit<SystemLog, 'id' | 'timestamp'>) => void;
    clearLogs: () => void;
}

const getStorageKey = (domain: string | null) => domain ? `${domain}_bi_data_sources` : 'bi_data_sources';

const saveToStorage = async (state: DataState, specificId?: string | 'metadata-only') => {
    const { dataSources, selectedDataSourceId, domain, systemLogs, isHydrated } = state;
    if (!isHydrated || !domain) return;

    try {
        const storageKey = getStorageKey(domain);

        // 1. Always save metadata to localStorage
        const metadata = dataSources.map(ds => {
            const { data, ...rest } = ds;
            return rest;
        });

        // Safety check removed to allow full pruning/reset

        localStorage.setItem(storageKey, JSON.stringify({
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
        if (e instanceof Error && e.name === 'QuotaExceededError') {
            console.error('🛑 LocalStorage quota exceeded for Data Sources');
        } else {
            console.error('Failed to save data sources', e);
        }
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
    googleToken: null,
    connections: [],
    isHydrated: false,

    // Auth Setters
    setGoogleToken: (googleToken) => set({ googleToken }),
    setConnections: (connections) => set({ connections }),

    // Setters
    setDomain: (domain) => set({ domain }),
    setSelectedDataSource: (id) => {
        set({ selectedDataSourceId: id });
        saveToStorage(get(), 'metadata-only');
    },

    // Data source actions
    addDataSource: (dataSource) => {
        const newDataSource: DataSource = {
            id: `ds-${Date.now()}`,
            createdAt: new Date().toISOString(),
            ...dataSource
        };

        set((state) => ({
            dataSources: [...state.dataSources, newDataSource],
            selectedDataSourceId: newDataSource.id
        }));
        saveToStorage(get(), newDataSource.id);
    },

    upsertDataSource: (dataSource) => {
        set((state) => {
            const existingIndex = state.dataSources.findIndex((source) => source.id === dataSource.id);
            if (existingIndex >= 0) {
                const nextDataSources = [...state.dataSources];
                nextDataSources[existingIndex] = {
                    ...nextDataSources[existingIndex],
                    ...dataSource,
                };
                return { dataSources: nextDataSources };
            }
            return { dataSources: [...state.dataSources, dataSource] };
        });
        saveToStorage(get(), dataSource.id);
    },

    updateDataSource: (id, updates) => {
        set((state) => ({
            dataSources: state.dataSources.map(ds =>
                ds.id === id ? { ...ds, ...updates } : ds
            )
        }));
        saveToStorage(get(), id);
    },

    deleteDataSource: (id) => {
        const state = get();
        const newDataSources = state.dataSources.filter(ds => ds.id !== id);
        const newSelectedId = state.selectedDataSourceId === id ? null : state.selectedDataSourceId;

        set({
            dataSources: newDataSources,
            selectedDataSourceId: newSelectedId
        });
        saveToStorage(get(), 'metadata-only');
        PersistentStorage.delete(`ds_data_${id}`);
    },

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

            set((state) => ({
                dataSources: [...state.dataSources, dataSource],
                selectedDataSourceId: dataSource.id,
                loading: false
            }));
            saveToStorage(get(), dataSource.id);
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

            set((state) => ({
                dataSources: [...state.dataSources, dataSource],
                selectedDataSourceId: dataSource.id,
                loading: false
            }));
            saveToStorage(get(), dataSource.id);
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : 'Failed to load JSON file',
                loading: false
            });
        }
    },

    // Load BigQuery table
    loadBigQueryTable: (connectionId, tableName, datasetName, data, schema, totalRows) => {
        const { dataSources } = get();

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

            set((state) => ({
                dataSources: [...state.dataSources, dataSource],
            }));
            saveToStorage(get(), dataSource.id);

            return dataSource.id;
        }
    },

    // Load Excel table metadata
    loadExcelTable: (syncedTableId, connectionId, tableName, datasetName, schema, totalRows) => {
        const { dataSources } = get();
        const sourceId = `excel:${syncedTableId}`;

        const existing = dataSources.find(ds => ds.id === sourceId);
        if (existing) {
            get().updateDataSource(sourceId, {
                schema,
                totalRows: totalRows !== undefined ? totalRows : existing.totalRows,
                tableName,
                datasetName,
                connectionId,
                syncedTableId
            });
            return sourceId;
        }

        const dataSource: DataSource = {
            id: sourceId,
            name: `${datasetName}.${tableName}`,
            type: 'excel',
            data: [],
            schema,
            connectionId,
            tableName,
            datasetName,
            syncedTableId,
            totalRows,
            isLoaded: false,
            syncStatus: 'ready',
            createdAt: new Date().toISOString()
        };

        set((state) => ({
            dataSources: [...state.dataSources, dataSource]
        }));
        saveToStorage(get(), 'metadata-only');

        return sourceId;
    },

    setSyncStatus: (id, status, error = null) => {
        set((state) => {
            const dataSource = state.dataSources.find(ds => ds.id === id);
            const newLogs = [...state.systemLogs];

            if (status === 'syncing') {
                newLogs.unshift({
                    id: `log-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    type: 'info',
                    message: `Bắt đầu đồng bộ dữ liệu cho: ${dataSource?.name || id}`,
                    target: id
                });
            } else if (status === 'ready') {
                newLogs.unshift({
                    id: `log-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    type: 'success',
                    message: `Đồng bộ thành công: ${dataSource?.name || id}`,
                    target: id
                });
            } else if (status === 'error') {
                newLogs.unshift({
                    id: `log-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    type: 'error',
                    message: `Lỗi đồng bộ ${dataSource?.name || id}: ${error}`,
                    target: id
                });
            }

            // Keep only last 100 logs
            if (newLogs.length > 100) newLogs.splice(100);

            return {
                dataSources: state.dataSources.map(ds =>
                    ds.id === id ? { ...ds, syncStatus: status, syncError: error } : ds
                ),
                systemLogs: newLogs
            };
        });
        saveToStorage(get(), 'metadata-only');
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

            // MEMORY OPTIMIZATION
            ds.data.push(...newRows);

            const finalTotal = totalRows !== undefined ? totalRows : (ds.totalRows || 0);

            if (finalTotal > 0 && ds.data.length > finalTotal) {
                ds.data.splice(finalTotal);
            }

            const isLoaded = finalTotal > 0 ? ds.data.length >= finalTotal : ds.isLoaded;

            const newDataSources = [...state.dataSources];
            newDataSources[dsIndex] = {
                ...ds,
                totalRows: finalTotal,
                isLoaded,
                lastRefresh: new Date().toISOString()
            };

            return { dataSources: newDataSources };
        });

        // Save metadata
        saveToStorage(get(), 'metadata-only');

        // PERIODIC IDB SAVE
        const ds = get().dataSources.find(d => d.id === id);
        if (ds && ds.data) {
            PersistentStorage.set(`ds_data_${id}`, ds.data).catch(e => console.error("Periodic IDB save failed", e));
        }
    },

    clearTableData: (id) => {
        set((state) => ({
            dataSources: state.dataSources.map(ds =>
                ds.id === id ? { ...ds, data: [], isLoaded: false, isLoadingPartial: false, totalRows: 0 } : ds
            )
        }));
        saveToStorage(get(), 'metadata-only');
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
        set((state) => ({
            dataSources: state.dataSources.map(ds =>
                ds.type === 'bigquery' ? { ...ds, isLoaded: false, data: [], isLoadingPartial: false, totalRows: 0 } : ds
            )
        }));
        saveToStorage(get(), 'metadata-only');
    },

    loadFromStorage: async (domain) => {
        try {
            const data = localStorage.getItem(getStorageKey(domain));
            if (data) {
                const parsed = JSON.parse(data);
                const metadataSources = parsed.dataSources || (Array.isArray(parsed) ? parsed : []);
                const selectedDataSourceId = parsed.selectedDataSourceId || null;
                const systemLogs = parsed.systemLogs || [];

                const fullSources = await Promise.all(metadataSources.map(async (ds: any) => {
                    const normalizedMeta = isAssistantGeneratedDataSource(ds)
                        ? {
                            ...ds,
                            type: 'ai_generated',
                            assistantGenerated: true,
                            hiddenFromDataTables: true
                        }
                        : ds;
                    const cachedData = await PersistentStorage.get(`ds_data_${ds.id}`);
                    return {
                        ...normalizedMeta,
                        data: cachedData || [],
                        isLoaded: normalizedMeta.isLoaded && !!cachedData,
                        isLoadingPartial: normalizedMeta.syncStatus === 'syncing'
                    };
                }));

                const selectedSource = fullSources.find((source) => source.id === selectedDataSourceId);
                const normalizedSelectedId = selectedSource && !isAssistantGeneratedDataSource(selectedSource)
                    ? selectedDataSourceId
                    : null;

                set({ dataSources: fullSources, selectedDataSourceId: normalizedSelectedId, domain, systemLogs, isHydrated: true });
            } else {
                set({ dataSources: [], selectedDataSourceId: null, domain, isHydrated: true });
            }
        } catch (e) {
            console.error('Failed to load data sources', e);
        }
    },

    commitDataToStorage: async (id) => {
        await saveToStorage(get(), id);
    },

    addLog: (log) => {
        if (!log) return;
        set((state) => {
            const newLog: SystemLog = {
                id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                timestamp: new Date().toISOString(),
                ...log
            };
            const newLogs = [newLog, ...state.systemLogs].slice(0, 100);
            return { systemLogs: newLogs };
        });
        saveToStorage(get(), 'metadata-only');
    },

    clearLogs: () => set({ systemLogs: [] })
}));
