import React, { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { DataSource, Field } from '../types';
import { Connection } from '../../../types';

interface RightDataSidebarProps {
    dataSources: DataSource[];
    connections: Connection[];
    selectedDataSourceIds: string[];
    activeDataSourceId: string | null;
    onToggleDataSource: (id: string, selected: boolean) => void;
    onActivateDataSource: (id: string) => void;
    onReloadDataSource?: (id: string) => void;
    onStopDataSource?: (id: string) => void;
}

const getFieldIcon = (type: string) => {
    switch (type) {
        case 'number': return 'fa-hashtag';
        case 'date': return 'fa-calendar';
        case 'boolean': return 'fa-toggle-on';
        default: return 'fa-font';
    }
};

const getFieldColor = (type: string) => {
    switch (type) {
        case 'number': return 'text-blue-400 bg-blue-500/10';
        case 'date': return 'text-purple-400 bg-purple-500/10';
        case 'boolean': return 'text-orange-400 bg-orange-500/10';
        default: return 'text-emerald-400 bg-emerald-500/10';
    }
};

const DraggableField: React.FC<{
    field: Field;
    dataSourceId: string;
    dataSourceName: string;
}> = ({ field, dataSourceId, dataSourceName }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `field:${dataSourceId}:${field.name}`,
        data: {
            type: 'field',
            field,
            dataSourceId,
            dataSourceName,
        }
    });

    const style = transform
        ? {
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            zIndex: 1000
        }
        : undefined;

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-grab active:cursor-grabbing border transition-all ${isDragging
                ? 'bg-indigo-600/20 border-indigo-500/40 ring-2 ring-indigo-500/40 opacity-70'
                : 'bg-white border-slate-200 hover:border-indigo-500/30 hover:bg-slate-50 dark:bg-slate-900/60 dark:border-white/10 dark:hover:bg-white/5'
                }`}
            title={`Drag ${field.name} to widget`}
        >
            <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${getFieldColor(field.type)}`}>
                <i className={`fas ${getFieldIcon(field.type)} text-[9px]`}></i>
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">{field.name}</div>
                <div className="text-[9px] text-slate-500 uppercase">{field.type}</div>
            </div>
            <i className="fas fa-grip-vertical text-[10px] text-slate-400 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"></i>
        </div>
    );
};

