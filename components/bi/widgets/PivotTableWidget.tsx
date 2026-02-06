
import React, { useMemo, useState, useEffect } from 'react';
import { BIWidget, ConditionalFormat, PivotValue } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { applyFilters } from '../engine/dataProcessing';
import { pivotData, formatValue } from '../engine/calculations';
import { useWidgetData } from '../hooks/useWidgetData';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import EmptyChartState from './EmptyChartState';
import { CHART_COLORS } from '../utils/chartColors';

interface PivotTableWidgetProps {
    widget: BIWidget;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    isSelected?: boolean;
    onClickDataTab?: () => void;
    onClick?: (e: React.MouseEvent) => void;
}

const checkCondition = (value: number, rule: ConditionalFormat) => {
    const numValue = Number(value);
    const target = Number(rule.value);
    const target2 = rule.value2 ? Number(rule.value2) : 0;

    if (isNaN(numValue)) return false;

    switch (rule.condition) {
        case 'greater': return numValue > target;
        case 'less': return numValue < target;
        case 'equal': return numValue === target;
        case 'between': return numValue >= target && numValue <= target2;
        default: return false;
    }
};

const PivotTableWidget: React.FC<PivotTableWidgetProps> = ({
    widget,
    onEdit,
    onDelete,
    onDuplicate,
    isSelected = false,
    onClickDataTab,
    onClick
}) => {
    const { crossFilters: allDashboardFilters, getCrossFiltersForWidget, isWidgetFiltered } = useFilterStore();
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));
    const widgetData = useWidgetData(widget);

    const isFiltered = isWidgetFiltered(widget.id);

    // Resizing State
    const [resizingConfig, setResizingConfig] = useState<{ colKey: string; startX: number; startWidth: number } | null>(null);
    const [tempWidths, setTempWidths] = useState<Record<string, number>>({});

    const getColWidth = (key: string, defaultW: number) => {
        if (typeof tempWidths[key] === 'number') return tempWidths[key];
        if (widget.columnWidths && typeof widget.columnWidths[key] === 'number') return widget.columnWidths[key];
        return defaultW;
    };

    const handleResizeStart = (e: React.MouseEvent, colKey: string, currentWidth: number) => {
        e.preventDefault();
        e.stopPropagation();
        setResizingConfig({ colKey, startX: e.clientX, startWidth: currentWidth });
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!resizingConfig) return;
            const diff = e.clientX - resizingConfig.startX;
            const newWidth = Math.max(50, resizingConfig.startWidth + diff);
            setTempWidths(prev => ({ ...prev, [resizingConfig.colKey]: newWidth }));
        };
        const handleMouseUp = () => {
            if (!resizingConfig) return;

            // Persist to store
            const finalWidth = tempWidths[resizingConfig.colKey];
            if (activeDashboard && finalWidth) {
                useDashboardStore.getState().updateWidget(activeDashboard.id, widget.id, {
                    columnWidths: { ...widget.columnWidths, [resizingConfig.colKey]: finalWidth }
                });
            }

            setResizingConfig(null);
            // We don't clear tempWidths immediately to prevent flicker before prop update
            // But to be clean we might want to sync. 
            // With strict React styles, relying on prop update is safer but slower. 
            // I'll keep tempWidths until prop takes over (re-render) will eventually satisfy getColWidth logic.
            setTempWidths({});
        };

        if (resizingConfig) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingConfig, tempWidths, widget, activeDashboard]);


    const { rowKeys, colKeys, dataMap, rowTotals, colTotals, grandTotal, error } = useMemo(() => {
        if (!widgetData || widgetData.length === 0) {
            return { rowKeys: [], colKeys: [], dataMap: {}, rowTotals: {}, colTotals: {}, grandTotal: {}, error: 'No data' };
        }

        if (!widget.pivotRows || widget.pivotRows.length === 0 || !widget.pivotValues || widget.pivotValues.length === 0) {
            return { rowKeys: [], colKeys: [], dataMap: {}, rowTotals: {}, colTotals: {}, grandTotal: {}, error: 'Fields not configured' };
        }

        try {
            let filteredData = widgetData;
            const crossFilters = getCrossFiltersForWidget(widget.id);

            if (crossFilters.length > 0) {
                filteredData = applyFilters(filteredData, crossFilters);
            }

            if (activeDashboard?.globalFilters?.length) {
                const relevantGlobal = activeDashboard.globalFilters.filter(gf =>
                    !gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)
                );
                if (relevantGlobal.length > 0) {
                    filteredData = applyFilters(filteredData, relevantGlobal as any[]);
                }
            }

            const result = pivotData(
                filteredData,
                widget.pivotRows || [],
                widget.pivotCols || [],
                widget.pivotValues || []
            );

            return { ...result, error: null };
        } catch (err: any) {
            return { rowKeys: [], colKeys: [], dataMap: {}, rowTotals: {}, colTotals: {}, grandTotal: {}, error: err.message };
        }
    }, [widget, widgetData, allDashboardFilters, activeDashboard?.globalFilters]);

    if (!widget.dataSourceId) {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} onClick={onClick}>
                <EmptyChartState type="table" message="Select data source" onClickDataTab={onClickDataTab} />
            </BaseWidget>
        );
    }

    if (error === 'Fields not configured') {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} onClick={onClick}>
                <EmptyChartState type="table" message="Configure Rows & Values" onClickDataTab={onClickDataTab} />
            </BaseWidget>
        );
    }

    const valueFields = widget.pivotValues || [];
    const showValueHeader = valueFields.length > 1;

    // Improved Row Label Renderer
    const renderRowLabel = (key: string) => {
        const parts = key.split(' > ');
        if (parts.length === 1) return <span className="text-white font-bold">{parts[0]}</span>;

        return (
            <div className="flex flex-row items-center flex-wrap gap-1 leading-tight">
                {parts.slice(0, -1).map((p, i) => (
                    <React.Fragment key={i}>
                        <span className="text-slate-500 font-medium whitespace-nowrap text-[10px]">{p}</span>
                        <i className="fas fa-chevron-right text-[8px] text-slate-700"></i>
                    </React.Fragment>
                ))}
                <span className="text-white font-bold whitespace-nowrap">{parts[parts.length - 1]}</span>
            </div>
        );
    };

    const rowHeaderWidth = getColWidth('ROW_HEADERS', 240);

    return (
        <BaseWidget
            widget={widget}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isSelected={isSelected}
            isFiltered={isFiltered}
            onClick={onClick}
        >
            <div className={`w-full h-full overflow-auto custom-scrollbar bg-slate-950/30 rounded-lg shadow-inner ${resizingConfig ? 'cursor-col-resize select-none' : ''}`}>
                <table className="w-full border-collapse text-[11px] table-fixed min-w-max">
                    <thead className="sticky top-0 z-20">
                        {/* Primary Column Header Row */}
                        <tr className="bg-slate-900 shadow-xl border-b border-indigo-500/20">
                            <th
                                className="p-3 border-r border-white/10 text-slate-400 font-black uppercase text-left sticky left-0 bg-slate-900 z-30 relative group"
                                style={{ width: rowHeaderWidth, minWidth: rowHeaderWidth }}
                                rowSpan={showValueHeader ? 1 : 2}
                            >
                                <div className="flex flex-col gap-1">
                                    <span className="text-[9px] text-indigo-400 opacity-80 uppercase tracking-wider">Rows</span>
                                </div>
                                {/* Resizer for Row Headers */}
                                <div
                                    className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500 z-50 transition-colors"
                                    onMouseDown={(e) => handleResizeStart(e, 'ROW_HEADERS', rowHeaderWidth)}
                                ></div>
                            </th>
                            {colKeys.map(c => {
                                // If showValueHeader is TRUE, this is the GROUP header (e.g. 2024). We generally don't resize groups directly, usually leaf columns.
                                // But if showValueHeader is FALSE, this IS the leaf column.
                                const isLeaf = !showValueHeader;
                                // If it's a leaf, the key is standard colKey c
                                // But wait, if single value, we reuse `c` as key. 
                                // To handle multiple values case, we rely on secondary row for resizing.
                                // So we only add resizer here if isLeaf is true.

                                // Actually, if it's a group, we spans multiple cols. Resizing group should resize ALL children? Too complex.
                                // We only resize LEAF columns.

                                // Case 1: Single Value (isLeaf = true).
                                const colWidth = isLeaf ? getColWidth(c, 160) : undefined;

                                return (
                                    <th
                                        key={c}
                                        colSpan={valueFields.length}
                                        className="p-2 border-r border-white/10 text-indigo-300 font-bold text-center bg-slate-900/95 backdrop-blur-md whitespace-nowrap overflow-hidden text-ellipsis relative group"
                                        style={isLeaf ? { width: colWidth, minWidth: colWidth } : {}}
                                        rowSpan={showValueHeader ? 1 : 2}
                                    >
                                        {c}
                                        {isLeaf && (
                                            <div
                                                className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500 z-50 transition-colors"
                                                onMouseDown={(e) => handleResizeStart(e, c, colWidth!)}
                                            ></div>
                                        )}
                                    </th>
                                );
                            })}
                            <th
                                colSpan={valueFields.length}
                                className="p-2 border-white/10 text-emerald-400 font-black text-center bg-slate-900 z-20 whitespace-nowrap relative group"
                                rowSpan={showValueHeader ? 1 : 2}
                                // If 1 value, this is the leaf Total column.
                                style={!showValueHeader ? { width: getColWidth('GRAND_TOTAL', 180), minWidth: getColWidth('GRAND_TOTAL', 180) } : {}}
                            >
                                Total
                                {!showValueHeader && (
                                    <div
                                        className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500 z-50 transition-colors"
                                        onMouseDown={(e) => handleResizeStart(e, 'GRAND_TOTAL', getColWidth('GRAND_TOTAL', 180))}
                                    ></div>
                                )}
                            </th>
                        </tr>

                        {/* Secondary Value Header Row (Only if > 1 value) */}
                        {showValueHeader && (
                            <tr className="bg-slate-800/40 backdrop-blur-md">
                                <th className="p-2 border-b border-r border-white/10 sticky left-0 bg-[#1e293b] z-30"></th>
                                {colKeys.map(c => (
                                    valueFields.map(v => {
                                        const uniqueKey = `${c}-${v.field}`;
                                        const width = getColWidth(uniqueKey, 160);
                                        return (
                                            <th
                                                key={uniqueKey}
                                                className="p-1 px-2 border-b border-r border-white/5 text-slate-500 font-bold uppercase tracking-tighter text-[9px] whitespace-nowrap relative group"
                                                style={{ width: width, minWidth: width }}
                                            >
                                                {v.field}
                                                <div
                                                    className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500 z-50 transition-colors"
                                                    onMouseDown={(e) => handleResizeStart(e, uniqueKey, width)}
                                                ></div>
                                            </th>
                                        );
                                    })
                                ))}
                                {valueFields.map(v => {
                                    const uniqueKey = `GRAND_TOTAL-${v.field}`;
                                    const width = getColWidth(uniqueKey, 180);
                                    return (
                                        <th
                                            key={uniqueKey}
                                            className="p-1 px-2 border-b border-white/10 text-slate-500 font-bold uppercase tracking-tighter text-[9px] bg-slate-900/50 whitespace-nowrap relative group"
                                            style={{ width: width, minWidth: width }}
                                        >
                                            {v.field}
                                            <div
                                                className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500 z-50 transition-colors"
                                                onMouseDown={(e) => handleResizeStart(e, uniqueKey, width)}
                                            ></div>
                                        </th>
                                    );
                                })}
                            </tr>
                        )}
                    </thead>
                    <tbody>
                        {rowKeys.map(r => (
                            <tr key={r} className="group hover:bg-indigo-500/10 transition-colors odd:bg-transparent even:bg-white/[0.02]">
                                <td
                                    className="p-2 px-3 border-b border-r border-white/10 text-white font-medium sticky left-0 bg-slate-950/95 backdrop-blur-sm group-hover:bg-slate-900 transition-colors z-10 overflow-hidden text-ellipsis align-middle"
                                    style={{ maxWidth: rowHeaderWidth }}
                                >
                                    {renderRowLabel(r)}
                                </td>
                                {colKeys.map(c => (
                                    valueFields.map(v => {
                                        const val = dataMap[r][c]?.[`${v.field}_${v.aggregation}`];
                                        const isZero = val === 0;
                                        const isLeaf = !showValueHeader;
                                        const key = isLeaf ? c : `${c}-${v.field}`;
                                        // If isLeaf, get width of c. Else get width of uniqueKey.
                                        // Wait, getColWidth helper handles lookup.
                                        const width = getColWidth(key, 160);

                                        if (widget.hideZeros && isZero) {
                                            return (
                                                <td key={`${r}-${c}-${v.field}-${v.aggregation}`}
                                                    className="p-2 px-3 border-b border-r border-white/5 text-right text-slate-700 font-mono align-middle bg-transparent"
                                                >
                                                    -
                                                </td>
                                            );
                                        }

                                        const formatted = val !== undefined ? formatValue(val, v.format || 'standard') : '-';

                                        let style: React.CSSProperties = {};

                                        if (val !== undefined && v.conditionalFormatting && v.conditionalFormatting.length > 0) {
                                            for (const rule of v.conditionalFormatting) {
                                                if (checkCondition(val, rule)) {
                                                    if (rule.textColor) style.color = rule.textColor;
                                                    if (rule.backgroundColor) style.backgroundColor = rule.backgroundColor;
                                                    break;
                                                }
                                            }
                                        }

                                        return (
                                            <td key={`${r}-${c}-${v.field}-${v.aggregation}`}
                                                className="p-2 px-3 border-b border-r border-white/5 text-right text-slate-300 font-mono align-middle whitespace-nowrap overflow-hidden text-ellipsis"
                                                style={{ ...style, maxWidth: width }} // minWidth handled by table-fixed + col width? No, td needs width too often or just relies on th.
                                            // Actually in fixed table, TD follows TH width. We don't need to set width on TD if TH has it.
                                            // But let's check.
                                            >
                                                {formatted}
                                            </td>
                                        );
                                    })
                                ))}
                                {/* Row Total Cells */}
                                {valueFields.map(v => {
                                    const val = rowTotals[r]?.[`${v.field}_${v.aggregation}`];
                                    const key = !showValueHeader ? 'GRAND_TOTAL' : `GRAND_TOTAL-${v.field}`;
                                    // Row totals correspond to the Grand Total column(s) on the right

                                    return (
                                        <td key={`total-${r}-${v.field}-${v.aggregation}`} className="p-2 px-3 border-b border-white/10 text-right text-white font-bold font-mono bg-white/5 align-middle whitespace-nowrap overflow-hidden text-ellipsis">
                                            {val !== undefined ? formatValue(val, v.format || 'standard') : '-'}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
                        <tr className="bg-slate-900 border-t border-emerald-500/30">
                            <td className="p-3 border-r border-white/10 text-emerald-400 font-black uppercase sticky left-0 bg-slate-900 z-30">
                                Grand Total
                            </td>
                            {colKeys.map(c => (
                                valueFields.map(v => {
                                    const val = colTotals[c]?.[`${v.field}_${v.aggregation}`];
                                    return (
                                        <td key={`total-col-${c}-${v.field}`} className="p-3 border-r border-white/10 text-right text-white font-black font-mono whitespace-nowrap overflow-hidden text-ellipsis">
                                            {val !== undefined ? formatValue(val, v.format || 'standard') : '-'}
                                        </td>
                                    );
                                })
                            ))}
                            {/* Grand Grand Total */}
                            {valueFields.map(v => {
                                const val = grandTotal[`${v.field}_${v.aggregation}`];
                                return (
                                    <td key={`grand-total-${v.field}`} className="p-3 text-right text-emerald-400 font-black font-mono bg-emerald-500/10 whitespace-nowrap overflow-hidden text-ellipsis">
                                        {val !== undefined ? formatValue(val, v.format || 'standard') : '-'}
                                    </td>
                                );
                            })}
                        </tr>
                    </tfoot>
                </table>
            </div>
        </BaseWidget>
    );
};

export default PivotTableWidget;
