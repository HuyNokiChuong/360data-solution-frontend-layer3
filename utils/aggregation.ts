import type { AggregationType } from '../components/bi/types';

export const AGGREGATION_OPTIONS: Array<{ value: AggregationType; label: string }> = [
    { value: 'sum', label: 'SUM' },
    { value: 'avg', label: 'AVG' },
    { value: 'count', label: 'COUNT' },
    { value: 'min', label: 'MIN' },
    { value: 'max', label: 'MAX' },
    { value: 'countDistinct', label: 'DISTINCT' },
];

const NON_NUMERIC_AGGREGATIONS: AggregationType[] = ['count', 'countDistinct', 'min', 'max'];
const NUMERIC_AGGREGATIONS: AggregationType[] = ['sum', 'avg', 'count', 'countDistinct', 'min', 'max'];

const isNumericFieldType = (fieldType?: string | null): boolean => {
    const normalized = String(fieldType || '').trim().toLowerCase();
    if (!normalized) return false;
    return normalized === 'number'
        || normalized.includes('numeric')
        || normalized.includes('decimal')
        || normalized.includes('int')
        || normalized.includes('float')
        || normalized.includes('double')
        || normalized.includes('real')
        || normalized.includes('money');
};

export const getDefaultAggregationForFieldType = (fieldType?: string | null): AggregationType => {
    return isNumericFieldType(fieldType) ? 'sum' : 'count';
};

export const getAggregationOptionsForFieldType = (fieldType?: string | null): Array<{ value: AggregationType; label: string }> => {
    const allowed = new Set(isNumericFieldType(fieldType) ? NUMERIC_AGGREGATIONS : NON_NUMERIC_AGGREGATIONS);
    return AGGREGATION_OPTIONS.filter((option) => allowed.has(option.value));
};

export const normalizeAggregation = (aggregation?: string | null): AggregationType => {
    const raw = String(aggregation || '').trim().toLowerCase();

    switch (raw) {
        case 'sum':
            return 'sum';
        case 'avg':
        case 'average':
            return 'avg';
        case 'count':
            return 'count';
        case 'min':
            return 'min';
        case 'max':
            return 'max';
        case 'countdistinct':
        case 'count_distinct':
        case 'distinct':
            return 'countDistinct';
        case 'none':
        case 'raw':
            return 'none';
        default:
            return 'sum';
    }
};

export const coerceAggregationForFieldType = (aggregation: string | null | undefined, fieldType?: string | null): AggregationType => {
    const normalized = normalizeAggregation(aggregation);
    const allowed = new Set((isNumericFieldType(fieldType) ? NUMERIC_AGGREGATIONS : NON_NUMERIC_AGGREGATIONS));
    if (allowed.has(normalized)) return normalized;
    return getDefaultAggregationForFieldType(fieldType);
};
