// ============================================
// Pie Chart Widget
// ============================================

import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import { useDirectQuery } from '../hooks/useDirectQuery';
import { formatValue } from '../engine/calculations';
import { formatBIValue, formatSmartDataLabel, getAdaptiveNumericFormat } from '../engine/utils';
import BaseWidget from './BaseWidget';
import CustomTooltip from './CustomTooltip';
import EmptyChartState from './EmptyChartState';
import { DrillDownService } from '../engine/DrillDownService';
import { DrillDownState } from '../types';
import { useChartColors } from '../utils/chartColors';
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

import ChartContextMenu from './ChartContextMenu';
import AIAnalysisModal from '../modals/AIAnalysisModal';
import { analyzeChartTrend } from '../../../services/ai';

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
    const xFields = DrillDownService.getCurrentFields(widget, drillDownState);
    const categoryFieldRaw = xFields[0] || '';
    const valueField = widget.values?.[0] || widget.yAxis?.[0] || widget.measures?.[0] || '';

    // NEW: Centralized Aggregation Hook
    const { chartData: rawChartData, error, isLoading } = useDirectQuery(widget);

    // --- AI ANALYSIS STATE ---
    const [contextMenu, setContextMenu] = React.useState<{ x: number, y: number } | null>(null);
    const [isAIModalOpen, setIsAIModalOpen] = React.useState(false);
    const [aiIsLoading, setAiIsLoading] = React.useState(false);
    const [aiResult, setAiResult] = React.useState<string | null>(null);
    const [aiError, setAiError] = React.useState<string | null>(null);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    const handleAnalyzeTrend = async (provider?: string, modelId?: string) => {
        setIsAIModalOpen(true);

        // If called without provider (initial click), just open modal and reset state
        // The Modal's useEffect will trigger the actual analysis
        if (!provider) {
            setAiResult(null);
            setAiError(null);
            setAiIsLoading(false);
            return;
        }

        setAiIsLoading(true);

        try {
            const context = `
                Chart Type: ${widget.chartType}
                Widget Filters: ${JSON.stringify(widget.filters || [])}
                Dashboard Filters: ${JSON.stringify(allDashboardFilters.filter(f => f.sourceWidgetId !== widget.id))}
                Drill Down Level: ${drillDownState?.currentLevel || 0}
                Hierarchy: ${JSON.stringify(widget.drillDownHierarchy || [])}
            `;
            const result = await analyzeChartTrend(
                widget.title || "Biểu đồ",
                categoryField,
                chartData,
                [valueField],
                context,
                { provider, modelId }
            );
            setAiResult(result);
            setAiError(null);
        } catch (err: any) {
            setAiError(err.message || "Phân tích thất bại");
        } finally {
            setAiIsLoading(false);
        }
    };
    // -------------------------

    const categoryField = useMemo(() => {
        if (drillDownState?.mode === 'expand' && xFields.length > 1) return '_combinedAxis';
        if (rawChartData && rawChartData.length > 0 && rawChartData[0]._formattedAxis) return '_formattedAxis';
        if (!categoryFieldRaw) return '_autoCategory';
        return categoryFieldRaw;
    }, [drillDownState?.mode, xFields, rawChartData, categoryFieldRaw]);

    // Map to name/value for Recharts Pie
    const chartData = useMemo(() => {
        if (!rawChartData || !valueField) return [];
        return rawChartData.map(item => {
            const originalName = item[categoryField];
            const alias = widget.legendAliases?.[originalName];
            return {
                name: alias || originalName || 'Total',
                value: item[valueField]
            };
        });
    }, [rawChartData, categoryField, valueField, widget.legendAliases]);

    const { piePalette } = useChartColors();
    const colors = widget.colors || piePalette;

    const isFiltered = isWidgetFiltered(widget.id) || (drillDownState && drillDownState.currentLevel > 0);
    const isDonut = widget.chartType === 'donut';

    const handleClick = (data: any) => {
        // Fallback to cross-filter
        if (onDataClick && widget.enableCrossFilter !== false) {
            onDataClick(data);
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
        if (!valueField) errorMsg = 'Select Value field';

        return (
            <BaseWidget
                widget={widget}
                onEdit={onEdit}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                isSelected={isSelected}
                loading={isLoading}
                error={error || undefined}
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
            loading={isLoading}
            error={error || undefined}
            onClick={onClick}
        >
            <div className="w-full h-full" onContextMenu={handleContextMenu}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            isAnimationActive={false}
                            labelLine={widget.showLabels !== false}
                            label={widget.showLabels !== false ? (props: any) => {
                                const { name, value, percent } = props;
                                if (value === undefined || value === null) return null;
                                const pVal = percent ? (percent * 100).toFixed(1) + '%' : '0%';
                                const formattedValue = formatSmartDataLabel(value, widget.labelFormat || getAdaptiveNumericFormat(widget.valueFormat), { maxLength: 10 });
                                switch (widget.labelMode) {
                                    case 'value': return formattedValue;
                                    case 'percent': return pVal;
                                    case 'category': return name;
                                    case 'categoricalPercent': return `${name}: ${pVal}`;
                                    case 'categoricalValue':
                                    default: return `${name}: ${formattedValue}`;
                                }
                            } : undefined}
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
                                    fontSize={widget.legendFontSize ? `${widget.legendFontSize}px` : (widget.fontSize ? `${Math.max(7, widget.fontSize - 3)}px` : '10px')}
                                />}
                            />
                        )}
                    </PieChart>
                </ResponsiveContainer>
                {/* AI Context Menu */}
                {contextMenu && (
                    <ChartContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        onClose={() => setContextMenu(null)}
                        onAnalyze={handleAnalyzeTrend}
                    />
                )}

                {/* AI Modal */}
                <AIAnalysisModal
                    isOpen={isAIModalOpen}
                    onClose={() => setIsAIModalOpen(false)}
                    isLoading={aiIsLoading}
                    analysisResult={aiResult}
                    error={aiError}
                    title={widget.title || "Chart Analysis"}
                    onReAnalyze={handleAnalyzeTrend}
                />
            </div>
        </BaseWidget >
    );
};

export default PieChartWidget;
