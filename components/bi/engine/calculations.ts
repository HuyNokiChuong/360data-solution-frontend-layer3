
import { DataSource, Field, CalculatedField, AggregationType } from '../types';
import { getFieldValue } from './utils';

/**
 * Calculate a new field based on an expression
 */
export function evaluateCalculation(
    expression: string,
    row: any,
    dataSource: DataSource
): number | string | null {
    try {
        // Replace field names with values
        let processedExpression = expression;

        dataSource.schema.forEach(field => {
            const fieldPattern = new RegExp(`\\[${field.name}\\]`, 'g');
            const value = getFieldValue(row, field.name);

            // Handle different data types
            if (typeof value === 'number') {
                processedExpression = processedExpression.replace(fieldPattern, String(value));
            } else if (typeof value === 'string') {
                processedExpression = processedExpression.replace(fieldPattern, `"${value}"`);
            } else {
                processedExpression = processedExpression.replace(fieldPattern, 'null');
            }
        });

        // Helper functions similar to Google Sheets / Excel
        const context: Record<string, any> = {
            IF: (cond: any, t: any, f: any = null) => cond ? t : f,
            AND: (...args: any[]) => args.every(Boolean),
            OR: (...args: any[]) => args.some(Boolean),
            NOT: (val: any) => !val,
            ABS: Math.abs,
            ROUND: (num: number, digits: number = 0) => {
                const factor = Math.pow(10, digits);
                return Math.round(num * factor) / factor;
            },
            CEILING: Math.ceil,
            FLOOR: Math.floor,
            MAX: Math.max,
            MIN: Math.min,
            UPPER: (s: string) => String(s).toUpperCase(),
            LOWER: (s: string) => String(s).toLowerCase(),
            CONCAT: (...args: any[]) => args.join(''),
            LEN: (s: string) => String(s).length,
        };

        // Evaluate the expression safely
        // Inject context functions as arguments to the dynamic function
        const functionBody = `return ${processedExpression}`;
        const argNames = Object.keys(context);
        const argValues = Object.values(context);

        const evaluator = new Function(...argNames, functionBody);
        const result = evaluator(...argValues);
        return result;
    } catch (error) {
        console.error('Calculation error:', error);
        return null;
    }
}

/**
 * Add calculated field to dataset
 */
export function addCalculatedField(
    dataSource: DataSource,
    calculatedField: CalculatedField
): DataSource {
    // Add field to schema
    const newSchema: Field[] = [
        ...dataSource.schema,
        {
            name: calculatedField.name,
            type: calculatedField.type || 'number',
            isCalculated: true
        }
    ];

    // Calculate values for all rows
    const newData = dataSource.data.map(row => {
        const calculatedValue = evaluateCalculation(
            calculatedField.formula,
            row,
            dataSource
        );
        return {
            ...row,
            [calculatedField.name]: calculatedValue
        };
    });

    return {
        ...dataSource,
        schema: newSchema,
        data: newData
    };
}

/**
 * Quick calculations
 */
export function calculatePercentOfTotal(
    data: any[],
    field: string,
    groupBy?: string
): any[] {
    if (!groupBy) {
        // Simple percent of total
        const total = data.reduce((sum, row) => sum + (Number(getFieldValue(row, field)) || 0), 0);
        return data.map(row => {
            const val = Number(getFieldValue(row, field)) || 0;
            const pct = total > 0 ? (val / total) * 100 : 0;
            return {
                ...row,
                [`${field}_pct`]: parseFloat(pct.toFixed(10))
            };
        });
    }

    // Percent of total within groups
    const groups = new Map<any, any[]>();
    data.forEach(row => {
        const key = String(getFieldValue(row, groupBy) || 'Unknown');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
    });

    const result: any[] = [];
    groups.forEach((groupRows) => {
        const total = groupRows.reduce((sum, row) => sum + (Number(getFieldValue(row, field)) || 0), 0);
        groupRows.forEach(row => {
            const val = Number(getFieldValue(row, field)) || 0;
            const pct = total > 0 ? (val / total) * 100 : 0;
            result.push({
                ...row,
                [`${field}_pct`]: parseFloat(pct.toFixed(10))
            });
        });
    });

    return result;
}

/**
 * Running total calculation
 */
