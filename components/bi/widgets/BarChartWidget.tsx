// ============================================
// Bar Chart Widget
// ============================================

import React, { useMemo } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend, LabelList } from 'recharts';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { formatValue } from '../engine/calculations';
import { useDirectQuery } from '../hooks/useDirectQuery';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import CustomTooltip from './CustomTooltip';
import EmptyChartState from './EmptyChartState';
import { DrillDownService } from '../engine/DrillDownService';
import { useChartColors } from '../utils/chartColors';
import { formatBIValue, formatSmartDataLabel, getAdaptiveNumericFormat } from '../engine/utils';
import { HierarchicalAxisTick } from './HierarchicalAxisTick';
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

import ChartContextMenu from './ChartContextMenu';
import AIAnalysisModal from '../modals/AIAnalysisModal';
import { analyzeChartTrend } from '../../../services/ai';

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
    // ... existing hooks ...
    const isStackedType = widget.chartType === 'stackedBar' || widget.stacked === true;
    const { getDataSource } = useDataStore();
    const { crossFilters: allDashboardFilters, getFiltersForWidget, isWidgetFiltered, setDrillDown } = useFilterStore();
    const drillDowns = useFilterStore(state => state.drillDowns);
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));

    const drillDownState = drillDowns[widget.id];
    const xFields = DrillDownService.getCurrentFields(widget, drillDownState);
    const xField = xFields[0] || '';

    // NEW: Centralized Aggregation Hook
    const { chartData, series, lineSeries, error, isLoading } = useDirectQuery(widget);

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
            const dataKeys = [...series, ...lineSeries];
            const context = `
                Chart Type: ${widget.chartType}
                Widget Filters: ${JSON.stringify(widget.filters || [])}
                Dashboard Filters: ${JSON.stringify(allDashboardFilters.filter(f => f.sourceWidgetId !== widget.id))}
                Drill Down Level: ${drillDownState?.currentLevel || 0}
                Hierarchy: ${JSON.stringify(widget.drillDownHierarchy || [])}
            `;

            const result = await analyzeChartTrend(
                widget.title || "Biểu đồ",
                xField,
                chartData,
                dataKeys,
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

    const xFieldDisplay = useMemo(() => {
        if (!xField) return '_autoCategory';
        if (drillDownState?.mode === 'expand' && xFields.length > 1) return '_combinedAxis';
        if (chartData.length > 0 && chartData[0]._formattedAxis) return '_formattedAxis';
        return xField;
    }, [drillDownState?.mode, xFields.length, chartData, xField]);

    const effectiveChartData = useMemo(() => {
        if (xField) return chartData;
        return chartData.map((row) => ({
            ...row,
            _autoCategory: row._autoCategory || 'Total'
        }));
    }, [chartData, xField]);

    const hierarchyDepth = useMemo(() => {
        if (drillDownState?.mode !== 'expand') return 1;
        return effectiveChartData.reduce((maxDepth, row) => {
            const raw = row?._combinedAxis || row?._formattedAxis || row?.[xFieldDisplay] || '';
            const depth = String(raw).split('\n').filter(Boolean).length || 1;
            return Math.max(maxDepth, depth);
        }, 1);
    }, [drillDownState?.mode, effectiveChartData, xFieldDisplay]);

    const xAxisHeight = hierarchyDepth <= 1 ? 30 : Math.min(96, 30 + hierarchyDepth * 16);
    const hasBottomLegend = widget.showLegend !== false && (!widget.legendPosition || widget.legendPosition === 'bottom');
    const bottomMarginBase = hierarchyDepth <= 1 ? 10 : 18;
    const bottomMargin = hasBottomLegend
        ? Math.max(bottomMarginBase + 24, xAxisHeight + 26)
        : bottomMarginBase;

    const yField = series[0] || '';

    // Colors
    const { chartColors } = useChartColors();
    const colors = widget.colors || chartColors;

    // Handle bar click
    const handleBarClick = (data: any) => {
        if (onDataClick && widget.enableCrossFilter !== false) {
            onDataClick(data);
        }
    };

    const isFiltered = isWidgetFiltered(widget.id) || (drillDownState && drillDownState.currentLevel > 0);
    const isHorizontal = widget.chartType === 'horizontalBar';
    const hasHierarchy = widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0;
    const shouldRenderDataLabels = widget.showLabels !== false && effectiveChartData.length <= 40;

    // Get current cross-filter selection for THIS widget
    const currentSelection = useMemo(() => {
        const cf = allDashboardFilters.find(f => f.sourceWidgetId === widget.id);
        if (!cf) return undefined;
        // Find the filter corresponding to the current X-axis field
        return cf.filters.find(f => f.field === xField)?.value;
    }, [allDashboardFilters, widget.id, xField]);

    const dataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    const resolveCategoryLabel = (payload: any) => {
        if (!payload) return '';
        const raw = payload[xFieldDisplay] ?? payload[xField] ?? payload._autoCategory ?? '';
        const asString = String(raw ?? '');
        if (!asString) return '';
        if (asString.includes('\n')) {
            const parts = asString.split('\n').filter(Boolean);
            return parts[parts.length - 1] || asString;
        }
        return asString;
    };

    const renderLabelText = (labelMode: BIWidget['labelMode'], valueText: string, categoryText: string) => {
        switch (labelMode) {
            case 'value':
                return valueText;
            case 'category':
                return categoryText;
            case 'categoricalPercent':
                return categoryText && valueText ? `${categoryText}: ${valueText}` : (valueText || categoryText);
            case 'categoricalValue':
            default:
                return categoryText && valueText ? `${categoryText}: ${valueText}` : (valueText || categoryText);
        }
    };

    if (effectiveChartData.length === 0 && !isLoading) {
        let errorMsg = 'No data available';
        if (!yField) errorMsg = 'Select Y-Axis field';

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
            loading={isLoading}
            error={error || undefined}
            onClick={onClick}
        >
            <div className="w-full h-full" onContextMenu={handleContextMenu}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        data={effectiveChartData}
                        layout={isHorizontal ? 'vertical' : 'horizontal'}
                        margin={isHorizontal
                            ? { top: 20, right: 40, left: 20, bottom: 5 }
                            : { top: 20, right: 30, left: 0, bottom: bottomMargin }
                        }
                        barCategoryGap="20%"
                        barGap={4}
                        onClick={(e: any) => e && e.activePayload && handleBarClick(e.activePayload[0].payload)}
                    >
                        {widget.showGrid !== false && (
                            <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="#ffffff08"
                                vertical={true}
                                horizontal={true}
                            />
                        )}
                        {(() => {
                            // Shared Logic for Axis Formatting
                            const leftSeriesField = series.find(s => {
                                const c = widget.yAxisConfigs?.find(conf => conf.field === s);
                                return !c?.yAxisId || c.yAxisId === 'left';
                            }) || lineSeries.find(s => {
                                const c = widget.lineAxisConfigs?.find(conf => conf.field === s);
                                return c?.yAxisId === 'left';
                            });

                            const rightSeriesField = series.find(s => {
                                const c = widget.yAxisConfigs?.find(conf => conf.field === s);
                                return c?.yAxisId === 'right';
                            }) || lineSeries.find(s => {
                                const c = widget.lineAxisConfigs?.find(conf => conf.field === s);
                                return c?.yAxisId === 'right';
                            });

                            const leftConfig = widget.yAxisConfigs?.find(c => c.field === leftSeriesField) || widget.lineAxisConfigs?.find(c => c.field === leftSeriesField);
                            const rightConfig = widget.yAxisConfigs?.find(c => c.field === rightSeriesField) || widget.lineAxisConfigs?.find(c => c.field === rightSeriesField);

                            const leftRawFormat = (leftConfig?.format && leftConfig.format !== 'standard' ? leftConfig.format : null) || widget.valueFormat;
                            const rightRawFormat = (rightConfig?.format && rightConfig.format !== 'standard' ? rightConfig.format : null) || widget.valueFormat;

                            const overrideFormats = ['standard', 'float_1', 'float_2', 'float_3', 'float_4', 'integer'];
                            const leftFormat = (!leftRawFormat || overrideFormats.includes(leftRawFormat)) ? 'smart_axis' : leftRawFormat;
                            const rightFormat = (!rightRawFormat || overrideFormats.includes(rightRawFormat)) ? 'smart_axis' : rightRawFormat;

                            const hasRightAxis = series.some(s => widget.yAxisConfigs?.find(c => c.field === s)?.yAxisId === 'right') ||
                                lineSeries.some(s => widget.lineAxisConfigs?.find(c => c.field === s)?.yAxisId === 'right');

                            if (isHorizontal) {
                                return (
                                    <>
                                        <XAxis
                                            type="number"
                                            xAxisId="left"
                                            stroke="#94a3b8"
                                            fontSize={10}
                                            tickLine={false}
                                            axisLine={false}
                                            tickFormatter={(val) => formatBIValue(val, leftFormat)}
                                            fontFamily="Outfit"
                                        />
                                        {hasRightAxis && (
                                            <XAxis
                                                type="number"
                                                xAxisId="right"
                                                orientation="top"
                                                stroke="#94a3b8"
                                                fontSize={10}
                                                tickLine={false}
                                                axisLine={false}
                                                tickFormatter={(val) => formatBIValue(val, rightFormat)}
                                                fontFamily="Outfit"
                                            />
                                        )}
                                        <YAxis
                                            dataKey={xFieldDisplay}
                                            type="category"
                                            stroke="#94a3b8"
                                            fontSize={10}
                                            tickLine={false}
                                            axisLine={false}
                                            width={120}
                                            fontFamily="Outfit"
                                            interval={0}
                                        />
                                    </>
                                );
                            } else {
                                // Vertical (Standard)
                                return (
                                    <>
                                        <XAxis
                                            dataKey={xFieldDisplay}
                                            type="category"
                                            stroke="#94a3b8"
                                            fontSize={10}
                                            tickLine={false}
                                            axisLine={false}
                                            interval={(drillDownState?.mode === 'expand' ? 0 : 'auto') as any}
                                            tick={<HierarchicalAxisTick data={effectiveChartData} />}
                                            height={xAxisHeight}
                                            fontFamily="Outfit"
                                        />
                                        <YAxis
                                            yAxisId="left"
                                            type="number"
                                            stroke="#94a3b8"
                                            tickFormatter={(val) => formatBIValue(val, leftFormat)}
                                            style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px', fontFamily: 'Outfit' }}
                                            width={80}
                                        />
                                        {hasRightAxis && (
                                            <YAxis
                                                yAxisId="right"
                                                orientation="right"
                                                stroke="#94a3b8"
                                                tickFormatter={(val) => formatBIValue(val, rightFormat)}
                                                style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px', fontFamily: 'Outfit' }}
                                                width={80}
                                            />
                                        )}
                                    </>
                                );
                            }
                        })()}

                        <Tooltip content={<CustomTooltip valueFormat={widget.valueFormat} configs={[...(widget.yAxisConfigs || []), ...(widget.lineAxisConfigs || [])]} />} />
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
                                wrapperStyle={hasBottomLegend ? { paddingTop: 8 } : undefined}
                            />
                        )}

                        {series.length > 0 ? (
                            series.map((sField, idx) => {
                                const config = widget.yAxisConfigs?.find(c => c.field === sField);
                                const yAxisId = config?.yAxisId || 'left';
                                const seriesFormat = (config?.format && config.format !== 'standard' ? config.format : null) || widget.valueFormat || 'standard';
                                const format = widget.labelFormat || getAdaptiveNumericFormat(seriesFormat);
                                const axisProps = isHorizontal ? { xAxisId: yAxisId } : { yAxisId: yAxisId };
                                const color = colors[idx % colors.length];

                                return (
                                    <Bar
                                        key={sField}
                                        dataKey={sField}
                                        name={sField}
                                        {...axisProps}
                                        isAnimationActive={false}
                                        fill={color}
                                        stackId={isStackedType ? "a" : undefined}
                                        onClick={(e: any) => handleBarClick(e.payload)}
                                        cursor="pointer"
                                        radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                                    >
                                        {effectiveChartData.map((entry, index) => {
                                            const isActive = !currentSelection || !xField || entry[xField] === currentSelection;
                                            return (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={color}
                                                    fillOpacity={isActive ? 1 : 0.3}
                                                    stroke={isActive && currentSelection ? 'white' : 'none'}
                                                    strokeWidth={2}
                                                />
                                            );
                                        })}
                                        {shouldRenderDataLabels && (
                                            <LabelList
                                                dataKey={sField}
                                                position={isHorizontal ? "right" : (lineSeries.length > 0 ? "insideTop" : "top")}
                                                dy={!isHorizontal && lineSeries.length > 0 ? 8 : 0}
                                                fill="#94a3b8"
                                                fontSize={10}
                                                formatter={(val: any, _name: any, labelProps: any) => {
                                                    const formatted = formatSmartDataLabel(val, format, { maxLength: 10 });
                                                    const category = resolveCategoryLabel(labelProps?.payload);
                                                    return renderLabelText(widget.labelMode, formatted, category);
                                                }}
                                            />
                                        )}
                                    </Bar>
                                );
                            })
                        ) : (
                            <Bar
                                dataKey={yField}
                                {...(isHorizontal ? { xAxisId: 'left' } : { yAxisId: 'left' })}
                                isAnimationActive={false}
                                fill={colors[0]}
                                onClick={(e: any) => handleBarClick(e.payload)}
                                cursor="pointer"
                                radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                            >
                                {effectiveChartData.map((entry, index) => {
                                    const isActive = !currentSelection || !xField || entry[xField] === currentSelection;
                                    return (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={colors[0]}
                                            fillOpacity={isActive ? 1 : 0.3}
                                            stroke={isActive && currentSelection ? 'white' : 'none'}
                                            strokeWidth={2}
                                        />
                                    );
                                })}
                                {shouldRenderDataLabels && (
                                    <LabelList
                                        dataKey={yField}
                                        position={isHorizontal ? "right" : (lineSeries.length > 0 ? "insideTop" : "top")}
                                        dy={!isHorizontal && lineSeries.length > 0 ? 8 : 0}
                                        fill="#94a3b8"
                                        fontSize={10}
                                        formatter={(val: any, _name: any, labelProps: any) => {
                                            const selectedFormat = getAdaptiveNumericFormat(widget.valueFormat);
                                            const formatted = formatSmartDataLabel(val, widget.labelFormat || selectedFormat || 'compact', { maxLength: 10 });
                                            const category = resolveCategoryLabel(labelProps?.payload);
                                            return renderLabelText(widget.labelMode, formatted, category);
                                        }}
                                    />
                                )}
                            </Bar>
                        )}

                        {lineSeries.length > 0 && (
                            lineSeries.map((ls, idx) => {
                                const config = widget.lineAxisConfigs?.find(c => c.field === ls);
                                const yAxisId = config?.yAxisId || 'left';
                                const axisProps = isHorizontal ? { xAxisId: yAxisId } : { yAxisId: yAxisId };
                                const color = colors[(series.length + idx) % colors.length];

                                return (
                                    <Line
                                        key={ls}
                                        dataKey={ls}
                                        name={ls}
                                        {...axisProps}
                                        isAnimationActive={false}
                                        stroke={color}
                                        strokeWidth={2}
                                        // Dim line dots if not active
                                        dot={(props: any) => {
                                            const { cx, cy, payload } = props;
                                            const isActive = !currentSelection || !xField || payload[xField] === currentSelection;
                                            return (
                                                <circle
                                                    cx={cx}
                                                    cy={cy}
                                                    r={4}
                                                    fill={color}
                                                    opacity={isActive ? 1 : 0.3}
                                                    pointerEvents="none"
                                                />
                                            );
                                        }}
                                        activeDot={{ r: 6 }}
                                        onClick={(e: any) => handleBarClick(e.payload)}
                                        cursor="pointer"
                                    >
                                        {shouldRenderDataLabels && (
                                            <LabelList
                                                dataKey={ls}
                                                position="top"
                                                dy={-12}
                                                fill="#94a3b8"
                                                fontSize={10}
                                                formatter={(val: any, _name: any, labelProps: any) => {
                                                    const formatted = formatSmartDataLabel(val, widget.labelFormat || getAdaptiveNumericFormat(config?.format || widget.valueFormat) || 'compact', { maxLength: 10 });
                                                    const category = resolveCategoryLabel(labelProps?.payload);
                                                    return renderLabelText(widget.labelMode, formatted, category);
                                                }}
                                            />
                                        )}
                                    </Line>
                                );
                            })
                        )}
                    </ComposedChart>
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
        </BaseWidget>
    );
};

export default BarChartWidget;
