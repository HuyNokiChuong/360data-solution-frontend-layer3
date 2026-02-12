
import React, { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ZAxis, LabelList, Cell } from 'recharts';
import { BIWidget, DrillDownState } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import { useDirectQuery } from '../hooks/useDirectQuery';
import { formatValue } from '../engine/calculations';
import { formatBIValue, formatSmartDataLabel, getAdaptiveNumericFormat } from '../engine/utils';
import BaseWidget from './BaseWidget';
import CustomTooltip from './CustomTooltip';
import { DrillDownService } from '../engine/DrillDownService';
import EmptyChartState from './EmptyChartState';
import { useChartColors } from '../utils/chartColors';
import ChartLegend from './ChartLegend';

interface ScatterChartWidgetProps {
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

const ScatterChartWidget: React.FC<ScatterChartWidgetProps> = ({
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
    const xFields = DrillDownService.getCurrentFields(widget, drillDownState);
    const xField = (drillDownState?.mode === 'expand' && xFields.length > 1)
        ? '_combinedAxis'
        : (xFields[0] || '_autoCategory');
    const { chartColors } = useChartColors();

    // NEW: Centralized Aggregation Hook
    const { chartData, error, isLoading } = useDirectQuery(widget);

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
                X-Axis (Independent): ${xField}
                Y-Axis (Dependent): ${widget.yAxis?.[0]}
                Z-Axis (Size): ${widget.yAxis?.[1] || 'None'}
            `;
            const result = await analyzeChartTrend(
                widget.title || "Biểu đồ phân tán",
                xField,
                chartData,
                widget.yAxis || [],
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

    const realDataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    const loadingProgress = useMemo(() => {
        if (!realDataSource || !realDataSource.totalRows || realDataSource.totalRows === 0) return 0;
        return (realDataSource.data?.length || 0) / realDataSource.totalRows * 100;
    }, [realDataSource]);

    const isFiltered = isWidgetFiltered(widget.id) || (drillDownState && drillDownState.currentLevel > 0);


    const handleClick = (data: any) => {
        const payload = data?.activePayload?.[0]?.payload;
        if (!payload) return;

        // 1. Check for drill-down
        if (widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0) {
            const currentState = drillDownState || DrillDownService.initDrillDown(widget);
            if (currentState) {
                const clickedValue = payload[xField];
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

    // Detect if X-axis is numeric or categorical
    const xFieldType = useMemo(() => {
        if (!realDataSource || xField === '_autoCategory') return 'category';
        const field = realDataSource.schema?.find(f => f.name === xField);
        return field?.type === 'number' ? 'number' : 'category';
    }, [realDataSource, xField]);

    // Get current cross-filter selection
    const currentSelection = useMemo(() => {
        const cf = allDashboardFilters.find(f => f.sourceWidgetId === widget.id);
        if (!cf) return undefined;
        return cf.filters.find(f => f.field === xField)?.value;
    }, [allDashboardFilters, widget.id, xField]);

    return (
        <BaseWidget
            widget={widget}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isSelected={isSelected}
            isFiltered={!!isFiltered}
            loading={isLoading}
            loadingProgress={loadingProgress}
            error={error}
            onClick={onClick}
        >
            <div className="w-full h-full" onContextMenu={handleContextMenu}>
                {chartData.length === 0 && !error ? (
                    <EmptyChartState type="scatter" message={widget.yAxis?.[0] ? "No data available" : "Select Y-Axis field"} onClickDataTab={onClickDataTab} onClick={onClick} />
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart
                            margin={{ top: 20, right: 30, left: 10, bottom: 10 }}
                            onClick={handleClick}
                        >
                            {widget.showGrid !== false && (
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                            )}

                            <XAxis
                                type={xFieldType}
                                dataKey={xField}
                                name={xField}
                                stroke="#94a3b8"
                                tickFormatter={(val) => {
                                    if (xFieldType === 'number') return formatBIValue(val, getAdaptiveNumericFormat(widget.valueFormat));
                                    return val;
                                }}
                                tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: widget.fontFamily || 'Outfit' }}
                                tickLine={false}
                                axisLine={false}
                            />

                            <YAxis
                                type="number"
                                dataKey={widget.yAxis?.[0]}
                                name={widget.yAxis?.[0]}
                                stroke="#94a3b8"
                                tickFormatter={(val) => formatBIValue(val, getAdaptiveNumericFormat(widget.valueFormat))}
                                tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: widget.fontFamily || 'Outfit' }}
                                tickLine={false}
                                axisLine={false}
                                width={120}
                            />

                            {/* Optional Z-axis for bubble chart effect */}
                            {widget.yAxis?.[1] && (
                                <ZAxis
                                    type="number"
                                    dataKey={widget.yAxis[1]}
                                    range={[50, 400]}
                                    name={widget.yAxis[1]}
                                />
                            )}

                            <Tooltip
                                content={<CustomTooltip
                                    aggregation={widget.aggregation}
                                    valueFormat={widget.valueFormat || 'standard'}
                                />}
                                cursor={{ strokeDasharray: '3 3' }}
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
                                        fontSize={widget.legendFontSize ? `${widget.legendFontSize}px` : (widget.fontSize ? `${Math.max(7, widget.fontSize - 3)}px` : '9px')}
                                    />}
                                />
                            )}

                            <Scatter
                                name={widget.yAxis?.[0] || 'Value'}
                                data={chartData}
                                isAnimationActive={false}
                                fill={widget.colors?.[0] || chartColors[0]}
                                opacity={0.8}
                                onClick={(e: any) => {
                                    if (onDataClick && e && e.payload) onDataClick(e.payload);
                                }}
                            >
                                {chartData.map((entry, index) => {
                                    const isActive = !currentSelection || entry[xField] === currentSelection;
                                    return (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={widget.colors?.[0] || chartColors[0]}
                                            fillOpacity={isActive ? 0.8 : 0.2}
                                        />
                                    );
                                })}
                                {widget.showLabels !== false && (
                                    <LabelList
                                        dataKey={widget.yAxis?.[0]}
                                        position="top"
                                        fill="#94a3b8"
                                        fontSize={10}
                                        formatter={(val: any) => formatSmartDataLabel(val, widget.labelFormat || getAdaptiveNumericFormat(widget.valueFormat), { maxLength: 10 })}
                                        style={{ fontFamily: widget.fontFamily || 'Outfit' }}
                                    />
                                )}
                            </Scatter>
                        </ScatterChart>
                    </ResponsiveContainer>
                )}

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

export default ScatterChartWidget;
