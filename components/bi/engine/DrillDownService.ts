// ============================================
// Drill-Down Service
// ============================================

import { BIWidget, Filter, DrillDownState } from '../types';

/**
 * Service to handle drill-down and drill-up logic for widgets
 */
export const DrillDownService = {
    /**
     * Initialize drill-down state for a widget
     */
    initDrillDown: (widget: BIWidget): DrillDownState | null => {
        const hierarchy = (widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0)
            ? widget.drillDownHierarchy
            : (widget.type === 'pivot' && widget.pivotRows && widget.pivotRows.length > 0)
                ? widget.pivotRows
                : null;

        if (!hierarchy) {
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
        value: any
    ): { newState: DrillDownState; filter: Filter } | null => {
        if (state.currentLevel >= state.hierarchy.length - 1) {
            return null; // Already at the lowest level
        }

        const currentField = state.hierarchy[state.currentLevel];
        const nextLevel = state.currentLevel + 1;

        const filter: Filter = {
            id: `drill-${currentField}-${Date.now()}`,
            field: currentField,
            operator: 'equals',
            value: value,
            enabled: true
        };

        const newState: DrillDownState = {
            ...state,
            currentLevel: nextLevel,
            breadcrumbs: [
                ...state.breadcrumbs,
                { level: state.currentLevel, value: String(value) }
            ]
        };

        return { newState, filter };
    },

    /**
     * Drill to next level: Replace current dimension with the next one
     * Logic: Move down without filtering, but reset breadcrumbs/filter state
     */
    drillToNextLevel: (state: DrillDownState): DrillDownState | null => {
        if (state.currentLevel >= state.hierarchy.length - 1) {
            return null;
        }

        return {
            ...state,
            currentLevel: state.currentLevel + 1,
            mode: 'drill',
            breadcrumbs: [] // Next level drill-down (Double arrow) usually means aggregated next level
        };
    },

    /**
     * Expand all down: Show both current and next dimension
     */
    expandNextLevel: (state: DrillDownState): DrillDownState | null => {
        if (state.currentLevel >= state.hierarchy.length - 1) {
            return null;
        }

        return {
            ...state,
            currentLevel: state.currentLevel + 1,
            mode: 'expand'
        };
    },

    /**
     * Go to next level without filtering (Aggregrate all)
     */
    goToNextLevel: (state: DrillDownState): DrillDownState | null => {
        if (state.currentLevel >= state.hierarchy.length - 1) {
            return null;
        }

        return {
            ...state,
            currentLevel: state.currentLevel + 1
        };
    },

    /**
     * Drill up one level
     */
    drillUp: (state: DrillDownState): DrillDownState | null => {
        if (state.currentLevel <= 0) {
            return null; // Already at the top level
        }

        const newBreadcrumbs = state.breadcrumbs.slice(0, -1);
        return {
            ...state,
            currentLevel: state.currentLevel - 1,
            breadcrumbs: newBreadcrumbs
        };
    },

    /**
     * Get the current field to display on X-Axis based on drill level
     */
    getCurrentFields: (widget: BIWidget, state?: DrillDownState | null): string[] => {
        // 1. If active state exists, use it (Prioritize state as it likely contains the correct hierarchy snapshot)
        if (state && state.hierarchy && state.hierarchy.length > 0) {
            if (state.mode === 'expand') {
                return state.hierarchy.slice(0, state.currentLevel + 1);
            }
            return [state.hierarchy[state.currentLevel] || state.hierarchy[0]];
        }

        // 2. If no state, check Widget definition
        const hierarchy = (widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0)
            ? widget.drillDownHierarchy
            : (widget.type === 'pivot' && widget.pivotRows && widget.pivotRows.length > 0)
                ? widget.pivotRows
                : null;

        if (!hierarchy) {
            const defaultField = widget.xAxis || widget.dimensions?.[0] || '';
            return defaultField ? [defaultField] : [];
        }

        // 3. Default to Top Level of Hierarchy
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
