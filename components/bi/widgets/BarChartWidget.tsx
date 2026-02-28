// ============================================
// Bar Chart Widget
// ============================================

import React, { useCallback, useMemo } from 'react';
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
import { exportRowsToExcel } from '../utils/widgetExcelExport';
import { findSourceSelectionFilter, isPayloadSelected } from '../utils/crossFilterSelection';

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
import { useLanguageStore } from '../../../store/languageStore';

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
    const { language } = useLanguageStore();
    const { getDataSource } = useDataStore();
    const { crossFilters: allDashboardFilters, getFiltersForWidget, isWidgetFiltered, setDrillDown } = useFilterStore();
    const drillDowns = useFilterStore(state => state.drillDowns);
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));

    const drillDownState = useMemo(() => {
        const runtimeState = drillDowns[widget.id];
        const persistedState = widget.drillDownState || null;
        return DrillDownService.resolveStateForWidget(widget, runtimeState || persistedState || undefined);
    }, [widget, drillDowns[widget.id], widget.drillDownState]);
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

    const hasBottomLegend = widget.showLegend !== false && (!widget.legendPosition || widget.legendPosition === 'bottom');
    const xAxisHeight = hierarchyDepth <= 1 ? 30 : Math.min(72, 16 + hierarchyDepth * 12);
    const legendItemCount = useMemo(() => {
        const count = Array.from(new Set([...series, ...lineSeries].filter(Boolean))).length;
        return Math.max(1, count);
    }, [series, lineSeries]);
    const legendRows = hasBottomLegend ? Math.max(1, Math.ceil(legendItemCount / 4)) : 0;
    const legendHeight = hasBottomLegend ? (legendRows * 18 + 8) : 0;
    const bottomMarginBase = hierarchyDepth <= 1 ? 10 : 14;
    const bottomMargin = hasBottomLegend
        ? Math.max(xAxisHeight + legendHeight + 6, bottomMarginBase + legendHeight)
        : Math.max(bottomMarginBase, xAxisHeight - 10);

    const hasBlankCategory = useMemo(() => {
        return effectiveChartData.some((row) => {
            const raw = row?.[xFieldDisplay];
            if (raw === null || raw === undefined) return true;
            const text = String(raw).trim().toLowerCase();
            return text === '' || text === '(blank)' || text === 'null' || text === 'undefined' || text === 'nan';
        });
    }, [effectiveChartData, xFieldDisplay]);

    const xAxisInterval = ((drillDownState?.mode === 'expand' || hasBlankCategory) ? 0 : 'auto') as any;

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

    const categoryFields = useMemo(() => {
        const fromAxis = xFields.filter(Boolean);
        const base = fromAxis.length > 0 ? fromAxis : (widget.xAxis ? [widget.xAxis] : []);
        const withLegend = widget.legend ? [...base, widget.legend] : base;
        return Array.from(new Set(withLegend.filter(Boolean)));
    }, [xFields, widget.xAxis, widget.legend]);

    const measureFields = useMemo(() => {
        const configured = [
            ...(widget.yAxisConfigs || []).map((config) => config.field),
            ...(widget.yAxis || []),
            ...(widget.values || []),
            ...(widget.measures || []),
            ...(widget.lineAxisConfigs || []).map((config) => config.field),
            ...series,
            ...lineSeries
        ];
        return Array.from(new Set(configured.filter(Boolean)));
    }, [widget.yAxisConfigs, widget.yAxis, widget.values, widget.measures, widget.lineAxisConfigs, series, lineSeries]);

    const exportFields = useMemo(() => {
        return [...categoryFields, ...measureFields].map((field) => ({ field }));
    }, [categoryFields, measureFields]);

    const handleExportExcel = useCallback(() => {
        exportRowsToExcel({
            title: widget.title || 'Bar Chart',
            rows: effectiveChartData as Record<string, any>[],
            fields: exportFields
        });
    }, [widget.title, effectiveChartData, exportFields]);

    const selectionFields = useMemo(() => {
        return Array.from(new Set([xFields[xFields.length - 1], xField, xFieldDisplay].filter(Boolean)));
    }, [xFields, xField, xFieldDisplay]);

    const currentSelectionFilter = useMemo(() => {
        return findSourceSelectionFilter(allDashboardFilters, widget.id, selectionFields);
    }, [allDashboardFilters, widget.id, selectionFields]);

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

    const renderBarDataLabel = (props: any, getText: (payload: any, value: any) => string) => {
        const { x, y, width, height, value, payload } = props;
        const text = getText(payload, value);
        if (!text) return null;

        if (isHorizontal) {
            const px = (x || 0) + (width || 0) + 6;
            const py = (y || 0) + (height || 0) / 2 + 3;
            return (
                <text
                    x={px}
                    y={py}
                    textAnchor="start"
                    fill="#e2e8f0"
                    fontSize={10}
                    fontWeight={700}
                    fontFamily={widget.fontFamily || 'Outfit'}
                    stroke="#020617"
                    strokeWidth={3}
                    paintOrder="stroke"
                    style={{ pointerEvents: 'none' }}
                >
                    {text}
                </text>
            );
        }

        const barHeight = Math.abs(height || 0);
        const isTinyBar = barHeight < 24;
        const px = (x || 0) + (width || 0) / 2;
        const py = isTinyBar ? (y || 0) - 6 : (y || 0) + 14;
        const fill = isTinyBar ? '#e2e8f0' : '#f8fafc';

        return (
            <text
                x={px}
                y={py}
                textAnchor="middle"
                fill={fill}
                fontSize={10}
                fontWeight={700}
                fontFamily={widget.fontFamily || 'Outfit'}
                stroke="#020617"
                strokeWidth={3}
                paintOrder="stroke"
                style={{ pointerEvents: 'none' }}
            >
                {text}
            </text>
        );
    };

    const renderLineDataLabel = (props: any, getText: (payload: any, value: any) => string) => {
        const { x, y, width, value, payload } = props;
        const text = getText(payload, value);
        if (!text) return null;
        const px = (x || 0) + (width || 0) / 2;
        const py = (y || 0) - 12;
        return (
            <text
                x={px}
                y={py}
                textAnchor="middle"
                fill="#fef08a"
                fontSize={10}
                fontWeight={700}
                fontFamily={widget.fontFamily || 'Outfit'}
                stroke="#020617"
                strokeWidth={3}
                paintOrder="stroke"
                style={{ pointerEvents: 'none' }}
            >
                {text}
            </text>
        );
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
                onExportExcel={handleExportExcel}
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
            onExportExcel={handleExportExcel}
        >
            <div className="w-full h-full" onContextMenu={handleContextMenu}>
                <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
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
                                            fontFamily={widget.fontFamily || 'Outfit'}
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
                                                fontFamily={widget.fontFamily || 'Outfit'}
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
                                            fontFamily={widget.fontFamily || 'Outfit'}
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
                                            interval={xAxisInterval}
                                            tick={<HierarchicalAxisTick data={effectiveChartData} fontFamily={widget.fontFamily || 'Outfit'} />}
                                            height={xAxisHeight}
                                            fontFamily={widget.fontFamily || 'Outfit'}
                                        />
                                        <YAxis
                                            yAxisId="left"
                                            type="number"
                                            stroke="#94a3b8"
                                            tickFormatter={(val) => formatBIValue(val, leftFormat)}
                                            style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px', fontFamily: widget.fontFamily || 'Outfit' }}
                                            width={80}
                                        />
                                        {hasRightAxis && (
                                            <YAxis
                                                yAxisId="right"
                                                orientation="right"
                                                stroke="#94a3b8"
                                                tickFormatter={(val) => formatBIValue(val, rightFormat)}
                                                style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px', fontFamily: widget.fontFamily || 'Outfit' }}
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
                                wrapperStyle={hasBottomLegend ? { paddingTop: legendRows > 1 ? 8 : 4 } : undefined}
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
                                            const isActive = isPayloadSelected(entry, currentSelectionFilter, selectionFields);
                                            return (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={color}
                                                    fillOpacity={isActive ? 1 : 0.3}
                                                    stroke={isActive && currentSelectionFilter ? 'white' : 'none'}
                                                    strokeWidth={2}
                                                />
                                            );
                                        })}
                                        {shouldRenderDataLabels && (
                                            <LabelList
                                                dataKey={sField}
                                                position={isHorizontal ? "right" : (lineSeries.length > 0 ? "insideTop" : "top")}
                                                dy={!isHorizontal && lineSeries.length > 0 ? 8 : 0}
                                                content={(labelProps: any) => renderBarDataLabel(labelProps, (payload: any, val: any) => {
                                                    const formatted = formatSmartDataLabel(val, format, { maxLength: 10 });
                                                    const category = resolveCategoryLabel(payload);
                                                    return renderLabelText(widget.labelMode, formatted, category);
                                                })}
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
                                    const isActive = isPayloadSelected(entry, currentSelectionFilter, selectionFields);
                                    return (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={colors[0]}
                                            fillOpacity={isActive ? 1 : 0.3}
                                            stroke={isActive && currentSelectionFilter ? 'white' : 'none'}
                                            strokeWidth={2}
                                        />
                                    );
                                })}
                                {shouldRenderDataLabels && (
                                    <LabelList
                                        dataKey={yField}
                                        position={isHorizontal ? "right" : (lineSeries.length > 0 ? "insideTop" : "top")}
                                        dy={!isHorizontal && lineSeries.length > 0 ? 8 : 0}
                                        content={(labelProps: any) => renderBarDataLabel(labelProps, (payload: any, val: any) => {
                                            const selectedFormat = getAdaptiveNumericFormat(widget.valueFormat);
                                            const formatted = formatSmartDataLabel(val, widget.labelFormat || selectedFormat || 'compact', { maxLength: 10 });
                                            const category = resolveCategoryLabel(payload);
                                            return renderLabelText(widget.labelMode, formatted, category);
                                        })}
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
                                            const isActive = isPayloadSelected(payload, currentSelectionFilter, selectionFields);
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
                                                content={(labelProps: any) => renderLineDataLabel(labelProps, (payload: any, val: any) => {
                                                    const formatted = formatSmartDataLabel(val, widget.labelFormat || getAdaptiveNumericFormat(config?.format || widget.valueFormat) || 'compact', { maxLength: 10 });
                                                    const category = resolveCategoryLabel(payload);
                                                    return renderLabelText(widget.labelMode, formatted, category);
                                                })}
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
        </BaseWidget>
    );
};

export default BarChartWidget;
