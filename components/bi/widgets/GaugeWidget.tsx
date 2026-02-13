import React, { useCallback, useMemo } from 'react';
import { aggregate, formatValue } from '../engine/calculations';
import { formatBIValue, getAdaptiveNumericFormat } from '../engine/utils';
import { applyFilters } from '../engine/dataProcessing';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDirectQuery } from '../hooks/useDirectQuery';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import EmptyChartState from './EmptyChartState';
import { useChartColors } from '../utils/chartColors';
import { exportRowsToExcel } from '../utils/widgetExcelExport';

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
    const { crossFilters: allDashboardFilters, getCrossFiltersForWidget, isWidgetFiltered, setDrillDown } = useFilterStore();
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));

    // Switch to useDirectQuery
    const { data: directData, isLoading, error: directError } = useDirectQuery(widget);
    const widgetData = directData;

    const dataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    const isFiltered = isWidgetFiltered(widget.id);

    const { value, percentage, maxValue, error } = useMemo(() => {
        if (!widgetData || widgetData.length === 0) {
            return { value: 0, percentage: 0, maxValue: 100, error: null };
        }

        try {
            const field = widget.yAxis?.[0];
            const aggregation = widget.aggregation || 'sum';
            if (!field) return { value: 0, percentage: 0, maxValue: 100, error: 'Configure metric field' };

            let calculatedValue: number;
            let maxVal = 100;

            if (dataSource?.type === 'bigquery') {
                const row = widgetData[0];
                calculatedValue = row[field];

                if (widget.comparisonValue) {
                    const num = parseFloat(widget.comparisonValue);
                    maxVal = !isNaN(num) ? num : (row[widget.comparisonValue] || 100);
                } else {
                    maxVal = calculatedValue > 0 ? calculatedValue * 1.5 : 100;
                }
            } else {
                // Local processing
                let filteredData = widgetData;
                if (widget.filters && widget.filters.length > 0) {
                    filteredData = applyFilters(filteredData, widget.filters);
                }
                const crossFilters = getCrossFiltersForWidget(widget.id);
                if (crossFilters.length > 0) {
                    filteredData = applyFilters(filteredData, crossFilters);
                }
                if (activeDashboard?.globalFilters?.length) {
                    const relevantGlobal = activeDashboard.globalFilters.filter(gf =>
                        !gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)
                    );
                    if (relevantGlobal.length > 0) {
                        filteredData = applyFilters(filteredData, relevantGlobal as any[]);
                    }
                }

                calculatedValue = aggregate(filteredData, field, aggregation);

                if (widget.comparisonValue) {
                    const num = parseFloat(widget.comparisonValue);
                    maxVal = !isNaN(num) ? num : aggregate(filteredData, widget.comparisonValue, aggregation);
                } else {
                    maxVal = calculatedValue > 0 ? calculatedValue * 1.5 : 100;
                }
            }

            const pct = maxVal > 0 ? Math.min((calculatedValue / maxVal) * 100, 100) : 0;
            return { value: calculatedValue, percentage: pct, maxValue: maxVal, error: null };
        } catch (err: any) {
            return { value: 0, percentage: 0, maxValue: 100, error: err.message };
        }
    }, [widgetData, dataSource?.type, allDashboardFilters, activeDashboard?.globalFilters]);

    // Gauge chart data
    const gaugeData = [
        { name: 'Value', value: percentage },
        { name: 'Remaining', value: 100 - percentage }
    ];

    const { chartColors, isDark } = useChartColors();

    // Color based on percentage
    const getGaugeColor = (pct: number) => {
        if (pct >= 80) return chartColors[2]; // Emerald/Green if chartColors[2] is green
        if (pct >= 50) return chartColors[1]; // Amber/Yellow
        return chartColors[3]; // Rose/Red
    };

    const mainColor = getGaugeColor(percentage);
    const COLORS = [mainColor, isDark ? '#1e293b' : '#f1f5f9'];

    const exportFields = useMemo(() => {
        const metricField = widget.yAxis?.[0];
        const comparisonField = widget.comparisonValue;
        const numericComparison = comparisonField !== undefined && comparisonField !== null && comparisonField !== '' && !Number.isNaN(Number(comparisonField));
        const fields = [metricField];
        if (comparisonField && !numericComparison) {
            fields.push(comparisonField);
        }
        return Array.from(new Set(fields.filter(Boolean))).map((field) => ({ field: String(field) }));
    }, [widget.yAxis, widget.comparisonValue]);

    const handleExportExcel = useCallback(() => {
        exportRowsToExcel({
            title: widget.title || 'Gauge',
            rows: widgetData as Record<string, any>[],
            fields: exportFields
        });
    }, [widget.title, widgetData, exportFields]);

    return (
        <BaseWidget
            widget={widget}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isSelected={isSelected}
            isFiltered={isFiltered}
            loading={isLoading}
            error={error && error !== 'Configure metric field' ? error : (directError || undefined)}
            onClick={onClick}
            onExportExcel={handleExportExcel}
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
                        <div
                            className="font-black max-w-full break-words px-2"
                            style={{
                                color: mainColor,
                                fontFamily: widget.fontFamily || 'Outfit',
                                fontSize: (() => {
                                    const formatted = formatBIValue(value, getAdaptiveNumericFormat(widget.valueFormat));
                                    const len = formatted.length;
                                    if (len <= 10) return '1.875rem'; // text-3xl
                                    if (len <= 15) return '1.5rem';   // text-2xl
                                    if (len <= 20) return '1.25rem';  // text-xl
                                    return '1.125rem';                // text-lg
                                })()
                            }}
                        >
                            {formatBIValue(value, getAdaptiveNumericFormat(widget.valueFormat))}
                        </div>
                        <div className="text-sm text-slate-400 mt-1">
                            {percentage.toFixed(1)}%
                        </div>
                        {widget.comparisonValue && (
                            <div className="text-xs text-slate-500 mt-1" style={{ fontFamily: widget.fontFamily || 'Outfit' }}>
                                Target: {formatBIValue(maxValue, getAdaptiveNumericFormat(widget.valueFormat))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </BaseWidget>
    );
};

export default GaugeWidget;
