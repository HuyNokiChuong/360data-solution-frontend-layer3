import { useMemo } from 'react';
import { useDataStore } from '../store/dataStore';
import { BIWidget, BIDashboard } from '../types';
import { CalculationEngine } from '../engine/calculationEngine';
import { useDashboardStore } from '../store/dashboardStore';

export const useWidgetData = (widget: BIWidget) => {
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));
    const { dataSources, selectedDataSourceId } = useDataStore();
    const dataSource = useMemo(() => {
        const id = widget.dataSourceId || selectedDataSourceId;
        return dataSources.find(ds => ds.id === id);
    }, [dataSources, widget.dataSourceId, selectedDataSourceId]);

    return useMemo(() => {
        // 1. Get raw data
        if (!dataSource || !dataSource.data || dataSource.data.length === 0) return [];

        // PERFORMANCE GUARD: Cap the amount of data processed locally for formulas/measures
        // Using 50,000 for stability. Large datasets (>50k) should use BigQuery counts/aggs.
        const MAX_PROCESSING_ROWS = 50000;
        let data = dataSource.data.length > MAX_PROCESSING_ROWS
            ? dataSource.data.slice(0, MAX_PROCESSING_ROWS)
            : [...dataSource.data];

        // 2. Apply Custom Calculated Fields (Formulas)
        // Combine widget-level and dashboard-level calculations
        const allCalculatedFields = [
            ...(activeDashboard?.calculatedFields || []),
            ...(widget.calculatedFields || [])
        ];

        if (allCalculatedFields.length > 0) {
            // Pre-compile formulas for performance
            const compiledFields = allCalculatedFields.map(f => ({
                name: f.name,
                evaluate: CalculationEngine.compile(f.formula)
            })).filter(f => f.evaluate);

            data = data.map(row => {
                const newRow = { ...row };
                compiledFields.forEach(cf => {
                    newRow[cf.name] = cf.evaluate!(newRow);
                });
                return newRow;
            });
        }

        // 3. Apply Quick Measures
        const allQuickMeasures = [
            ...(activeDashboard?.quickMeasures || []),
            ...(widget.quickMeasures || [])
        ];

        if (allQuickMeasures.length > 0) {
            allQuickMeasures.forEach(measure => {
                data = CalculationEngine.applyQuickCalculation(
                    data,
                    measure.field,
                    '', // categoryField not used currently
                    measure.calculation,
                    {
                        window: measure.window,
                        outputField: measure.label // Use the label as the field name in the result
                    }
                );
            });
        }

        return data;
    }, [dataSource?.data, widget.quickMeasures, widget.calculatedFields, activeDashboard?.quickMeasures, activeDashboard?.calculatedFields]);
};
