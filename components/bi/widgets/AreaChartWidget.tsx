import React, { useMemo } from 'react';
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

    const drillDownState = drillDowns[widget.id];
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
                series,
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

    // Colors
    const { chartColors } = useChartColors();
    const colors = widget.colors || chartColors;
    const isFiltered = isWidgetFiltered(widget.id) || (drillDownState && drillDownState.currentLevel > 0);
    const shouldRenderDataLabels = widget.showLabels !== false && effectiveChartData.length <= 40;

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

    if (series.length === 0) {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} loading={isLoading} error={error || undefined} onClick={onClick}>
                <EmptyChartState type="area" message="Select Y-Axis field" onClickDataTab={onClickDataTab} onClick={onClick} />
            </BaseWidget>
        );
    }

    if (effectiveChartData.length === 0) {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} loading={isLoading} error={error || undefined} onClick={onClick}>
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
        >
            <div className="w-full h-full" onContextMenu={handleContextMenu}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={effectiveChartData}
                        margin={{ top: 20, right: 30, left: 0, bottom: bottomMargin }}
                        onClick={(e: any) => e && e.activePayload && handleAreaClick(e.activePayload[0].payload)}
                    >
                        <defs>
                            {series.map((s, i) => {
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
                            tick={<HierarchicalAxisTick data={effectiveChartData} fontFamily={widget.fontFamily || 'Outfit'} />}
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
                                wrapperStyle={hasBottomLegend ? { paddingTop: 8 } : undefined}
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

                        {series.map((sField, idx) => {
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
                            const dataPoint = effectiveChartData[hl.index];
                            if (!dataPoint) return null;
                            const xValue = dataPoint[selectionField];
                            const yValue = hl.value || dataPoint[series[0]];
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
