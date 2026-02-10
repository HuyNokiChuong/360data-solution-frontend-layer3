// ============================================
// Data Processing Utilities
// ============================================

import { DataSource, Field, Filter, FilterOperator, DataStats, BIWidget, AggregationType } from '../types';
import { getFieldValue } from './utils';
import { DrillDownService } from './DrillDownService';

/**
 * Parse CSV data into structured format
 */
export function parseCSV(csvText: string): { data: any[]; schema: Field[] } {
    const lines = csvText.trim().split('\n');
    if (lines.length === 0) return { data: [], schema: [] };

    // Parse headers
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

    // Parse data rows
    const data: any[] = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === headers.length) {
            const row: any = {};
            headers.forEach((header, idx) => {
                row[header] = parseValue(values[idx]);
            });
            data.push(row);
        }
    }

    // Detect schema
    const schema = detectSchema(data, headers);

    return { data, schema };
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
}

/**
 * Parse JSON data
 */
export function parseJSON(jsonText: string): { data: any[]; schema: Field[] } {
    try {
        const parsed = JSON.parse(jsonText);
        const data = Array.isArray(parsed) ? parsed : [parsed];

        if (data.length === 0) return { data: [], schema: [] };

        const headers = Object.keys(data[0]);
        const schema = detectSchema(data, headers);

        return { data, schema };
    } catch (error) {
        console.error('JSON parse error:', error);
        return { data: [], schema: [] };
    }
}

/**
 * Detect field types from data
 */
export function detectSchema(data: any[], headers: string[]): Field[] {
    return headers.map(header => {
        const field: Field = {
            name: header,
            type: detectFieldType(data, header)
        };
        return field;
    });
}

/**
 * Detect the type of a field based on sample data
 */
function detectFieldType(data: any[], fieldName: string): 'string' | 'number' | 'date' | 'boolean' {
    if (data.length === 0) return 'string';

    // Sample first 100 rows
    const sample = data.slice(0, 100);
    let numberCount = 0;
    let dateCount = 0;
    let booleanCount = 0;

    for (const row of sample) {
        const value = row[fieldName];
        if (value === null || value === undefined || value === '') continue;

        if (typeof value === 'boolean' || value === 'true' || value === 'false') {
            booleanCount++;
        } else if (!isNaN(Number(value)) && value !== '') {
            numberCount++;
        } else if (isValidDate(value)) {
            dateCount++;
        }
    }

    const total = sample.length;
    if (booleanCount / total > 0.8) return 'boolean';
    if (numberCount / total > 0.8) return 'number';
    if (dateCount / total > 0.8) return 'date';

    return 'string';
}

/**
 * Check if a value is a valid date
 */
function isValidDate(value: any): boolean {
    if (typeof value === 'string') {
        const date = new Date(value);
        const hasValidFormat = /\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value);
        return !isNaN(date.getTime()) && hasValidFormat;
    }
    return false;
}

/**
 * Parse a value to its appropriate type
 */
function parseValue(value: string): any {
    const trimmed = value.trim().replace(/^"|"$/g, '');

    if (trimmed === '') return null;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;

    const num = Number(trimmed);
    if (!isNaN(num) && trimmed !== '') return num;

    return trimmed;
}

/**
 * Apply filters to a dataset
 */
export function applyFilters(data: any[], filters: Filter[]): any[] {
    if (!filters || filters.length === 0) return data;

    return data.filter(row => {
        return filters.every(filter => {
            if (!filter.enabled && filter.enabled !== undefined) return true;
            return evaluateFilter(row, filter);
        });
    });
}

/**
 * Evaluate a single filter against a row
 */
function evaluateFilter(row: any, filter: Filter): boolean {
    const value = getFieldValue(row, filter.field);
    const filterValue = filter.value;

    // Type-aware comparison
    const isNumeric = (val: any) => val !== null && val !== undefined && val !== '' && !isNaN(Number(val));
    const isDate = (val: any) => typeof val === 'string' && !isNaN(Date.parse(val)) && (val.includes('-') || val.includes('/'));

    const compareValues = (a: any, b: any, operator: string) => {
        if (isNumeric(a) && isNumeric(b)) {
            const na = Number(a);
            const nb = Number(b);
            if (operator === 'gt') return na > nb;
            if (operator === 'lt') return na < nb;
            if (operator === 'ge') return na >= nb;
            if (operator === 'le') return na <= nb;
        }

        if (isDate(a) && isDate(b)) {
            const da = new Date(a).getTime();
            const db = new Date(b).getTime();
            if (operator === 'gt') return da > db;
            if (operator === 'lt') return da < db;
            if (operator === 'ge') return da >= db;
            if (operator === 'le') return da <= db;
        }

        // Fallback to string comparison
        if (operator === 'gt') return a > b;
        if (operator === 'lt') return a < b;
        if (operator === 'ge') return a >= b;
        if (operator === 'le') return a <= b;
        return false;
    };

    switch (filter.operator) {
        case 'equals':
            return value == filterValue;
        case 'notEquals':
            return value != filterValue;
        case 'contains':
            return String(value).toLowerCase().includes(String(filterValue).toLowerCase());
        case 'notContains':
            return !String(value).toLowerCase().includes(String(filterValue).toLowerCase());
        case 'startsWith':
            return String(value).toLowerCase().startsWith(String(filterValue).toLowerCase());
        case 'endsWith':
            return String(value).toLowerCase().endsWith(String(filterValue).toLowerCase());
        case 'greaterThan':
            return compareValues(value, filterValue, 'gt');
        case 'lessThan':
            return compareValues(value, filterValue, 'lt');
        case 'greaterOrEqual':
            return compareValues(value, filterValue, 'ge');
        case 'lessOrEqual':
            return compareValues(value, filterValue, 'le');
        case 'between':
            return compareValues(value, filterValue, 'ge') && compareValues(value, filter.value2, 'le');
        case 'in':
            return Array.isArray(filterValue) && filterValue.includes(value);
        case 'notIn':
            return Array.isArray(filterValue) && !filterValue.includes(value);
        case 'isNull':
            return value === null || value === undefined || value === '';
        case 'isNotNull':
            return value !== null && value !== undefined && value !== '';
        default:
            return true;
    }
}

