// ============================================
// Pie Chart Widget
// ============================================

import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import { useAggregatedData } from '../hooks/useAggregatedData';
import { formatValue } from '../engine/calculations';
import BaseWidget from './BaseWidget';
import CustomTooltip from './CustomTooltip';
import EmptyChartState from './EmptyChartState';
import { DrillDownService } from '../engine/DrillDownService';
import { DrillDownState } from '../types';
import { CHART_COLORS, PIE_PALETTE } from '../utils/chartColors';
import ChartLegend from './ChartLegend';

interface PieChartWidgetProps {
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

const PieChartWidget: React.FC<PieChartWidgetProps> = ({
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
    const { getDataSource } = useDataStore(); // Kept if needed
    const { crossFilters: allDashboardFilters, getFiltersForWidget, isWidgetFiltered, setDrillDown } = useFilterStore();
    const drillDowns = useFilterStore(state => state.drillDowns);
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));

    const drillDownState = drillDowns[widget.id];
    const categoryField = DrillDownService.getCurrentField(widget, drillDownState);
    const valueField = widget.values?.[0] || widget.yAxis?.[0] || widget.measures?.[0] || '';

    // NEW: Centralized Aggregation Hook
    const { chartData: rawChartData, error } = useAggregatedData(widget);

    // Map to name/value for Recharts Pie
    const chartData = useMemo(() => {
        if (!rawChartData || !categoryField || !valueField) return [];
        return rawChartData.map(item => {
            const originalName = item[categoryField];
            const alias = widget.legendAliases?.[originalName];
            return {
                name: alias || originalName,
                value: item[valueField]
            };
        });
    }, [rawChartData, categoryField, valueField, widget.legendAliases]);

    const colors = widget.colors || PIE_PALETTE;

    const isFiltered = isWidgetFiltered(widget.id) || (drillDownState && drillDownState.currentLevel > 0);
    const isDonut = widget.chartType === 'donut';

    const handleClick = (data: any) => {
        // 1. Check for drill-down
        if (widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0) {
            const currentState = drillDownState || DrillDownService.initDrillDown(widget);
            if (currentState) {
                const result = DrillDownService.drillDown(currentState, data.name);
                if (result) {
                    setDrillDown(widget.id, result.newState);
                    return;
                }
            }
        }

        // 2. Fallback to cross-filter
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
        return cf.filters.find(f => f.field === categoryField)?.value;
    }, [allDashboardFilters, widget.id, categoryField]);

    const realDataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    const loadingProgress = useMemo(() => {
        if (!realDataSource || !realDataSource.totalRows || realDataSource.totalRows === 0) return 0;
        return (realDataSource.data?.length || 0) / realDataSource.totalRows * 100;
    }, [realDataSource]);

    if (chartData.length === 0) {
        let errorMsg = 'No data available';
        if (!categoryField) errorMsg = 'Select Category field';
        else if (!valueField) errorMsg = 'Select Value field';

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
                <EmptyChartState type={widget.chartType || 'pie'} message={errorMsg} onClickDataTab={onClickDataTab} onClick={onClick} />
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
                <PieChart>
                    <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        labelLine={widget.showLabels !== false}
                        label={widget.showLabels !== false ? (entry) => `${entry.name}: ${formatValue(entry.value, widget.valueFormat || 'standard')}` : undefined}
                        outerRadius="70%"
                        innerRadius={isDonut ? "40%" : "0%"}
                        fill="#8884d8"
                        dataKey="value"
                        onClick={handleClick}
                        cursor="pointer"
                    >
                        {chartData.map((entry, index) => {
                            const isSelectedValue = !currentSelection || entry.name === currentSelection;
                            return (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={colors[index % colors.length]}
                                    fillOpacity={isSelectedValue ? 1 : 0.3}
                                />
                            );
                        })}
                    </Pie>
                    <Tooltip
                        content={<CustomTooltip
                            aggregation={widget.aggregation}
                            valueFormat={widget.valueFormat || 'standard'}
                        />}
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
                </PieChart>
            </ResponsiveContainer>
        </BaseWidget>
    );
};

export default PieChartWidget;
