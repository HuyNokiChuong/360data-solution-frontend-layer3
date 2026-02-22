// ============================================
// Pie Chart Widget
// ============================================

import React, { useCallback, useMemo } from 'react';
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
import { exportRowsToExcel } from '../utils/widgetExcelExport';

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
import { useLanguageStore } from '../../../store/languageStore';

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
    const { language } = useLanguageStore();
    const { getDataSource } = useDataStore(); // Kept if needed
    const { crossFilters: allDashboardFilters, getFiltersForWidget, isWidgetFiltered, setDrillDown } = useFilterStore();
    const drillDowns = useFilterStore(state => state.drillDowns);
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));

    const drillDownState = useMemo(() => {
        const runtimeState = drillDowns[widget.id];
        const persistedState = widget.drillDownState || null;
        return DrillDownService.resolveStateForWidget(widget, runtimeState || persistedState || undefined);
    }, [widget, drillDowns[widget.id], widget.drillDownState]);
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
    const [aiOutputLanguage, setAiOutputLanguage] = React.useState<'vi' | 'en'>(language === 'en' ? 'en' : 'vi');

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    const handleAnalyzeTrend = async (provider?: string, modelId?: string, outputLanguage?: string) => {
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
                { provider, modelId, language, outputLanguage: outputLanguage || language }
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

    const handleAnalyzeFromContextMenu = (outputLanguage: 'vi' | 'en') => {
        setAiOutputLanguage(outputLanguage);
        handleAnalyzeTrend(undefined, undefined, outputLanguage);
    };

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
            const rawValue = item[valueField];
            const numericValue = typeof rawValue === 'number'
                ? rawValue
                : Number.parseFloat(String(rawValue ?? ''));
            return {
                name: alias || originalName || 'Total',
                value: Number.isFinite(numericValue) ? numericValue : 0
            };
        });
    }, [rawChartData, categoryField, valueField, widget.legendAliases]);

    const labelVisibleIndices = useMemo(() => {
        const positiveEntries = chartData
            .map((item, index) => ({
                index,
                value: Number(item.value) || 0
            }))
            .filter((item) => item.value > 0);

        if (positiveEntries.length === 0) return new Set<number>();

        const total = positiveEntries.reduce((sum, item) => sum + item.value, 0);
        if (!Number.isFinite(total) || total <= 0) return new Set<number>();

        const positiveCount = positiveEntries.length;
        const minVisibleShare =
            positiveCount > 20 ? 0.06 :
                positiveCount > 12 ? 0.04 :
                    positiveCount > 8 ? 0.025 : 0.015;
        const maxLabelCount =
            positiveCount > 24 ? 6 :
                positiveCount > 16 ? 8 :
                    positiveCount > 10 ? 10 : 14;

        const prioritized = positiveEntries
            .map((item) => ({ ...item, share: item.value / total }))
            .filter((item) => item.share >= minVisibleShare)
            .sort((a, b) => b.value - a.value)
            .slice(0, maxLabelCount);

        const selected = new Set<number>(prioritized.map((item) => item.index));
        const minGuaranteed = Math.min(3, positiveCount, maxLabelCount);
        if (selected.size < minGuaranteed) {
            const topEntries = [...positiveEntries]
                .sort((a, b) => b.value - a.value)
                .slice(0, minGuaranteed);
            topEntries.forEach((entry) => selected.add(entry.index));
        }

        return selected;
    }, [chartData]);

    const formatSmartPercent = useCallback((rawPercent: number) => {
        if (!Number.isFinite(rawPercent) || rawPercent <= 0) return '';
        const pct = rawPercent * 100;
        if (pct < 0.1) return '<0.1%';
        if (pct < 10) return `${pct.toFixed(1)}%`;
        return `${pct.toFixed(1).replace(/\.0$/, '')}%`;
    }, []);

    const compactCategoryName = useCallback((rawName: any) => {
        const text = String(rawName ?? '').trim();
        if (!text) return '(Blank)';
        if (text.length <= 16) return text;
        return `${text.slice(0, 13)}...`;
    }, []);

    const exportFields = useMemo(() => {
        const categoryFields = xFields.length > 0 ? xFields : (widget.xAxis ? [widget.xAxis] : []);
        const fieldOrder = [...categoryFields, valueField].filter(Boolean);
        return Array.from(new Set(fieldOrder)).map((field) => ({ field }));
    }, [xFields, widget.xAxis, valueField]);

    const handleExportExcel = useCallback(() => {
        exportRowsToExcel({
            title: widget.title || 'Pie Chart',
            rows: rawChartData as Record<string, any>[],
            fields: exportFields
        });
    }, [widget.title, rawChartData, exportFields]);

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
                onExportExcel={handleExportExcel}
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
            onExportExcel={handleExportExcel}
        >
            <div className="w-full h-full" onContextMenu={handleContextMenu}>
                <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
                    <PieChart>
                        <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            isAnimationActive={false}
                            labelLine={widget.showLabels !== false && labelVisibleIndices.size <= 8}
                            label={widget.showLabels !== false ? (props: any) => {
                                const { name, value, percent, index } = props;
                                if (!labelVisibleIndices.has(index)) return null;
                                if (value === undefined || value === null) return null;
                                const pVal = formatSmartPercent(Number(percent) || 0);
                                if (!pVal && widget.labelMode !== 'value' && widget.labelMode !== 'category' && widget.labelMode !== 'categoricalValue') {
                                    return null;
                                }
                                const formattedValue = formatSmartDataLabel(value, widget.labelFormat || getAdaptiveNumericFormat(widget.valueFormat), { maxLength: 10 });
                                const compactName = compactCategoryName(name);
                                switch (widget.labelMode) {
                                    case 'value': return formattedValue;
                                    case 'percent': return pVal;
                                    case 'category': return compactName;
                                    case 'categoricalPercent': return pVal ? `${compactName}: ${pVal}` : compactName;
                                    case 'categoricalValue':
                                    default: return `${compactName}: ${formattedValue}`;
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
                        onAnalyze={handleAnalyzeFromContextMenu}
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
                    defaultOutputLanguage={aiOutputLanguage}
                    uiLanguage={language}
                    onReAnalyze={handleAnalyzeTrend}
                />
            </div>
        </BaseWidget >
    );
};

export default PieChartWidget;