export function calculateRunningTotal(
    data: any[],
    field: string,
    orderBy?: string
): any[] {
    // Sort data if orderBy is specified
    let sortedData = [...data];
    if (orderBy) {
        sortedData.sort((a, b) => {
            const aVal = getFieldValue(a, orderBy);
            const bVal = getFieldValue(b, orderBy);
            if (aVal < bVal) return -1;
            if (aVal > bVal) return 1;
            return 0;
        });
    }

    let runningTotal = 0;
    return sortedData.map(row => {
        runningTotal += Number(getFieldValue(row, field)) || 0;
        return {
            ...row,
            [`${field}_running_total`]: parseFloat(runningTotal.toFixed(10))
        };
    });
}

/**
 * Moving average calculation
 */
export function calculateMovingAverage(
    data: any[],
    field: string,
    windowSize: number = 3,
    orderBy?: string
): any[] {
    // Sort data if orderBy is specified
    let sortedData = [...data];
    if (orderBy) {
        sortedData.sort((a, b) => {
            const aVal = getFieldValue(a, orderBy);
            const bVal = getFieldValue(b, orderBy);
            if (aVal < bVal) return -1;
            if (aVal > bVal) return 1;
            return 0;
        });
    }

    return sortedData.map((row, index) => {
        const start = Math.max(0, index - windowSize + 1);
        const window = sortedData.slice(start, index + 1);
        const sum = window.reduce((acc, r) => acc + (Number(getFieldValue(r, field)) || 0), 0);
        const avg = sum / window.length;

        return {
            ...row,
            [`${field}_ma${windowSize}`]: parseFloat(avg.toFixed(10))
        };
    });
}

/**
 * Year-over-Year calculation
 */
export function calculateYoY(
    data: any[],
    field: string,
    dateField: string
): any[] {
    // Group by year
    const yearGroups = new Map<number, any[]>();
    data.forEach(row => {
        const dateRaw = getFieldValue(row, dateField);
        const date = new Date(dateRaw);
        if (isNaN(date.getTime())) return;

        const year = date.getFullYear();
        if (!yearGroups.has(year)) yearGroups.set(year, []);
        yearGroups.get(year)!.push(row);
    });

    const result: any[] = [];
    const years = Array.from(yearGroups.keys()).sort();

    years.forEach((year, index) => {
        const currentYearData = yearGroups.get(year)!;
        const previousYear = years[index - 1];
        const previousYearData = previousYear ? yearGroups.get(previousYear) : null;

        currentYearData.forEach(row => {
            let yoyChange = null;
            let yoyPercent = null;

            if (previousYearData) {
                const currentValue = Number(getFieldValue(row, field)) || 0;
                const previousTotal = previousYearData.reduce(
                    (sum, r) => sum + (Number(getFieldValue(r, field)) || 0),
                    0
                );
                const previousAvg = previousTotal / previousYearData.length;

                const diff = currentValue - previousAvg;
                yoyChange = parseFloat(diff.toFixed(10));

                const pct = previousAvg > 0 ? (diff / previousAvg) * 100 : 0;
                yoyPercent = parseFloat(pct.toFixed(10));
            }

            result.push({
                ...row,
                [`${field}_yoy_change`]: yoyChange,
                [`${field}_yoy_percent`]: yoyPercent
            });
        });
    });

    return result;
}

/**
 * Aggregate data by group
 */
export function groupAndAggregate(
    data: any[],
    groupByField: string,
    aggregateField: string,
    aggregationType: string | AggregationType = 'sum'
): any[] {
    const groups = new Map<string, any[]>();

    data.forEach(row => {
        const val = getFieldValue(row, groupByField);
        // Skip null/undefined groupings for charts to keep it clean
        if (val === null || val === undefined) return;

        const key = String(val);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(row);
    });

    const result: any[] = [];

    groups.forEach((groupRows, key) => {
        const value = aggregate(groupRows, aggregateField, aggregationType as AggregationType);
        // Only add if value is non-zero (to avoid "empty" report items)
        if (value !== 0 && value !== null && value !== undefined) {
            result.push({
                [groupByField]: key,
                [aggregateField]: value
            });
        }
    });

    // Sort result by the grouping field to ensure logical chart axes
    return result.sort((a, b) => {
        const aVal = a[groupByField];
        const bVal = b[groupByField];
        if (aVal < bVal) return -1;
        if (aVal > bVal) return 1;
        return 0;
    });
}

/**
 * Aggregate multiple measures by group
 */
