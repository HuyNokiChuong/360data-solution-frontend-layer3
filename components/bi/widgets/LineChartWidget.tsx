// ============================================
// Line Chart Widget
// ============================================

import React, { useMemo } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot, Label, LabelList } from 'recharts';
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
import { DrillDownState } from '../types';
import { useChartColors } from '../utils/chartColors';
import { formatBIValue, formatSmartDataLabel, getAdaptiveNumericFormat } from '../engine/utils';
import ChartLegend from './ChartLegend';
import { HierarchicalAxisTick } from './HierarchicalAxisTick';

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

import ChartContextMenu from './ChartContextMenu';
import AIAnalysisModal from '../modals/AIAnalysisModal';
import { analyzeChartTrend } from '../../../services/ai';

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
    const xFields = DrillDownService.getCurrentFields(widget, drillDownState);
    const xField = xFields[0] || '';

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

    // ... rest of the code


    // -------------------------

    const xFieldDisplay = useMemo(() => {
        if (drillDownState?.mode === 'expand' && xFields.length > 1) return '_combinedAxis';
        if (chartData.length > 0 && chartData[0]._formattedAxis) return '_formattedAxis';
        if (!xField) return '_autoCategory';
        return xField;
    }, [drillDownState?.mode, xFields.length, chartData, xField]);
    const selectionField = xField || xFieldDisplay;

    const yField = series[0] || '';

    const effectiveChartData = useMemo(() => {
        if (xField) return chartData;
        return chartData.map((row) => ({
            ...row,
            _autoCategory: row._autoCategory || 'Total'
        }));
    }, [chartData, xField]);

    // Colors
    const { chartColors } = useChartColors();
    const colors = widget.colors || chartColors;
    const isFiltered = isWidgetFiltered(widget.id) || (drillDownState && drillDownState.currentLevel > 0);

    // Handle dot click
    const handleDotClick = (data: any) => {
        // Only trigger cross-filter on click.
        // Drill-down is now exclusively handled by the toolbar buttons.
        if (onDataClick && widget.enableCrossFilter !== false) {
            onDataClick(data);
        }
    };


    const hasHierarchy = widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0;
    const shouldRenderDataLabels = widget.showLabels !== false && effectiveChartData.length <= 40;

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

    const hierarchyDepth = useMemo(() => {
        if (drillDownState?.mode !== 'expand') return 1;
        return effectiveChartData.reduce((maxDepth, row) => {
            const raw = row?._combinedAxis || row?._formattedAxis || row?.[xFieldDisplay] || '';
            const depth = String(raw).split('\n').filter(Boolean).length || 1;
            return Math.max(maxDepth, depth);
        }, 1);
    }, [drillDownState?.mode, effectiveChartData, xFieldDisplay]);

    const hasBottomLegend = widget.showLegend !== false && (!widget.legendPosition || widget.legendPosition === 'bottom');
    const xAxisHeight = hierarchyDepth <= 1 ? 30 : Math.min(96, 30 + hierarchyDepth * 16);
    const bottomMargin = hasBottomLegend
        ? Math.max(44, xAxisHeight + 26)
        : Math.max(14, xAxisHeight - 8);

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
                loading={isLoading}
                error={error || undefined}
                onClick={onClick}
            >
                <EmptyChartState type={widget.chartType || 'line'} message="Select X-Axis and Y-Axis fields" onClickDataTab={onClickDataTab} onClick={onClick} />
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
                loading={isLoading}
                error={error || undefined}
                onClick={onClick}
            >
                <EmptyChartState type={widget.chartType || 'line'} message="Select Y-Axis field" onClickDataTab={onClickDataTab} onClick={onClick} />
            </BaseWidget>
        );
    }

    if (effectiveChartData.length === 0) {
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
            loading={isLoading}
            error={error || undefined}
            onClick={onClick}
        >
            <div className="w-full h-full" onContextMenu={handleContextMenu}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        data={effectiveChartData}
                        margin={{ top: 20, right: 30, left: 0, bottom: bottomMargin }}
                        onClick={(e: any) => e && e.activePayload && handleDotClick(e.activePayload[0].payload)}
                    >
                        {widget.showGrid !== false && <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={true} horizontal={true} />}
                        <XAxis
                            dataKey={xFieldDisplay}
                            stroke="#94a3b8"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            interval={(drillDownState?.mode === 'expand' ? 0 : 'auto') as any}
                            tick={<HierarchicalAxisTick data={effectiveChartData} />}
                            height={xAxisHeight}
                            fontFamily="Outfit"
                        />
                        {(() => {
                            // Determine formats for axes based on first series assigned to them
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

                            return (
                                <>
                                    <YAxis
                                        yAxisId="left"
                                        stroke="#94a3b8"
                                        tickFormatter={(val) => formatBIValue(val, leftFormat)}
                                        style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px', fontFamily: 'Outfit' }}
                                        width={80}
                                    />
                                    {((widget.yAxisConfigs?.some(c => c.yAxisId === 'right')) || (widget.lineAxisConfigs?.some(c => c.yAxisId === 'right'))) && (
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
                        })()}
                        <Tooltip
                            content={<CustomTooltip
                                aggregation={widget.aggregation}
                                valueFormat={widget.valueFormat || 'standard'}
                                configs={[...(widget.yAxisConfigs || []), ...(widget.lineAxisConfigs || [])]}
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
                                    fontSize={widget.legendFontSize ? `${widget.legendFontSize}px` : (widget.fontSize ? `${Math.max(7, widget.fontSize - 3)}px` : '10px')}
                                />}
                                wrapperStyle={hasBottomLegend ? { paddingTop: 8 } : undefined}
                            />
                        )}

                        {series.length > 0 ? (
                            series.map((sField, idx) => {
                                const config = widget.yAxisConfigs?.[idx];
                                const yAxisId = config?.yAxisId || 'left';
                                const color = colors[idx % colors.length];
                                const seriesFormat = (config?.format && config.format !== 'standard' ? config.format : null) || widget.valueFormat || 'standard';
                                const format = widget.labelFormat || getAdaptiveNumericFormat(seriesFormat);

                                return (
                                    <Line
                                        key={sField}
                                        type="monotone"
                                        dataKey={sField}
                                        name={sField}
                                        yAxisId={yAxisId}
                                        isAnimationActive={false}
                                        stroke={color}
                                        strokeWidth={3}
                                        connectNulls={true}
                                        dot={(dotProps: any) => {
                                            const { cx, cy, payload } = dotProps;
                                            if (!cx || !cy) return null;
                                            const isItemSelected = !currentSelection || payload[selectionField] === currentSelection;
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
                                    >
                                        {shouldRenderDataLabels && (
                                            <LabelList
                                                dataKey={sField}
                                                position={idx % 2 === 0 ? "top" : "bottom"}
                                                dy={idx % 2 === 0 ? -6 : 6}
                                                fill="#94a3b8"
                                                fontSize={10}
                                                formatter={(val: any, _name: any, labelProps: any) => {
                                                    const formatted = formatSmartDataLabel(val, format, { maxLength: 10 });
                                                    const category = resolveCategoryLabel(labelProps?.payload);
                                                    return renderLabelText(widget.labelMode, formatted, category);
                                                }}
                                            />
                                        )}
                                    </Line>
                                );
                            })
                        ) : null}

                        {lineSeries.length > 0 && (
                            lineSeries.map((ls, idx) => {
                                const config = widget.lineAxisConfigs?.[idx];
                                const yAxisId = config?.yAxisId || 'right';
                                const color = colors[(series.length + idx) % colors.length];
                                const seriesFormat = (config?.format && config.format !== 'standard' ? config.format : null) || widget.valueFormat || 'standard';
                                const format = widget.labelFormat || getAdaptiveNumericFormat(seriesFormat);

                                return (
                                    <Line
                                        key={ls}
                                        type="monotone"
                                        dataKey={ls}
                                        name={ls}
                                        yAxisId={yAxisId}
                                        isAnimationActive={false}
                                        stroke={color}
                                        strokeWidth={3}
                                        connectNulls={true}
                                        dot={(dotProps: any) => {
                                            const { cx, cy, payload } = dotProps;
                                            if (!cx || !cy) return null;
                                            const isItemSelected = !currentSelection || payload[selectionField] === currentSelection;
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
                                    >
                                        {shouldRenderDataLabels && (
                                            <LabelList
                                                dataKey={ls}
                                                position={(series.length + idx) % 2 === 0 ? "top" : "bottom"}
                                                dy={(series.length + idx) % 2 === 0 ? -6 : 6}
                                                fill="#94a3b8"
                                                fontSize={10}
                                                formatter={(val: any, _name: any, labelProps: any) => {
                                                    const formatted = formatSmartDataLabel(val, format, { maxLength: 10 });
                                                    const category = resolveCategoryLabel(labelProps?.payload);
                                                    return renderLabelText(widget.labelMode, formatted, category);
                                                }}
                                            />
                                        )}
                                    </Line>
                                );
                            })
                        )}

                        {!series.length && !lineSeries.length && (
                            <Line
                                type="monotone"
                                dataKey={yField}
                                yAxisId="left"
                                isAnimationActive={false}
                                stroke={colors[0]}
                                strokeWidth={3}
                                connectNulls={true}
                                dot={(dotProps: any) => {
                                    const { cx, cy, payload } = dotProps;
                                    if (!cx || !cy) return null;
                                    const isItemSelected = !currentSelection || payload[selectionField] === currentSelection;
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
                            >
                                {shouldRenderDataLabels && (
                                    <LabelList
                                        dataKey={yField}
                                        position="top"
                                        fill="#94a3b8"
                                        fontSize={10}
                                        formatter={(val: any, _name: any, labelProps: any) => {
                                            const formatted = formatSmartDataLabel(val, widget.labelFormat || getAdaptiveNumericFormat(widget.valueFormat), { maxLength: 10 });
                                            const category = resolveCategoryLabel(labelProps?.payload);
                                            return renderLabelText(widget.labelMode, formatted, category);
                                        }}
                                    />
                                )}
                            </Line>
                        )}

                        {/* Render Highlights from Insight */}
                        {widget.insight?.highlight?.map((hl, i) => {
                            const dataPoint = effectiveChartData[hl.index];
                            if (!dataPoint) return null;

                            const xValue = dataPoint[selectionField];
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

export default LineChartWidget;
