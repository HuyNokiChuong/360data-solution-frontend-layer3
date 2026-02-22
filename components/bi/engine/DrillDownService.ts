// ============================================
// Drill-Down Service
// ============================================

import { BIWidget, Filter, DrillDownState } from '../types';

const getHierarchyFromWidget = (widget: BIWidget): string[] => {
    const hierarchy = (widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0)
        ? widget.drillDownHierarchy
        : (widget.type === 'pivot' && widget.pivotRows && widget.pivotRows.length > 0)
            ? widget.pivotRows
            : [];
    return hierarchy.filter(Boolean);
};

const isNullLikeValue = (value: any) => {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === '' || normalized === '(blank)' || normalized === 'null' || normalized === 'undefined' || normalized === 'nan';
};

const normalizeBreadcrumbValue = (value: any) => {
    if (isNullLikeValue(value)) {
        return { rawValue: null, value: '(Blank)' };
    }
    return { rawValue: value, value: String(value) };
};

const readFieldValueFromRow = (row: Record<string, any> | undefined, field: string) => {
    if (!row || !field) return undefined;
    if (Object.prototype.hasOwnProperty.call(row, field)) return row[field];

    const lowerField = field.toLowerCase();
    const matchedKey = Object.keys(row).find((key) => key.toLowerCase() === lowerField);
    if (matchedKey) return row[matchedKey];

    const baseField = field.split('___')[0];
    if (baseField && Object.prototype.hasOwnProperty.call(row, baseField)) return row[baseField];

    return undefined;
};

const sanitizeState = (state: DrillDownState, hierarchyOverride?: string[]): DrillDownState | null => {
    if (!state) return null;
    const hierarchy = (hierarchyOverride && hierarchyOverride.length > 0)
        ? hierarchyOverride
        : Array.isArray(state.hierarchy) ? state.hierarchy.filter(Boolean) : [];
    if (hierarchy.length === 0) return null;

    const maxLevel = hierarchy.length - 1;
    const currentLevel = Math.max(0, Math.min(Number(state.currentLevel || 0), maxLevel));
    const allowedBreadcrumbMaxLevel = Math.max(0, currentLevel - 1);
    const dedup = new Map<number, { level: number; value: string; rawValue?: any }>();
    (state.breadcrumbs || []).forEach((crumb) => {
        if (!crumb || !Number.isInteger(crumb.level)) return;
        if (crumb.level < 0 || crumb.level > allowedBreadcrumbMaxLevel) return;
        const normalized = normalizeBreadcrumbValue(crumb.rawValue ?? crumb.value);
        dedup.set(crumb.level, {
            level: crumb.level,
            value: normalized.value,
            rawValue: normalized.rawValue,
        });
    });

    const breadcrumbs = Array.from(dedup.values()).sort((a, b) => a.level - b.level);
    const mode = state.mode === 'expand' ? 'expand' : 'drill';

    return {
        widgetId: state.widgetId,
        hierarchy,
        currentLevel,
        breadcrumbs,
        mode,
    };
};

const isSameHierarchy = (a: string[], b: string[]) =>
    a.length === b.length && a.every((item, idx) => item === b[idx]);

/**
 * Service to handle drill-down and drill-up logic for widgets
 */
