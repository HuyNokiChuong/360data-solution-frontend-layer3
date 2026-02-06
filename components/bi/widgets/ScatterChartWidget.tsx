
import React, { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ZAxis } from 'recharts';
import { BIWidget, DrillDownState } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import { useAggregatedData } from '../hooks/useAggregatedData';
import { formatValue } from '../engine/calculations';
import BaseWidget from './BaseWidget';
import CustomTooltip from './CustomTooltip';
import { DrillDownService } from '../engine/DrillDownService';
import EmptyChartState from './EmptyChartState';
import { CHART_COLORS } from '../utils/chartColors';
import ChartLegend from './ChartLegend';

interface ScatterChartWidgetProps {
    widget: BIWidget;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    onDataClick?: (data: any) => void;
    isSelected?: boolean;
    onClickDataTab?: () => void;
    isDraggingOrResizing?: boolean;
    onClick?: (e: React.MouseEvent) => void;
}

const ScatterChartWidget: React.FC<ScatterChartWidgetProps> = ({
    widget,
    onEdit,
    onDelete,
    onDuplicate,
    onDataClick,
    isSelected = false,
    onClickDataTab,
    isDraggingOrResizing = false,
    onClick
}) => {
    const { getDataSource } = useDataStore(); // Kept for metadata
    const { crossFilters: allDashboardFilters, getCrossFiltersForWidget, isWidgetFiltered, setDrillDown } = useFilterStore();
    const drillDowns = useFilterStore(state => state.drillDowns);
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));

    const drillDownState = drillDowns[widget.id];
    const xField = DrillDownService.getCurrentField(widget, drillDownState);

    // NEW: Centralized Aggregation Hook
    const { chartData, error } = useAggregatedData(widget);

    const realDataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    const loadingProgress = useMemo(() => {
        if (!realDataSource || !realDataSource.totalRows || realDataSource.totalRows === 0) return 0;
        return (realDataSource.data?.length || 0) / realDataSource.totalRows * 100;
    }, [realDataSource]);

    const isFiltered = isWidgetFiltered(widget.id) || (drillDownState && drillDownState.currentLevel > 0);

    const handleDrillUp = () => {
        if (drillDownState) {
            const newState = DrillDownService.drillUp(drillDownState);
            setDrillDown(widget.id, newState);
        }
    };

    const handleNextLevel = () => {
        const currentState = drillDownState || DrillDownService.initDrillDown(widget);
        if (currentState) {
            const newState = DrillDownService.goToNextLevel(currentState);
            if (newState) {
                setDrillDown(widget.id, newState);
            }
        }
    };

    const handleClick = (data: any) => {
        const payload = data?.activePayload?.[0]?.payload;
        if (!payload) return;

        // 1. Check for drill-down
        if (widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0) {
            const currentState = drillDownState || DrillDownService.initDrillDown(widget);
            if (currentState) {
                const clickedValue = payload[xField];
                const result = DrillDownService.drillDown(currentState, clickedValue);
                if (result) {
                    setDrillDown(widget.id, result.newState);
                    return;
                }
            }
        }

        // 2. Fallback to cross-filter
        if (onDataClick && data && data.activePayload) {
            onDataClick(data.activePayload[0].payload);
        }
    };

    // Detect if X-axis is numeric or categorical
    const xFieldType = useMemo(() => {
        if (!realDataSource || !xField) return 'number';
        const field = realDataSource.schema?.find(f => f.name === xField);
        return field?.type === 'number' ? 'number' : 'category';
    }, [realDataSource, xField]);

    const hasHierarchy = widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0;

    return (
        <BaseWidget
            widget={widget}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isSelected={isSelected}
            isFiltered={isFiltered}
            loading={realDataSource?.isLoadingPartial}
            loadingProgress={loadingProgress}
            error={error}
            onClick={onClick}
        >
            <div className="absolute top-0 right-0 z-10 flex items-center gap-1 p-1">
                {hasHierarchy && (
                    <>
                        <button
                            onClick={handleDrillUp}
                            disabled={!drillDownState || drillDownState.currentLevel === 0}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors ${drillDownState && drillDownState.currentLevel > 0
                                ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/30'
                                : 'bg-slate-800/50 text-slate-500 border-white/5 cursor-not-allowed'
                                }`}
                            title="Drill Up"
                        >
                            <i className="fas fa-arrow-up text-[8px]"></i>
                        </button>
                        <button
                            onClick={handleNextLevel}
                            disabled={drillDownState && drillDownState.currentLevel >= (widget.drillDownHierarchy?.length || 0) - 1}
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors ${!(drillDownState && drillDownState.currentLevel >= (widget.drillDownHierarchy?.length || 0) - 1)
                                ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/30'
                                : 'bg-slate-800/50 text-slate-500 border-white/5 cursor-not-allowed'
                                }`}
                            title="Go to Next Level"
                        >
                            <i className="fas fa-chevron-down text-[8px]"></i>
                        </button>
                        {drillDownState && drillDownState.breadcrumbs.length > 0 && (
                            <div className="ml-1 px-1.5 py-0.5 rounded bg-slate-800/80 text-indigo-300 text-[9px] border border-white/5 max-w-[150px] truncate">
                                {drillDownState.breadcrumbs.map(bc => bc.value).join(' > ')}
                            </div>
                        )}
                    </>
                )}
            </div>
            {chartData.length === 0 && !error ? (
                <EmptyChartState type="scatter" message="Select X and Y axes" onClickDataTab={onClickDataTab} onClick={onClick} />
            ) : (
                <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart
                        margin={{ top: 5, right: 5, bottom: 5, left: 0 }}
                        onClick={handleClick}
                    >
                        {widget.showGrid !== false && (
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                        )}

                        <XAxis
                            type={xFieldType}
                            dataKey={xField}
                            name={xField}
                            stroke="#94a3b8"
                            tickFormatter={(val) => {
                                if (xFieldType === 'number') return formatValue(val, widget.valueFormat || 'standard');
                                return val;
                            }}
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            tickLine={{ stroke: '#475569' }}
                        />

                        <YAxis
                            type="number"
                            dataKey={widget.yAxis?.[0]}
                            name={widget.yAxis?.[0]}
                            stroke="#94a3b8"
                            tickFormatter={(val) => formatValue(val, widget.valueFormat || 'standard')}
                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                            tickLine={{ stroke: '#475569' }}
                            width={120}
                        />

                        {/* Optional Z-axis for bubble chart effect */}
                        {widget.yAxis?.[1] && (
                            <ZAxis
                                type="number"
                                dataKey={widget.yAxis[1]}
                                range={[50, 400]}
                                name={widget.yAxis[1]}
                            />
                        )}

                        <Tooltip
                            content={<CustomTooltip
                                aggregation={widget.aggregation}
                                valueFormat={widget.valueFormat || 'standard'}
                            />}
                            cursor={{ strokeDasharray: '3 3' }}
                        />

                        {widget.showLegend !== false && (
                            <Legend
                                layout={(widget.legendPosition === 'left' || widget.legendPosition === 'right') ? 'vertical' : 'horizontal'}
                                align={widget.legendPosition === 'left' ? 'left' : (widget.legendPosition === 'right' ? 'right' : 'center')}
                                verticalAlign={(widget.legendPosition === 'top') ? 'top' : (widget.legendPosition === 'bottom' || !widget.legendPosition ? 'bottom' : 'middle')}
                                content={<ChartLegend
                                    widget={widget}
                                    layout={(widget.legendPosition === 'left' || widget.legendPosition === 'right') ? 'vertical' : 'horizontal'}
                                    align={widget.legendPosition === 'left' ? 'left' : (widget.legendPosition === 'right' ? 'right' : 'center')}
                                    fontSize={widget.fontSize ? `${Math.max(7, widget.fontSize - 3)}px` : '9px'}
                                />}
                            />
                        )}

                        <Scatter
                            name={widget.yAxis?.[0] || 'Value'}
                            data={chartData}
                            fill={widget.colors?.[0] || CHART_COLORS[0]}
                            opacity={0.8}
                        />
                    </ScatterChart>
                </ResponsiveContainer>
            )}
        </BaseWidget>
    );
};

export default ScatterChartWidget;
