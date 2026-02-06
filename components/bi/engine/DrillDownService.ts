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
        if (!widget.drillDownHierarchy || widget.drillDownHierarchy.length === 0) {
            return null;
        }

        return {
            widgetId: widget.id,
            hierarchy: widget.drillDownHierarchy,
            currentLevel: 0,
            breadcrumbs: []
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
    getCurrentField: (widget: BIWidget, state?: DrillDownState | null): string => {
        if (!state || !widget.drillDownHierarchy || widget.drillDownHierarchy.length === 0) {
            // If we have a hierarchy but no state yet, show the first level of the hierarchy
            if (widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0) {
                return widget.drillDownHierarchy[0];
            }
            return widget.xAxis || widget.dimensions?.[0] || '';
        }
        return (state.hierarchy && state.hierarchy[state.currentLevel]) || state.hierarchy[0];
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
