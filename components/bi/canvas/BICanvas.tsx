// ============================================
// BI Canvas - Dashboard Workspace
// ============================================

import React, { useMemo, useState } from 'react';
import RGL from 'react-grid-layout';
const WidthProvider = (RGL as any).WidthProvider;
import { BIDashboard, BIWidget } from '../types';
import { useDashboardStore } from '../store/dashboardStore';
import { useFilterStore } from '../store/filterStore';
import BarChartWidget from '../widgets/BarChartWidget';
import LineChartWidget from '../widgets/LineChartWidget';
import PieChartWidget from '../widgets/PieChartWidget';
import CardWidget from '../widgets/CardWidget';
import TableWidget from '../widgets/TableWidget';
import ScatterChartWidget from '../widgets/ScatterChartWidget';
import ComboChartWidget from '../widgets/ComboChartWidget';
import GaugeWidget from '../widgets/GaugeWidget';
import SlicerWidget from '../widgets/SlicerWidget';
import DateRangeWidget from '../widgets/DateRangeWidget';
import SearchWidget from '../widgets/SearchWidget';
import PivotTableWidget from '../widgets/PivotTableWidget';
import { DrillDownService } from '../engine/DrillDownService';
import { Filter } from '../types';

const GridLayout = WidthProvider(RGL);

interface BICanvasProps {
    dashboard: BIDashboard;
    onUpdateDashboard?: (dashboard: BIDashboard) => void;
    onEditWidget?: (id: string) => void;
    onAddWidget?: (type: string) => void;
    onSelectDataSource?: (id: string) => void;
    onClearDataSource?: () => void;
    onReloadDataSource?: (id: string) => void;
    onStopDataSource?: (id: string) => void;
    dataSources?: any[];
    setActiveVisualTab?: (tab: 'visualizations' | 'data' | 'format' | 'filters') => void;
    readOnly?: boolean;
}

