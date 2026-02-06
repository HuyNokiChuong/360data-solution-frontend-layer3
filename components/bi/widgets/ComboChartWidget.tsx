import React, { useMemo } from 'react';
import { formatValue } from '../engine/calculations';
import { useAggregatedData } from '../hooks/useAggregatedData';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { BIWidget, DrillDownState } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import CustomTooltip from './CustomTooltip';
import { DrillDownService } from '../engine/DrillDownService';
import EmptyChartState from './EmptyChartState';
import { CHART_COLORS } from '../utils/chartColors';
import ChartLegend from './ChartLegend';

interface ComboChartWidgetProps {
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

const ComboChartWidget: React.FC<ComboChartWidgetProps> = ({
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

    const realDataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    const loadingProgress = useMemo(() => {
        if (!realDataSource || !realDataSource.totalRows || realDataSource.totalRows === 0) return 0;
        return (realDataSource.data?.length || 0) / realDataSource.totalRows * 100;
    }, [realDataSource]);

    const isFiltered = isWidgetFiltered(widget.id) || (drillDownState && drillDownState.currentLevel > 0);

    // NEW: Centralized Aggregation Hook
    const { chartData, series, lineSeries, error } = useAggregatedData(widget);

    const handleClick = (data: any) => {
        const clickedValue = data?.activeLabel || data?.activePayload?.[0]?.payload?.[xField];

        // 1. Check for drill-down
        if (widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0 && clickedValue) {
            const currentState = drillDownState || DrillDownService.initDrillDown(widget);
            if (currentState) {
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

    const hasHierarchy = widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0;

    // Get current cross-filter selection for THIS widget
    const currentSelection = useMemo(() => {
        const cf = allDashboardFilters.find(f => f.sourceWidgetId === widget.id);
        if (!cf) return undefined;
        // Find the filter that matches the CURRENTly displayed field
        return cf.filters.find(f => f.field === xField)?.value;
    }, [allDashboardFilters, widget.id, xField]);

    const COLORS = widget.colors || CHART_COLORS;

    return (
        <BaseWidget
            widget={widget}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isSelected={isSelected}
            isFiltered={isFiltered || (drillDownState && drillDownState.currentLevel > 0)}
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
                <EmptyChartState type="combo" message="Configure chart axes" onClickDataTab={onClickDataTab} onClick={onClick} />
            ) : (
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        data={chartData}
                        margin={{ top: 5, right: 30, bottom: 5, left: 0 }}
                        onClick={handleClick}
                    >
                        {widget.showGrid !== false && (
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                        )}

                        <XAxis
                            dataKey={xField}
                            stroke="#94a3b8"
                            tick={{ fill: '#94a3b8', fontSize: widget.fontSize ? Math.max(8, widget.fontSize - 2) : 11 }}
                            tickLine={{ stroke: '#475569' }}
                        />

                        <YAxis
                            yAxisId="left"
                            stroke="#94a3b8"
                            tickFormatter={(val) => formatValue(val, widget.valueFormat || 'standard')}
                            tick={{ fill: '#94a3b8', fontSize: widget.fontSize ? Math.max(8, widget.fontSize - 2) : 11 }}
                            tickLine={{ stroke: '#475569' }}
                            width={120}
                        />

                        {lineSeries.length > 0 && (
                            <YAxis
                                yAxisId="right"
                                orientation="right"
                                stroke="#94a3b8"
                                tickFormatter={(val) => formatValue(val, widget.valueFormat || 'standard')}
                                tick={{ fill: '#94a3b8', fontSize: widget.fontSize ? Math.max(8, widget.fontSize - 2) : 11 }}
                                tickLine={{ stroke: '#475569' }}
                                width={120}
                            />
                        )}

                        <Tooltip
                            content={<CustomTooltip
                                aggregation={widget.aggregation}
                                valueFormat={widget.valueFormat || 'standard'}
                            />}
                            cursor={{ fill: '#ffffff05' }}
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

                        {/* Bar Series */}
                        {series.map((field, index) => {
                            const config = widget.yAxisConfigs?.[index];
                            const yAxisId = config?.yAxisId || 'left';
                            return (
                                <Bar
                                    key={field}
                                    dataKey={field}
                                    yAxisId={yAxisId}
                                    fill={COLORS[index % COLORS.length]}
                                    radius={[4, 4, 0, 0]}
                                    opacity={0.9}
                                >
                                    {chartData.map((entry: any, idx: number) => {
                                        const isSelected = !currentSelection || entry[xField] === currentSelection;
                                        return (
                                            <Cell
                                                key={`cell-${idx}`}
                                                fill={COLORS[index % COLORS.length]}
                                                fillOpacity={isSelected ? 1 : 0.3}
                                            />
                                        );
                                    })}
                                </Bar>
                            );
                        })}

                        {/* Line Series */}
                        {lineSeries.map((field, index) => {
                            const config = widget.lineAxisConfigs?.[index];
                            const yAxisId = config?.yAxisId || 'right';
                            return (
                                <Line
                                    key={field}
                                    type="monotone"
                                    dataKey={field}
                                    yAxisId={yAxisId}
                                    stroke={COLORS[(series.length + index) % COLORS.length]}
                                    strokeWidth={2}
                                    dot={(dotProps: any) => {
                                        const { cx, cy, payload } = dotProps;
                                        if (!cx || !cy) return null;
                                        const isItemSelected = !currentSelection || payload[xField] === currentSelection;
                                        return (
                                            <circle
                                                cx={cx}
                                                cy={cy}
                                                r={isItemSelected ? 4 : 2}
                                                fill={COLORS[(series.length + index) % COLORS.length]}
                                                fillOpacity={isItemSelected ? 1 : 0.3}
                                                stroke="none"
                                            />
                                        );
                                    }}
                                    activeDot={{ r: 6 }}
                                />
                            );
                        })}
                    </ComposedChart>
                </ResponsiveContainer>
            )}
        </BaseWidget>
    );
};

export default ComboChartWidget;
