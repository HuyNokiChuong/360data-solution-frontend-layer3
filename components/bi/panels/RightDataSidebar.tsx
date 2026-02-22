import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { DataSource, Field } from '../types';
import { Connection } from '../../../types';
import { useLanguageStore } from '../../../store/languageStore';
import { isAssistantGeneratedDataSource } from '../utils/dataSourceVisibility';

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
    const { language } = useLanguageStore();
    const isVi = language === 'vi';
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
            title={isVi ? `Kéo ${field.name} vào widget` : `Drag ${field.name} to widget`}
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
    const { language } = useLanguageStore();
    const isVi = language === 'vi';
    const [searchQuery, setSearchQuery] = useState('');
    const [sourceFilter, setSourceFilter] = useState('');
    const [fieldSearchQuery, setFieldSearchQuery] = useState('');
    const [showSelectedOnly, setShowSelectedOnly] = useState(false);
    const [isBulkRefreshing, setIsBulkRefreshing] = useState(false);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [hasAutoFocusedFields, setHasAutoFocusedFields] = useState(false);
    const fieldsSectionRef = useRef<HTMLDivElement | null>(null);
    const ui = isVi
        ? {
            dataTables: 'Bảng dữ liệu',
            selectedForPage: 'bảng được chọn cho trang này',
            shown: 'hiển thị',
            queued: 'đang chờ',
            selected: 'Lọc bảng chọn',
            selectedOnly: 'Đang lọc bảng chọn',
            refreshing: 'Đang làm mới',
            refreshQueued: 'Làm mới chờ',
            refreshAll: 'Làm mới tất cả',
            refreshAllTitle: 'Làm mới tất cả bảng',
            refreshQueuedTitle: (count: number) => `Làm mới tất cả (${count} đang chờ)`,
            searchTables: 'Tìm bảng...',
            advancedFilters: 'Bộ lọc nâng cao',
            allSources: 'Tất cả nguồn',
            noTableFound: 'Không tìm thấy bảng',
            syncButton: 'Đồng bộ',
            stopButton: 'Dừng',
            nextStepHint: 'Tốt rồi. Bước tiếp theo: kéo trường bên dưới để dựng biểu đồ.',
            dragFields: 'Kéo trường',
            toChartSlots: 'vào ô biểu đồ',
            clickTableToContinue: 'Bấm một bảng phía trên để tiếp tục',
            selectedTable: 'Bảng đã chọn',
            searchFields: 'Tìm trường...',
            noFieldsMatch: 'Không có trường phù hợp',
            fieldsLabel: 'trường',
            syncError: 'Lỗi',
            syncing: 'Đang đồng bộ',
            syncQueued: 'Đang chờ',
            synced: 'Đã đồng bộ',
            initialized: 'Khởi tạo',
            imported: 'Đã nhập',
            semanticModel: 'Mô hình ngữ nghĩa'
        }
        : {
            dataTables: 'Data Tables',
            selectedForPage: 'table(s) selected for this page',
            shown: 'shown',
            queued: 'queued',
            selected: 'Filter Selected',
            selectedOnly: 'Selected Focus',
            refreshing: 'Refreshing',
            refreshQueued: 'Refresh queued',
            refreshAll: 'Refresh all',
            refreshAllTitle: 'Refresh all tables',
            refreshQueuedTitle: (count: number) => `Refresh all (${count} queued)`,
            searchTables: 'Search tables...',
            advancedFilters: 'Advanced filters',
            allSources: 'All sources',
            noTableFound: 'No table found',
            syncButton: 'Sync',
            stopButton: 'Stop',
            nextStepHint: 'Great. Next step: drag fields below to build your chart.',
            dragFields: 'Drag Fields',
            toChartSlots: 'to chart slots',
            clickTableToContinue: 'Click one table above to continue',
            selectedTable: 'Selected table',
            searchFields: 'Search fields...',
            noFieldsMatch: 'No fields match search',
            fieldsLabel: 'fields',
            syncError: 'Error',
            syncing: 'Syncing',
            syncQueued: 'Queued',
            synced: 'Synced',
            initialized: 'Initialized',
            imported: 'Imported',
            semanticModel: 'Semantic Model'
        };

    const selectableDataSources = useMemo(
        () => dataSources.filter((ds) => ds.type !== 'semantic_model' && !isAssistantGeneratedDataSource(ds)),
        [dataSources]
    );

    const getSourceKey = (ds: DataSource) => {
        if (ds.connectionId) return `conn:${ds.connectionId}`;
        if (['csv', 'json', 'manual', 'ai_generated', 'api'].includes(ds.type)) return `${ds.type}:local`;
        return `${ds.type}:default`;
    };

    const getSourceLabel = (ds: DataSource) => {
        if (ds.connectionId) {
            const connection = connections.find((item) => item.id === ds.connectionId);
            if (connection?.name) return connection.name;
        }
        switch (ds.type) {
            case 'bigquery': return 'BigQuery';
            case 'excel': return ui.imported;
            case 'semantic_model': return ui.semanticModel;
            case 'ai_generated': return 'AI Generated';
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
    }, [selectableDataSources, connections, language]);

    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filteredDataSources = useMemo(() => {
        const selectedSet = new Set(selectedDataSourceIds);
        return selectableDataSources.filter((ds) => {
            if (showSelectedOnly && !selectedSet.has(ds.id)) return false;
            if (sourceFilter && getSourceKey(ds) !== sourceFilter) return false;
            if (!normalizedQuery) return true;
            const haystack = `${getSourceLabel(ds)} ${ds.datasetName || ''} ${ds.tableName || ''} ${ds.name}`.toLowerCase();
            return haystack.includes(normalizedQuery);
        }).sort((a, b) => {
            const score = (ds: DataSource) =>
                (ds.id === activeDataSourceId ? 2 : 0) + (selectedSet.has(ds.id) ? 1 : 0);
            const scoreDiff = score(b) - score(a);
            if (scoreDiff !== 0) return scoreDiff;
            const aName = (a.tableName || a.name || '').toLowerCase();
            const bName = (b.tableName || b.name || '').toLowerCase();
            return aName.localeCompare(bName);
        });
    }, [selectableDataSources, selectedDataSourceIds, activeDataSourceId, showSelectedOnly, sourceFilter, normalizedQuery, connections, language]);

    const queuedRefreshableIds = useMemo(
        () => filteredDataSources
            .filter((ds) => ds.type === 'bigquery' && ds.syncStatus === 'queued' && !ds.isLoadingPartial)
            .map((ds) => ds.id),
        [filteredDataSources]
    );

    const refreshableSourceIds = useMemo(
        () => filteredDataSources
            .filter((ds) => ds.type === 'bigquery' && !ds.isLoadingPartial)
            .map((ds) => ds.id),
        [filteredDataSources]
    );

    const refreshTargetIds = queuedRefreshableIds.length > 0 ? queuedRefreshableIds : refreshableSourceIds;

    const queuedCount = useMemo(
        () => filteredDataSources.filter((ds) => ds.type === 'bigquery' && ds.syncStatus === 'queued').length,
        [filteredDataSources]
    );

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
            return { label: ui.syncError, className: 'text-red-400', icon: 'fa-exclamation-triangle' };
        }
        if (ds.syncStatus === 'syncing' || ds.isLoadingPartial) {
            const progress = ds.totalRows && ds.totalRows > 0
                ? Math.min(100, Math.round(((ds.data?.length || 0) / ds.totalRows) * 100))
                : null;
            return {
                label: progress !== null ? `${ui.syncing} ${progress}%` : ui.syncing,
                className: 'text-blue-400',
                icon: 'fa-spinner fa-spin'
            };
        }
        if (ds.syncStatus === 'queued') {
            return { label: ui.syncQueued, className: 'text-amber-400', icon: 'fa-clock' };
        }
        if (ds.syncStatus === 'ready' || ds.isLoaded) {
            return { label: ui.synced, className: 'text-emerald-400', icon: 'fa-circle-check' };
        }
        return { label: ui.initialized, className: 'text-slate-500', icon: 'fa-circle-notch' };
    };

    useEffect(() => {
        if (selectedSources.length === 0) {
            setHasAutoFocusedFields(false);
            return;
        }
        if (!hasAutoFocusedFields) {
            fieldsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setHasAutoFocusedFields(true);
        }
    }, [selectedSources.length, hasAutoFocusedFields]);

    const handleRefreshAll = async () => {
        if (!onReloadDataSource || isBulkRefreshing || refreshTargetIds.length === 0) return;
        setIsBulkRefreshing(true);
        try {
            // Run sequentially to avoid flooding BigQuery with parallel sync jobs.
            for (const dsId of refreshTargetIds) {
                await Promise.resolve(onReloadDataSource(dsId));
            }
        } finally {
            setIsBulkRefreshing(false);
        }
    };

    return (
        <div className="h-full flex flex-col bg-white dark:bg-slate-950">
            <div className="shrink-0 border-b border-slate-200 dark:border-white/10 p-3 space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{ui.dataTables}</h3>
                        <p className="text-[9px] text-slate-500 mt-1">
                            {selectedSources.length} {ui.selectedForPage}
                        </p>
                    </div>
                    <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 flex items-center justify-center">
                        <i className="fas fa-database text-[10px]"></i>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <p className="text-[9px] text-slate-500 dark:text-slate-400">
                        {filteredDataSources.length} {ui.shown}
                        {queuedCount > 0 ? ` • ${queuedCount} ${ui.queued}` : ''}
                    </p>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => setShowSelectedOnly((prev) => !prev)}
                            className={`px-2.5 py-1 rounded-md text-[10px] font-black border transition-all inline-flex items-center gap-1.5 ${
                                showSelectedOnly
                                    ? 'bg-gradient-to-r from-indigo-600/35 to-fuchsia-500/30 border-indigo-400/70 text-indigo-100 shadow-[0_0_0_1px_rgba(129,140,248,0.45),0_8px_20px_rgba(79,70,229,0.25)]'
                                    : 'bg-indigo-500/15 border-indigo-500/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/25 hover:border-indigo-400/60'
                            }`}
                        >
                            <i className={`fas ${showSelectedOnly ? 'fa-bullseye' : 'fa-filter'} text-[9px]`}></i>
                            {showSelectedOnly
                                ? ui.selectedOnly
                                : ui.selected}
                        </button>
                        <button
                            type="button"
                            onClick={handleRefreshAll}
                            disabled={!onReloadDataSource || refreshTargetIds.length === 0 || isBulkRefreshing}
                            className="px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider border transition-all bg-emerald-500/10 border-emerald-500/30 text-emerald-500 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-500/10 flex items-center gap-1.5"
                            title={queuedCount > 0 ? ui.refreshQueuedTitle(queuedCount) : ui.refreshAllTitle}
                        >
                            <i className={`fas fa-sync-alt text-[8px] ${isBulkRefreshing ? 'fa-spin' : ''}`}></i>
                            {isBulkRefreshing ? ui.refreshing : queuedCount > 0 ? ui.refreshQueued : ui.refreshAll}
                        </button>
                    </div>
                </div>

                <div className="relative">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-[10px]"></i>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={ui.searchTables}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg pl-8 pr-3 py-2 text-[11px] text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                </div>

                <div className="space-y-2">
                    <button
                        type="button"
                        onClick={() => setShowAdvancedFilters((prev) => !prev)}
                        className="text-[9px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors flex items-center gap-1.5"
                    >
                        <i className={`fas fa-chevron-right text-[8px] transition-transform ${showAdvancedFilters ? 'rotate-90' : ''}`}></i>
                        {ui.advancedFilters}
                    </button>
                    {showAdvancedFilters && (
                        <select
                            value={sourceFilter}
                            onChange={(e) => setSourceFilter(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        >
                            <option value="">{ui.allSources}</option>
                            {sourceOptions.map((source) => (
                                <option key={source.key} value={source.key}>{source.label}</option>
                            ))}
                        </select>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <div className={`${selectedSources.length > 0 ? 'shrink-0 max-h-[34vh] border-b border-slate-200 dark:border-white/5' : 'flex-1'} overflow-y-auto overflow-x-visible custom-scrollbar p-2 space-y-1.5`}>
                        {filteredDataSources.length === 0 && (
                            <div className="text-center py-8 text-slate-500">
                                <i className="fas fa-inbox text-2xl mb-2 opacity-30"></i>
                                <p className="text-xs">{ui.noTableFound}</p>
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
                                    onClick={() => {
                                        onActivateDataSource(ds.id);
                                        if (!isChecked) onToggleDataSource(ds.id, true);
                                    }}
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
                                                <span className="text-[9px] text-slate-500">{ds.schema.length} {ui.fieldsLabel}</span>
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
                                                title={ui.syncButton}
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
                                                title={ui.stopButton}
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

                <div ref={fieldsSectionRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-visible custom-scrollbar p-2 space-y-2">
                    {selectedSources.length > 0 && (
                        <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-2 text-[10px] text-indigo-200 flex items-start gap-2">
                            <i className="fas fa-arrow-down mt-0.5"></i>
                            <span>{ui.nextStepHint}</span>
                        </div>
                    )}

                    <div className="flex items-center justify-between px-1">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-500">{ui.dragFields}</h4>
                        <span className="text-[9px] text-slate-500 dark:text-slate-600">{ui.toChartSlots}</span>
                    </div>

                    {selectedSources.length === 0 && (
                        <div className="rounded-lg border border-dashed border-slate-300 dark:border-white/10 bg-slate-50 dark:bg-slate-900/30 p-4 text-center text-slate-500">
                            <i className="fas fa-hand-pointer text-xl mb-2 opacity-40"></i>
                            <p className="text-[10px] font-bold uppercase tracking-widest">{ui.clickTableToContinue}</p>
                        </div>
                    )}

                    {activeSelectedSource && (
                        <div className="space-y-2">
                            <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-2 space-y-2">
                                {selectedSources.length > 1 ? (
                                    <div>
                                        <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-1">{ui.selectedTable}</div>
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
                                ) : (
                                    <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-2">
                                        <div className="text-[9px] uppercase tracking-widest text-indigo-300/80">{ui.selectedTable}</div>
                                        <div className="text-[11px] font-black text-indigo-100 truncate mt-0.5">
                                            {activeSelectedSource.tableName || activeSelectedSource.name}
                                        </div>
                                    </div>
                                )}

                                <div className="relative">
                                    <i className="fas fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-[10px]"></i>
                                    <input
                                        type="text"
                                        value={fieldSearchQuery}
                                        onChange={(e) => setFieldSearchQuery(e.target.value)}
                                        placeholder={ui.searchFields}
                                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg pl-7 pr-2.5 py-1.5 text-[10px] text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/50">
                                <div className="px-2.5 py-2 border-b border-slate-200 dark:border-white/5">
                                    <div className="text-[11px] font-black text-slate-800 dark:text-slate-200 truncate">{activeSelectedSource.tableName || activeSelectedSource.name}</div>
                                    <div className="text-[9px] text-slate-500">
                                        {filteredActiveFields.length}/{activeSelectedSource.schema.length} {ui.fieldsLabel}
                                    </div>
                                </div>

                                <div className="p-2 space-y-1.5">
                                    {filteredActiveFields.length === 0 && (
                                        <div className="text-center py-4 text-slate-500 text-[10px]">{ui.noFieldsMatch}</div>
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