export const DrillDownService = {
    sanitizeState,
    resolveStateForWidget: (widget: BIWidget, state?: DrillDownState | null): DrillDownState | null => {
        const hierarchy = getHierarchyFromWidget(widget);
        if (hierarchy.length === 0) return null;
        if (!state) return null;

        const stateHierarchy = Array.isArray(state.hierarchy) ? state.hierarchy.filter(Boolean) : [];
        if (!isSameHierarchy(stateHierarchy, hierarchy)) {
            return {
                widgetId: widget.id,
                hierarchy,
                currentLevel: 0,
                breadcrumbs: [],
                mode: 'drill'
            };
        }

        const sanitized = sanitizeState(state, hierarchy);
        if (!sanitized) return null;
        return {
            ...sanitized,
            widgetId: widget.id,
        };
    },
    /**
     * Initialize drill-down state for a widget
     */
    initDrillDown: (widget: BIWidget): DrillDownState | null => {
        const hierarchy = getHierarchyFromWidget(widget);
        if (hierarchy.length === 0) {
            return null;
        }

        return {
            widgetId: widget.id,
            hierarchy: hierarchy,
            currentLevel: 0,
            breadcrumbs: [],
            mode: 'drill'
        };
    },

    /**
     * Drill down into a specific value
     */
    drillDown: (
        state: DrillDownState,
        value: any,
        clickedRow?: Record<string, any>
    ): { newState: DrillDownState; filter: Filter } | null => {
        const safeState = sanitizeState(state);
        if (!safeState) return null;
        if (safeState.currentLevel >= safeState.hierarchy.length - 1) {
            return null; // Already at the lowest level
        }

        const currentLevel = safeState.currentLevel;
        const currentField = safeState.hierarchy[currentLevel];
        const nextLevel = currentLevel + 1;

        const currentValueFromRow = readFieldValueFromRow(clickedRow, currentField);
        const resolvedCurrentValue = value !== undefined ? value : currentValueFromRow;
        if (resolvedCurrentValue === undefined) return null;
        const currentLevelValue = normalizeBreadcrumbValue(resolvedCurrentValue);
        const filterOperator = currentLevelValue.rawValue === null ? 'isNull' : 'equals';

        const filter: Filter = {
            id: `drill-${currentField}-${Date.now()}`,
            field: currentField,
            operator: filterOperator,
            value: currentLevelValue.rawValue,
            enabled: true
        };

        const previousByLevel = new Map((safeState.breadcrumbs || []).map((crumb) => [crumb.level, crumb]));
        const breadcrumbs: { level: number; value: string; rawValue?: any }[] = [];

        for (let level = 0; level <= currentLevel; level += 1) {
            const field = safeState.hierarchy[level];
            if (!field) continue;

            let sourceValue: any;
            if (level === currentLevel) {
                sourceValue = currentLevelValue.rawValue;
            } else {
                sourceValue = readFieldValueFromRow(clickedRow, field);
                if (sourceValue === undefined) {
                    const existing = previousByLevel.get(level);
                    sourceValue = existing ? (existing.rawValue ?? existing.value) : undefined;
                }
            }

            if (sourceValue === undefined) continue;
            const normalized = normalizeBreadcrumbValue(sourceValue);
            breadcrumbs.push({
                level,
                value: normalized.value,
                rawValue: normalized.rawValue,
            });
        }

        const newState: DrillDownState = {
            ...safeState,
            currentLevel: nextLevel,
            mode: 'drill',
            breadcrumbs
        };

        return { newState, filter };
    },

    /**
     * Drill to next level: Replace current dimension with the next one
     * Logic: Move down without filtering, but reset breadcrumbs/filter state
     */
    drillToNextLevel: (state: DrillDownState): DrillDownState | null => {
        const safeState = sanitizeState(state);
        if (!safeState) return null;
        if (safeState.currentLevel >= safeState.hierarchy.length - 1) {
            return null;
        }

        return {
            ...safeState,
            currentLevel: safeState.currentLevel + 1,
            mode: 'drill',
            breadcrumbs: [] // Next level drill-down (Double arrow) usually means aggregated next level
        };
    },

    /**
     * Expand all down: Show both current and next dimension
     */
    expandNextLevel: (state: DrillDownState): DrillDownState | null => {
        const safeState = sanitizeState(state);
        if (!safeState) return null;
        if (safeState.currentLevel >= safeState.hierarchy.length - 1) {
            return null;
        }

        return {
            ...safeState,
            currentLevel: safeState.currentLevel + 1,
            mode: 'expand'
        };
    },

    /**
     * Go to next level without filtering (Aggregrate all)
     */
    goToNextLevel: (state: DrillDownState): DrillDownState | null => {
        const safeState = sanitizeState(state);
        if (!safeState) return null;
        if (safeState.currentLevel >= safeState.hierarchy.length - 1) {
            return null;
        }

        return {
            ...safeState,
            currentLevel: safeState.currentLevel + 1
        };
    },

    /**
     * Drill up one level
     */
    drillUp: (state: DrillDownState): DrillDownState | null => {
        const safeState = sanitizeState(state);
        if (!safeState) return null;
        if (safeState.currentLevel <= 0) {
            return null; // Already at the top level
        }

        const nextLevel = safeState.currentLevel - 1;
        const newBreadcrumbs = (safeState.breadcrumbs || []).filter((crumb) => crumb.level < nextLevel);
        return {
            ...safeState,
            currentLevel: nextLevel,
            breadcrumbs: newBreadcrumbs
        };
    },

    /**
     * Get the current field to display on X-Axis based on drill level
     */
    getCurrentFields: (widget: BIWidget, state?: DrillDownState | null): string[] => {
        const resolvedState = DrillDownService.resolveStateForWidget(widget, state);
        if (resolvedState && resolvedState.hierarchy.length > 0) {
            if (resolvedState.mode === 'expand') {
                return resolvedState.hierarchy.slice(0, resolvedState.currentLevel + 1);
            }
            return [resolvedState.hierarchy[resolvedState.currentLevel] || resolvedState.hierarchy[0]];
        }

        const hierarchy = getHierarchyFromWidget(widget);
        if (hierarchy.length === 0) {
            const defaultField = widget.xAxis || widget.dimensions?.[0] || '';
            return defaultField ? [defaultField] : [];
        }

        return [hierarchy[0]];
    },
    /**
     * Get the current field to display as Legend based on hierarchy
     */
    getLegendField: (widget: BIWidget, state?: DrillDownState | null): string => {
        // NOTE: Currently we don't track legend drill state separately, 
        // but we can support starting with the first level of hierarchy if defined.
        if (widget.legendHierarchy && widget.legendHierarchy.length > 0) {
            return widget.legendHierarchy[0];
        }
        return widget.legend || '';
    }
};
