
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { BIWidget, ConditionalFormat, PivotValue } from '../types';
import { useFilterStore } from '../store/filterStore';
import { pivotData } from '../engine/calculations';
import { useDirectQuery } from '../hooks/useDirectQuery';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import EmptyChartState from './EmptyChartState';
import { useChartColors } from '../utils/chartColors';
import { formatBIValue } from '../engine/utils';
import { exportRowsToExcel } from '../utils/widgetExcelExport';
import { DrillDownService } from '../engine/DrillDownService';
import { findSourceSelectionFilter, isPayloadSelected } from '../utils/crossFilterSelection';

interface PivotTableWidgetProps {
    widget: BIWidget;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    onDataClick?: (data: any) => void;
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

const toSafeVarName = (raw: string) => String(raw || '').replace(/[^a-zA-Z0-9_]/g, '_');

const toNumber = (value: any) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
};

const FormulaHelpers = {
    IF: (condition: any, trueValue: any, falseValue: any = null) => (condition ? trueValue : falseValue),
    ABS: (x: any) => Math.abs(toNumber(x)),
    ROUND: (x: any, digits: any = 0) => {
        const precision = Math.max(0, Math.floor(toNumber(digits)));
        const factor = Math.pow(10, precision);
        return Math.round(toNumber(x) * factor) / factor;
    },
    FLOOR: (x: any) => Math.floor(toNumber(x)),
    CEIL: (x: any) => Math.ceil(toNumber(x)),
    MIN: (...args: any[]) => Math.min(...args.map(toNumber)),
    MAX: (...args: any[]) => Math.max(...args.map(toNumber)),
    SUM: (...args: any[]) => args.reduce((acc, item) => acc + toNumber(item), 0),
    AVG: (...args: any[]) => {
        if (args.length === 0) return 0;
        return args.reduce((acc, item) => acc + toNumber(item), 0) / args.length;
    },
    SAFE_DIV: (numerator: any, denominator: any, fallback: any = 0) => {
        const num = toNumber(numerator);
        const den = toNumber(denominator);
        if (!den) return toNumber(fallback);
        return num / den;
    },
    PERCENT_OF: (value: any, total: any) => {
        const den = toNumber(total);
        if (!den) return 0;
        return (toNumber(value) / den) * 100;
    },
    PERCENT_CHANGE: (current: any, baseline: any) => {
        const base = toNumber(baseline);
        if (!base) return 0;
        return ((toNumber(current) - base) / base) * 100;
    },
    CLAMP: (value: any, minValue: any, maxValue: any) => Math.max(toNumber(minValue), Math.min(toNumber(value), toNumber(maxValue))),
};

const evaluateCompareFormula = (formula: string | undefined, context: Record<string, any>) => {
    if (!formula || !formula.trim()) return undefined;
    try {
        // Trusted in-app expression evaluator for power-user conditional formatting.
        const helperNames = Object.keys(FormulaHelpers);
        const helperValues = Object.values(FormulaHelpers);
        // eslint-disable-next-line no-new-func
        const fn = new Function('ctx', 'Math', ...helperNames, `with (ctx) { return (${formula}); }`);
        return fn(context, Math, ...helperValues);
    } catch {
        return undefined;
    }
};