/**
 * Calculate statistics for a field
 */
export function calculateFieldStats(data: any[], fieldName: string): DataStats {
    const values = data.map(row => getFieldValue(row, fieldName)).filter(v => v !== null && v !== undefined && v !== '');
    const uniqueValues = new Set(values);

    const stats: DataStats = {
        field: fieldName,
        count: data.length,
        uniqueCount: uniqueValues.size,
        nullCount: data.length - values.length
    };

    // Numeric statistics
    const numericValues = values.filter(v => !isNaN(Number(v))).map(Number);
    if (numericValues.length > 0) {
        stats.min = Math.min(...numericValues);
        stats.max = Math.max(...numericValues);
        stats.avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;

        // Calculate median
        const sorted = [...numericValues].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        stats.median = sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    return stats;
}

/**
 * Group data by a field
 */
export function groupBy(data: any[], field: string): Map<any, any[]> {
    const groups = new Map<any, any[]>();

    for (const row of data) {
        const key = getFieldValue(row, field);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(row);
    }

    return groups;
}

/**
 * Sort data by a field
 */
export function sortData(data: any[], field: string, direction: 'asc' | 'desc' = 'asc'): any[] {
    return [...data].sort((a, b) => {
        const aVal = getFieldValue(a, field);
        const bVal = getFieldValue(b, field);

        if (aVal === bVal) return 0;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        const comparison = aVal < bVal ? -1 : 1;
        return direction === 'asc' ? comparison : -comparison;
    });
}

/**
 * Get unique values for a field
 */
export function getUniqueValues(data: any[], field: string): any[] {
    const unique = new Set(data.map(row => getFieldValue(row, field)));
    return Array.from(unique).filter(v => v !== null && v !== undefined);
}

/**
 * Sample data for preview
 */
export function sampleData(data: any[], count: number = 100): any[] {
    if (data.length <= count) return data;

    // Random sampling
    const sampled: any[] = [];
    const step = Math.floor(data.length / count);

    for (let i = 0; i < data.length && sampled.length < count; i += step) {
        sampled.push(data[i]);
    }

    return sampled;
}

/**
 * Aggregate function for calculating statistics
 */
export function aggregate(data: any[], field: string, aggregation: AggregationType): number {
    if (data.length === 0) return 0;

    const values = data
        .map(row => getFieldValue(row, field))
        .filter(v => v !== null && v !== undefined && v !== '');

    if (values.length === 0) return 0;

    switch (aggregation) {
        case 'sum':
            return values.reduce((acc, val) => acc + Number(val), 0);

        case 'avg':
            const sum = values.reduce((acc, val) => acc + Number(val), 0);
            return sum / values.length;

        case 'count':
            return values.length;

        case 'countDistinct':
            return new Set(values).size;

        case 'min':
            return Math.min(...values.map(Number));

        case 'max':
            return Math.max(...values.map(Number));

        case 'none':
        default:
            return values.length > 0 ? Number(values[0]) : 0;
    }
}

/**
 * Process widget data with aggregations and filters
 */
export function processWidgetData(widget: BIWidget, dataSource: DataSource, crossFilters: Filter[] = []): any[] {
    let data = dataSource.data;

    // Apply cross-filters
    if (crossFilters.length > 0) {
        data = applyFilters(data, crossFilters);
    }

    // Apply widget-specific filters
    if (widget.filters && widget.filters.length > 0) {
        data = applyFilters(data, widget.filters);
    }

    // If no axes configured, return empty
    if (!widget.xAxis) return [];

    // Group by X-axis
    const grouped = groupBy(data, widget.xAxis);
    const result: any[] = [];

    // Calculate aggregations for each group
    grouped.forEach((groupData, key) => {
        const row: any = {};
        row[widget.xAxis!] = key;

        // Calculate Y-axis values
        if (widget.yAxis && widget.yAxis.length > 0) {
            widget.yAxis.forEach(yField => {
                const aggType = widget.aggregation || 'sum';
                row[yField] = aggregate(groupData, yField, aggType);
            });
        }

        // Add category/legend field if specified
        const legendField = DrillDownService.getLegendField(widget);
        if (legendField && groupData.length > 0) {
            row[legendField] = getFieldValue(groupData[0], legendField);
        }

        result.push(row);
    });

    // Sort by X-axis
    return sortData(result, widget.xAxis, 'asc');
}
