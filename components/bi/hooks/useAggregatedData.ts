import { useMemo, useState, useEffect } from 'react';
import { useWidgetData } from './useWidgetData';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import { useDataStore } from '../store/dataStore';
import { applyFilters } from '../engine/dataProcessing';
import { groupAndAggregate, groupAndAggregateMulti, groupAndAggregateMeasures } from '../engine/calculations';
import { DrillDownService } from '../engine/DrillDownService';
import { BIWidget } from '../types';

/**
 * useAggregatedData - Hook to centralize filtering and aggregation logic for report charts.
 * This ensures that widgets receive only the minimal data they need to render, improving performance.
 */
export const useAggregatedData = (widget: BIWidget) => {
    const { getFiltersForWidget, drillDowns, crossFilters: allDashboardFilters } = useFilterStore();
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));
    const drillDownState = drillDowns[widget.id];

    const widgetData = useWidgetData(widget);
    const { getDataSource, selectedDataSourceId } = useDataStore();
    const [remoteData, setRemoteData] = useState<{ chartData: any[], series: string[], lineSeries: string[] } | null>(null);
    const [isRemoteLoading, setIsRemoteLoading] = useState(false);
    const [remoteError, setRemoteError] = useState<string | null>(null);

    const googleToken = useDataStore(state => state.dataSources.find(ds => ds.type === 'bigquery')?.connectionId); // Simplified token access

    const dataSource = useMemo(() => {
        const id = widget.dataSourceId || selectedDataSourceId;
        return id ? getDataSource(id) : null;
    }, [widget.dataSourceId, selectedDataSourceId, getDataSource]);

    // Remote Aggregation Logic for BIG DATA
    useEffect(() => {
        // Condition: BigQuery + Large dataset (> 1M) + We have a token
        if (dataSource?.type === 'bigquery' && (dataSource.totalRows || 0) > 1000000 && dataSource.connectionId) {
            const fetchRemote = async () => {
                const { fetchAggregatedData } = await import('../../../services/bigquery');

                // Get the token from localStorage or state
                const googleToken = localStorage.getItem('google_token');

                setIsRemoteLoading(true);
                setRemoteError(null);

                try {
                    // Map widget config to BigQuery dimensions/measures
                    const dimensions = [widget.xAxis!];
                    if (DrillDownService.getLegendField(widget, drillDownState)) {
                        dimensions.push(DrillDownService.getLegendField(widget, drillDownState)!);
                    }

                    const measures = (widget.yAxisConfigs || [{ field: widget.yAxis?.[0] || widget.measures?.[0] || '', aggregation: widget.aggregation || 'sum' }])
                        .map(m => ({ field: m.field, aggregation: m.aggregation }));

                    const results = await fetchAggregatedData(
                        googleToken || '',
                        dataSource.connectionId || '',
                        dataSource.datasetName || '',
                        dataSource.tableName || '',
                        { dimensions, measures, filters: widget.filters, limit: 1000 }
                    );

                    // Transform BQ results back to UI format
                    setRemoteData({
                        chartData: results,
                        series: measures.map(m => `${m.field}_${m.aggregation}`),
                        lineSeries: []
                    });
                } catch (err: any) {
                    setRemoteError(err.message);
                } finally {
                    setIsRemoteLoading(false);
                }
            };

            fetchRemote();
        } else {
            setRemoteData(null);
        }
    }, [widget.id, widget.xAxis, widget.yAxis, widget.aggregation, widget.filters, dataSource?.id, drillDownState]);

    return useMemo(() => {
        // If we have remote data, use it!
        if (remoteData) {
            return { ...remoteData, error: remoteError, isLoading: isRemoteLoading };
        }

        if (!widgetData || widgetData.length === 0) {
            return { chartData: [], series: [], lineSeries: [], error: null, isLoading: isRemoteLoading };
        }

        const DATA_CAPPING_LIMIT = 50000;
        const isCapped = widgetData.length > DATA_CAPPING_LIMIT;

        try {
            // Processing for regular/small data
            let data = isCapped ? widgetData.slice(0, DATA_CAPPING_LIMIT) : widgetData;
            // ... (rest of the processing logic remains the same)
            // Note: I will only keep the core of the Memo here for brevity in the replacement chunk
            // as the previous logic for local aggregation is fine.


            // 1. Apply widget-level filters
            if (widget.filters && widget.filters.length > 0) {
                data = applyFilters(data, widget.filters);
            }

            // 2. Apply cross-filters
            if (widget.enableCrossFilter !== false) {
                const crossFilters = getFiltersForWidget(widget.id);
                if (crossFilters.length > 0) {
                    data = applyFilters(data, crossFilters);
                }
            }

            // 3. Apply global filters
            if (activeDashboard?.globalFilters?.length) {
                const relevantFilters = activeDashboard.globalFilters.filter(gf =>
                    !gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)
                );
                if (relevantFilters.length > 0) {
                    data = applyFilters(data, relevantFilters as any[]);
                }
            }

            // 4. Apply drill-down filters (stored in breadcrumbs)
            if (drillDownState && drillDownState.breadcrumbs.length > 0) {
                const drillFilters = drillDownState.breadcrumbs.map(bc => ({
                    id: `drill-${bc.level}`,
                    field: drillDownState.hierarchy[bc.level],
                    operator: 'equals' as const,
                    value: bc.value,
                    enabled: true
                }));
                data = applyFilters(data, drillFilters);
            }

            const xField = DrillDownService.getCurrentField(widget, drillDownState);
            const legendField = DrillDownService.getLegendField(widget, drillDownState);
            let result: { chartData: any[], series: string[], lineSeries: string[], error: string | null } = { chartData: [], series: [], lineSeries: [], error: null };
            let primaryValueField = '';

            // CASE 1: Single Measure + Legend (Categorical series)
            // Priority given to Legend if present, as it defines horizontal stacking/clustering
            const yField = widget.yAxis?.[0] || widget.measures?.[0] || widget.values?.[0] || widget.yAxisConfigs?.[0]?.field;
            primaryValueField = yField || '';

            if (legendField && yField) {
                result = {
                    ...groupAndAggregateMulti(
                        data,
                        xField,
                        legendField,
                        yField,
                        widget.aggregation || 'sum',
                        widget.legendAliases || {}
                    ),
                    lineSeries: [],
                    error: null
                };
            }
            // CASE 2: Multiple Measures (Bar + Line or multiple Bars) - No Legend
            else if ((widget.yAxisConfigs && widget.yAxisConfigs.length > 0) || (widget.lineAxisConfigs && widget.lineAxisConfigs.length > 0)) {
                result = {
                    ...groupAndAggregateMeasures(
                        data,
                        xField,
                        widget.yAxisConfigs || [],
                        widget.lineAxisConfigs || []
                    ),
                    error: null
                };
                primaryValueField = widget.yAxisConfigs?.[0]?.field || widget.lineAxisConfigs?.[0]?.field || '';
            }
            // CASE 3: Single Grouping (Basic aggregation)
            else {
                if (!xField || !yField) {
                    result = { chartData: [], series: [], lineSeries: [], error: 'Axes not configured' };
                }
                else if (widget.aggregation === 'none') {
                    // Sanitize data to ensure values are primitives (avoid Recharts Max call stack crashes)
                    const sanitizedData = data.map(row => {
                        const newRow: any = { ...row };
                        if (xField && typeof newRow[xField] === 'object') newRow[xField] = String(newRow[xField]);
                        if (yField && typeof newRow[yField] === 'object') newRow[yField] = String(newRow[yField]);
                        return newRow;
                    });
                    result = { chartData: sanitizedData, series: [], lineSeries: [], error: null };
                }
                else {
                    const aggregated = groupAndAggregate(
                        data,
                        xField,
                        yField,
                        widget.aggregation || 'sum'
                    );

                    // Special handling for multiple Y axes (e.g. Z field in Scatter)
                    if (widget.yAxis && widget.yAxis.length > 1) {
                        for (let i = 1; i < widget.yAxis.length; i++) {
                            const extraField = widget.yAxis[i];
                            const extraAgg = groupAndAggregate(data, xField, extraField, widget.aggregation || 'sum');
                            const extraMap = new Map(extraAgg.map(item => [item[xField], item[extraField]]));

                            aggregated.forEach(item => {
                                item[extraField] = extraMap.get(item[xField]) || 0;
                            });
                        }
                    }

                    result = {
                        chartData: aggregated,
                        series: [],
                        lineSeries: [],
                        error: null
                    };
                }
            }

            // Apply Sorting
            if (widget.sortBy && widget.sortBy !== 'none' && result.chartData.length > 0) {
                const isCategorySort = widget.sortBy.includes('category');
                // Determine which field to sort by
                // If category: xField
                // If value: primaryValueField (from Case 1/2/3) OR the first series if available
                let sortKey = isCategorySort ? xField : primaryValueField;

                // If we don't have a primary value field determined yet (e.g. in legend case where keys are values of the legend field)
                if (!isCategorySort && !sortKey && result.series.length > 0) {
                    // For stacked charts/legend, sorting by "total" is often expected, but for now let's sort by the first series
                    sortKey = result.series[0];
                }

                if (sortKey) {
                    const isDesc = widget.sortBy.endsWith('_desc');

                    result.chartData.sort((a, b) => {
                        const valA = a[sortKey];
                        const valB = b[sortKey];

                        // Handle nulls always last
                        if (valA === undefined || valA === null) return 1;
                        if (valB === undefined || valB === null) return -1;

                        if (typeof valA === 'number' && typeof valB === 'number') {
                            return isDesc ? valB - valA : valA - valB;
                        }

                        const strA = String(valA);
                        const strB = String(valB);
                        return isDesc ? strB.localeCompare(strA) : strA.localeCompare(strB);
                    });
                }
            }

            // FINALIZE: Safety Truncation for Rendering
            const MAX_CHART_ITEMS = 2000;
            if (result.chartData.length > MAX_CHART_ITEMS) {
                result.chartData = result.chartData.slice(0, MAX_CHART_ITEMS);
                result.error = `Showing first ${MAX_CHART_ITEMS} items. Use filters to narrow down.`;
            }

            if (isCapped && !result.error) {
                result.error = `Data sampled from first 50,000 rows. Use BigQuery for full analysis.`;
            }

            return { ...result, isLoading: isRemoteLoading, isCapped };

        } catch (err: any) {
            console.error('Aggregation error:', err);
            return { chartData: [], series: [], lineSeries: [], error: err.message, isLoading: isRemoteLoading };
        }
    }, [
        widgetData,
        widget.filters,
        widget.enableCrossFilter,
        widget.yAxisConfigs,
        widget.lineAxisConfigs,
        widget.xAxis,
        widget.yAxis,
        widget.measures,
        widget.values,
        widget.aggregation,
        widget.drillDownHierarchy,
        activeDashboard?.globalFilters,
        drillDownState,
        getFiltersForWidget,
        allDashboardFilters,
        widget.sortBy, // Dependency needed for re-sort
        widget.legend,
        widget.legendHierarchy,
        widget.legendAliases
    ]);
};
