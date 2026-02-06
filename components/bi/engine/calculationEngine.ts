
// ============================================
// BI Calculation Engine
// ============================================

import { CalculatedField, QuickCalculation } from '../types';
import { getFieldValue } from './utils';

export const CalculationEngine = {
    // Pre-compile a formula into a reusable function for speed
    compile: (formula: string): ((row: any) => any) | null => {
        try {
            const fieldRegex = /\[(.*?)\]/g;
            const fieldsNeeded: string[] = [];
            let match;
            while ((match = fieldRegex.exec(formula)) !== null) {
                fieldsNeeded.push(match[1]);
            }

            // Create a formula that uses row['FieldName']
            let sanitizedFormula = formula;
            fieldsNeeded.forEach(field => {
                const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`\\[${escapedField}\\]`, 'g');
                // Use getFieldValue logic but simplified for speed
                sanitizedFormula = sanitizedFormula.replace(regex, `(Number(row["${field}"]) || 0)`);
            });

            // eslint-disable-next-line no-new-func
            return new Function('row', `try { return ${sanitizedFormula}; } catch(e) { return 0; }`) as any;
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
            parsedFormula = parsedFormula.replace(fieldRegex, (match, fieldName) => {
                const value = getFieldValue(row, fieldName);
                if (typeof value === 'string') return `"${value}"`;
                if (value === null || value === undefined) return '0';
                return String(value);
            });
            // eslint-disable-next-line no-new-func
            return new Function(`return ${parsedFormula}`)();
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

        return { valid: true };
    }
};