const RightDataSidebar: React.FC<RightDataSidebarProps> = ({
    dataSources,
    connections,
    selectedDataSourceIds,
    activeDataSourceId,
    onToggleDataSource,
    onActivateDataSource,
    onReloadDataSource,
    onStopDataSource,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [sourceFilter, setSourceFilter] = useState('');
    const [fieldSearchQuery, setFieldSearchQuery] = useState('');

    const selectableDataSources = useMemo(
        () => dataSources.filter((ds) => ds.type !== 'semantic_model'),
        [dataSources]
    );

    const getSourceKey = (ds: DataSource) => {
        if (ds.connectionId) return `conn:${ds.connectionId}`;
        if (['csv', 'json', 'manual', 'api'].includes(ds.type)) return `${ds.type}:local`;
        return `${ds.type}:default`;
    };

    const getSourceLabel = (ds: DataSource) => {
        if (ds.connectionId) {
            const connection = connections.find((item) => item.id === ds.connectionId);
            if (connection?.name) return connection.name;
        }
        switch (ds.type) {
            case 'bigquery': return 'BigQuery';
            case 'excel': return 'Imported';
            case 'semantic_model': return 'Semantic Model';
            case 'csv': return 'CSV';
            case 'json': return 'JSON';
            default: return ds.type;
        }
    };

    const sourceOptions = useMemo(() => {
        const map = new Map<string, string>();
        selectableDataSources.forEach((ds) => {
            const key = getSourceKey(ds);
            if (!map.has(key)) {
                map.set(key, getSourceLabel(ds));
            }
        });
        return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
    }, [selectableDataSources, connections]);

    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filteredDataSources = useMemo(() => {
        return selectableDataSources.filter((ds) => {
            if (sourceFilter && getSourceKey(ds) !== sourceFilter) return false;
            if (!normalizedQuery) return true;
            const haystack = `${getSourceLabel(ds)} ${ds.datasetName || ''} ${ds.tableName || ''} ${ds.name}`.toLowerCase();
            return haystack.includes(normalizedQuery);
        });
    }, [selectableDataSources, sourceFilter, normalizedQuery, connections]);

    const selectedSources = useMemo(() => {
        const idSet = new Set(selectedDataSourceIds);
        return selectableDataSources.filter((ds) => idSet.has(ds.id));
    }, [selectedDataSourceIds, selectableDataSources]);

    const activeSelectedSource = useMemo(() => {
        if (selectedSources.length === 0) return null;
        const activeInSelected = selectedSources.find((ds) => ds.id === activeDataSourceId);
        return activeInSelected || selectedSources[0];
    }, [selectedSources, activeDataSourceId]);

    const filteredActiveFields = useMemo(() => {
        if (!activeSelectedSource) return [];
        const query = fieldSearchQuery.trim().toLowerCase();
        if (!query) return activeSelectedSource.schema;
        return activeSelectedSource.schema.filter((field) => field.name.toLowerCase().includes(query));
    }, [activeSelectedSource, fieldSearchQuery]);

    const getSyncMeta = (ds: DataSource) => {
        if (ds.syncStatus === 'error') {
            return { label: 'Error', className: 'text-red-400', icon: 'fa-exclamation-triangle' };
        }
        if (ds.syncStatus === 'syncing' || ds.isLoadingPartial) {
            const progress = ds.totalRows && ds.totalRows > 0
                ? Math.min(100, Math.round(((ds.data?.length || 0) / ds.totalRows) * 100))
                : null;
            return {
                label: progress !== null ? `Syncing ${progress}%` : 'Syncing',
                className: 'text-blue-400',
                icon: 'fa-spinner fa-spin'
            };
        }
        if (ds.syncStatus === 'queued') {
            return { label: 'Queued', className: 'text-amber-400', icon: 'fa-clock' };
        }
        if (ds.syncStatus === 'ready' || ds.isLoaded) {
            return { label: 'Synced', className: 'text-emerald-400', icon: 'fa-circle-check' };
        }
        return { label: 'Initialized', className: 'text-slate-500', icon: 'fa-circle-notch' };
    };

    return (
        <div className="h-full flex flex-col bg-white dark:bg-slate-950">
            <div className="shrink-0 border-b border-slate-200 dark:border-white/10 p-3 space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Data Tables</h3>
                        <p className="text-[9px] text-slate-500 mt-1">
                            {selectedSources.length} table(s) selected for this page
                        </p>
                    </div>
                    <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center">
                        <i className="fas fa-database text-[10px]"></i>
                    </div>
                </div>

                <div className="relative">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-[10px]"></i>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search tables..."
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg pl-8 pr-3 py-2 text-[11px] text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                </div>

                <select
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                    <option value="">All sources</option>
                    {sourceOptions.map((source) => (
                        <option key={source.key} value={source.key}>{source.label}</option>
                    ))}
                </select>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <div className="shrink-0 max-h-[40vh] overflow-y-auto overflow-x-visible custom-scrollbar p-2 space-y-1.5 border-b border-slate-200 dark:border-white/5">
                    {filteredDataSources.length === 0 && (
                        <div className="text-center py-8 text-slate-500">
                            <i className="fas fa-inbox text-2xl mb-2 opacity-30"></i>
                            <p className="text-xs">No table found</p>
                        </div>
                    )}

                    {filteredDataSources.map((ds) => {
                        const isChecked = selectedDataSourceIds.includes(ds.id);
                        const isActive = ds.id === activeDataSourceId;
                        const tableName = ds.tableName || ds.name;
                        const syncMeta = getSyncMeta(ds);

                        return (
                            <div
                                key={ds.id}
                                onClick={() => onActivateDataSource(ds.id)}
                                className={`group rounded-lg border p-2 cursor-pointer transition-all ${isActive
                                    ? 'bg-indigo-50 border-indigo-300 dark:bg-indigo-600/15 dark:border-indigo-500/40'
                                    : 'bg-white border-slate-200 hover:border-slate-300 dark:bg-slate-900/50 dark:border-white/5 dark:hover:border-white/15'
                                    }`}
                            >
                                <div className="flex items-start gap-2">
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={(e) => onToggleDataSource(ds.id, e.target.checked)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="mt-0.5 rounded border-slate-300 dark:border-white/20 bg-white dark:bg-slate-900 text-indigo-500 focus:ring-indigo-500"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className={`text-[11px] font-black truncate ${isActive ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-800 dark:text-slate-200'}`}>
                                            {tableName}
                                        </div>
                                        <div className="text-[9px] text-slate-500 truncate">
                                            {getSourceLabel(ds)}{ds.datasetName ? ` • ${ds.datasetName}` : ''}
                                        </div>
                                        <div className="mt-1 flex items-center justify-between gap-2">
                                            <span className="text-[9px] text-slate-500">{ds.schema.length} fields</span>
                                            <span className={`text-[9px] font-black uppercase tracking-tight flex items-center gap-1 ${syncMeta.className}`}>
                                                <i className={`fas ${syncMeta.icon} text-[8px]`}></i>
                                                {syncMeta.label}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        {ds.type === 'bigquery' && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onReloadDataSource?.(ds.id);
                                                }}
                                                className="w-6 h-6 rounded flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                                                title="Sync"
                                            >
                                                <i className={`fas fa-sync-alt text-[9px] ${ds.isLoadingPartial ? 'fa-spin text-blue-400' : ''}`}></i>
                                            </button>
                                        )}
                                        {ds.isLoadingPartial && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onStopDataSource?.(ds.id);
                                                }}
                                                className="w-6 h-6 rounded flex items-center justify-center text-red-400 hover:bg-red-500/10 transition-all"
                                                title="Stop"
                                            >
                                                <i className="fas fa-stop text-[9px]"></i>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-visible custom-scrollbar p-2 space-y-2">
                    <div className="flex items-center justify-between px-1">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-500">Drag Fields</h4>
                        <span className="text-[9px] text-slate-500 dark:text-slate-600">to chart slots</span>
                    </div>

                    {selectedSources.length === 0 && (
                        <div className="rounded-lg border border-dashed border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-slate-900/30 p-4 text-center text-slate-500">
                            <i className="fas fa-hand-pointer text-xl mb-2 opacity-40"></i>
                            <p className="text-[10px] font-bold uppercase tracking-widest">Select table(s) above first</p>
                        </div>
                    )}

                    {activeSelectedSource && (
                        <div className="space-y-2">
                            <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-2 space-y-2">
                                <div>
                                    <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">Selected table</div>
                                    <select
                                        value={activeSelectedSource.id}
                                        onChange={(e) => onActivateDataSource(e.target.value)}
                                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    >
                                        {selectedSources.map((ds) => (
                                            <option key={ds.id} value={ds.id}>
                                                {ds.tableName || ds.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="relative">
                                    <i className="fas fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-[10px]"></i>
                                    <input
                                        type="text"
                                        value={fieldSearchQuery}
                                        onChange={(e) => setFieldSearchQuery(e.target.value)}
                                        placeholder="Search fields..."
                                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg pl-7 pr-2.5 py-1.5 text-[10px] text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/50">
                                <div className="px-2.5 py-2 border-b border-slate-200 dark:border-white/5">
                                    <div className="text-[11px] font-black text-slate-800 dark:text-slate-200 truncate">{activeSelectedSource.tableName || activeSelectedSource.name}</div>
                                    <div className="text-[9px] text-slate-500">
                                        {filteredActiveFields.length}/{activeSelectedSource.schema.length} fields
                                    </div>
                                </div>

                                <div className="p-2 space-y-1.5">
                                    {filteredActiveFields.length === 0 && (
                                        <div className="text-center py-4 text-slate-500 text-[10px]">No fields match search</div>
                                    )}
                                    {filteredActiveFields.map((field) => (
                                        <DraggableField
                                            key={`${activeSelectedSource.id}:${field.name}`}
                                            field={field}
                                            dataSourceId={activeSelectedSource.id}
                                            dataSourceName={activeSelectedSource.tableName || activeSelectedSource.name}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default RightDataSidebar;
