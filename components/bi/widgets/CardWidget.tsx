// ============================================
// Card Widget (KPI Display)
// ============================================

import React, { useMemo } from 'react';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { applyFilters } from '../engine/dataProcessing';
import { aggregate } from '../engine/calculations';
import { formatValue } from '../engine/calculations';
import { useWidgetData } from '../hooks/useWidgetData';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import EmptyChartState from './EmptyChartState';
import { CHART_COLORS } from '../utils/chartColors';

interface CardWidgetProps {
    widget: BIWidget;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    isSelected?: boolean;
    onClickDataTab?: () => void;
    isDraggingOrResizing?: boolean;
    onClick?: (e: React.MouseEvent) => void;
}

const CardWidget: React.FC<CardWidgetProps> = ({
    widget,
    onEdit,
    onDelete,
    onDuplicate,
    isSelected,
    onClickDataTab,
    isDraggingOrResizing = false,
    onClick
}) => {
    const { getDataSource } = useDataStore(); // Kept if needed
    const { crossFilters: allDashboardFilters, getFiltersForWidget, isWidgetFiltered } = useFilterStore();
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));
    const widgetData = useWidgetData(widget);

    const dataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    // Optimized memo dependencies - only re-calculate if data-relevant fields change
    const dataRelevantProps = JSON.stringify({
        metric: widget.metric,
        yAxis: widget.yAxis,
        values: widget.values,
        measures: widget.measures,
        filters: widget.filters,
        enableCrossFilter: widget.enableCrossFilter,
        comparisonValue: widget.comparisonValue
    });

    const { value, comparisonValue, trend } = useMemo(() => {
        if (!widgetData || widgetData.length === 0) return { value: 0, comparisonValue: null, trend: 'neutral' };

        let data = widgetData;

        if (widget.filters && widget.filters.length > 0) {
            data = applyFilters(data, widget.filters);
        }

        if (widget.enableCrossFilter !== false) {
            const crossFilters = getFiltersForWidget(widget.id);
            if (crossFilters.length > 0) {
                data = applyFilters(data, crossFilters);
            }
        }

        // Apply global filters
        if (activeDashboard?.globalFilters?.length) {
            const relevantFilters = activeDashboard.globalFilters.filter(gf =>
                !gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)
            );
            if (relevantFilters.length > 0) {
                data = applyFilters(data, relevantFilters as any[]);
            }
        }

        const aggregation = widget.aggregation || 'sum';
        const metricField = widget.yAxis?.[0] || widget.metric || widget.values?.[0] || widget.measures?.[0];
        if (!metricField) return { value: 0, comparisonValue: null, trend: 'neutral' };

        const mainValue = aggregate(data, metricField, aggregation);

        // Calculate comparison if specified
        let comparisonDisp = null;
        let finalTrend: 'up' | 'down' | 'neutral' = widget.trend || 'neutral';

        if (widget.comparisonValue) {
            const compNum = parseFloat(widget.comparisonValue);
            let compValue: number;

            if (!isNaN(compNum)) {
                compValue = compNum;
            } else {
                compValue = aggregate(data, widget.comparisonValue, aggregation);
            }

            if (compValue !== 0) {
                const diff = mainValue - compValue;
                const pct = (diff / compValue) * 100;
                comparisonDisp = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
                finalTrend = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral';
            }
        }

        return { value: mainValue, comparisonValue: comparisonDisp, trend: finalTrend };
    }, [widgetData, dataRelevantProps, allDashboardFilters, activeDashboard?.globalFilters]);

    const isFiltered = isWidgetFiltered(widget.id);

    // Determine colors/icons based on trend
    const trendIcon = trend === 'up' ? 'fa-arrow-up' : trend === 'down' ? 'fa-arrow-down' : 'fa-minus';
    const trendColor = trend === 'up' ? CHART_COLORS[4] : trend === 'down' ? CHART_COLORS[2] : '#94a3b8';

    const loadingProgress = useMemo(() => {
        if (!dataSource || !dataSource.totalRows || dataSource.totalRows === 0) return 0;
        return (dataSource.data?.length || 0) / dataSource.totalRows * 100;
    }, [dataSource]);

    if (!dataSource) {
        return (
            <BaseWidget
                widget={widget}
                onEdit={onEdit}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                isSelected={isSelected}
                onClick={onClick}
            >
                <EmptyChartState type="card" message="Select data source" onClickDataTab={onClickDataTab} onClick={onClick} />
            </BaseWidget>
        );
    }

    if (!widget.metric && !widget.yAxis?.[0] && !widget.measures?.[0]) {
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
                <EmptyChartState type="card" message="Select a metric" onClickDataTab={onClickDataTab} onClick={onClick} />
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
            isFiltered={isFiltered}
            loading={dataSource?.isLoadingPartial}
            loadingProgress={loadingProgress}
            onClick={onClick}
        >
            <div className="flex flex-col justify-center h-full">
                <div className="text-center">
                    {/* Main Value */}
                    <div
                        className="text-4xl font-black text-white mb-2"
                        style={{ fontSize: widget.fontSize ? `${widget.fontSize}px` : undefined }}
                    >
                        {formatValue(value, widget.valueFormat || 'standard')}
                    </div>

                    {/* Trend Indicator */}
                    {comparisonValue && (
                        <div className="flex items-center justify-center gap-2 text-sm" style={{ color: trendColor }}>
                            <i className={`fas ${trendIcon}`}></i>
                            <span>{comparisonValue}</span>
                        </div>
                    )}

                    {/* Subtitle */}
                    <div className="text-xs text-slate-400 mt-2">
                        {widget.metric || 'Total'}
                    </div>
                </div>
            </div>
        </BaseWidget>
    );
};

export default CardWidget;
