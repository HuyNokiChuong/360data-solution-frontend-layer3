
import React, { useMemo, useState, useEffect } from 'react';
import { BIWidget, ConditionalFormat, PivotValue } from '../types';
import { useFilterStore } from '../store/filterStore';
import { pivotData } from '../engine/calculations';
import { useDirectQuery } from '../hooks/useDirectQuery';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import EmptyChartState from './EmptyChartState';
import { useChartColors } from '../utils/chartColors';
import { formatBIValue } from '../engine/utils';

interface PivotTableWidgetProps {
    widget: BIWidget;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    isSelected?: boolean;
    onClickDataTab?: () => void;
    onClick?: (e: React.MouseEvent) => void;
}

const checkCondition = (leftValue: any, rule: ConditionalFormat, rightValue?: any) => {
    const leftNum = Number(leftValue);
    const rhsValue = rightValue ?? rule.value;
    const rightNum = Number(rhsValue);
    const rightNum2 = rule.value2 !== undefined ? Number(rule.value2) : NaN;

    switch (rule.condition) {
        case 'contains':
            return String(leftValue ?? '').toLowerCase().includes(String(rhsValue ?? '').toLowerCase());
        case 'greater':
            return !isNaN(leftNum) && !isNaN(rightNum) && leftNum > rightNum;
        case 'less':
            return !isNaN(leftNum) && !isNaN(rightNum) && leftNum < rightNum;
        case 'equal':
            if (!isNaN(leftNum) && !isNaN(rightNum)) return leftNum === rightNum;
            return String(leftValue) === String(rhsValue);
        case 'between':
            return !isNaN(leftNum) && !isNaN(rightNum) && !isNaN(rightNum2) && leftNum >= rightNum && leftNum <= rightNum2;
        default:
            return false;
    }
};