export function groupAndAggregateMeasures(
    data: any[],
    groupByField: string,
    measures: { field: string, aggregation: AggregationType, [key: string]: any }[],
    lineMeasures: { field: string, aggregation: AggregationType, [key: string]: any }[] = []
): { chartData: any[], series: string[], lineSeries: string[] } {
    if ((!measures || measures.length === 0) && (!lineMeasures || lineMeasures.length === 0)) {
        return { chartData: [], series: [], lineSeries: [] };
    }

    const groups = new Map<string, any[]>();

    // Create unique series names for bars
    const seriesConfigs = (measures || []).map(m => {
        if (m.alias) return { ...m, seriesName: m.alias };
        const count = measures.filter(f => f.field === m.field).length + (lineMeasures?.filter(f => f.field === m.field).length || 0);
        const name = count > 1 ? `${m.aggregation.toUpperCase()}(${m.field})` : m.field;
        return { ...m, seriesName: name };
    });

    // Create unique series names for lines
    const lineSeriesConfigs = (lineMeasures || []).map(m => {
        if (m.alias) return { ...m, seriesName: m.alias };
        const count = (measures?.filter(f => f.field === m.field).length || 0) + lineMeasures.filter(f => f.field === m.field).length;
        const name = count > 1 ? `${m.aggregation.toUpperCase()}(${m.field})` : m.field;
        // If name is already taken by a bar series, append (Line)
        const finalName = seriesConfigs.some(s => s.seriesName === name) ? `${name} (Line)` : name;
        return { ...m, seriesName: finalName };
    });

    const series = seriesConfigs.map(s => s.seriesName);
    const lineSeries = lineSeriesConfigs.map(s => s.seriesName);

    data.forEach(row => {
        const val = getFieldValue(row, groupByField);
        if (val === null || val === undefined) return;

        const key = String(val);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(row);
    });

    const chartData: any[] = [];

    groups.forEach((groupRows, key) => {
        const rowData: any = { [groupByField]: key };

        seriesConfigs.forEach(s => {
            const value = aggregate(groupRows, s.field, s.aggregation);
            rowData[s.seriesName] = value;
        });

        lineSeriesConfigs.forEach(s => {
            const value = aggregate(groupRows, s.field, s.aggregation);
            rowData[s.seriesName] = value;
        });

        chartData.push(rowData);
    });

    // Sort result
    chartData.sort((a, b) => {
        const aVal = a[groupByField];
        const bVal = b[groupByField];
        if (aVal < bVal) return -1;
        if (aVal > bVal) return 1;
        return 0;
    });

    return {
        chartData,
        series,
        lineSeries
    };
}

/**
 * Aggregate data by group and a second level (Legend/Series)
 */
export function groupAndAggregateMulti(
    data: any[],
    groupByField: string,
    legendField: string,
    aggregateField: string,
    aggregationType: string | AggregationType = 'sum',
    legendAliases: Record<string, string> = {}
): { chartData: any[], series: string[] } {
    const parentGroups = new Map<string, Map<string, any[]>>();
    const allLegendValues = new Set<string>();

    data.forEach(row => {
        const groupVal = getFieldValue(row, groupByField);
        const legendVal = getFieldValue(row, legendField);

        if (groupVal === null || groupVal === undefined) return;
        const legendKey = legendVal === null || legendVal === undefined ? 'Unknown' : String(legendVal);
        const groupKey = String(groupVal);

        if (!parentGroups.has(groupKey)) {
            parentGroups.set(groupKey, new Map());
        }

        const legendGroups = parentGroups.get(groupKey)!;
        if (!legendGroups.has(legendKey)) {
            legendGroups.set(legendKey, []);
        }

        legendGroups.get(legendKey)!.push(row);
        allLegendValues.add(legendKey);
    });

    const chartData: any[] = [];
    parentGroups.forEach((legendGroups, groupKey) => {
        const rowData: any = { [groupByField]: groupKey };

        legendGroups.forEach((rows, legendKey) => {
            const value = aggregate(rows, aggregateField, aggregationType as AggregationType);
            if (value !== 0) {
                const finalKey = legendAliases[legendKey] || legendKey;
                rowData[finalKey] = value;
            }
        });

        chartData.push(rowData);
    });

    // Sort chartData by groupKey
    chartData.sort((a, b) => {
        const aVal = a[groupByField];
        const bVal = b[groupByField];
        if (aVal < bVal) return -1;
        if (aVal > bVal) return 1;
        return 0;
    });

    const series = Array.from(allLegendValues).map(v => legendAliases[v] || v).sort();

    return {
        chartData,
        series
    };
}

