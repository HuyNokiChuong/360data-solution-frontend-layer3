import React, { useCallback, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot, Label, ReferenceLine, LabelList } from 'recharts';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDirectQuery } from '../hooks/useDirectQuery';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import CustomTooltip from './CustomTooltip';
import EmptyChartState from './EmptyChartState';
import { DrillDownService } from '../engine/DrillDownService';
import { useChartColors } from '../utils/chartColors';
import { formatBIValue, formatSmartDataLabel, getAdaptiveNumericFormat } from '../engine/utils';
import ChartLegend from './ChartLegend';
import { HierarchicalAxisTick } from './HierarchicalAxisTick';
import { exportRowsToExcel } from '../utils/widgetExcelExport';

interface AreaChartWidgetProps {
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

const AreaChartWidget: React.FC<AreaChartWidgetProps> = ({
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
    const { getDataSource } = useDataStore();
    const { crossFilters: allDashboardFilters, isWidgetFiltered } = useFilterStore();
    const drillDowns = useFilterStore(state => state.drillDowns);
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));

    const drillDownState = useMemo(() => {
        const runtimeState = drillDowns[widget.id];
        const persistedState = widget.drillDownState || null;
        return DrillDownService.resolveStateForWidget(widget, runtimeState || persistedState || undefined);
    }, [widget, drillDowns[widget.id], widget.drillDownState]);
    const xFields = DrillDownService.getCurrentFields(widget, drillDownState);
    const xField = xFields[0] || '';