const PivotTableWidget: React.FC<PivotTableWidgetProps> = ({
    widget,
    onEdit,
    onDelete,
    onDuplicate,
    onDataClick,
    isSelected = false,
    onClickDataTab,
    onClick
}) => {
    const { isDark } = useChartColors();
    const { crossFilters: allDashboardFilters, isWidgetFiltered } = useFilterStore();
    const rawDrillDownState = useFilterStore(state => state.drillDowns[widget.id]);
    const drillDownState = useMemo(
        () => DrillDownService.resolveStateForWidget(widget, rawDrillDownState || widget.drillDownState || undefined),
        [widget, rawDrillDownState, widget.drillDownState]
    );
    const currentFields = DrillDownService.getCurrentFields(widget, drillDownState);
    const selectionField = currentFields[currentFields.length - 1] || widget.pivotRows?.[0] || '';
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

    const decodePivotToken = (raw: any) => {
        if (typeof raw !== 'string' || !raw.includes('|||')) return raw;
        const [sortValue, displayValue] = raw.split('|||');
        const trimmedSort = String(sortValue || '').trim();
        if (/^-?\d+(\.\d+)?$/.test(trimmedSort)) {
            return Number(trimmedSort);
        }
        const trimmedDisplay = String(displayValue || '').trim();
        return trimmedDisplay || trimmedSort;
    };

    const buildRowPayload = useCallback((node: any) => {
        const payload: Record<string, any> = {};
        const hierarchy = widget.pivotRows || [];
        const parts = String(node?.key || '').split(' > ');

        hierarchy.forEach((field, index) => {
            if (!field) return;
            const token = parts[index];
            if (token === undefined) return;
            payload[field] = decodePivotToken(token);
        });

        const nodeDepth = typeof node?.depth === 'number' ? node.depth : (parts.length - 1);
        const safeDepth = Math.max(0, Math.min(nodeDepth, Math.max(hierarchy.length - 1, 0)));
        const crossFilterField = hierarchy[safeDepth] || selectionField;
        if (crossFilterField) {
            payload.__crossFilterField = crossFilterField;
            payload._rawAxisValue = payload[crossFilterField] ?? decodePivotToken(parts[safeDepth]);
        }

        payload.name = node?.label;
        payload._autoCategory = node?.label;
        return payload;
    }, [widget.pivotRows, selectionField]);

    const selectionFields = useMemo(() => {
        const hierarchy = widget.pivotRows || [];
        return Array.from(new Set([selectionField, ...hierarchy].filter(Boolean)));
    }, [selectionField, widget.pivotRows]);

    const currentSelectionFilter = useMemo(() => {
        return findSourceSelectionFilter(allDashboardFilters, widget.id, selectionFields);
    }, [allDashboardFilters, widget.id, selectionFields]);

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
        const scope = rule.compareScope || 'cell';
        const currentMeasureKey = measureKeyOf(currentValueCfg.field, currentValueCfg.aggregation);
        const currentRowTotal = context.node ? getNodeRowTotalByMeasureKey(context.node, currentMeasureKey) : undefined;
        const currentColumnTotal = context.colKey ? colTotals?.[context.colKey]?.[currentMeasureKey] : undefined;
        const currentGrandTotal = grandTotal?.[currentMeasureKey];

        if (rule.compareMode === 'formula') {
            const formulaCtx: Record<string, any> = {
                VALUE: scope === 'rowTotal'
                    ? currentRowTotal
                    : scope === 'columnTotal'
                        ? currentColumnTotal
                        : scope === 'grandTotal'
                            ? currentGrandTotal
                            : (context.node && context.colKey ? context.node?.values?.[context.colKey]?.[currentMeasureKey] : undefined),
                ROW_TOTAL: currentRowTotal,
                COLUMN_TOTAL: currentColumnTotal,
                GRAND_TOTAL: currentGrandTotal
            };

            valueFields.forEach((mv) => {
                const mk = measureKeyOf(mv.field, mv.aggregation);
                const safeKey = toSafeVarName(mk);
                formulaCtx[`VALUE_${safeKey}`] = context.node && context.colKey ? context.node?.values?.[context.colKey]?.[mk] : undefined;
                formulaCtx[`ROW_TOTAL_${safeKey}`] = context.node ? getNodeRowTotalByMeasureKey(context.node, mk) : undefined;
                formulaCtx[`COLUMN_TOTAL_${safeKey}`] = context.colKey ? colTotals?.[context.colKey]?.[mk] : undefined;
                formulaCtx[`GRAND_TOTAL_${safeKey}`] = grandTotal?.[mk];
            });

            return evaluateCompareFormula(rule.compareFormula, formulaCtx);
        }

        if (!rule.compareMode || rule.compareMode === 'literal') {
            return rule.value;
        }

        const targetField = rule.compareField || currentValueCfg.field;
        const targetAgg = rule.compareAggregation || currentValueCfg.aggregation;
        const targetMeasureKey = measureKeyOf(targetField, targetAgg);

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

    const exportFields = useMemo(() => {
        const fieldOrder = [
            ...(widget.pivotRows || []),
            ...(widget.pivotCols || []),
            ...(widget.pivotValues || []).map((value) => value.field)
        ];
        return Array.from(new Set(fieldOrder.filter(Boolean))).map((field) => ({ field }));
    }, [widget.pivotRows, widget.pivotCols, widget.pivotValues]);

    const handleExportExcel = useCallback(() => {
        exportRowsToExcel({
            title: widget.title || 'Pivot Table',
            rows: widgetData as Record<string, any>[],
            fields: exportFields
        });
    }, [widget.title, widgetData, exportFields]);

    // Early returns moved here to comply with React hooks rules - hooks must be called in the same order every render
    if (!widget.dataSourceId) {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} onClick={onClick} onExportExcel={handleExportExcel}>
                <EmptyChartState type="table" message="Select data source" onClickDataTab={onClickDataTab} />
            </BaseWidget>
        );
    }

    if (error === 'No data') {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} onClick={onClick} onExportExcel={handleExportExcel}>
                <EmptyChartState type="table" message="No data available" onClickDataTab={onClickDataTab} />
            </BaseWidget>
        );
    }

    if (error === 'Fields not configured') {
        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} onClick={onClick} onExportExcel={handleExportExcel}>
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
            onExportExcel={handleExportExcel}
        >
            <div className={`w-full h-full overflow-auto custom-scrollbar bg-white dark:bg-slate-950/30 rounded-lg shadow-inner font-['Outfit'] ${resizingConfig ? 'cursor-col-resize select-none' : ''}`}>
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
                                                className="p-1 px-2 border-b border-r border-slate-200 dark:border-white/5 text-slate-700 dark:text-slate-500 font-bold uppercase tracking-tighter text-[9px] whitespace-nowrap relative group"
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
                                            className="p-1 px-2 border-b border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-500 font-bold uppercase tracking-tighter text-[9px] bg-slate-100 dark:bg-slate-900/50 whitespace-nowrap relative group"
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
                            const rowPayload = buildRowPayload(node);
                            const isRowSelected = Boolean(currentSelectionFilter) && isPayloadSelected(rowPayload, currentSelectionFilter, selectionFields);
                            const isRowDimmed = Boolean(currentSelectionFilter) && !isRowSelected;

                            return (
                                <tr
                                    key={node.key}
                                    onClick={() => {
                                        if (onDataClick && widget.enableCrossFilter !== false) {
                                            onDataClick(rowPayload);
                                        }
                                    }}
                                    className={`group transition-colors odd:bg-transparent even:bg-slate-50/60 dark:even:bg-white/[0.02] ${onDataClick && widget.enableCrossFilter !== false ? 'cursor-pointer' : ''} ${isRowSelected ? 'bg-indigo-500/15 dark:bg-indigo-500/20' : 'hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10'} ${isRowDimmed ? 'opacity-60' : ''}`}
                                >
                                    <td
                                        className={`p-2 px-3 border-b border-r border-slate-200 dark:border-white/10 text-slate-900 dark:text-white font-medium sticky left-0 bg-white dark:bg-slate-950/95 backdrop-blur-sm transition-colors z-10 overflow-hidden text-ellipsis align-middle ${isRowSelected ? 'ring-1 ring-inset ring-indigo-400/50' : 'group-hover:bg-slate-50 dark:group-hover:bg-slate-900'}`}
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
                                                    <td key={`${node.key}-${c}-${v.field}`} className="p-2 px-3 border-b border-r border-slate-200 dark:border-white/5 text-right text-slate-400 dark:text-slate-700 font-mono align-middle bg-transparent">-</td>
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
                                                    className="p-2 px-3 border-b border-r border-slate-200 dark:border-white/5 text-right text-slate-700 dark:text-slate-300 font-mono align-middle whitespace-nowrap overflow-hidden text-ellipsis"
                                                    style={{
                                                        ...style,
                                                        maxWidth: width,
                                                        fontFamily: "'JetBrains Mono', monospace",
                                                        fontWeight: !isLeafNode ? 'bold' : 'normal',
                                                        // Only apply default subtotal color if no conditional color is set
                                                        color: style.color || (!isLeafNode ? (isDark ? '#cbd5e1' : '#334155') : undefined)
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
                                                className="p-2 px-3 border-b border-slate-200 dark:border-white/10 text-right text-slate-900 dark:text-white font-bold font-mono bg-slate-100 dark:bg-white/5 align-middle whitespace-nowrap overflow-hidden text-ellipsis"
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
                    <tfoot
                        className="sticky bottom-0 z-20"
                        style={{ boxShadow: isDark ? '0 -10px 20px rgba(0,0,0,0.5)' : '0 -6px 14px rgba(15,23,42,0.08)' }}
                    >
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
