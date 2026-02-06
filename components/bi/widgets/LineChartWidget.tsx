// ============================================
// Line Chart Widget
// ============================================

import React, { useMemo } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot, Label } from 'recharts';
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

interface LineChartWidgetProps {
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

const LineChartWidget: React.FC<LineChartWidgetProps> = ({
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
    const { getDataSource } = useDataStore(); // Kept if needed for metadata
    const { crossFilters: allDashboardFilters, getFiltersForWidget, isWidgetFiltered, setDrillDown } = useFilterStore();
    const drillDowns = useFilterStore(state => state.drillDowns);
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));

    const drillDownState = drillDowns[widget.id];
    const xField = DrillDownService.getCurrentField(widget, drillDownState);
    const yField = widget.yAxis?.[0] || widget.measures?.[0] || '';

    // NEW: Centralized Aggregation Hook
    const { chartData, series, lineSeries, error } = useAggregatedData(widget);

    const colors = widget.colors || CHART_COLORS;
    const isFiltered = isWidgetFiltered(widget.id) || (drillDownState && drillDownState.currentLevel > 0);

    // Handle dot click
    const handleDotClick = (data: any) => {
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

    const hasHierarchy = widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0;

    // Get current cross-filter selection for THIS widget
    const currentSelection = useMemo(() => {
        const cf = allDashboardFilters.find(f => f.sourceWidgetId === widget.id);
        if (!cf) return undefined;
        // Find the filter that matches the CURRENTly displayed field
        return cf.filters.find(f => f.field === xField)?.value;
    }, [allDashboardFilters, widget.id, xField]);

    const realDataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    const loadingProgress = useMemo(() => {
        if (!realDataSource || !realDataSource.totalRows || realDataSource.totalRows === 0) return 0;
        return (realDataSource.data?.length || 0) / realDataSource.totalRows * 100;
    }, [realDataSource]);

    if (!xField && !yField) {
        return (
            <BaseWidget
                widget={widget}
                onEdit={onEdit}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                isSelected={isSelected}
                loading={realDataSource?.isLoadingPartial}
                loadingProgress={loadingProgress}
                onClick={onClick}
            >
                <EmptyChartState type={widget.chartType || 'line'} message="Select X-Axis and Y-Axis fields" onClickDataTab={onClickDataTab} onClick={onClick} />
            </BaseWidget>
        );
    }

    if (!xField) {
        return (
            <BaseWidget
                widget={widget}
                onEdit={onEdit}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                isSelected={isSelected}
                loading={realDataSource?.isLoadingPartial}
                loadingProgress={loadingProgress}
                onClick={onClick}
            >
                <EmptyChartState type={widget.chartType || 'line'} message="Select X-Axis field" onClickDataTab={onClickDataTab} onClick={onClick} />
            </BaseWidget>
        );
    }

    if (!yField) {
        return (
            <BaseWidget
                widget={widget}
                onEdit={onEdit}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                isSelected={isSelected}
                loading={realDataSource?.isLoadingPartial}
                loadingProgress={loadingProgress}
                onClick={onClick}
            >
                <EmptyChartState type={widget.chartType || 'line'} message="Select Y-Axis field" onClickDataTab={onClickDataTab} onClick={onClick} />
            </BaseWidget>
        );
    }

    if (chartData.length === 0) {
        return (
            <BaseWidget
                widget={widget}
                onEdit={onEdit}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                isSelected={isSelected}
                loading={realDataSource?.isLoadingPartial}
                loadingProgress={loadingProgress}
                onClick={onClick}
            >
                <EmptyChartState type={widget.chartType || 'line'} message="No data available" onClickDataTab={onClickDataTab} onClick={onClick} />
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
            loading={realDataSource?.isLoadingPartial}
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
                <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
                            aggregation={widget.aggregation}
                            valueFormat={widget.valueFormat || 'standard'}
                        />}
                        cursor={{ stroke: '#ffffff20' }}
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
                            const color = colors[idx % colors.length];

                            return (
                                <Line
                                    key={s}
                                    type="monotone"
                                    dataKey={s}
                                    name={s}
                                    yAxisId={yAxisId}
                                    stroke={color}
                                    strokeWidth={3}
                                    connectNulls={true}
                                    dot={(dotProps: any) => {
                                        const { cx, cy, payload } = dotProps;
                                        if (!cx || !cy) return null;
                                        const isItemSelected = !currentSelection || payload[xField] === currentSelection;
                                        return (
                                            <circle
                                                cx={cx}
                                                cy={cy}
                                                r={isItemSelected ? 4 : 2}
                                                fill={color}
                                                fillOpacity={isItemSelected ? 1 : 0.3}
                                                stroke="none"
                                            />
                                        );
                                    }}
                                    activeDot={{ r: 6, strokeWidth: 0 }}
                                    onClick={(e: any) => handleDotClick(e.payload)}
                                />
                            );
                        })
                    ) : null}

                    {lineSeries.length > 0 && (
                        lineSeries.map((ls, idx) => {
                            const config = widget.lineAxisConfigs?.[idx];
                            const yAxisId = config?.yAxisId || 'right';
                            const color = colors[(series.length + idx) % colors.length];

                            return (
                                <Line
                                    key={ls}
                                    type="monotone"
                                    dataKey={ls}
                                    name={ls}
                                    yAxisId={yAxisId}
                                    stroke={color}
                                    strokeWidth={3}
                                    connectNulls={true}
                                    dot={(dotProps: any) => {
                                        const { cx, cy, payload } = dotProps;
                                        if (!cx || !cy) return null;
                                        const isItemSelected = !currentSelection || payload[xField] === currentSelection;
                                        return (
                                            <circle
                                                cx={cx}
                                                cy={cy}
                                                r={isItemSelected ? 4 : 2}
                                                fill={color}
                                                fillOpacity={isItemSelected ? 1 : 0.3}
                                                stroke="none"
                                            />
                                        );
                                    }}
                                    activeDot={{ r: 6, strokeWidth: 0 }}
                                    onClick={(e: any) => handleDotClick(e.payload)}
                                />
                            );
                        })
                    )}

                    {!series.length && !lineSeries.length && (
                        <Line
                            type="monotone"
                            dataKey={yField}
                            yAxisId="left"
                            stroke={colors[0]}
                            strokeWidth={3}
                            connectNulls={true}
                            dot={(dotProps: any) => {
                                const { cx, cy, payload } = dotProps;
                                if (!cx || !cy) return null;
                                const isItemSelected = !currentSelection || payload[xField] === currentSelection;
                                return (
                                    <circle
                                        cx={cx}
                                        cy={cy}
                                        r={isItemSelected ? 4 : 2}
                                        fill={colors[0]}
                                        fillOpacity={isItemSelected ? 1 : 0.3}
                                        stroke="none"
                                    />
                                );
                            }}
                            activeDot={{ r: 6, strokeWidth: 0 }}
                            onClick={(e: any) => handleDotClick(e?.payload)}
                        />
                    )}

                    {/* Render Highlights from Insight */}
                    {widget.insight?.highlight?.map((hl, i) => {
                        const dataPoint = chartData[hl.index];
                        if (!dataPoint) return null;

                        const xValue = dataPoint[xField];
                        const yValue = hl.value || dataPoint[series[0] || yField];

                        // Pick a color based on type
                        let hlColor = '#facc15'; // yellow (peak/insight)
                        if (hl.type === 'peak') hlColor = '#10b981'; // green
                        if (hl.type === 'drop') hlColor = '#ef4444'; // red
                        if (hl.type === 'anomaly') hlColor = '#f97316'; // orange

                        return (
                            <React.Fragment key={`hl-${i}`}>
                                <Line
                                    type="monotone"
                                    dataKey={() => yValue}
                                    stroke="none"
                                    dot={(props: any) => {
                                        const { cx, cy } = props;
                                        // We only want to render the dot at the specific index
                                        // However, ReferenceDot is cleaner for this.
                                        return null;
                                    }}
                                />
                                <ReferenceDot
                                    x={xValue}
                                    y={yValue}
                                    r={6}
                                    fill={hlColor}
                                    stroke="#fff"
                                    strokeWidth={2}
                                    yAxisId="left"
                                >
                                    <Label
                                        value={hl.label}
                                        position="top"
                                        fill="#fff"
                                        style={{ fontSize: '10px', fontWeight: 'bold', textShadow: '0 0 4px rgba(0,0,0,0.8)' }}
                                    />
                                </ReferenceDot>
                            </React.Fragment>
                        );
                    })}
                </ComposedChart>
            </ResponsiveContainer>
        </BaseWidget>
    );
};

export default LineChartWidget;