/**
 * Single field aggregation
 */
export function aggregate(data: any[], field: string, type: AggregationType = 'sum'): number {
    const values = data.map(row => {
        const val = getFieldValue(row, field);
        if (val === null || val === undefined || val === '') return NaN;
        return Number(val);
    }).filter(v => !isNaN(v));

    if (values.length === 0) return 0;

    switch (type) {
        case 'sum': {
            const sum = values.reduce((a, b) => a + b, 0);
            return parseFloat(sum.toFixed(10));
        }
        case 'avg': {
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            return parseFloat(avg.toFixed(10));
        }
        case 'min': {
            let min = values[0];
            for (let i = 1; i < values.length; i++) {
                if (values[i] < min) min = values[i];
            }
            return min;
        }
        case 'max': {
            let max = values[0];
            for (let i = 1; i < values.length; i++) {
                if (values[i] > max) max = values[i];
            }
            return max;
        }
        case 'count':
            return data.length;
        case 'countDistinct':
            // BQ behavior: COUNT(DISTINCT) excludes nulls
            return new Set(data.map(row => getFieldValue(row, field)).filter(v => v !== null && v !== undefined)).size;
        case 'none':
            return values[0] || 0;
        default: {
            const sum = values.reduce((a, b) => a + b, 0);
            return parseFloat(sum.toFixed(10));
        }
    }
}

import { formatBIValue } from './utils';

/**
 * Format value for display using global utility
 */
export function formatValue(value: number | string, format: string = 'standard'): string {
    return formatBIValue(value, format);
}

/**
 * Pivots a flat dataset based on row groupings, column groupings, and aggregated values.
 */
export function pivotData(
    data: any[],
    rows: string[],
    cols: string[],
    values: { field: string, aggregation: AggregationType }[]
) {
    if (!data || data.length === 0 || rows.length === 0 || values.length === 0) {
        return { rowKeys: [], colKeys: [], dataMap: {}, allColKeys: [] };
    }

    const dataMap: Record<string, Record<string, any>> = {};
    const rowKeysSet = new Set<string>();
    const colKeysSet = new Set<string>();

    data.forEach(item => {
        const rowKey = rows.map(r => String(getFieldValue(item, r) ?? 'All')).join(' > ');
        const colKey = cols.length > 0
            ? cols.map(c => String(getFieldValue(item, c) ?? 'All')).join(' > ')
            : 'Value';

        rowKeysSet.add(rowKey);
        colKeysSet.add(colKey);

        if (!dataMap[rowKey]) dataMap[rowKey] = {};
        if (!dataMap[rowKey][colKey]) {
            dataMap[rowKey][colKey] = values.map(v => ({ field: v.field, items: [] }));
        }

        const cell = dataMap[rowKey][colKey];
        values.forEach((v, idx) => {
            cell[idx].items.push(item);
        });
    });

    // Sort keys
    const sortedRowKeys = Array.from(rowKeysSet).sort();
    const sortedColKeys = Array.from(colKeysSet).sort();

    // Final aggregation + Totals
    const finalDataMap: Record<string, Record<string, any>> = {};
    const colTotals: Record<string, any> = {};
    const rowTotals: Record<string, any> = {};
    let grandTotal: any = {};

    sortedRowKeys.forEach(r => {
        finalDataMap[r] = {};
        rowTotals[r] = {};

        sortedColKeys.forEach(c => {
            if (!colTotals[c]) colTotals[c] = {};

            if (dataMap[r][c]) {
                const results: Record<string, number> = {};
                values.forEach((v, idx) => {
                    const fieldKey = `${v.field}_${v.aggregation}`;
                    const val = aggregate(dataMap[r][c][idx].items, v.field, v.aggregation);
                    results[fieldKey] = val;

                    // Accumulate for totals (simplistic sum for now)
                    rowTotals[r][fieldKey] = (rowTotals[r][fieldKey] || 0) + val;
                    colTotals[c][fieldKey] = (colTotals[c][fieldKey] || 0) + val;
                    grandTotal[fieldKey] = (grandTotal[fieldKey] || 0) + val;
                });
                finalDataMap[r][c] = results;
            } else {
                finalDataMap[r][c] = null;
            }
        });
    });

    return {
        rowKeys: sortedRowKeys,
        colKeys: sortedColKeys,
        dataMap: finalDataMap,
        rowTotals,
        colTotals,
        grandTotal
    };
}
