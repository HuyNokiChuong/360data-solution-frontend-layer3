// ============================================
// Bar Chart Widget
// ============================================

import React, { useMemo } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { formatValue } from '../engine/calculations';
import { useAggregatedData } from '../hooks/useAggregatedData';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import CustomTooltip from './CustomTooltip';
import EmptyChartState from './EmptyChartState';
import { DrillDownService } from '../engine/DrillDownService';
import { DrillDownState } from '../types';
import { CHART_COLORS } from '../utils/chartColors';
import ChartLegend from './ChartLegend';

interface BarChartWidgetProps {
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

const BarChartWidget: React.FC<BarChartWidgetProps> = ({
    widget,
    onEdit,
    onDelete,
    onDuplicate,
    onDataClick,
    isSelected,
    onClickDataTab,
    isDraggingOrResizing = false,
    onClick
}) => {
    const isStackedType = widget.chartType === 'stackedBar' || widget.stacked === true;
    const { getDataSource } = useDataStore();
    const { crossFilters: allDashboardFilters, getFiltersForWidget, isWidgetFiltered, setDrillDown } = useFilterStore();
    const drillDowns = useFilterStore(state => state.drillDowns);
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));

    const drillDownState = drillDowns[widget.id];
    const xField = DrillDownService.getCurrentField(widget, drillDownState);

    const yField = widget.yAxis?.[0] || widget.measures?.[0] || '';

    // NEW: Centralized Aggregation Hook
    const { chartData, series, lineSeries, error } = useAggregatedData(widget);

    // Colors
    const colors = widget.colors || CHART_COLORS;

    // Handle bar click
    const handleBarClick = (data: any) => {
        // Only trigger cross-filter on click.
        // Drill-down is now exclusively handled by the toolbar buttons.
        if (onDataClick && widget.enableCrossFilter !== false) {
            onDataClick(data);
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

    const isFiltered = isWidgetFiltered(widget.id) || (drillDownState && drillDownState.currentLevel > 0);
    const isHorizontal = widget.chartType === 'horizontalBar';
    const hasHierarchy = widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0;

    // Get current cross-filter selection for THIS widget
    const currentSelection = useMemo(() => {
        const cf = allDashboardFilters.find(f => f.sourceWidgetId === widget.id);
        if (!cf) return undefined;
        // Find the filter that matches the CURRENTly displayed field
        return cf.filters.find(f => f.field === xField)?.value;
    }, [allDashboardFilters, widget.id, xField]);

    const dataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    const loadingProgress = useMemo(() => {
        if (!dataSource || !dataSource.totalRows || dataSource.totalRows === 0) return 0;
        return (dataSource.data?.length || 0) / dataSource.totalRows * 100;
    }, [dataSource]);

    if (chartData.length === 0) {
        const yField = widget.yAxis?.[0] || widget.measures?.[0];
        let errorMsg = 'No data available';
        if (!xField) errorMsg = 'Select X-Axis field';
        else if (!yField) errorMsg = 'Select Y-Axis field';

        return (
            <BaseWidget
                widget={widget}
                onEdit={onEdit}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                isSelected={isSelected}
                loading={dataSource?.isLoadingPartial}
                loadingProgress={loadingProgress}
                onClick={onClick}
            >
                <EmptyChartState type={widget.chartType || 'bar'} message={errorMsg} onClickDataTab={onClickDataTab} onClick={onClick} />
            </BaseWidget>
        );
    }

    return (
        <BaseWidget
            widget={widget}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isSelected={isSelected}
            isFiltered={!!isFiltered}
            loading={dataSource?.isLoadingPartial}
            loadingProgress={loadingProgress}
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
            <ResponsiveContainer width="100%" height="100%">
                {isHorizontal ? (
                    <ComposedChart
                        data={chartData}
                        layout="vertical"
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                        {widget.showGrid !== false && <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />}
                        <XAxis
                            type="number"
                            stroke="#94a3b8"
                            tickFormatter={(val) => formatValue(val, widget.valueFormat || 'standard')}
                            style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px' }}
                        />
                        <YAxis
                            yAxisId="left"
                            dataKey={xField}
                            type="category"
                            stroke="#94a3b8"
                            tickFormatter={(val) => {
                                if (typeof val === 'number') return formatValue(val, widget.valueFormat || 'standard');
                                return val;
                            }}
                            style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px' }}
                            width={120}
                        />
                        {((widget.yAxisConfigs?.some(c => c.yAxisId === 'right')) || (widget.lineAxisConfigs?.some(c => c.yAxisId === 'right'))) && (
                            <YAxis
                                yAxisId="right"
                                orientation="right"
                                stroke="#94a3b8"
                                tickFormatter={(val) => formatValue(val, widget.valueFormat || 'standard')}
                                style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px' }}
                                width={120}
                            />
                        )}
                        <Tooltip
                            content={<CustomTooltip
                                aggregation={!widget.yAxisConfigs?.length ? widget.aggregation : undefined}
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
                        {series.length > 0 ? (
                            series.map((s, idx) => {
                                const config = widget.yAxisConfigs?.[idx];
                                const yAxisId = config?.yAxisId || 'left';
                                return (
                                    <Bar
                                        key={s}
                                        dataKey={s}
                                        name={s}
                                        yAxisId={yAxisId}
                                        stackId={isStackedType ? "a" : undefined}
                                        fill={colors[idx % colors.length]}
                                        onClick={handleBarClick}
                                        cursor="pointer"
                                    >
                                        {chartData.map((entry: any, index: number) => {
                                            const isSelected = !currentSelection || entry[xField] === currentSelection;
                                            return (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={colors[idx % colors.length]}
                                                    fillOpacity={isSelected ? 1 : 0.3}
                                                />
                                            );
                                        })}
                                    </Bar>
                                );
                            })
                        ) : null}

                        {lineSeries.length > 0 && (
                            lineSeries.map((ls, idx) => {
                                const config = widget.lineAxisConfigs?.[idx];
                                const yAxisId = config?.yAxisId || 'right';
                                return (
                                    <Line
                                        key={ls}
                                        dataKey={ls}
                                        name={ls}
                                        yAxisId={yAxisId}
                                        stroke={colors[(series.length + idx) % colors.length]}
                                        strokeWidth={3}
                                        dot={{ r: 4, fill: colors[(series.length + idx) % colors.length] }}
                                        activeDot={{ r: 6 }}
                                        onClick={(e: any) => handleBarClick(e.payload)}
                                        cursor="pointer"
                                    />
                                );
                            })
                        )}

                        {!series.length && !lineSeries.length ? (
                            <Bar
                                dataKey={yField}
                                fill={colors[0]}
                                onClick={handleBarClick}
                                cursor="pointer"
                                radius={[0, 4, 4, 0]}
                                stackId={isStackedType ? "a" : undefined}
                            >
                                {chartData.map((entry: any, index: number) => {
                                    const isSelected = !currentSelection || entry[xField] === currentSelection;
                                    return (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={colors[index % colors.length]}
                                            fillOpacity={isSelected ? 1 : 0.3}
                                        />
                                    );
                                })}
                            </Bar>
                        ) : null}
                    </ComposedChart>
                ) : (
                    <ComposedChart
                        data={chartData}
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                        {widget.showGrid !== false && <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />}
                        <XAxis
                            dataKey={xField}
                            stroke="#94a3b8"
                            tickFormatter={(val) => {
                                if (typeof val === 'number') return formatValue(val, widget.valueFormat || 'standard');
                                return val;
                            }}
                            style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px' }}
                        />
                        <YAxis
                            yAxisId="left"
                            stroke="#94a3b8"
                            tickFormatter={(val) => formatValue(val, widget.valueFormat || 'standard')}
                            style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px' }}
                            width={120}
                        />
                        {((widget.yAxisConfigs?.some(c => c.yAxisId === 'right')) || (widget.lineAxisConfigs?.some(c => c.yAxisId === 'right'))) && (
                            <YAxis
                                yAxisId="right"
                                orientation="right"
                                stroke="#94a3b8"
                                tickFormatter={(val) => formatValue(val, widget.valueFormat || 'standard')}
                                style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px' }}
                                width={120}
                            />
                        )}
                        <Tooltip
                            content={<CustomTooltip
                                aggregation={!widget.yAxisConfigs?.length ? widget.aggregation : undefined}
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
                        {series.length > 0 ? (
                            series.map((s, idx) => {
                                const config = widget.yAxisConfigs?.[idx];
                                const yAxisId = config?.yAxisId || 'left';
                                return (
                                    <Bar
                                        key={s}
                                        dataKey={s}
                                        name={s}
                                        yAxisId={yAxisId}
                                        stackId={isStackedType ? "a" : undefined}
                                        fill={colors[idx % colors.length]}
                                        onClick={handleBarClick}
                                        cursor="pointer"
                                    >
                                        {chartData.map((entry: any, index: number) => {
                                            const isSelected = !currentSelection || entry[xField] === currentSelection;
                                            return (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={colors[idx % colors.length]}
                                                    fillOpacity={isSelected ? 1 : 0.3}
                                                />
                                            );
                                        })}
                                    </Bar>
                                );
                            })
                        ) : null}

                        {lineSeries.length > 0 && (
                            lineSeries.map((ls, idx) => {
                                const config = widget.lineAxisConfigs?.[idx];
                                const yAxisId = config?.yAxisId || 'right';
                                return (
                                    <Line
                                        key={ls}
                                        dataKey={ls}
                                        name={ls}
                                        type="monotone"
                                        yAxisId={yAxisId}
                                        stroke={colors[(series.length + idx) % colors.length]}
                                        strokeWidth={3}
                                        dot={(dotProps: any) => {
                                            const { cx, cy, payload } = dotProps;
                                            if (!cx || !cy) return null;
                                            const isItemSelected = !currentSelection || payload[xField] === currentSelection;
                                            return (
                                                <circle
                                                    cx={cx}
                                                    cy={cy}
                                                    r={isItemSelected ? 4 : 2}
                                                    fill={colors[(series.length + idx) % colors.length]}
                                                    fillOpacity={isItemSelected ? 1 : 0.3}
                                                    stroke="none"
                                                />
                                            );
                                        }}
                                        activeDot={{ r: 6 }}
                                        onClick={(e: any) => handleBarClick(e.payload)}
                                        cursor="pointer"
                                    />
                                );
                            })
                        )}

                        {!series.length && !lineSeries.length ? (
                            <Bar
                                dataKey={yField}
                                fill={colors[0]}
                                onClick={handleBarClick}
                                cursor="pointer"
                                radius={[4, 4, 0, 0]}
                                stackId={widget.stacked !== false ? "a" : undefined}
                            >
                                {chartData.map((entry: any, index: number) => {
                                    const isSelected = !currentSelection || entry[xField] === currentSelection;
                                    return (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={colors[index % colors.length]}
                                            fillOpacity={isSelected ? 1 : 0.3}
                                        />
                                    );
                                })}
                            </Bar>
                        ) : null}
                    </ComposedChart>
                )}
            </ResponsiveContainer>
        </BaseWidget>
    );
};

export default BarChartWidget;
