
import React, { useState, useEffect, useRef } from 'react';
import { BIWidget, PivotValue } from '../types';
import { useDashboardStore } from '../store/dashboardStore';

interface ChartLegendProps {
    payload?: any[];
    widget: BIWidget;
    layout?: 'horizontal' | 'vertical';
    align?: 'left' | 'center' | 'right';
    fontSize?: string;
}

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

    if (!payload || payload.length === 0) return null;

    const handleDoubleClick = (item: any) => {
        // item.value is the current display name
        // item.dataKey is the data key
        setEditingId(item.dataKey || item.value);
        setEditValue(item.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            saveEdit();
        } else if (e.key === 'Escape') {
            setEditingId(null);
        }
    };

    const saveEdit = () => {
        if (!activeDashboardId || !editingId) return;

        const isLine = widget.lineAxisConfigs?.some(c => {
            const defaultName = widget.lineAxisConfigs!.filter(f => f.field === c.field).length + (widget.yAxisConfigs?.filter(f => f.field === c.field).length || 0) > 1
                ? `${c.aggregation.toUpperCase()}(${c.field})`
                : c.field;
            return c.alias === editingId || defaultName === editingId || c.field === editingId;
        });

        const isBar = widget.yAxisConfigs?.some(c => {
            const defaultName = widget.yAxisConfigs!.filter(f => f.field === c.field).length + (widget.lineAxisConfigs?.filter(f => f.field === c.field).length || 0) > 1
                ? `${c.aggregation.toUpperCase()}(${c.field})`
                : c.field;
            return c.alias === editingId || defaultName === editingId || c.field === editingId;
        });

        // Case 2: Multi-measures
        if (isBar || isLine) {
            if (isBar) {
                const newConfigs = widget.yAxisConfigs?.map(c => {
                    const count = widget.yAxisConfigs!.filter(f => f.field === c.field).length + (widget.lineAxisConfigs?.filter(f => f.field === c.field).length || 0);
                    const defaultName = count > 1 ? `${c.aggregation.toUpperCase()}(${c.field})` : c.field;
                    if (c.alias === editingId || defaultName === editingId || c.field === editingId) {
                        return { ...c, alias: editValue };
                    }
                    return c;
                });
                updateWidget(activeDashboardId, widget.id, { yAxisConfigs: newConfigs });
            } else {
                const newConfigs = widget.lineAxisConfigs?.map(c => {
                    const count = (widget.yAxisConfigs?.filter(f => f.field === c.field).length || 0) + widget.lineAxisConfigs!.filter(f => f.field === c.field).length;
                    const defaultName = count > 1 ? `${c.aggregation.toUpperCase()}(${c.field})` : c.field;
                    if (c.alias === editingId || defaultName === editingId || c.field === editingId) {
                        return { ...c, alias: editValue };
                    }
                    return c;
                });
                updateWidget(activeDashboardId, widget.id, { lineAxisConfigs: newConfigs });
            }
        }
        // Fallback for single measure with no config object
        else if ((widget.yAxis?.[0] || widget.measures?.[0]) === editingId) {
            const field = widget.yAxis?.[0] || widget.measures?.[0];
            updateWidget(activeDashboardId, widget.id, {
                yAxisConfigs: [{
                    field: field!,
                    aggregation: widget.aggregation || 'sum',
                    alias: editValue
                }]
            });
        }
        // Case 1: Categorical Legend (or single dimension like Pie)
        else {
            const originalValue = Object.entries(widget.legendAliases || {}).find(([k, v]) => v === editingId)?.[0] || editingId;
            updateWidget(activeDashboardId, widget.id, {
                legendAliases: {
                    ...(widget.legendAliases || {}),
                    [originalValue]: editValue
                }
            });
        }

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
        maxWidth: '100%',
        margin: '0 auto'
    };

    return (
        <div style={containerStyle} className="recharts-default-legend">
            {payload.map((entry, index) => {
                const isEditing = editingId === (entry.dataKey || entry.value);

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
                                className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-indigo-500 rounded px-1 py-0.5 outline-none w-24 h-5"
                                style={{ fontSize }}
                            />
                        ) : (
                            <span
                                className="text-slate-600 dark:text-slate-300 font-medium whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]"
                                style={{ fontSize }}
                                title={entry.value}
                            >
                                {entry.value}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default ChartLegend;
