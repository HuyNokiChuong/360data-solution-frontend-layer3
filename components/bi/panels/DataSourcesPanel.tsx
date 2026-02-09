
import React, { useMemo, useState } from 'react';
import { useDataStore } from '../store/dataStore';
import { DataSource } from '../types';

interface DataSourcesPanelProps {
    onSelectDataSource?: (id: string) => void;
    onReloadDataSource?: (id: string) => void;
    onStopDataSource?: (id: string) => void;
}

const DataSourcesPanel: React.FC<DataSourcesPanelProps> = ({ onSelectDataSource, onReloadDataSource, onStopDataSource }) => {
    const { dataSources, selectedDataSourceId, setSelectedDataSource, systemLogs, clearLogs } = useDataStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeView, setActiveView] = useState<'tables' | 'logs'>('tables');

    const filteredDataSources = useMemo(() => {
        let results = dataSources;
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            results = results.filter(ds =>
                ds.name.toLowerCase().includes(query) ||
                ds.datasetName?.toLowerCase().includes(query) ||
                ds.tableName?.toLowerCase().includes(query)
            );
        }

        // Apply Priority Sort:
        // 0: Syncing/Loading (Active)
        // 1: Ready/Loaded (Done)
        // 2: Waiting/Not Started (Queued)
        return [...results].sort((a, b) => {
            const getPriority = (ds: any) => {
                if (ds.syncStatus === 'syncing' || ds.isLoadingPartial) return 0; // Running
                if (ds.syncStatus === 'queued') return 1; // Waiting
                if (ds.isLoaded) return 2; // Done
                return 3; // Not started
            };

            const pA = getPriority(a);
            const pB = getPriority(b);

            if (pA !== pB) return pA - pB;

            // Default to name sorting within same priority
            const nameA = (a.tableName || a.name || '').toLowerCase();
            const nameB = (b.tableName || b.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });
    }, [dataSources, searchQuery]);

    const handleSelectDataSource = (id: string) => {
        setSelectedDataSource(id);
        if (onSelectDataSource) {
            onSelectDataSource(id);
        }
    };

    const getDataSourceIcon = (type: string) => {
        switch (type) {
            case 'bigquery':
                return 'fa-database';
            case 'csv':
                return 'fa-file-csv';
            case 'json':
                return 'fa-file-code';
            case 'api':
                return 'fa-cloud';
            default:
                return 'fa-table';
        }
    };

    const getDataSourceBadgeColor = (type: string) => {
        switch (type) {
            case 'bigquery':
                return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            case 'csv':
                return 'bg-green-500/20 text-green-400 border-green-500/30';
            case 'json':
                return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
            case 'api':
                return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
            default:
                return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
        }
    };

    const handleSyncAll = () => {
        // Switch to logs view to show progress
        setActiveView('logs');

        // Trigger reload for all bigquery tables
        dataSources.forEach(ds => {
            if (ds.type === 'bigquery') {
                onReloadDataSource?.(ds.id);
            }
        });
    };

    return (
        <div className="flex flex-col h-full bg-slate-950">
            {/* Tab Header */}
            <div className="flex bg-slate-900 border-b border-white/10 shrink-0">
                <button
                    onClick={() => setActiveView('tables')}
                    className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all relative ${activeView === 'tables' ? 'text-white bg-white/5' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
                >
                    <i className="fas fa-table mr-2 text-xs"></i>
                    Data Tables
                    {activeView === 'tables' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 shadow-[0_-2px_6px_rgba(99,102,241,0.5)]"></div>}
                </button>
                <button
                    onClick={() => setActiveView('logs')}
                    className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all relative ${activeView === 'logs' ? 'text-white bg-white/5' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
                >
                    <div className="flex items-center justify-center gap-2">
                        <i className="fas fa-terminal text-xs"></i>
                        System Logs
                        {systemLogs.some(l => l.type === 'error') && (
                            <span className="flex h-2 w-2 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                        )}
                    </div>
                    {activeView === 'logs' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 shadow-[0_-2px_6px_rgba(99,102,241,0.5)]"></div>}
                </button>
            </div>

            {activeView === 'tables' ? (
                <>
                    {/* Header */}
                    <div className="p-4 border-b border-white/5 bg-slate-900/20">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Data Tables</h3>
                            <button
                                onClick={handleSyncAll}
                                className="px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 text-[9px] font-black uppercase tracking-widest rounded transition-all flex items-center gap-1.5 border border-indigo-500/30"
                            >
                                <i className="fas fa-sync-alt"></i>
                                Reload All
                            </button>
                        </div>

                        {/* Search */}
                        <div className="relative">
                            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
                            <input
                                type="text"
                                placeholder="Search tables..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-slate-900 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all"
                            />
                        </div>
                    </div>

                    {/* Data Sources List */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                        {filteredDataSources.length === 0 && (
                            <div className="text-center py-8 text-slate-500">
                                <i className="fas fa-inbox text-3xl mb-2 opacity-20"></i>
                                <p className="text-xs">No data tables found</p>
                            </div>
                        )}

                        {filteredDataSources.map((ds) => {
                            const isSelected = ds.id === selectedDataSourceId;
                            const displayName = ds.datasetName && ds.tableName
                                ? ds.tableName
                                : ds.name;

                            return (
                                <div
                                    key={ds.id}
                                    onClick={() => handleSelectDataSource(ds.id)}
                                    className={`
                                group relative p-2 rounded-lg cursor-pointer transition-all border
                                ${isSelected
                                            ? 'bg-indigo-600/10 border-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.1)]'
                                            : 'bg-slate-900/40 border-white/[0.03] hover:bg-white/[0.05] hover:border-white/10'
                                        }
                            `}
                                >
                                    <div className="flex items-center gap-2.5">
                                        {/* Icon */}
                                        <div className={`
                                    w-7 h-7 rounded flex items-center justify-center flex-shrink-0 transition-colors
                                    ${isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500 group-hover:text-slate-300'}
                                `}>
                                            <i className={`fas ${getDataSourceIcon(ds.type)} text-[10px]`}></i>
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="min-w-0">
                                                <h4 className={`text-[11px] font-black truncate leading-tight ${isSelected ? 'text-indigo-300' : 'text-slate-300'}`}>
                                                    {displayName}
                                                </h4>
                                                <p className="text-[9px] text-slate-500 font-medium truncate">
                                                    {ds.datasetName || 'Dataset'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Info Row */}
                                    <div className="mt-2 flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            <span className={`px-1.5 py-0.5 rounded-[3px] text-[8px] font-black uppercase tracking-wider border leading-none ${getDataSourceBadgeColor(ds.type)}`}>
                                                {ds.type}
                                            </span>
                                            <span className="text-[9px] font-medium text-slate-600">
                                                {ds.schema.length} fields
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {ds.type === 'bigquery' && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onReloadDataSource?.(ds.id);
                                                    }}
                                                    disabled={ds.isLoadingPartial}
                                                    className={`
                                                w-6 h-6 rounded flex items-center justify-center transition-all
                                                ${ds.isLoadingPartial ? 'text-blue-400' : 'text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10'}
                                            `}
                                                    title={ds.syncStatus === 'ready' ? 'Refresh Sync' : 'Sync Now'}
                                                >
                                                    <i className={`fas ${ds.syncStatus === 'error' ? 'fa-exclamation-triangle text-red-500' : 'fa-sync-alt'} text-[9px] ${ds.isLoadingPartial ? 'fa-spin' : ''}`}></i>
                                                </button>
                                            )}
                                            {ds.isLoadingPartial && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onStopDataSource?.(ds.id);
                                                    }}
                                                    className="w-6 h-6 rounded flex items-center justify-center text-red-500 hover:bg-red-500/10 transition-all"
                                                    title="Stop Job"
                                                >
                                                    <i className="fas fa-stop text-[9px]"></i>
                                                </button>
                                            )}
                                            <div className="text-[9px] text-right">
                                                {ds.syncStatus === 'ready' && ds.lastSyncAt ? (
                                                    <span className="text-emerald-500/60 block text-[7px] uppercase font-black tracking-tighter mb-0.5">
                                                        Sẵn sàng • {new Date(ds.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                ) : (ds.syncStatus === 'syncing' || ds.isLoadingPartial) ? (
                                                    <span className="text-blue-400 block text-[7px] uppercase font-black tracking-tighter mb-0.5 animate-pulse">
                                                        Đang kết nối...
                                                    </span>
                                                ) : ds.syncStatus === 'queued' ? (
                                                    <span className="text-amber-400/80 block text-[7px] uppercase font-black tracking-tighter mb-0.5">
                                                        Đang chờ...
                                                    </span>
                                                ) : ds.syncStatus === 'error' ? (
                                                    <span className="text-red-400 block text-[7px] uppercase font-black tracking-tighter mb-0.5">
                                                        Lỗi kết nối
                                                    </span>
                                                ) : null}
                                                {ds.type === 'bigquery' ? (
                                                    <span className="text-indigo-400 font-bold uppercase tracking-widest text-[8px]">
                                                        Direct Query
                                                    </span>
                                                ) : (
                                                    <>
                                                        <span className={`font-mono ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`}>
                                                            {(ds.data?.length || 0).toLocaleString()}
                                                        </span>
                                                        <span className="text-slate-700 mx-0.5">/</span>
                                                        <span className="text-slate-600">
                                                            {(ds.totalRows || ds.data?.length || 0).toLocaleString()} rows
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Progress bar (Only for local file sync) */}
                                    {
                                        ds.type !== 'bigquery' && !!(ds.isLoadingPartial || (ds.totalRows && ds.totalRows > ds.data?.length)) && (
                                            <div className="mt-1.5 w-full h-0.5 bg-slate-800 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-indigo-500 shadow-[0_0_5px_rgba(99,102,241,0.5)] transition-all duration-300"
                                                    style={{ width: `${Math.min(100, Math.round((ds.data?.length / (ds.totalRows || 1)) * 100))}%` }}
                                                />
                                            </div>
                                        )
                                    }
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-white/5 flex items-center justify-between bg-slate-900/20">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">System Logs</h3>
                        <button
                            onClick={clearLogs}
                            className="text-[9px] font-black text-slate-500 hover:text-red-400 uppercase tracking-widest transition-colors"
                        >
                            Clear Logs
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                        {systemLogs.length === 0 && (
                            <div className="text-center py-20 text-slate-600">
                                <i className="fas fa-clipboard-list text-3xl mb-3 opacity-20"></i>
                                <p className="text-xs italic">No activity logs recorded yet</p>
                            </div>
                        )}
                        {systemLogs.map((log) => (
                            <div key={log.id} className="group relative pl-3 border-l-2 transition-all hover:bg-white/[0.02] p-1.5 rounded-r">
                                <div className={`absolute left-[-2px] top-0 bottom-0 w-[2px] ${log.type === 'error' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
                                    log.type === 'success' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                                        'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]'
                                    }`}></div>

                                <div className="flex items-center justify-between mb-0.5">
                                    <span className={`text-[8px] font-black uppercase tracking-tighter ${log.type === 'error' ? 'text-red-400' :
                                        log.type === 'success' ? 'text-emerald-400' :
                                            'text-blue-400'
                                        }`}>
                                        {log.type}
                                    </span>
                                    <span className="text-[8px] text-slate-600 font-mono">
                                        {new Date(log.timestamp).toLocaleTimeString()}
                                    </span>
                                </div>
                                <div className="text-[10px] text-slate-300 leading-relaxed font-medium">
                                    {log.message}
                                </div>
                                {log.target && (
                                    <div className="mt-1 flex items-center gap-1">
                                        <i className="fas fa-database text-[8px] text-slate-600"></i>
                                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tight">{log.target}</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div >
    );
};

export default DataSourcesPanel;