const getConditionalFormatResult = (value: number | undefined, rules?: ConditionalFormat[], resolveCompareValue?: (rule: ConditionalFormat) => any) => {
    const style: React.CSSProperties = {};
    if (value === undefined || !rules || rules.length === 0) {
        return { style, icon: null as string | null };
    }

    for (const rule of rules) {
        const compareValue = resolveCompareValue ? resolveCompareValue(rule) : undefined;
        if (!checkCondition(value, rule, compareValue)) continue;
        if (rule.textColor) style.color = rule.textColor;
        if (rule.backgroundColor) style.backgroundColor = rule.backgroundColor;
        return { style, icon: rule.icon || null };
    }

    return { style, icon: null as string | null };
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
    const { isDark } = useChartColors();
    const { isWidgetFiltered } = useFilterStore();
    const drillDownState = useFilterStore(state => state.drillDowns[widget.id]);
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));

    // Switch to useDirectQuery
    const { data: directData, isLoading, error: directError } = useDirectQuery(widget);
    const widgetData = directData;

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

        const hasValues = Array.isArray(widget.pivotValues) && widget.pivotValues.length > 0;

        if (!hasValues) {
            return { rowKeys: [], colKeys: [], dataMap: {}, rowTotals: {}, colTotals: {}, grandTotal: {}, error: 'Fields not configured' };
        }

        const configuredRows = widget.pivotRows || [];
        const useAutoRow = !configuredRows || configuredRows.length === 0;
        const activeRows = useAutoRow ? ['_autoCategory'] : configuredRows;

        try {
            let filteredData = widgetData;

            // FORMATTING STEP: Transform data for Display while keeping sort order
            // We use a composite key "SortValue|||DisplayValue"
            const formattedData = filteredData.map(row => {
                const newRow = { ...row };
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

                if (useAutoRow) {
                    newRow._autoCategory = newRow._autoCategory || 'Total';
                }

                activeRows.forEach(field => {
                    const val = newRow[field];
                    if (val === null || val === undefined) return;

                    if (field.includes('___half')) {
                        // Sort: 1, 2. Display: Half 1, Half 2
                        newRow[field] = `${val}|||Half ${val}`;
                    } else if (field.includes('___quarter')) {
                        // Sort: 1, 2. Display: Qtr 1, Qtr 2
                        newRow[field] = `${val}|||Qtr ${val}`;
                    } else if (field.includes('___month')) {
                        // Sort: 01, 02. Display: Jan, Feb
                        const sortVal = String(val).padStart(2, '0');
                        const displayVal = months[Number(val) - 1] || val;
                        newRow[field] = `${sortVal}|||${displayVal}`;
                    } else if (field.includes('___day')) {
                        // Sort: 01, 02. Display: 1, 2
                        const sortVal = String(val).padStart(2, '0');
                        newRow[field] = `${sortVal}|||${val}`;
                    }
                });
                return newRow;
            });

            const result = pivotData(
                formattedData,
                activeRows,
                widget.pivotCols || [],
                widget.pivotValues || []
            );

            return { ...result, error: null };
        } catch (err: any) {
            return { rowKeys: [], colKeys: [], dataMap: {}, rowTotals: {}, colTotals: {}, grandTotal: {}, error: err.message };
        }
    }, [widget, widgetData]);

    const valueFields = widget.pivotValues || [];
    const showValueHeader = valueFields.length > 1;
    const measureKeyOf = (field: string, aggregation: string) => `${field}_${aggregation}`;

    // Helper to extract display value
    const getDisplay = (str: string) => {
        if (typeof str === 'string' && str.includes('|||')) {
            return str.split('|||')[1];
        }
        return str;
    };

    const getNodeRowTotalByMeasureKey = (node: any, measureKey: string) => {
        let total = 0;
        if (!node?.values) return total;
        Object.values(node.values).forEach((colVal: any) => {
            if (!colVal) return;
            total += Number(colVal[measureKey] || 0);
        });
        return total;
    };

    const resolveCompareValue = (
        rule: ConditionalFormat,
        currentValueCfg: PivotValue,
        context: { node?: any; colKey?: string }
    ) => {
        if (!rule.compareMode || rule.compareMode === 'literal') {
            return rule.value;
        }

        const targetField = rule.compareField || currentValueCfg.field;
        const targetAgg = rule.compareAggregation || currentValueCfg.aggregation;
        const targetMeasureKey = measureKeyOf(targetField, targetAgg);
        const scope = rule.compareScope || 'cell';

        if (scope === 'grandTotal') {
            return grandTotal?.[targetMeasureKey];
        }

        if (scope === 'columnTotal') {
            if (!context.colKey) return undefined;
            return colTotals?.[context.colKey]?.[targetMeasureKey];
        }

        if (scope === 'rowTotal') {
            if (!context.node) return undefined;
            return getNodeRowTotalByMeasureKey(context.node, targetMeasureKey);
        }

        // default: 'cell'
        if (!context.node || !context.colKey) return undefined;
        return context.node?.values?.[context.colKey]?.[targetMeasureKey];
    };

    // Tree Builder Logic
    const { treeData, flattenedRows } = useMemo(() => {
        if (!rowKeys.length) return { treeData: [], flattenedRows: [] };

        const root: any = { children: {}, values: grandTotal, key: 'TOTAL', label: 'Grand Total', depth: -1 };

        // 1. Build Tree
        rowKeys.forEach(rowKey => {
            const parts = rowKey.split(' > ');
            let currentNode = root;

            parts.forEach((part, index) => {
                const isLeaf = index === parts.length - 1;
                if (!currentNode.children[part]) {
                    currentNode.children[part] = {
                        key: parts.slice(0, index + 1).join(' > '),
                        label: getDisplay(part),
                        fullPart: part,
                        depth: index,
                        children: {},
                        values: {}, // Will accumulate
                        isLeaf: false // Will check later
                    };
                }
                currentNode = currentNode.children[part];

                // If this is the specific rowKey from dataMap, it has values (Leaf of the query, but maybe not leaf of tree if we drilled deeper? 
                // Actually pivotData returns the deepest level keys. So these are leaves.)
                if (isLeaf) {
                    currentNode.isLeaf = true;
                    currentNode.values = dataMap[rowKey]; // Assign direct values
                }
            });
        });

        // 2. Aggregate Values Upwards (Post-Order Traversal)
        const aggregateNode = (node: any) => {
            const children = Object.values(node.children);
            if (children.length === 0) return node.values || {}; // Leaf node

            const aggregatedValues: any = {};

            // Initialize based on first child structure
            // Or just accum all fields found
            children.forEach((child: any) => {
                const childVals = aggregateNode(child);
                Object.keys(childVals).forEach(colKey => { // colKey is like "2024" or "2024 > Q1" (Columns)
                    if (!aggregatedValues[colKey]) aggregatedValues[colKey] = {};
                    const measureObj = childVals[colKey];
                    if (!measureObj) return;

                    Object.keys(measureObj).forEach(measureKey => {
                        const val = measureObj[measureKey] || 0;
                        if (!aggregatedValues[colKey][measureKey]) aggregatedValues[colKey][measureKey] = 0;
                        aggregatedValues[colKey][measureKey] += val;
                    });
                });
            });

            // If node already had values (it shouldn't if activeRows includes all levels, unless mixed granularity exists), specific logic needed.
            // For now, assume pivotData returns uniform depth. Parent nodes rely on aggregation.
            node.values = aggregatedValues;
            return aggregatedValues;
        };

        aggregateNode(root);

        // 3. Flatten for Rendering (DFS)
        const flatten = (node: any, list: any[]) => {
            // Sort children by key (or part) - Reuse the logic from pivotData sort?
            // They are keys in an object, so order is not guaranteed. 
            // We should sort by the original `rowKeys` order preference.
            // Simple string sort on the 'fullPart' (which includes sorting prefix)
            const children = Object.values(node.children).sort((a: any, b: any) => a.fullPart.localeCompare(b.fullPart));

            children.forEach((child: any) => {
                list.push(child);
                flatten(child, list);
            });
        };

        const list: any[] = [];
        flatten(root, list);
        return { treeData: root, flattenedRows: list };

    }, [rowKeys, dataMap, grandTotal]);

    // Expansion State
    const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

    // Auto-expand all on load/change
    useEffect(() => {
        // Default collapsed tree. User expands specific nodes manually (+/-).
        setExpandedKeys(new Set());
    }, [flattenedRows.length]); // Depend on structure change

    useEffect(() => {
        if (!drillDownState) return;

        const targetDepth = Math.max(0, drillDownState.currentLevel);
        if (targetDepth === 0) {
            setExpandedKeys(new Set());
            return;
        }

        const autoExpanded = new Set<string>();
        flattenedRows.forEach((node: any) => {
            if (typeof node?.depth === 'number' && node.depth < targetDepth) {
                autoExpanded.add(node.key);
            }
        });
        setExpandedKeys(autoExpanded);
    }, [drillDownState?.currentLevel, drillDownState?.mode, flattenedRows]);

    const toggleExpand = (key: string) => {
        const newSet = new Set(expandedKeys);
        if (newSet.has(key)) newSet.delete(key);
        else newSet.add(key);
        setExpandedKeys(newSet);
    };

    const rowHeaderWidth = getColWidth('ROW_HEADERS', 240);

    // Early returns moved here to comply with React hooks rules - hooks must be called in the same order every render
    if (!widget.dataSourceId) {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} onClick={onClick}>
                <EmptyChartState type="table" message="Select data source" onClickDataTab={onClickDataTab} />
            </BaseWidget>
        );
    }

    if (error === 'No data') {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} onClick={onClick}>
                <EmptyChartState type="table" message="No data available" onClickDataTab={onClickDataTab} />
            </BaseWidget>
        );
    }

    if (error === 'Fields not configured') {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} onClick={onClick}>
                <EmptyChartState type="table" message="Configure Values" onClickDataTab={onClickDataTab} />
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
            isFiltered={isFiltered}
            loading={isLoading}
            error={directError || undefined}
            onClick={onClick}
        >
            <div className={`w-full h-full overflow-auto custom-scrollbar bg-slate-50/50 dark:bg-slate-950/30 rounded-lg shadow-inner font-['Outfit'] ${resizingConfig ? 'cursor-col-resize select-none' : ''}`}>
                <table className="w-full border-collapse text-[11px] table-fixed min-w-max">
                    <thead className="sticky top-0 z-20">
                        <tr className="bg-slate-100 dark:bg-slate-900 shadow-xl border-b border-slate-200 dark:border-indigo-500/20">
                            {/* Unified Rows Column */}
                            <th
                                className="p-3 border-r border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 font-black uppercase text-left sticky left-0 bg-slate-100 dark:bg-slate-900 z-30 relative group"
                                style={{ width: rowHeaderWidth, minWidth: rowHeaderWidth }}
                                rowSpan={showValueHeader ? 2 : 1}
                            >
                                <div className="flex flex-col gap-1">
                                    <span className="text-[9px] text-indigo-400 opacity-80 uppercase tracking-wider">Rows</span>
                                </div>
                                <div
                                    className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500 z-50 transition-colors"
                                    onMouseDown={(e) => handleResizeStart(e, 'ROW_HEADERS', rowHeaderWidth)}
                                ></div>
                            </th>

                            {/* Column Headers */}
                            {colKeys.map(c => {
                                const isLeaf = !showValueHeader;
                                const colWidth = isLeaf ? getColWidth(c, 160) : undefined;
                                return (
                                    <th
                                        key={c}
                                        colSpan={valueFields.length}
                                        className="p-2 border-r border-slate-200 dark:border-white/10 text-indigo-700 dark:text-indigo-300 font-bold text-center bg-slate-100/95 dark:bg-slate-900/95 backdrop-blur-md whitespace-nowrap overflow-hidden text-ellipsis relative group"
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
                                className="p-2 border-slate-200 dark:border-white/10 text-emerald-600 dark:text-emerald-400 font-black text-center bg-slate-100 dark:bg-slate-900 z-20 whitespace-nowrap relative group"
                                rowSpan={showValueHeader ? 1 : 2}
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

                        {/* Secondary Value Header Row */}
                        {showValueHeader && (
                            <tr className="bg-slate-50/40 dark:bg-slate-800/40 backdrop-blur-md">
                                {/* Empty cell for nested header under Rows is NOT needed if we used rowSpan=2 above */}
                                {/* WAIT. If rowSpan=2 for Rows column, we don't need a TH here. */}
                                {/* BUT logic `colSpan={valueFields.length}` uses `th` for each group column. */}
                                {/* The previous rows used colSpan logic correct. */}
                                {/* But here we need to skip the first column (Rows) because it spanned 2 rows. */}

                                {colKeys.map(c => (
                                    valueFields.map(v => {
                                        const uniqueKey = `${c}-${v.field}`;
                                        const width = getColWidth(uniqueKey, 160);
                                        return (
                                            <th
                                                key={uniqueKey}
                                                className="p-1 px-2 border-b border-r border-slate-200 dark:border-white/5 text-slate-500 font-bold uppercase tracking-tighter text-[9px] whitespace-nowrap relative group"
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
                                            className="p-1 px-2 border-b border-slate-200 dark:border-white/10 text-slate-500 font-bold uppercase tracking-tighter text-[9px] bg-slate-100 dark:bg-slate-900/50 whitespace-nowrap relative group"
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
                        {flattenedRows.map((node: any) => {
                            // Check if visible (parent is expanded)
                            // We need to check all ancestors. 'flattenedRows' contains all. 
                            // Quick check: split key, check parts.
                            // Optimization: In render? No, let's just do it.
                            const parts = node.key.split(' > ');
                            let visible = true;
                            // Check ancestors
                            for (let i = 1; i < parts.length; i++) {
                                const parentKey = parts.slice(0, i).join(' > ');
                                if (!expandedKeys.has(parentKey)) {
                                    visible = false;
                                    break;
                                }
                            }
                            if (!visible) return null;

                            const isLeafNode = Object.keys(node.children || {}).length === 0;
                            const isExpanded = expandedKeys.has(node.key);

                            return (
                                <tr key={node.key} className="group hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 transition-colors odd:bg-transparent even:bg-slate-50/20 dark:even:bg-white/[0.02]">
                                    <td
                                        className="p-2 px-3 border-b border-r border-slate-100 dark:border-white/10 text-slate-900 dark:text-white font-medium sticky left-0 bg-white dark:bg-slate-950/95 backdrop-blur-sm group-hover:bg-slate-50 dark:group-hover:bg-slate-900 transition-colors z-10 overflow-hidden text-ellipsis align-middle"
                                        style={{ maxWidth: rowHeaderWidth, paddingLeft: `${node.depth * 16 + 12}px` }}
                                    >
                                        <div className="flex items-center gap-2">
                                            {!isLeafNode && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); toggleExpand(node.key); }}
                                                    className="w-4 h-4 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
                                                >
                                                    <span className="text-[11px] font-black leading-none">{isExpanded ? '-' : '+'}</span>
                                                </button>
                                            )}
                                            {isLeafNode && <span className="w-4"></span>}
                                            <span className="truncate">{node.label}</span>
                                        </div>
                                    </td>

                                    {colKeys.map(c => (
                                        valueFields.map(v => {
                                            const measureKey = measureKeyOf(v.field, v.aggregation);
                                            const val = node.values?.[c]?.[measureKey];
                                            const isZero = val === 0;
                                            const key = !showValueHeader ? c : `${c}-${v.field}`;
                                            const width = getColWidth(key, 160);

                                            if (widget.hideZeros && isZero) {
                                                return (
                                                    <td key={`${node.key}-${c}-${v.field}`} className="p-2 px-3 border-b border-r border-slate-100 dark:border-white/5 text-right text-slate-300 dark:text-slate-700 font-mono align-middle bg-transparent">-</td>
                                                );
                                            }

                                            const formatted = val !== undefined ? formatBIValue(val, (v.format && v.format !== 'standard' ? v.format : null) || widget.valueFormat || 'standard') : '-';

                                            const cf = getConditionalFormatResult(
                                                val,
                                                v.conditionalFormatting,
                                                (rule) => resolveCompareValue(rule, v, { node, colKey: c })
                                            );
                                            const style: React.CSSProperties = { ...cf.style };

                                            return (
                                                <td key={`${node.key}-${c}-${v.field}`}
                                                    className="p-2 px-3 border-b border-r border-slate-100 dark:border-white/5 text-right text-slate-600 dark:text-slate-300 font-mono align-middle whitespace-nowrap overflow-hidden text-ellipsis"
                                                    style={{
                                                        ...style,
                                                        maxWidth: width,
                                                        fontFamily: "'JetBrains Mono', monospace",
                                                        fontWeight: !isLeafNode ? 'bold' : 'normal',
                                                        // Only apply default subtotal color if no conditional color is set
                                                        color: style.color || (!isLeafNode ? '#cbd5e1' : undefined)
                                                    }}
                                                >
                                                    <span className="inline-flex items-center justify-end gap-1 w-full">
                                                        {cf.icon && <i className={`${cf.icon} text-[10px]`} aria-hidden="true"></i>}
                                                        <span>{formatted}</span>
                                                    </span>
                                                </td>
                                            );
                                        })
                                    ))}

                                    {/* Total Column for this Row */}
                                    {valueFields.map(v => {
                                        // Calculate total for this node across all columns
                                        const measureKey = measureKeyOf(v.field, v.aggregation);
                                        const rowTotal = getNodeRowTotalByMeasureKey(node, measureKey);

                                        const val = rowTotal;
                                        const key = !showValueHeader ? 'GRAND_TOTAL' : `GRAND_TOTAL-${v.field}`;

                                        // Apply conditional formatting to Row Total
                                        const cf = getConditionalFormatResult(
                                            val,
                                            v.conditionalFormatting,
                                            (rule) => resolveCompareValue(rule, v, { node })
                                        );
                                        const style: React.CSSProperties = { ...cf.style };

                                        return (
                                            <td key={`total-${node.key}-${v.field}`}
                                                className="p-2 px-3 border-b border-slate-200 dark:border-white/10 text-right text-slate-900 dark:text-white font-bold font-mono bg-slate-50 dark:bg-white/5 align-middle whitespace-nowrap overflow-hidden text-ellipsis"
                                                style={{
                                                    ...style,
                                                    fontFamily: "'JetBrains Mono', monospace"
                                                }}
                                            >
                                                <span className="inline-flex items-center justify-end gap-1 w-full">
                                                    {cf.icon && <i className={`${cf.icon} text-[10px]`} aria-hidden="true"></i>}
                                                    <span>{val !== undefined ? formatBIValue(val, (v.format && v.format !== 'standard' ? v.format : null) || widget.valueFormat || 'standard') : '-'}</span>
                                                </span>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot className="sticky bottom-0 z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
                        <tr className="bg-slate-100 dark:bg-slate-900 border-t border-emerald-500/30">
                            <td className="p-3 border-r border-slate-200 dark:border-white/10 text-emerald-600 dark:text-emerald-400 font-black uppercase sticky left-0 bg-slate-100 dark:bg-slate-900 z-30">
                                Grand Total
                            </td>
                            {colKeys.map(c => (
                                valueFields.map(v => {
                                    const measureKey = measureKeyOf(v.field, v.aggregation);
                                    const val = colTotals?.[c]?.[measureKey];

                                    // Apply conditional formatting to Column Total
                                    const cf = getConditionalFormatResult(
                                        val,
                                        v.conditionalFormatting,
                                        (rule) => resolveCompareValue(rule, v, { colKey: c })
                                    );
                                    const style: React.CSSProperties = { ...cf.style };

                                    return (
                                        <td key={`total-col-${c}-${v.field}`}
                                            className="p-3 border-r border-slate-200 dark:border-white/10 text-right text-slate-900 dark:text-white font-black font-mono whitespace-nowrap overflow-hidden text-ellipsis"
                                            style={{
                                                ...style,
                                                fontFamily: "'JetBrains Mono', monospace"
                                            }}
                                        >
                                            <span className="inline-flex items-center justify-end gap-1 w-full">
                                                {cf.icon && <i className={`${cf.icon} text-[10px]`} aria-hidden="true"></i>}
                                                <span>{val !== undefined ? formatBIValue(val, (v.format && v.format !== 'standard' ? v.format : null) || widget.valueFormat || 'standard') : '-'}</span>
                                            </span>
                                        </td>
                                    );
                                })
                            ))}
                            {/* Grand Grand Total */}
                            {valueFields.map(v => {
                                const measureKey = measureKeyOf(v.field, v.aggregation);
                                const val = grandTotal?.[measureKey];

                                // Apply conditional formatting to Grand Grand Total
                                const cf = getConditionalFormatResult(
                                    val,
                                    v.conditionalFormatting,
                                    (rule) => resolveCompareValue(rule, v, {})
                                );
                                const style: React.CSSProperties = { ...cf.style };

                                return (
                                    <td key={`grand-total-${v.field}`}
                                        className="p-3 text-right text-emerald-600 dark:text-emerald-400 font-black font-mono bg-emerald-500/5 dark:bg-emerald-500/10 whitespace-nowrap overflow-hidden text-ellipsis"
                                        style={{
                                            ...style,
                                            fontFamily: "'JetBrains Mono', monospace"
                                        }}
                                    >
                                        <span className="inline-flex items-center justify-end gap-1 w-full">
                                            {cf.icon && <i className={`${cf.icon} text-[10px]`} aria-hidden="true"></i>}
                                            <span>{val !== undefined ? formatBIValue(val, (v.format && v.format !== 'standard' ? v.format : null) || widget.valueFormat || 'standard') : '-'}</span>
                                        </span>
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