    const { chartData, series, isLoading, error } = useDirectQuery(widget);

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
                xField,
                chartData,
                effectiveSeries,
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
        if (drillDownState?.mode === 'expand' && xFields.length > 1) return '_combinedAxis';
        if (chartData.length > 0 && chartData[0]._formattedAxis) return '_formattedAxis';
        if (!xField) return '_autoCategory';
        return xField;
    }, [drillDownState?.mode, xFields.length, chartData, xField]);
    const selectionField = xField || xFieldDisplay;

    const effectiveChartData = useMemo(() => {
        if (xField) return chartData;
        return chartData.map((row) => ({
            ...row,
            _autoCategory: row._autoCategory || 'Total'
        }));
    }, [chartData, xField]);

    const configuredMeasureKeys = useMemo(() => {
        const keys = new Set<string>();
        const add = (value?: string) => {
            const normalized = String(value || '').trim();
            if (normalized) keys.add(normalized);
        };

        (widget.yAxisConfigs || []).forEach((config) => add(config.field));
        (widget.yAxis || []).forEach((field) => add(field));
        (widget.values || []).forEach((field) => add(field));
        (widget.measures || []).forEach((field) => add(field));
        (series || []).forEach((field) => add(field));

        return keys;
    }, [widget.yAxisConfigs, widget.yAxis, widget.values, widget.measures, series]);

    const detectedLegendSeries = useMemo(() => {
        if (!widget.legend || effectiveChartData.length === 0) return [];

        const blockedKeys = new Set<string>([
            '_formattedAxis',
            '_combinedAxis',
            '_rawAxisValue',
            '_autoCategory',
            String(widget.legend || '').trim(),
            String(xField || '').trim(),
            String(xFieldDisplay || '').trim(),
            ...xFields.map((field) => String(field || '').trim()).filter(Boolean)
        ]);

        const stats = new Map<string, { hasNonZero: boolean; absTotal: number }>();
        effectiveChartData.forEach((row) => {
            Object.entries(row || {}).forEach(([key, rawValue]) => {
                const normalizedKey = String(key || '').trim();
                if (!normalizedKey) return;
                if (normalizedKey.startsWith('_')) return;
                if (blockedKeys.has(normalizedKey)) return;
                if (configuredMeasureKeys.has(normalizedKey)) return;

                const numeric = Number(rawValue);
                if (!Number.isFinite(numeric)) return;

                const current = stats.get(normalizedKey) || { hasNonZero: false, absTotal: 0 };
                if (numeric !== 0) current.hasNonZero = true;
                current.absTotal += Math.abs(numeric);
                stats.set(normalizedKey, current);
            });
        });

        return Array.from(stats.entries())
            .filter(([, stat]) => stat.hasNonZero && stat.absTotal > 0)
            .sort((a, b) => b[1].absTotal - a[1].absTotal)
            .map(([key]) => key);
    }, [widget.legend, effectiveChartData, configuredMeasureKeys, xField, xFieldDisplay, xFields]);

    const effectiveSeries = useMemo(() => {
        const sanitize = (items: string[]) =>
            items
                .map((item) => String(item || '').trim())
                .filter((item) => item.length > 0 && !item.startsWith('_'));

        if (widget.legend && detectedLegendSeries.length > 0) {
            return sanitize(detectedLegendSeries);
        }

        return sanitize(series || []);
    }, [widget.legend, detectedLegendSeries, series]);

    const renderChartData = useMemo(() => {
        const shouldFallbackAggregate =
            !!widget.legend &&
            detectedLegendSeries.length === 0 &&
            effectiveSeries.length === 1 &&
            effectiveChartData.length > 0;

        if (!shouldFallbackAggregate) return effectiveChartData;

        const axisKey = xFieldDisplay || xField || '_autoCategory';
        const seriesKey = effectiveSeries[0];
        const grouped = new Map<string, any>();

        effectiveChartData.forEach((row) => {
            const axisValue = row?.[axisKey] ?? row?.[xField] ?? row?._autoCategory ?? '(Blank)';
            const mapKey = String(axisValue);
            const currentValue = Number(row?.[seriesKey]) || 0;

            if (!grouped.has(mapKey)) {
                grouped.set(mapKey, {
                    ...row,
                    [axisKey]: axisValue,
                    [seriesKey]: currentValue
                });
                return;
            }

            const existing = grouped.get(mapKey);
            existing[seriesKey] = (Number(existing?.[seriesKey]) || 0) + currentValue;
        });

        return Array.from(grouped.values());
    }, [widget.legend, detectedLegendSeries.length, effectiveSeries, effectiveChartData, xFieldDisplay, xField]);

    // Colors
    const { chartColors } = useChartColors();
    const colors = widget.colors || chartColors;
    const isFiltered = isWidgetFiltered(widget.id) || (drillDownState && drillDownState.currentLevel > 0);
    const shouldRenderDataLabels = widget.showLabels !== false && renderChartData.length <= 40;

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
            ...effectiveSeries
        ];
        return Array.from(new Set(configured.filter(Boolean)));
    }, [widget.yAxisConfigs, widget.yAxis, widget.values, widget.measures, effectiveSeries]);

    const exportFields = useMemo(() => {
        return [...categoryFields, ...measureFields].map((field) => ({ field }));
    }, [categoryFields, measureFields]);

    const handleExportExcel = useCallback(() => {
        exportRowsToExcel({
            title: widget.title || 'Area Chart',
            rows: renderChartData as Record<string, any>[],
            fields: exportFields
        });
    }, [widget.title, renderChartData, exportFields]);

    const handleAreaClick = (data: any) => {
        if (onDataClick && widget.enableCrossFilter !== false) {
            onDataClick(data);
        }
    };

    const currentSelection = useMemo(() => {
        const cf = allDashboardFilters.find(f => f.sourceWidgetId === widget.id);
        if (!cf) return undefined;
        return cf.filters.find(f => f.field === xField)?.value;
    }, [allDashboardFilters, widget.id, xField]);

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
        return renderChartData.reduce((maxDepth, row) => {
            const raw = row?._combinedAxis || row?._formattedAxis || row?.[xFieldDisplay] || '';
            const depth = String(raw).split('\n').filter(Boolean).length || 1;
            return Math.max(maxDepth, depth);
        }, 1);
    }, [drillDownState?.mode, renderChartData, xFieldDisplay]);

    const hasBottomLegend = widget.showLegend !== false && (!widget.legendPosition || widget.legendPosition === 'bottom');
    const xAxisHeight = hierarchyDepth <= 1 ? 30 : Math.min(72, 16 + hierarchyDepth * 12);
    const legendItemCount = useMemo(() => Math.max(1, effectiveSeries.length || 1), [effectiveSeries]);
    const legendRows = hasBottomLegend ? Math.max(1, Math.ceil(legendItemCount / 4)) : 0;
    const legendHeight = hasBottomLegend ? (legendRows * 18 + 8) : 0;
    const bottomMargin = hasBottomLegend
        ? Math.max(xAxisHeight + legendHeight + 6, 24 + legendHeight)
        : Math.max(14, xAxisHeight - 10);

    const hasBlankCategory = useMemo(() => {
        return renderChartData.some((row) => {
            const raw = row?.[xFieldDisplay];
            if (raw === null || raw === undefined) return true;
            const text = String(raw).trim().toLowerCase();
            return text === '' || text === '(blank)' || text === 'null' || text === 'undefined' || text === 'nan';
        });
    }, [renderChartData, xFieldDisplay]);

    const xAxisInterval = ((drillDownState?.mode === 'expand' || hasBlankCategory) ? 0 : 'auto') as any;

    if (effectiveSeries.length === 0) {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} loading={isLoading} error={error || undefined} onClick={onClick} onExportExcel={handleExportExcel}>
                <EmptyChartState type="area" message="Select Y-Axis field" onClickDataTab={onClickDataTab} onClick={onClick} />
            </BaseWidget>
        );
    }

    if (renderChartData.length === 0) {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} loading={isLoading} error={error || undefined} onClick={onClick} onExportExcel={handleExportExcel}>
                <EmptyChartState type="area" message="No data available" onClickDataTab={onClickDataTab} onClick={onClick} />
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
                    <AreaChart
                        data={renderChartData}
                        margin={{ top: 20, right: 30, left: 0, bottom: bottomMargin }}
                        onClick={(e: any) => e && e.activePayload && handleAreaClick(e.activePayload[0].payload)}
                    >
                        <defs>
                            {effectiveSeries.map((s, i) => {
                                const safeId = `color-${s.replace(/[^a-zA-Z0-9]/g, '_')}`;
                                return (
                                    <linearGradient key={`gradient-${i}`} id={safeId} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={colors[i % colors.length]} stopOpacity={0.3} />
                                        <stop offset="95%" stopColor={colors[i % colors.length]} stopOpacity={0} />
                                    </linearGradient>
                                );
                            })}
                        </defs>
                        {widget.showGrid !== false && <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={true} horizontal={true} />}
                        <XAxis
                            dataKey={xFieldDisplay}
                            stroke="#94a3b8"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            interval={xAxisInterval}
                            tick={<HierarchicalAxisTick data={renderChartData} fontFamily={widget.fontFamily || 'Outfit'} />}
                            height={xAxisHeight}
                            fontFamily={widget.fontFamily || 'Outfit'}
                        />
                        <YAxis
                            stroke="#94a3b8"
                            tickFormatter={(val) => {
                                const overrideFormats = ['standard', 'float_1', 'float_2', 'float_3', 'float_4', 'integer'];
                                const format = (!widget.valueFormat || overrideFormats.includes(widget.valueFormat)) ? 'smart_axis' : widget.valueFormat;
                                return formatBIValue(val, format);
                            }}
                            style={{ fontSize: widget.fontSize ? `${Math.max(8, widget.fontSize - 2)}px` : '11px', fontFamily: widget.fontFamily || 'Outfit' }}
                            width={80}
                        />
                        <Tooltip
                            content={<CustomTooltip
                                aggregation={widget.aggregation}
                                valueFormat={widget.valueFormat || 'standard'}
                                configs={widget.yAxisConfigs || []}
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
                                wrapperStyle={hasBottomLegend ? { paddingTop: legendRows > 1 ? 8 : 4 } : undefined}
                            />
                        )}

                        {currentSelection && (
                            <ReferenceLine
                                x={currentSelection}
                                stroke="white"
                                strokeDasharray="3 3"
                                strokeOpacity={0.5}
                            />
                        )}

                        {effectiveSeries.map((sField, idx) => {
                            const safeId = `color-${sField.replace(/[^a-zA-Z0-9]/g, '_')}`;
                            const color = colors[idx % colors.length];

                            return (
                                <Area
                                    key={sField}
                                    type="monotone"
                                    dataKey={sField}
                                    isAnimationActive={false}
                                    stroke={color}
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill={`url(#${safeId})`}
                                    onClick={(e: any) => handleAreaClick(e.payload)}
                                    // Add dots to show selection
                                    activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
                                    dot={(dotProps: any) => {
                                        const { cx, cy, payload } = dotProps;
                                        if (!cx || !cy) return null;

                                        // Only show dots if selected or if hovering (but hover is handled by activeDot)
                                        // Here we show dots ONLY for the selected item to avoid clutter, 
                                        // or show all but dim specific ones?
                                        // Area charts usually don't have dots. Let's only show the dot for the SELECTED item.

                                        if (currentSelection && payload[selectionField] === currentSelection) {
                                            return (
                                                <circle
                                                    cx={cx}
                                                    cy={cy}
                                                    r={5}
                                                    fill={color}
                                                    stroke="#fff"
                                                    strokeWidth={2}
                                                />
                                            );
                                        }
                                        return null;
                                    }}
                                >
                                    {shouldRenderDataLabels && (
                                        <LabelList
                                            dataKey={sField}
                                            position="top"
                                            formatter={(val: any, _name: any, labelProps: any) => {
                                                const formatted = formatSmartDataLabel(val, widget.labelFormat || getAdaptiveNumericFormat(widget.valueFormat), { maxLength: 10 });
                                                const category = resolveCategoryLabel(labelProps?.payload);
                                                return renderLabelText(widget.labelMode, formatted, category);
                                            }}
                                            fill="#94a3b8"
                                            fontSize={10}
                                            style={{ fontFamily: widget.fontFamily || 'Outfit' }}
                                        />
                                    )}
                                </Area>
                            );
                        })}

                        {/* Render Highlights */}
                        {widget.insight?.highlight?.map((hl, i) => {
                            const dataPoint = renderChartData[hl.index];
                            if (!dataPoint) return null;
                            const xValue = dataPoint[selectionField];
                            const yValue = hl.value || dataPoint[effectiveSeries[0]];
                            let hlColor = '#facc15';
                            if (hl.type === 'peak') hlColor = '#10b981';
                            if (hl.type === 'drop') hlColor = '#ef4444';
                            return (
                                <ReferenceDot
                                    key={`hl-${i}`}
                                    x={xValue}
                                    y={yValue}
                                    r={6}
                                    fill={hlColor}
                                    stroke="#fff"
                                    strokeWidth={2}
                                >
                                    <Label value={hl.label} position="top" fill="#fff" style={{ fontSize: '10px', fontWeight: 'bold' }} />
                                </ReferenceDot>
                            );
                        })}
                    </AreaChart>
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
            </div>        </BaseWidget>
    );
};

export default AreaChartWidget;