const BICanvas: React.FC<BICanvasProps> = ({
    dashboard,
    onUpdateDashboard,
    onEditWidget,
    onAddWidget,
    onSelectDataSource,
    onClearDataSource,
    onReloadDataSource,
    onStopDataSource,
    dataSources = [],
    setActiveVisualTab,
    readOnly = false
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const {
        updateWidget,
        deleteWidget,
        duplicateWidget,
        setEditingWidget,
        selectedWidgetIds,
        selectWidget,
        groupWidgets,
        ungroupWidgets,
        alignWidgets,
        clearSelection
    } = useDashboardStore();
    const { addCrossFilter, drillDowns } = useFilterStore();
    const [isDragging, setIsDragging] = React.useState(false);
    const [sortConfig, setSortConfig] = useState<{ field: 'name' | 'rowCount', direction: 'asc' | 'desc' }>({
        field: 'name',
        direction: 'asc'
    });


    // Convert widgets to layout format
    const canvasWidgets = useMemo(() => {
        const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
        const widgets = activePage ? activePage.widgets : (dashboard.widgets || []);
        return widgets.filter(w => !w.isGlobalFilter);
    }, [dashboard.widgets, dashboard.pages, dashboard.activePageId]);

    const layout = useMemo(() => {
        return canvasWidgets.map(w => ({
            i: w.id,
            x: w.x,
            y: w.y,
            w: w.w,
            h: w.h,
            minW: 2,
            minH: 2
        }));
    }, [canvasWidgets]);

    // Handle layout change
    const handleLayoutChange = (newLayout: any[]) => {
        if (readOnly) return;

        const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
        const currentWidgets = activePage ? activePage.widgets : (dashboard.widgets || []);

        const updatedWidgets = currentWidgets.map(widget => {
            const layoutItem = newLayout.find((l: any) => l.i === widget.id);
            if (layoutItem) {
                return {
                    ...widget,
                    x: layoutItem.x,
                    y: layoutItem.y,
                    w: layoutItem.w,
                    h: layoutItem.h
                };
            }
            return widget;
        });

        if (onUpdateDashboard) {
            if (dashboard.pages) {
                const updatedPages = dashboard.pages.map(p =>
                    p.id === dashboard.activePageId ? { ...p, widgets: updatedWidgets } : p
                );
                onUpdateDashboard({
                    ...dashboard,
                    pages: updatedPages,
                    widgets: updatedWidgets
                });
            } else {
                onUpdateDashboard({
                    ...dashboard,
                    widgets: updatedWidgets
                });
            }
        }
    };

    // Handle widget click for cross-filtering
    const handleWidgetDataClick = (widget: BIWidget, data: any) => {
        if (widget.enableCrossFilter === false || readOnly) return;

        // Get current field from drill-down if applicable
        const drillDownState = drillDowns[widget.id];
        const currentField = DrillDownService.getCurrentField(widget, drillDownState);

        if (!currentField) return;

        const filterValue = data[currentField] || data.name;
        if (!filterValue) return;

        const currentFilters = useFilterStore.getState().crossFilters;
        const existingFilter = currentFilters.find(cf => cf.sourceWidgetId === widget.id);

        // If clicking the same value again (at the same level), remove the filter
        if (existingFilter && existingFilter.filters.some(f => f.field === currentField && f.value === filterValue)) {
            useFilterStore.getState().removeCrossFilter(widget.id);
            return;
        }

        // Build composite filters (Parent context + Current click)
        const filters: Filter[] = [];

        // 1. Add breadcrumbs (parent levels)
        if (drillDownState && drillDownState.breadcrumbs) {
            drillDownState.breadcrumbs.forEach(bc => {
                filters.push({
                    id: `cf-${widget.id}-p-${bc.level}-${Date.now()}`,
                    field: drillDownState.hierarchy[bc.level],
                    operator: 'equals' as const,
                    value: bc.value,
                    enabled: true
                });
            });
        }

        // 2. Add current level
        filters.push({
            id: `cf-${widget.id}-c-${Date.now()}`,
            field: currentField,
            operator: 'equals' as const,
            value: filterValue,
            enabled: true
        });

        // Apply to all other widgets across all pages
        const allDashboardWidgets = dashboard.pages
            ? dashboard.pages.flatMap(p => p.widgets)
            : (dashboard.widgets || []);

        const affectedWidgetIds = allDashboardWidgets
            .filter(w => w.id !== widget.id && w.enableCrossFilter !== false)
            .map(w => w.id);

        addCrossFilter(widget.id, filters, affectedWidgetIds);
    };

    // Handle widget selection
    const handleWidgetSelect = (widgetId: string, e: React.MouseEvent) => {
        if (readOnly) return;

        // Stop bubbling to prevent canvas clearing selection
        e.stopPropagation();

        const isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
        selectWidget(widgetId, isMulti);

        if (onEditWidget && !isMulti) {
            onEditWidget(widgetId);
        }
    };

    // Handle widget actions
    const handleEdit = (widgetId: string) => {
        setEditingWidget(widgetId);
        if (onEditWidget) {
            onEditWidget(widgetId);
        }
    };

    const handleDelete = (widgetId: string) => {
        if (selectedWidgetIds.includes(widgetId) && selectedWidgetIds.length > 1) {
            if (window.confirm(`Delete all ${selectedWidgetIds.length} selected widgets?`)) {
                [...selectedWidgetIds].forEach(id => deleteWidget(dashboard.id, id));
                clearSelection();
            }
        } else {
            deleteWidget(dashboard.id, widgetId);
        }
    };

    const handleDuplicate = (widgetId: string) => {
        duplicateWidget(dashboard.id, widgetId);
    };

    // Render widget based on type
    const renderWidget = (widget: BIWidget) => {
        const commonProps = {
            widget,
            onEdit: !readOnly ? () => handleEdit(widget.id) : undefined,
            onDelete: !readOnly ? () => handleDelete(widget.id) : undefined,
            onDuplicate: !readOnly ? () => handleDuplicate(widget.id) : undefined,
            isSelected: selectedWidgetIds ? selectedWidgetIds.includes(widget.id) : false,
            onClick: !readOnly ? (e: React.MouseEvent) => handleWidgetSelect(widget.id, e) : undefined,
            onClickDataTab: () => setActiveVisualTab?.('data'),
            isDraggingOrResizing: isDragging
        };

        switch (widget.type) {
            case 'chart':
                switch (widget.chartType) {
                    case 'bar':
                    case 'horizontalBar':
                    case 'stackedBar':
                        return (
                            <BarChartWidget
                                {...commonProps}
                                onDataClick={(data) => handleWidgetDataClick(widget, data)}
                            />
                        );

                    case 'line':
                        return (
                            <LineChartWidget
                                {...commonProps}
                                onDataClick={(data) => handleWidgetDataClick(widget, data)}
                            />
                        );

                    case 'pie':
                    case 'donut':
                        return (
                            <PieChartWidget
                                {...commonProps}
                                onDataClick={(data) => handleWidgetDataClick(widget, data)}
                            />
                        );

                    case 'scatter':
                        return (
                            <ScatterChartWidget
                                {...commonProps}
                                onDataClick={(data) => handleWidgetDataClick(widget, data)}
                            />
                        );

                    case 'combo':
                        return (
                            <ComboChartWidget
                                {...commonProps}
                                onDataClick={(data) => handleWidgetDataClick(widget, data)}
                            />
                        );

                    default:
                        return <BarChartWidget {...commonProps} />;
                }

            case 'card':
                return <CardWidget {...commonProps} />;

            case 'table':
                return <TableWidget {...commonProps} />;

            case 'gauge':
                return <GaugeWidget {...commonProps} />;

            case 'slicer':
                return <SlicerWidget {...commonProps} />;

            case 'date-range':
                return <DateRangeWidget {...commonProps} />;

            case 'search':
                return <SearchWidget {...commonProps} />;

            case 'pivot':
                return <PivotTableWidget {...commonProps} />;

            default:
                return (
                    <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                        Unknown widget type: {widget.type}
                    </div>
                );
        }
    };

    if (dashboard.widgets.length === 0) {
        const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
        const currentDataSourceId = activePage?.dataSourceId || dashboard.dataSourceId;

        if (!currentDataSourceId && !readOnly) {
            return (
                <div className="flex items-center justify-center h-full p-8 opacity-100">
                    <div className="text-center max-w-4xl w-full">
                        <div className="mb-12">
                            <div className="w-20 h-20 bg-indigo-600/10 rounded-[2rem] flex items-center justify-center mx-auto mb-6 border border-indigo-500/20 shadow-2xl">
                                <i className="fas fa-database text-3xl text-indigo-400"></i>
                            </div>
                            <h2 className="text-4xl font-black text-white mb-3 uppercase tracking-tighter italic">Connect Your Data</h2>
                            <p className="text-slate-500 text-sm max-w-md mx-auto">
                                To begin building your dashboard, please select a data table from your workspace as the primary source for this analysis.
                            </p>
                        </div>

                        <div className="max-w-xl mx-auto mb-10 flex gap-4">
                            <div className="relative group flex-1">
                                <i className="fas fa-search absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors"></i>
                                <input
                                    type="text"
                                    placeholder="Search data tables by name or dataset..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-slate-900/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:bg-slate-900 placeholder:text-slate-600"
                                />
                            </div>
                            <div className="bg-slate-900/50 border border-white/10 rounded-2xl px-4 flex items-center gap-2">
                                <i className="fas fa-sort-amount-down text-slate-500 text-xs"></i>
                                <select
                                    value={`${sortConfig.field}-${sortConfig.direction}`}
                                    onChange={(e) => {
                                        const [field, direction] = e.target.value.split('-') as [any, any];
                                        setSortConfig({ field, direction });
                                    }}
                                    className="bg-transparent text-slate-400 text-xs font-black uppercase tracking-widest focus:ring-0 border-none outline-none cursor-pointer"
                                >
                                    <option value="name-asc" className="bg-slate-900">Name (A-Z)</option>
                                    <option value="name-desc" className="bg-slate-900">Name (Z-A)</option>
                                    <option value="rowCount-desc" className="bg-slate-900">Rows (High-Low)</option>
                                    <option value="rowCount-asc" className="bg-slate-900">Rows (Low-High)</option>
                                </select>
                            </div>
                        </div>

                        {dataSources.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                                {dataSources
                                    .filter(ds =>
                                        (ds.tableName || ds.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                                        (ds.datasetName || '').toLowerCase().includes(searchQuery.toLowerCase())
                                    )
                                    .sort((a, b) => {
                                        // Priority Scoring:
                                        // 0: Syncing/Loading (Active)
                                        // 1: Ready/Loaded (Done)
                                        // 2: Waiting/Not Started (Queued)
                                        const getPriority = (ds: any) => {
                                            if (ds.syncStatus === 'syncing' || ds.isLoadingPartial) return 0;
                                            if (ds.isLoaded) return 1;
                                            return 2;
                                        };

                                        const pA = getPriority(a);
                                        const pB = getPriority(b);

                                        if (pA !== pB) return pA - pB;

                                        // Same priority, use selected sort config
                                        if (sortConfig.field === 'name') {
                                            const nameA = (a.tableName || a.name || '').toLowerCase();
                                            const nameB = (b.tableName || b.name || '').toLowerCase();
                                            return sortConfig.direction === 'asc'
                                                ? nameA.localeCompare(nameB)
                                                : nameB.localeCompare(nameA);
                                        } else {
                                            const rowA = a.totalRows || a.data?.length || 0;
                                            const rowB = b.totalRows || b.data?.length || 0;
                                            return sortConfig.direction === 'asc' ? rowA - rowB : rowB - rowA;
                                        }
                                    })
                                    .map((ds) => (
                                        <div
                                            key={ds.id}
                                            onClick={() => onSelectDataSource?.(ds.id)}
                                            className="group p-6 bg-slate-900/40 border border-white/5 rounded-[2rem] hover:bg-indigo-600/10 hover:border-indigo-500/50 transition-all cursor-pointer shadow-xl active:scale-95 flex items-center gap-6"
                                        >
                                            <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all shrink-0 shadow-lg">
                                                <i className={`fas ${ds.type === 'bigquery' ? 'fa-database text-2xl' : ds.type === 'csv' ? 'fa-file-csv text-2xl' : 'fa-table text-2xl'}`}></i>
                                            </div>
                                            <div className="min-w-0 flex-1 relative">
                                                <h4 className="text-lg font-black text-slate-200 uppercase tracking-tighter group-hover:text-white leading-tight mb-1">
                                                    {ds.tableName || ds.name}
                                                </h4>
                                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                                                    <span className="text-[10px] text-indigo-400 uppercase font-black tracking-widest bg-indigo-500/10 px-2 py-0.5 rounded">
                                                        {ds.datasetName || 'Manual Sync'}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest flex items-center gap-1">
                                                        <i className="fas fa-list-ol opacity-50"></i>
                                                        {(ds.data?.length || 0).toLocaleString()} / {(ds.totalRows || ds.data?.length || 0).toLocaleString()} rows
                                                    </span>
                                                    {ds.syncStatus === 'syncing' ? (
                                                        <span className="text-[10px] text-blue-400 uppercase font-black tracking-widest flex items-center gap-1 animate-pulse">
                                                            <i className="fas fa-sync fa-spin opacity-50"></i>
                                                            Syncing...
                                                        </span>
                                                    ) : ds.lastRefresh && (
                                                        <span className="text-[10px] text-emerald-500 uppercase font-black tracking-widest flex items-center gap-1">
                                                            <i className="fas fa-history opacity-50"></i>
                                                            Last sync: {new Date(ds.lastRefresh).toLocaleTimeString()}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Progress Bar */}
                                                {!!(ds.isLoadingPartial || (ds.totalRows && ds.totalRows > (ds.data?.length || 0))) && (
                                                    <div className="w-full h-4 bg-slate-950/80 rounded-full overflow-hidden border border-white/10 p-[1px] relative mt-2 shadow-inner">
                                                        <div
                                                            className="h-full bg-gradient-to-r from-indigo-700 via-indigo-500 to-cyan-400 rounded-full relative group"
                                                            style={{ width: `${Math.min(100, Math.round(((ds.data?.length || 0) / (ds.totalRows || 1)) * 100))}%` }}
                                                        >
                                                            <div className="absolute inset-0 bg-white/10"></div>
                                                        </div>
                                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                            <span className="text-[8px] font-bold text-white uppercase tracking-widest drop-shadow-sm leading-none">
                                                                {ds.totalRows && ds.totalRows > 0
                                                                    ? `Syncing ${Math.min(100, Math.round(((ds.data?.length || 0) / (ds.totalRows || 1)) * 100))}%`
                                                                    : 'Preparing Download...'
                                                                }
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {ds.type === 'bigquery' && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onReloadDataSource?.(ds.id);
                                                        }}
                                                        disabled={ds.isLoadingPartial}
                                                        className="w-10 h-10 rounded-full border border-white/5 flex items-center justify-center text-slate-600 hover:text-emerald-400 hover:border-emerald-500/30 transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed group/reload"
                                                        title="Reload Data"
                                                    >
                                                        <i className={`fas fa-sync-alt ${ds.isLoadingPartial ? 'fa-spin text-emerald-400' : 'group-hover/reload:rotate-180 transition-transform duration-500'}`}></i>
                                                    </button>
                                                )}
                                                {ds.isLoadingPartial && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onStopDataSource?.(ds.id);
                                                        }}
                                                        className="w-10 h-10 rounded-full border border-red-500/30 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all active:scale-90 group/stop"
                                                        title="Stop Sync"
                                                    >
                                                        <i className="fas fa-stop"></i>
                                                    </button>
                                                )}
                                                <div className="w-10 h-10 rounded-full border border-white/5 flex items-center justify-center text-slate-600 group-hover:text-indigo-400 group-hover:border-indigo-500/30 transition-all">
                                                    <i className={`fas ${ds.isLoadingPartial ? 'fa-spinner fa-spin text-indigo-400' : 'fa-arrow-right'}`}></i>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        ) : (
                            <div className="py-12 bg-slate-900/50 rounded-[3rem] border border-white/5 border-dashed">
                                <i className="fas fa-inbox text-5xl text-slate-700 mb-6"></i>
                                <p className="text-slate-500 font-bold mb-4">No data sources available in this workspace</p>
                                <button
                                    onClick={() => setActiveVisualTab?.('data')}
                                    className="px-8 py-3 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500 transition-all"
                                >
                                    Go to Data Management
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <div
                        onClick={() => onAddWidget?.('bar')}
                        className="w-24 h-24 bg-indigo-600/10 border-2 border-dashed border-indigo-500/30 rounded-3xl flex items-center justify-center mb-6 mx-auto group hover:border-indigo-500 hover:bg-indigo-600/20 transition-all shadow-2xl shadow-indigo-500/5"
                    >
                        <i className="fas fa-plus text-3xl text-indigo-400 group-hover:scale-125 transition-transform"></i>
                    </div>
                    <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter italic">No widgets yet</h3>
                    <p className="text-slate-500 text-sm mb-8 max-w-sm mx-auto font-medium">
                        Click the button above or select a chart from the right panel to begin your strategic data analysis.
                    </p>
                    <button
                        onClick={() => onAddWidget?.('bar')}
                        className="px-10 py-4 bg-indigo-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/40 active:scale-95 flex items-center gap-4 mx-auto mb-4"
                    >
                        <i className="fas fa-chart-column text-lg"></i>
                        Add First Chart
                    </button>
                    <button
                        onClick={() => onClearDataSource?.()}
                        className="text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-indigo-400 transition-colors flex items-center gap-2 mx-auto"
                    >
                        <i className="fas fa-arrow-left"></i>
                        Back to Data Selection
                    </button>
                    <div className="mt-8 pt-8 border-t border-white/5 flex items-center justify-center gap-6 opacity-30">
                        <i className="fas fa-chart-line text-2xl"></i>
                        <i className="fas fa-chart-pie text-2xl"></i>
                        <i className="fas fa-chart-area text-2xl"></i>
                        <i className="fas fa-table text-2xl"></i>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full p-4" onClick={() => clearSelection()}>
            <style>{`
        .widget-container {
          overflow: visible !important;
        }
        
        /* React Grid Layout base styles */
        .react-grid-layout {
          position: relative;
        }
        
        .react-grid-item {
          transition-property: left, top, width, height;
        }
        
        .react-grid-item img {
          pointer-events: none;
          user-select: none;
        }
        
        .react-grid-item.cssTransforms {
          transition-property: transform, width, height;
        }
        
        .react-grid-item.resizing {
          transition: none;
          z-index: 1;
          will-change: width, height;
          opacity: 0.9;
          z-index: 100;
        }
        
        .react-grid-item.react-draggable-dragging {
          transition: none;
          z-index: 3;
          will-change: transform;
          opacity: 0.8;
          z-index: 100;
        }
        
        .react-grid-item.dropping {
          visibility: hidden;
        }
        
        .react-grid-item.react-grid-placeholder {
          background: rgba(99, 102, 241, 0.2);
          border: 2px dashed rgba(99, 102, 241, 0.5);
          border-radius: 8px;
          opacity: 0.2;
          transition-duration: 100ms;
          z-index: 2;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          -o-user-select: none;
          user-select: none;
        }
        
        .react-grid-item > .react-resizable-handle {
          position: absolute;
          width: 20px;
          height: 20px;
          background-image: none;
        }
        
        .react-grid-item > .react-resizable-handle::after {
          content: '';
          position: absolute;
          right: 3px;
          bottom: 3px;
          width: 8px;
          height: 8px;
          border-right: 2px solid rgba(148, 163, 184, 0.5);
          border-bottom: 2px solid rgba(148, 163, 184, 0.5);
        }
        
        .react-resizable-handle-sw {
          bottom: 0;
          left: 0;
          cursor: sw-resize;
          transform: rotate(90deg);
        }
        
        .react-resizable-handle-se {
          bottom: 0;
          right: 0;
          cursor: se-resize;
        }
        
        .react-resizable-handle-nw {
          top: 0;
          left: 0;
          cursor: nw-resize;
          transform: rotate(180deg);
        }
        
        .react-resizable-handle-ne {
          top: 0;
          right: 0;
          cursor: ne-resize;
          transform: rotate(270deg);
        }
        
        .react-resizable-handle-w,
        .react-resizable-handle-e {
          top: 50%;
          margin-top: -10px;
          cursor: ew-resize;
        }
        
        .react-resizable-handle-w {
          left: 0;
          transform: rotate(135deg);
        }
        
        .react-resizable-handle-e {
          right: 0;
          transform: rotate(315deg);
        }
        
        .react-resizable-handle-n,
        .react-resizable-handle-s {
          left: 50%;
          margin-left: -10px;
          cursor: ns-resize;
        }
        
        .react-resizable-handle-n {
          top: 0;
          transform: rotate(225deg);
        }
        
        .react-resizable-handle-s {
          bottom: 0;
          transform: rotate(45deg);
        }
      `}</style>

            <GridLayout
                className="layout"
                layout={layout}
                cols={12}
                rowHeight={60}
                width={1200}
                onLayoutChange={handleLayoutChange}
                onDragStart={() => setIsDragging(true)}
                onDragStop={() => setIsDragging(false)}
                onResizeStart={() => setIsDragging(true)}
                onResizeStop={() => setIsDragging(false)}
                isDraggable={!readOnly}
                isResizable={!readOnly}
                compactType="vertical"
                preventCollision={false}
                margin={[16, 16]}
                containerPadding={[0, 0]}
                draggableCancel=".no-drag"
                draggableHandle=".drag-handle"
            >
                {canvasWidgets.map(widget => {
                    const isSelected = selectedWidgetIds ? selectedWidgetIds.includes(widget.id) : false;
                    return (
                        <div
                            key={widget.id}
                            className="widget-container"
                            style={{ zIndex: isSelected ? 100 : 1 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {renderWidget(widget)}
                        </div>
                    );
                })}
            </GridLayout>

            {/* Multi-select Floating Toolbar */}
            {selectedWidgetIds.length > 1 && !readOnly && (
                <div
                    className="fixed bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-slate-900/95 backdrop-blur-xl px-4 py-2.5 rounded-2xl border border-indigo-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[60]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="text-[10px] font-black text-indigo-400 uppercase tracking-widest border-r border-white/10 pr-4 mr-2">
                        {selectedWidgetIds.length.toLocaleString()} Widgets
                    </div>

                    {/* Alignment Controls */}
                    <div className="flex items-center gap-1 border-r border-white/10 pr-3 mr-2">
                        <button
                            onClick={() => alignWidgets('top')}
                            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-indigo-400 transition-all"
                            title="Align Top"
                        >
                            <i className="fas fa-align-left rotate-90"></i>
                        </button>
                        <button
                            onClick={() => alignWidgets('bottom')}
                            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-indigo-400 transition-all"
                            title="Align Bottom"
                        >
                            <i className="fas fa-align-right rotate-90"></i>
                        </button>
                        <button
                            onClick={() => alignWidgets('left')}
                            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-indigo-400 transition-all"
                            title="Align Left"
                        >
                            <i className="fas fa-align-left"></i>
                        </button>
                        <button
                            onClick={() => alignWidgets('right')}
                            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-indigo-400 transition-all"
                            title="Align Right"
                        >
                            <i className="fas fa-align-right"></i>
                        </button>
                    </div>

                    {/* Bulk Actions */}
                    <div className="flex items-center gap-2 border-r border-white/10 pr-3 mr-2">
                        <button
                            onClick={groupWidgets}
                            className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-black uppercase tracking-wider text-white transition-all shadow-lg shadow-indigo-600/20"
                        >
                            <i className="fas fa-object-group"></i>
                            Group
                        </button>
                        <button
                            onClick={ungroupWidgets}
                            className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-black uppercase tracking-wider text-slate-300 transition-all border border-white/5"
                        >
                            <i className="fas fa-object-ungroup"></i>
                            Ungroup
                        </button>
                        <button
                            onClick={() => {
                                if (window.confirm(`Delete ${selectedWidgetIds.length} widgets?`)) {
                                    [...selectedWidgetIds].forEach(id => deleteWidget(dashboard.id, id));
                                    clearSelection();
                                }
                            }}
                            className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-red-600/20 hover:bg-red-600 text-xs font-black uppercase tracking-wider text-red-400 hover:text-white transition-all border border-red-500/30"
                        >
                            <i className="fas fa-trash-alt"></i>
                            Delete
                        </button>
                    </div>

                    {/* Close Selection */}
                    <button
                        onClick={() => clearSelection()}
                        className="ml-2 p-2 text-slate-500 hover:text-white transition-colors"
                        title="Clear Selection"
                    >
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            )}
        </div>
    );
};

export default BICanvas;
