import { create } from 'zustand';
import { Filter, CrossFilterState, DrillDownState } from '../types';

interface FilterState {
    // Active cross-filters
    crossFilters: CrossFilterState[];

    // Active drill-down states
    drillDowns: Record<string, DrillDownState>;

    // Actions
    addCrossFilter: (sourceWidgetId: string, filters: Filter[], affectedWidgetIds: string[]) => void;
    removeCrossFilter: (sourceWidgetId: string) => void;
    clearAllFilters: () => void;

    setDrillDown: (widgetId: string, state: DrillDownState | null) => void;

    // Utility
    getFiltersForWidget: (widgetId: string) => Filter[];
    getCrossFiltersForWidget: (widgetId: string) => Filter[];
    isWidgetFiltered: (widgetId: string) => boolean;
    getDrillDown: (widgetId: string) => DrillDownState | null;
}

export const useFilterStore = create<FilterState>((set, get) => ({
    // Initial state
    crossFilters: [],
    drillDowns: {},

    // Actions
    addCrossFilter: (sourceWidgetId, filters, affectedWidgetIds) => set((state) => {
        // Remove existing filter from same source
        const filtered = state.crossFilters.filter(cf => cf.sourceWidgetId !== sourceWidgetId);

        return {
            crossFilters: [
                ...filtered,
                { sourceWidgetId, filters, affectedWidgetIds }
            ]
        };
    }),

    removeCrossFilter: (sourceWidgetId) => set((state) => ({
        crossFilters: state.crossFilters.filter(cf => cf.sourceWidgetId !== sourceWidgetId)
    })),

    clearAllFilters: () => set({ crossFilters: [] }),

    setDrillDown: (widgetId, drillDownState) => set((state) => {
        const newDrillDowns = { ...state.drillDowns };
        if (drillDownState) {
            newDrillDowns[widgetId] = drillDownState;
        } else {
            delete newDrillDowns[widgetId];
        }
        return { drillDowns: newDrillDowns };
    }),

    // Utility getters
    getFiltersForWidget: (widgetId) => {
        const { crossFilters } = get();
        const applicableFilters: Filter[] = [];

        for (const cf of crossFilters) {
            if (cf.affectedWidgetIds.includes(widgetId)) {
                applicableFilters.push(...cf.filters);
            }
        }

        return applicableFilters;
    },

    isWidgetFiltered: (widgetId) => {
        const { crossFilters } = get();
        return crossFilters.some(cf => cf.affectedWidgetIds.includes(widgetId));
    },

    getDrillDown: (widgetId) => {
        return get().drillDowns[widgetId] || null;
    },

    // Alias for consistency
    getCrossFiltersForWidget: (widgetId) => {
        return get().getFiltersForWidget(widgetId);
    }
}));
