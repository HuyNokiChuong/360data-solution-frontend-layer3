
// ============================================
// BI Calculation Engine
// ============================================

import { CalculatedField, QuickCalculation } from '../types';
import { getFieldValue } from './utils';

const formulaHelpers = {
    IF: (condition: any, trueValue: any, falseValue: any = null) => (condition ? trueValue : falseValue),
    AND: (...args: any[]) => args.every(Boolean),
    OR: (...args: any[]) => args.some(Boolean),
    NOT: (value: any) => !value,
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

export const CalculationEngine = {
    // Pre-compile a formula into a reusable function for speed
    compile: (formula: string): ((row: any) => any) | null => {
        try {
            const fieldRegex = /\[(.*?)\]/g;
            const sanitizedFormula = formula.replace(fieldRegex, (_match, fieldName) => `__value(row, ${JSON.stringify(fieldName)})`);

            // eslint-disable-next-line no-new-func
            const evaluator = new Function(
                'row',
                '__value',
                ...Object.keys(formulaHelpers),
                `return (${sanitizedFormula});`
            );

            const helperValues = Object.values(formulaHelpers);
            return (row: any) => {
                const valueResolver = (inputRow: any, fieldName: string) => {
                    const value = getFieldValue(inputRow, fieldName);
                    if (value === null || value === undefined || value === '') return 0;
                    if (typeof value === 'string') {
                        const parsed = Number(value);
                        return Number.isNaN(parsed) ? value : parsed;
                    }
                    return value;
                };

                try {
                    return evaluator(row, valueResolver, ...helperValues);
                } catch {
                    return null;
                }
            };
        } catch (error) {
            console.error('Failed to compile formula:', formula, error);
            return null;
        }
    },

    // Evaluate a calculated field against a data row
    evaluate: (formula: string, row: any): any => {
        try {
            const fieldRegex = /\[(.*?)\]/g;
            let parsedFormula = formula;
            parsedFormula = parsedFormula.replace(fieldRegex, (_match, fieldName) => {
                const value = getFieldValue(row, fieldName);
                if (typeof value === 'string') return `"${value}"`;
                if (value === null || value === undefined) return '0';
                return String(value);
            });
            // eslint-disable-next-line no-new-func
            const evaluator = new Function(...Object.keys(formulaHelpers), `return ${parsedFormula}`);
            return evaluator(...Object.values(formulaHelpers));
        } catch (error) {
            console.warn('Calculation error:', error, formula, row);
            return null;
        }
    },

    // Apply quick calculations to a dataset
    applyQuickCalculation: (
        data: any[],
        valueField: string,
        categoryField: string,
        type: QuickCalculation,
        options?: { window?: number; outputField?: string }
    ): any[] => {
        if (!data || data.length === 0) return [];

        const result = [...data]; // Clone
        const total = data.reduce((sum, item) => sum + (Number(item[valueField]) || 0), 0);
        const outField = options?.outputField || `${valueField}_${type}`;

        switch (type) {
            case 'percentOfTotal':
                return result.map(item => ({
                    ...item,
                    [outField]: total === 0 ? 0 : ((Number(getFieldValue(item, valueField)) || 0) / total) * 100
                }));

            case 'runningTotal':
                let running = 0;
                return result.map(item => {
                    running += (Number(getFieldValue(item, valueField)) || 0);
                    return {
                        ...item,
                        [outField]: running
                    };
                });

            case 'movingAverage': {
                // Configurable moving average window (default 3)
                const window = options?.window || 3;
                return result.map((item, index) => {
                    let sum = 0;
                    let count = 0;

                    // Calculate average from window before to window after current index
                    for (let i = Math.max(0, index - Math.floor(window / 2));
                        i <= Math.min(result.length - 1, index + Math.floor(window / 2));
                        i++) {
                        sum += (Number(getFieldValue(result[i], valueField)) || 0);
                        count++;
                    }

                    return {
                        ...item,
                        [outField]: count > 0 ? sum / count : 0
                    };
                });
            }

            case 'yearOverYear':
                // Assumes data is sorted by date/time
                // Compares current value with value 12 months ago
                return result.map((item, index) => {
                    const previousYearIndex = index - 12; // Assumes monthly data
                    if (previousYearIndex >= 0 && previousYearIndex < result.length) {
                        const currentValue = Number(getFieldValue(item, valueField)) || 0;
                        const previousValue = Number(getFieldValue(result[previousYearIndex], valueField)) || 0;
                        const yoyChange = previousValue !== 0
                            ? ((currentValue - previousValue) / previousValue) * 100
                            : 0;

                        return {
                            ...item,
                            [outField]: yoyChange
                        };
                    }
                    return {
                        ...item,
                        [outField]: null
                    };
                });

            case 'difference':
                // Difference from previous period
                return result.map((item, index) => {
                    if (index === 0) {
                        return {
                            ...item,
                            [outField]: 0
                        };
                    }
                    const currentValue = Number(getFieldValue(item, valueField)) || 0;
                    const previousValue = Number(getFieldValue(result[index - 1], valueField)) || 0;
                    return {
                        ...item,
                        [outField]: currentValue - previousValue
                    };
                });

            case 'percentChange':
                // Percent change from previous period
                return result.map((item, index) => {
                    if (index === 0) {
                        return {
                            ...item,
                            [outField]: 0
                        };
                    }
                    const currentValue = Number(getFieldValue(item, valueField)) || 0;
                    const previousValue = Number(getFieldValue(result[index - 1], valueField)) || 0;
                    const pctChange = previousValue !== 0
                        ? ((currentValue - previousValue) / previousValue) * 100
                        : 0;
                    return {
                        ...item,
                        [outField]: pctChange
                    };
                });

            default:
                return result;
        }
    },

    validateFormula: (formula: string, availableFields: string[]): { valid: boolean; error?: string } => {
        if (!formula.trim()) return { valid: false, error: 'Formula is required' };

        // Check for balanced brackets
        let openBrackets = 0;
        for (const char of formula) {
            if (char === '[') openBrackets++;
            if (char === ']') openBrackets--;
        }

        if (openBrackets !== 0) return { valid: false, error: 'Unbalanced brackets' };

        // Check fields exist
        const fieldRegex = /\[(.*?)\]/g;
        let match;
        while ((match = fieldRegex.exec(formula)) !== null) {
            const fieldName = match[1];
            if (!availableFields.includes(fieldName)) {
                return { valid: false, error: `Field [${fieldName}] not found` };
            }
        }

        // Check JS expression syntax
        const compiled = CalculationEngine.compile(formula);
        if (!compiled) {
            return { valid: false, error: 'Invalid formula syntax' };
        }

        return { valid: true };
    }
};
