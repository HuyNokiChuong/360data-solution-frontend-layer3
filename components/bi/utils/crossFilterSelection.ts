import { CrossFilterState, Filter } from '../types';

export const isNullLikeValue = (value: any) => {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === '' || normalized === '(blank)' || normalized === 'null' || normalized === 'undefined' || normalized === 'nan';
};

export const findSourceSelectionFilter = (
    crossFilters: CrossFilterState[],
    widgetId: string,
    candidateFields: string[]
): Filter | undefined => {
    const sourceFilter = crossFilters.find((cf) => cf.sourceWidgetId === widgetId);
    if (!sourceFilter || sourceFilter.filters.length === 0) return undefined;

    const fields = candidateFields.filter(Boolean);
    return sourceFilter.filters.find((f) => fields.includes(f.field)) || sourceFilter.filters[0];
};

export const readSelectionValue = (payload: any, candidateFields: string[]) => {
    if (!payload || typeof payload !== 'object') return payload;

    for (const field of candidateFields) {
        if (!field) continue;
        if (Object.prototype.hasOwnProperty.call(payload, field)) {
            return payload[field];
        }
    }

    return payload._rawAxisValue ?? payload._formattedAxis ?? payload._combinedAxis ?? payload._autoCategory ?? payload.name;
};

export const isPayloadSelected = (
    payload: any,
    selectionFilter: Filter | undefined,
    candidateFields: string[]
) => {
    if (!selectionFilter) return true;

    const selectedValue = readSelectionValue(payload, [selectionFilter.field, ...candidateFields]);
    const operator = selectionFilter.operator || 'equals';

    if (operator === 'isNull') {
        return isNullLikeValue(selectedValue);
    }

    if (operator === 'isNotNull') {
        return !isNullLikeValue(selectedValue);
    }

    if (operator === 'equals') {
        if (selectedValue == selectionFilter.value) return true;
        return isNullLikeValue(selectedValue) && isNullLikeValue(selectionFilter.value);
    }

    return selectedValue == selectionFilter.value;
};
