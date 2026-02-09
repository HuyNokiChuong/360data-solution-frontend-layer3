// ============================================
// Card Widget (KPI Display)
// ============================================

import React, { useMemo } from 'react';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { applyFilters } from '../engine/dataProcessing';
import { aggregate, formatValue } from '../engine/calculations';
import { formatBIValue } from '../engine/utils';
import { useDirectQuery } from '../hooks/useDirectQuery';
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

    // Switch to useDirectQuery
    const { data: directData, isLoading, error: directError } = useDirectQuery(widget);
    const widgetData = directData;

    const dataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    const { value, comparisonValue, trend } = useMemo(() => {
        if (!widgetData || widgetData.length === 0) return { value: 0, comparisonValue: null, trend: 'neutral' };

        const agg = widget.aggregation || 'sum';
        const metricField = widget.yAxis?.[0] || widget.metric || widget.values?.[0] || widget.measures?.[0];
        if (!metricField) return { value: 0, comparisonValue: null, trend: 'neutral' };

        let data = widgetData;

        // If BIGQUERY, widgetData is already aggregated!
        if (dataSource?.type === 'bigquery') {
            const row = widgetData[0];
            const mainValue = row ? row[metricField] : 0;

            let comparisonDisp = null;
            let finalTrend: 'up' | 'down' | 'neutral' = widget.trend || 'neutral';

            if (widget.comparisonValue && row) {
                const compValue = row[widget.comparisonValue];
                if (typeof mainValue === 'number' && typeof compValue === 'number' && compValue !== 0) {
                    const diff = mainValue - compValue;
                    const pct = (diff / compValue) * 100;
                    comparisonDisp = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
                    finalTrend = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral';
                }
            }
            return { value: mainValue, comparisonValue: comparisonDisp, trend: finalTrend };
        }

        // Local processing for non-BigQuery
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

        const mainValue = aggregate(data, metricField, agg);

        // Calculate comparison if specified
        let comparisonDisp = null;
        let finalTrend: 'up' | 'down' | 'neutral' = widget.trend || 'neutral';

        if (widget.comparisonValue) {
            const compNum = parseFloat(widget.comparisonValue);
            let compValue: number;

            if (!isNaN(compNum)) {
                compValue = compNum;
            } else {
                compValue = aggregate(data, widget.comparisonValue, agg);
            }

            if (typeof mainValue === 'number' && typeof compValue === 'number' && compValue !== 0) {
                const diff = mainValue - compValue;
                const pct = (diff / compValue) * 100;
                comparisonDisp = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
                finalTrend = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral';
            }
        }

        return { value: mainValue, comparisonValue: comparisonDisp, trend: finalTrend };
    }, [widgetData, dataSource?.type, allDashboardFilters, activeDashboard?.globalFilters, widget.comparisonValue, widget.metric, widget.yAxis, widget.values, widget.measures]);

    const isFiltered = isWidgetFiltered(widget.id);

    // Determine colors/icons based on trend
    const trendIcon = trend === 'up' ? 'fa-arrow-up' : trend === 'down' ? 'fa-arrow-down' : 'fa-minus';
    const trendColor = trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : '#94a3b8';

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
                error={directError || undefined}
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
            loading={isLoading}
            error={directError || undefined}
            onClick={onClick}
        >
            <div className="flex flex-col justify-center h-full">
                <div className="text-center">
                    {/* Main Value */}
                    <div
                        className="font-black text-slate-900 dark:text-white mb-2 break-words"
                        style={{
                            fontSize: widget.fontSize ? `${widget.fontSize}px` : (() => {
                                const formatted = formatBIValue(value, widget.valueFormat || 'standard');
                                const len = formatted.length;
                                if (len <= 12) return '2.25rem'; // text-4xl (36px)
                                if (len <= 15) return '1.875rem'; // text-3xl (30px)
                                if (len <= 20) return '1.5rem'; // text-2xl (24px)
                                return '1.25rem'; // text-xl (20px)
                            })(),
                            fontFamily: 'Outfit',
                            lineHeight: '1.2'
                        }}
                    >
                        {formatBIValue(value, widget.valueFormat || 'standard')}
                    </div>

                    {/* Trend Indicator */}
                    {comparisonValue && (
                        <div className="flex items-center justify-center gap-2 text-sm" style={{ color: trendColor }}>
                            <i className={`fas ${trendIcon}`}></i>
                            <span>{comparisonValue}</span>
                        </div>
                    )}

                    {/* Subtitle */}
                    <div className="text-xs text-slate-400 mt-2 truncate max-w-full px-2">
                        {widget.metric || widget.yAxis?.[0] || widget.measures?.[0] || 'Total'}
                    </div>
                </div>
            </div>
        </BaseWidget>
    );
};

export default CardWidget;
