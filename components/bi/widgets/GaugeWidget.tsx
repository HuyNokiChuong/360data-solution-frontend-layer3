
import React, { useMemo } from 'react';
import { formatValue } from '../engine/calculations';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { BIWidget, DrillDownState } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { aggregate, applyFilters } from '../engine/dataProcessing';
import { useWidgetData } from '../hooks/useWidgetData';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import { DrillDownService } from '../engine/DrillDownService';
import EmptyChartState from './EmptyChartState';
import { CHART_COLORS } from '../utils/chartColors';

interface GaugeWidgetProps {
    widget: BIWidget;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    isSelected?: boolean;
    onClickDataTab?: () => void;
    onClick?: (e: React.MouseEvent) => void;
}

const GaugeWidget: React.FC<GaugeWidgetProps> = ({
    widget,
    onEdit,
    onDelete,
    onDuplicate,
    isSelected = false,
    onClickDataTab,
    onClick
}) => {
    const { getDataSource } = useDataStore(); // Kept for metadata
    const { crossFilters: allDashboardFilters, getCrossFiltersForWidget, isWidgetFiltered, getDrillDown, setDrillDown } = useFilterStore();
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));
    const widgetData = useWidgetData(widget);

    const drillDownState = getDrillDown(widget.id);
    const crossFilters = getCrossFiltersForWidget(widget.id);
    const isFiltered = isWidgetFiltered(widget.id);

    const { value, percentage, maxValue, loading, error } = useMemo(() => {
        if (!widgetData.length || !widget.yAxis?.[0]) {
            return { value: 0, percentage: 0, maxValue: 100, loading: false, error: 'Please configure metric field' };
        }

        try {
            // Apply widget-level filters
            let filteredData = widgetData;
            if (widget.filters && widget.filters.length > 0) {
                filteredData = applyFilters(filteredData, widget.filters);
            }

            // Apply cross-filters
            const crossFilters = getCrossFiltersForWidget(widget.id);
            if (crossFilters.length > 0) {
                filteredData = applyFilters(filteredData, crossFilters);
            }

            // Apply global filters
            if (activeDashboard?.globalFilters?.length) {
                const relevantGlobal = activeDashboard.globalFilters.filter(gf =>
                    !gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)
                );
                if (relevantGlobal.length > 0) {
                    filteredData = applyFilters(filteredData, relevantGlobal as any[]);
                }
            }

            // Calculate value
            const field = widget.yAxis[0];
            const aggregation = widget.aggregation || 'sum';
            const calculatedValue = aggregate(filteredData, field, aggregation);

            // Calculate max value (comparison)
            let maxVal = 100;
            if (widget.comparisonValue) {
                // Check if it's a numeric string or a field name
                const num = parseFloat(widget.comparisonValue);
                if (!isNaN(num)) {
                    maxVal = num;
                } else {
                    // It's a field name, aggregate it
                    maxVal = aggregate(filteredData, widget.comparisonValue, aggregation);
                }
            } else {
                maxVal = calculatedValue > 0 ? calculatedValue * 1.5 : 100;
            }

            const pct = maxVal > 0 ? Math.min((calculatedValue / maxVal) * 100, 100) : 0;
            return { value: calculatedValue, percentage: pct, maxValue: maxVal, loading: false, error: null };
        } catch (err: any) {
            return { value: 0, percentage: 0, maxValue: 100, loading: false, error: err.message };
        }
    }, [widget, widgetData, allDashboardFilters, activeDashboard?.globalFilters]);

    // Gauge chart data
    const gaugeData = [
        { name: 'Value', value: percentage },
        { name: 'Remaining', value: 100 - percentage }
    ];

    // Color based on percentage
    const getColor = (pct: number) => {
        if (pct >= 80) return CHART_COLORS[4]; // Emerald/Green
        if (pct >= 50) return CHART_COLORS[3]; // Amber/Yellow
        return CHART_COLORS[2]; // Pink/Red
    };

    const mainColor = getColor(percentage);
    const COLORS = [mainColor, '#1e293b'];

    return (
        <BaseWidget
            widget={widget}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isSelected={isSelected}
            isFiltered={isFiltered}
            loading={loading}
            error={error && error !== 'Please configure metric field' ? error : undefined}
            onClick={onClick}
        >
            {!widget.yAxis?.[0] ? (
                <EmptyChartState type="gauge" message="Configure metric field" onClickDataTab={onClickDataTab} />
            ) : (
                <div className="flex flex-col items-center justify-center h-full">
                    <ResponsiveContainer width="100%" height="70%">
                        <PieChart>
                            <Pie
                                data={gaugeData}
                                cx="50%"
                                cy="70%"
                                startAngle={180}
                                endAngle={0}
                                innerRadius="60%"
                                outerRadius="90%"
                                paddingAngle={0}
                                dataKey="value"
                            >
                                {gaugeData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index]} />
                                ))}
                            </Pie>
                        </PieChart>
                    </ResponsiveContainer>

                    <div className="text-center mt-[-20%]">
                        <div className="text-3xl font-black" style={{ color: mainColor }}>
                            {formatValue(value, widget.valueFormat || 'standard')}
                        </div>
                        <div className="text-sm text-slate-400 mt-1">
                            {percentage.toFixed(1)}%
                        </div>
                        {widget.comparisonValue && (
                            <div className="text-xs text-slate-500 mt-1">
                                Target: {formatValue(maxValue, widget.valueFormat || 'standard')}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </BaseWidget>
    );
};

export default GaugeWidget;
