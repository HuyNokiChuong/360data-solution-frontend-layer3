import { useState, useEffect, useRef, useMemo } from 'react';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import { fetchAggregatedData } from '../../../services/bigquery';
import { DrillDownService } from '../engine/DrillDownService';

export const useAggregatedData = (widget: BIWidget) => {
    const { getDataSource, googleToken, connections } = useDataStore();
    const { crossFilters, drillDowns } = useFilterStore();
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));
    const globalFilters = activeDashboard?.globalFilters || [];

    // ... rest of the hook
    const [chartData, setChartData] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Identify Series
    const series = useMemo(() => {
        if (widget.yAxisConfigs && widget.yAxisConfigs.length > 0) {
            return widget.yAxisConfigs.map(c => c.field);
        }
        return widget.yAxis ? widget.yAxis : (widget.measures ? widget.measures : []);
    }, [widget]);

    const lineSeries = useMemo(() => {
        if (widget.lineAxisConfigs && widget.lineAxisConfigs.length > 0) {
            return widget.lineAxisConfigs.map(c => c.field);
        }
        return [];
    }, [widget]);

    // Data Source
    const dataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    // Dependencies for effect
    const drillDownState = drillDowns[widget.id];
    const currentXField = DrillDownService.getCurrentField(widget, drillDownState);
    const dashboardId = activeDashboard?.id;

    useEffect(() => {
        let isMounted = true;
        const abortController = new AbortController();

        const fetchData = async () => {
            if (!dataSource) {
                setChartData([]);
                return;
            }

            // If NOT BigQuery, fall back to existing data in memory (for CSV/JSON)
            if (dataSource.type !== 'bigquery') {
                // TODO: Implement client-side aggregation if needed for CSV/JSON
                // For now, return full data or simplified version
                // This preserves backward compatibility for small files
                if (dataSource.data) {
                    setChartData(dataSource.data);
                }
                return;
            }

            // BigQuery Direct Query Logic
            // BigQuery Direct Query Logic
            // We'll validate token after checking connection type below

            setIsLoading(true);
            setError(null);

            try {
                // Connection Info
                const connection = connections.find(c => c.id === dataSource.connectionId);
                const projectId = connection?.projectId;

                if (!projectId) {
                    console.warn("Project ID not found for data source", dataSource);
                    throw new Error("Missing Project ID");
                }

                // Resolve Token (Service Account or OAuth)
                let token = googleToken;
                if (connection?.authType === 'ServiceAccount' && connection.serviceAccountKey) {
                    const { getServiceAccountToken } = await import('../../../services/googleAuth');
                    token = await getServiceAccountToken(connection.serviceAccountKey);
                }

                if (!token) {
                    setError("No Google Token or Service Account Key");
                    setIsLoading(false);
                    return;
                }

                const dimensions = [currentXField].filter(Boolean);
                const measures = [
                    ...series.map(s => ({ field: s, aggregation: widget.aggregation || 'sum' })),
                    ...lineSeries.map(s => ({ field: s, aggregation: widget.aggregation || 'sum' }))
                ];

                // Filters
                // Combine Global, Page (if any), and Cross-filters
                // This logic needs to be robust mapping to BQ filters
                // For now, basic placeholder for filters
                const bqFilters: any[] = [];
                // TODO: Map `globalFilters` and `crossFilters` to BigQuery filter objects
                // loop through crossFilters where source != widget.id

                // Check cache or debounce?
                // For now, direct fetch

                if (!currentXField && measures.length === 0) {
                    // Nothing to map
                    setChartData([]);
                    setIsLoading(false);
                    return;
                }

                const data = await fetchAggregatedData(
                    token!,
                    projectId,
                    dataSource.datasetName || '',
                    dataSource.tableName || '',
                    {
                        dimensions,
                        measures,
                        filters: bqFilters,
                        limit: 1000 // Reasonable limit for charts
                    }
                );

                if (isMounted) {
                    // Map results back to expected format
                    // SQL returns `field_AGG` but frontend expects `field` or needs to know to look up `field_AGG`
                    // The Series in the Chart is just "field".
                    // Recharts looks for `dataKey="field"`.
                    // So we must remap `field_AGG` -> `field`.
                    const mappedData = data.map(row => {
                        const newRow = { ...row };
                        // Remap measures
                        measures.forEach(m => {
                            const sqlAlias = `${m.field}_${m.aggregation}`;
                            if (newRow[sqlAlias] !== undefined) {
                                newRow[m.field] = newRow[sqlAlias];
                            }
                        });
                        return newRow;
                    });
                    setChartData(mappedData);
                }
            } catch (err: any) {
                if (isMounted) {
                    console.error("Direct Query Error:", err);
                    setError(err.message);
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        fetchData();

        return () => {
            isMounted = false;
            abortController.abort();
        };
    }, [
        dataSource?.id,
        currentXField,
        JSON.stringify(series),
        JSON.stringify(lineSeries),
        widget.aggregation,
        // Dependencies for filters triggers re-fetch
        JSON.stringify(globalFilters),
        JSON.stringify(crossFilters.filter(cf => cf.sourceWidgetId !== widget.id))
    ]);

    return { chartData, series, lineSeries, isLoading, error };
};
