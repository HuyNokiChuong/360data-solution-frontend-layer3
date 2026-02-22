
import React, { useState, useEffect, useRef } from 'react';
import { BIWidget } from '../types';
import { useDashboardStore } from '../store/dashboardStore';

interface ChartLegendProps {
    payload?: any[];
    widget: BIWidget;
    layout?: 'horizontal' | 'vertical';
    align?: 'left' | 'center' | 'right';
    fontSize?: string;
}

type MeasureConfig = NonNullable<BIWidget['yAxisConfigs']>[number];

const normalizeToken = (value: string | null | undefined): string => {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[`"]/g, '');
};

const stripAggregationCall = (value: string): string => {
    return value.replace(/^(sum|avg|min|max|count|countdistinct|none)\((.+)\)$/i, '$2');
};

const stripAggregationSuffix = (value: string): string => {
    return value.replace(/__(sum|avg|min|max|count|countdistinct|none)$/i, '');
};

const getMatchScore = (candidate: string | null | undefined, target: string | null | undefined): number => {
    const cNorm = normalizeToken(candidate);
    const tNorm = normalizeToken(target);
    if (!cNorm || !tNorm) return 0;
    if (cNorm === tNorm) return 4;

    const cWithoutCall = stripAggregationCall(cNorm);
    const tWithoutCall = stripAggregationCall(tNorm);
    if (cWithoutCall === tWithoutCall) return 3;

    const cWithoutAgg = stripAggregationSuffix(cWithoutCall);
    const tWithoutAgg = stripAggregationSuffix(tWithoutCall);
    if (
        cWithoutAgg === tWithoutAgg ||
        cWithoutAgg.endsWith(`.${tWithoutAgg}`) ||
        tWithoutAgg.endsWith(`.${cWithoutAgg}`)
    ) {
        return 2;
    }

    const cTail = cWithoutAgg.split('.').pop();
    const tTail = tWithoutAgg.split('.').pop();
    if (cTail && tTail && cTail === tTail) return 1;

    return 0;
};

const getDefaultMeasureName = (
    config: MeasureConfig,
    currentConfigs?: MeasureConfig[],
    oppositeConfigs?: MeasureConfig[]
): string => {
    const sameFieldCount =
        (currentConfigs?.filter((entry) => entry.field === config.field).length || 0) +
        (oppositeConfigs?.filter((entry) => entry.field === config.field).length || 0);

    if (sameFieldCount > 1) {
        return `${(config.aggregation || 'sum').toUpperCase()}(${config.field})`;
    }
    return config.field;
};

const getConfigCandidates = (
    config: MeasureConfig,
    currentConfigs?: MeasureConfig[],
    oppositeConfigs?: MeasureConfig[]
): string[] => {
    const defaultName = getDefaultMeasureName(config, currentConfigs, oppositeConfigs);
    const aggregation = String(config.aggregation || 'sum').toLowerCase();
    const aggregationCall = `${String(config.aggregation || 'sum').toUpperCase()}(${config.field})`;

    return [
        config.alias || '',
        config.field || '',
        defaultName,
        `${config.field}__${aggregation}`,
        aggregationCall
    ].filter(Boolean);
};

const configMatchesTarget = (
    config: MeasureConfig,
    targetId: string,
    currentConfigs?: MeasureConfig[],
    oppositeConfigs?: MeasureConfig[]
): boolean => {
    const candidates = getConfigCandidates(config, currentConfigs, oppositeConfigs);
    return candidates.some((candidate) => getMatchScore(candidate, targetId) >= 2);
};

const resolveEntryId = (entry: any): string => String(entry?.dataKey ?? entry?.value ?? '');

const ChartLegend: React.FC<ChartLegendProps> = ({ payload, widget, layout = 'horizontal', align = 'center', fontSize = '10px' }) => {
    const { updateWidget, activeDashboardId } = useDashboardStore();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editingId]);

    const resolveDisplayValue = (entry: any): string => {
        const entryId = resolveEntryId(entry);

        const matchedBarConfig = (widget.yAxisConfigs || []).find((config) =>
            configMatchesTarget(config, entryId, widget.yAxisConfigs, widget.lineAxisConfigs)
        );
        if (matchedBarConfig?.alias?.trim()) return matchedBarConfig.alias.trim();

        const matchedLineConfig = (widget.lineAxisConfigs || []).find((config) =>
            configMatchesTarget(config, entryId, widget.lineAxisConfigs, widget.yAxisConfigs)
        );
        if (matchedLineConfig?.alias?.trim()) return matchedLineConfig.alias.trim();

        if (widget.legendAliases?.[entryId]) return widget.legendAliases[entryId];

        const rawValue = String(entry?.value ?? entryId);
        if (widget.legendAliases?.[rawValue]) return widget.legendAliases[rawValue];

        return rawValue;
    };

    if (!payload || payload.length === 0) return null;

    const handleDoubleClick = (item: any) => {
        const entryId = resolveEntryId(item);
        setEditingId(entryId);
        setEditValue(resolveDisplayValue(item));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if ((e.nativeEvent as any)?.isComposing) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            saveEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setEditingId(null);
        }
    };

    const saveEdit = () => {
        if (!activeDashboardId || !editingId) {
            setEditingId(null);
            return;
        }

        const nextAlias = editValue.trim();
        if (!nextAlias) {
            setEditingId(null);
            return;
        }

        const updatedBarConfigs = widget.yAxisConfigs?.map((config) => {
            if (configMatchesTarget(config, editingId, widget.yAxisConfigs, widget.lineAxisConfigs)) {
                return { ...config, alias: nextAlias };
            }
            return config;
        });
        const updatedLineConfigs = widget.lineAxisConfigs?.map((config) => {
            if (configMatchesTarget(config, editingId, widget.lineAxisConfigs, widget.yAxisConfigs)) {
                return { ...config, alias: nextAlias };
            }
            return config;
        });

        const hasBarConfigMatch = (updatedBarConfigs || []).some((config, index) => {
            return config.alias !== widget.yAxisConfigs?.[index]?.alias;
        });
        const hasLineConfigMatch = (updatedLineConfigs || []).some((config, index) => {
            return config.alias !== widget.lineAxisConfigs?.[index]?.alias;
        });

        if (hasBarConfigMatch || hasLineConfigMatch) {
            updateWidget(activeDashboardId, widget.id, {
                ...(hasBarConfigMatch ? { yAxisConfigs: updatedBarConfigs } : {}),
                ...(hasLineConfigMatch ? { lineAxisConfigs: updatedLineConfigs } : {})
            });
            setEditingId(null);
            return;
        }

        const singleMeasureField = widget.yAxis?.[0] || widget.measures?.[0];
        if (singleMeasureField && getMatchScore(singleMeasureField, editingId) >= 2) {
            updateWidget(activeDashboardId, widget.id, {
                yAxisConfigs: [{
                    field: singleMeasureField,
                    aggregation: widget.aggregation || 'sum',
                    alias: nextAlias
                }]
            });
            setEditingId(null);
            return;
        }

        const originalLegendValue =
            Object.entries(widget.legendAliases || {}).find(([key, value]) =>
                getMatchScore(value, editingId) >= 2 || getMatchScore(key, editingId) >= 2
            )?.[0] || editingId;

        updateWidget(activeDashboardId, widget.id, {
            legendAliases: {
                ...(widget.legendAliases || {}),
                [originalLegendValue]: nextAlias
            }
        });
        setEditingId(null);
    };

    const containerStyle: React.CSSProperties = {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: align === 'center' ? 'center' : (align === 'right' ? 'flex-end' : 'flex-start'),
        flexDirection: layout === 'vertical' ? 'column' : 'row',
        gap: '4px 8px',
        padding: '4px 0',
        fontSize: `calc(${fontSize} - 1px)`,
        fontFamily: widget.fontFamily || 'Outfit',
        maxWidth: '100%',
        margin: '0 auto'
    };

    return (
        <div style={containerStyle} className="recharts-default-legend">
            {payload.map((entry, index) => {
                const entryId = resolveEntryId(entry);
                const displayValue = resolveDisplayValue(entry);
                const isEditing = editingId === entryId;

                return (
                    <div
                        key={`legend-item-${index}`}
                        className="flex items-center gap-1.5 py-0.5 px-2 rounded-full transition-all hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer hover:shadow-[0_0_8px_rgba(0,0,0,0.05)] dark:hover:shadow-[0_0_8px_rgba(255,255,255,0.05)]"
                        onDoubleClick={() => handleDoubleClick(entry)}
                        title="Double click to rename"
                    >
                        <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: entry.color }}
                        />
                        {isEditing ? (
                            <input
                                ref={inputRef}
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                onBlur={saveEdit}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-indigo-500 rounded px-1 py-0.5 outline-none w-24 h-5"
                                style={{ fontSize }}
                            />
                        ) : (
                            <span
                                className="text-slate-600 dark:text-slate-300 font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]"
                                style={{ fontSize }}
                                title={displayValue}
                            >
                                {displayValue}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default ChartLegend;
