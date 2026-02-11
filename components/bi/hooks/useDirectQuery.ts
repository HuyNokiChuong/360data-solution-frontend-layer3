import { useState, useEffect, useRef, useMemo } from 'react';
import { BIWidget, Filter, FilterOperator } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import { fetchAggregatedData } from '../../../services/bigquery';
import { fetchExcelTableData } from '../../../services/excel';
import { DrillDownService } from '../engine/DrillDownService';
import { getFieldValue } from '../engine/utils';

/**
 * Unified hook for Direct Query data fetching from BigQuery.
 * This hook replaces useAggregatedData and provides support for Charts, Tables, Pivot Tables, etc.
 */
export const useDirectQuery = (widget: BIWidget) => {
    const { getDataSource, googleToken, connections, dataSources, updateDataSource, loadTableData } = useDataStore();
    const { crossFilters, drillDowns, getFiltersForWidget } = useFilterStore();
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));
    const globalFilters = activeDashboard?.globalFilters || [];

    const [data, setData] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const dataSource = useMemo(() => {
        let ds = widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;

        // --- AUTO-RECOVERY ---
        // If ID references a deleted table, try to find it by NAME (Case-Insensitive)
        if (!ds && widget.dataSourceName) {
            const normalizedSavedName = widget.dataSourceName.toLowerCase().trim();
            ds = dataSources.find(d => {
                const dName = (d.name || '').toLowerCase().trim();
                const dTable = (d.tableName || '').toLowerCase().trim();
                const dFull = (d.datasetName && d.tableName) ? `${d.datasetName}.${d.tableName}`.toLowerCase().trim() : '';

                return dName === normalizedSavedName ||
                    dTable === normalizedSavedName ||
                    dFull === normalizedSavedName;
            });
        }

        return ds || null;
    }, [widget.dataSourceId, widget.dataSourceName, getDataSource, dataSources]);

    // Identify Dimensions and Measures based on widget type
    const { dimensions, measures } = useMemo(() => {
        let dims: string[] = [];
        let meass: { field: string; aggregation: string; expression?: string; isQuickMeasure?: boolean; qmType?: string; qmField?: string }[] = [];

        switch (widget.type) {
            case 'chart':
                const drillDownState = drillDowns[widget.id];
                const xFields = DrillDownService.getCurrentFields(widget, drillDownState);
                if (xFields.length > 0) dims.push(...xFields);

                if (widget.legend && !dims.includes(widget.legend)) {
                    dims.push(widget.legend);
                }

                // Support for yAxisConfigs (modern multi-measure configuration)
                if (widget.yAxisConfigs && widget.yAxisConfigs.length > 0) {
                    widget.yAxisConfigs.forEach(c => {
                        meass.push({ field: c.field, aggregation: c.aggregation || 'sum' });
                    });
                } else if (widget.yAxis && widget.yAxis.length > 0) {
                    // Fallback to yAxis array
                    widget.yAxis.forEach(field => {
                        meass.push({ field, aggregation: widget.aggregation || 'sum' });
                    });
                }

                // Support for Pie/Donut charts that use widget.values
                if (widget.values && widget.values.length > 0) {
                    widget.values.forEach(field => {
                        // Avoid duplicates if already added via yAxisConfigs/yAxis
                        if (!meass.some(m => m.field === field)) {
                            meass.push({ field, aggregation: widget.aggregation || 'sum' });
                        }
                    });
                }

                // Support for widget.measures (alternative naming)
                if (widget.measures && widget.measures.length > 0) {
                    widget.measures.forEach(field => {
                        if (!meass.some(m => m.field === field)) {
                            meass.push({ field, aggregation: widget.aggregation || 'sum' });
                        }
                    });
                }

                // Support for lineAxisConfigs (Combo charts)
                if (widget.lineAxisConfigs && widget.lineAxisConfigs.length > 0) {
                    widget.lineAxisConfigs.forEach(c => {
                        meass.push({ field: c.field, aggregation: c.aggregation || 'sum' });
                    });
                }
                break;

            case 'pivot':
                const pivotDrillState = drillDowns[widget.id];
                const activeRows = (widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0)
                    ? DrillDownService.getCurrentFields(widget, pivotDrillState)
                    : widget.pivotRows || [];
                dims.push(...activeRows);
                if (widget.pivotCols) dims.push(...widget.pivotCols);
                if (widget.pivotValues) {
                    widget.pivotValues.forEach(v => {
                        meass.push({ field: v.field, aggregation: v.aggregation || 'sum' });
                    });
                }
                break;

            case 'table':
                if (widget.columns) {
                    dims.push(...widget.columns.map(c => c.field));
                }
                break;

            case 'card':
            case 'gauge':
                const metricField = widget.yAxis?.[0] || widget.metric || widget.measures?.[0];
                if (metricField) {
                    meass.push({ field: metricField, aggregation: widget.aggregation || 'sum' });
                }
                if (widget.comparisonValue) {
                    meass.push({ field: widget.comparisonValue, aggregation: widget.aggregation || 'sum' });
                }
                break;

            case 'slicer':
                if (widget.slicerField) {
                    dims.push(widget.slicerField);
                }
                break;
        }

        // AUTO-CORRECT AGGREGATION based on Schema
        if (dataSource?.schema) {
            meass = meass.map(m => {
                // If aggregation is explicitly compatible with string (count, countDistinct), keep it.
                if (['count', 'countDistinct', 'min', 'max'].includes(m.aggregation)) return m;

                const fieldDef = dataSource.schema.find(f => f.name === m.field);
                if (fieldDef) {
                    const type = fieldDef.type.toLowerCase();
                    // If it's a string/date and currently set to sum/avg (default), switch to count
                    if ((type === 'string' || type === 'date' || type === 'timestamp' || type === 'boolean') &&
                        (m.aggregation === 'sum' || m.aggregation === 'avg')) {
                        return { ...m, aggregation: 'count' };
                    }
                }
                return m;
            });
        }

        // process calculated fields (SQL Injection)
        meass = meass.map(m => {
            const calcField = activeDashboard?.calculatedFields?.find(c => c.name === m.field);
            if (calcField) {
                let expr = calcField.formula;
                // Transpile [Field] to `Field`
                expr = expr.replace(/\[(.*?)\]/g, (match, p1) => `\`${p1}\``);
                return { ...m, expression: expr };
            }

            // process quick measures (Client-side Post-Processing mostly)
            const quickMeasure = activeDashboard?.quickMeasures?.find(qm => qm.label === m.field);
            if (quickMeasure) {
                // For BQ, we fetch the underlying field
                // For Post-processing, we allow identifying it
                return {
                    ...m,
                    field: quickMeasure.field, // Fetch the source field
                    isQuickMeasure: true,
                    qmType: quickMeasure.calculation,
                    qmField: quickMeasure.field, // Original source field
                    originalLabel: quickMeasure.label
                };
            }
            return m;
        });

        return { dimensions: [...new Set(dims)], measures: meass };
    }, [widget, drillDowns, dataSource, activeDashboard?.calculatedFields, activeDashboard?.quickMeasures]);

    useEffect(() => {
        let isMounted = true;
        const abortController = new AbortController();

        const fetchData = async () => {
            if (!dataSource) {
                if (widget.dataSourceId || widget.dataSourceName) {
                    const name = widget.dataSourceName || 'Unknown Table';
                    setError(`Data source "${name}" not found. Please restore the table in Data Warehouse.`);
                }
                setData([]);
                return;
            }

            if (dataSource.type !== 'bigquery') {
                if (dataSource.type === 'excel' && (!dataSource.isLoaded || !dataSource.data || dataSource.data.length === 0)) {
                    try {
                        updateDataSource(dataSource.id, {
                            syncStatus: 'syncing',
                            isLoadingPartial: true,
                            syncError: null
                        });

                        const tableId = dataSource.syncedTableId || dataSource.id.replace('excel:', '');
                        const allRows: any[] = [];
                        const pageSize = 500;
                        let offset = 0;
                        let hasMore = true;
                        let totalRows = dataSource.totalRows || 0;

                        while (hasMore) {
                            const page = await fetchExcelTableData(tableId, offset, pageSize);
                            const pageRows = page.rows || [];

                            allRows.push(...pageRows);
                            totalRows = page.totalRows ?? totalRows;
                            offset += pageRows.length;
                            hasMore = !!page.hasMore && pageRows.length > 0;
                        }

                        if (!isMounted) return;

                        loadTableData(dataSource.id, allRows);
                        updateDataSource(dataSource.id, {
                            isLoaded: true,
                            isLoadingPartial: false,
                            syncStatus: 'ready',
                            totalRows: totalRows || allRows.length,
                            lastSyncAt: new Date().toISOString(),
                        });
                        setData(allRows);
                    } catch (err: any) {
                        if (!isMounted) return;
                        updateDataSource(dataSource.id, {
                            isLoadingPartial: false,
                            syncStatus: 'error',
                            syncError: err?.message || 'Failed to load Excel data'
                        });
                        setError(err?.message || 'Failed to load Excel data');
                        setData([]);
                    }
                } else {
                    setData(dataSource.data || []);
                }
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const connection = connections.find(c => c.id === dataSource.connectionId);
                const projectId = connection?.projectId;

                if (!projectId) throw new Error("Missing Project ID");

                let token = googleToken;
                if (connection?.authType === 'ServiceAccount' && connection.serviceAccountKey) {
                    const { getServiceAccountToken } = await import('../../../services/googleAuth');
                    token = await getServiceAccountToken(connection.serviceAccountKey);
                }

                if (!token) {
                    setError("Relink your account to fetch data");
                    setIsLoading(false);
                    return;
                }

                const bqFilters: any[] = [];
                if (widget.filters) bqFilters.push(...widget.filters);
                globalFilters.forEach(gf => {
                    if (!gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)) {
                        bqFilters.push({ field: gf.field, operator: gf.operator, value: gf.value, enabled: true });
                    }
                });
                const activeCrossFilters = getFiltersForWidget(widget.id);
                bqFilters.push(...activeCrossFilters.map(f => ({ ...f, enabled: true })));

                const drillDownState = drillDowns[widget.id];
                if (drillDownState && drillDownState.breadcrumbs.length > 0) {
                    drillDownState.breadcrumbs.forEach(bc => {
                        bqFilters.push({
                            field: drillDownState.hierarchy[bc.level],
                            operator: 'equals',
                            value: bc.value,
                            enabled: true
                        });
                    });
                }

                if (dimensions.length === 0 && measures.length === 0) {
                    setData([]);
                    setIsLoading(false);
                    return;
                }

                let bqSortBy: string | string[] | undefined;
                let bqSortDir: 'ASC' | 'DESC' | undefined;

                if (widget.sortBy && widget.sortBy !== 'none') {
                    const [type, dir] = widget.sortBy.split('_');
                    bqSortDir = dir.toUpperCase() as any;
                    if (type === 'category') {
                        // Sort by all dimensions to maintain hierarchy order
                        bqSortBy = dimensions;
                    } else if (type === 'value') {
                        bqSortBy = measures[0] ? `${measures[0].field}_${measures[0].aggregation}` : undefined;
                    }
                } else if (dimensions.length > 0) {
                    // AUTO-DETECT TIME SERIES: Sort by all dimensions ASC by default if no explicit sort
                    const firstDim = dimensions[0];
                    const isTimeHierarchy = firstDim.includes('___');
                    const fieldDef = dataSource.schema.find(f => f.name === firstDim.split('___')[0]);
                    const isDateType = fieldDef?.type === 'date' ||
                        firstDim.toLowerCase().includes('date') ||
                        firstDim.toLowerCase().includes('time');

                    if (isTimeHierarchy || isDateType) {
                        bqSortBy = dimensions;
                        bqSortDir = 'ASC';
                    } else if (['pie', 'donut'].includes(widget.chartType || widget.type)) {
                        // Smart default for Pie/Donut: Biggest slice first
                        bqSortBy = measures[0] ? `${measures[0].field}_${measures[0].aggregation}` : undefined;
                        bqSortDir = 'DESC';
                    }
                }

                const bqDimensions = dimensions.map(d => {
                    const calcField = activeDashboard?.calculatedFields?.find(c => c.name === d);
                    if (calcField) {
                        let expr = calcField.formula;
                        expr = expr.replace(/\[(.*?)\]/g, (match, p1) => `\`${p1}\``);
                        return { field: d, expression: expr };
                    }
                    return d;
                });

                const finalFilters = bqFilters.map(f => {
                    const calcField = activeDashboard?.calculatedFields?.find(c => c.name === f.field);
                    if (calcField) {
                        let expr = calcField.formula;
                        expr = expr.replace(/\[(.*?)\]/g, (match, p1) => `\`${p1}\``);
                        return { ...f, expression: expr };
                    }
                    return f;
                });

                const result = await fetchAggregatedData(
                    token!, projectId, dataSource.datasetName || '', dataSource.tableName || '',
                    {
                        dimensions: bqDimensions,
                        measures,
                        filters: finalFilters,
                        sortBy: bqSortBy,
                        sortDir: bqSortDir,
                        limit: widget.type === 'table' ? (widget.pageSize || 100) : 1000,
                        signal: abortController.signal
                    }
                );

                if (isMounted) {
                    // 1. Normalize data: Map SQL aliases to field names and ensure numeric types
                    const normalizedData = result.map(row => {
                        const newRow: Record<string, any> = {};

                        // Copy dimension values (handle hierarchy case-insensitively)
                        dimensions.forEach(dim => {
                            if (row[dim] !== undefined) {
                                newRow[dim] = row[dim];
                            } else {
                                const matchedKey = Object.keys(row).find(k => k.toLowerCase() === dim.toLowerCase());
                                if (matchedKey) newRow[dim] = row[matchedKey];
                            }
                        });

                        // Extract measures
                        measures.forEach(m => {
                            const sqlAlias = `${m.field}_${m.aggregation}`;
                            const findKey = (obj: any, target: string) =>
                                Object.keys(obj).find(k => k.toLowerCase() === target.toLowerCase());

                            const matchedAlias = findKey(row, sqlAlias);
                            const matchedField = findKey(row, m.field);

                            let rawVal = matchedAlias ? row[matchedAlias] : (matchedField ? row[matchedField] : undefined);
                            let val = 0;
                            if (rawVal !== null && rawVal !== undefined) {
                                if (typeof rawVal === 'number') val = rawVal;
                                else {
                                    const parsed = parseFloat(String(rawVal));
                                    val = isNaN(parsed) ? 0 : parsed;
                                }
                            }
                            newRow[m.field] = val;
                        });
                        return newRow;
                    });

                    const innerDrillDownState = drillDowns[widget.id];
                    const axisFields = DrillDownService.getCurrentFields(widget, innerDrillDownState);

                    const formatLevelValue = (val: any, field: string) => {
                        if (val === null || val === undefined) return '(Blank)';
                        if (field.includes('___')) {
                            const part = field.split('___')[1];
                            switch (part) {
                                case 'year': return String(val);
                                case 'quarter': return `Q${val}`;
                                case 'half': return `H${val}`;
                                case 'month': {
                                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                    const mIdx = parseInt(val) - 1;
                                    return months[mIdx] || `M${val}`;
                                }
                                case 'day': return `Day ${val}`;
                                case 'hour': return `${String(val).padStart(2, '0')}:00`;
                                case 'minute': return `:${String(val).padStart(2, '0')}`;
                                case 'second': return `:${String(val).padStart(2, '0')}s`;
                                default: return String(val);
                            }
                        }
                        return String(val);
                    };

                    let processedData = normalizedData;

                    // 2. Add Axis Labels
                    const axisKey = (innerDrillDownState?.mode === 'expand' && axisFields.length > 1) ? '_combinedAxis' : '_formattedAxis';

                    if (axisFields.length > 0) {
                        processedData = processedData.map(row => {
                            let label = '';
                            if (innerDrillDownState?.mode === 'expand' && axisFields.length > 1) {
                                label = axisFields.map(f => formatLevelValue(row[f], f)).reverse().join('\n');
                            } else {
                                label = formatLevelValue(row[axisFields[0]], axisFields[0]);
                            }
                            return { ...row, [axisKey]: label };
                        });
                    }

                    // 3. CRITICAL FIX: Group by Axis Label to prevent duplicates and ensure Tooltip consistency
                    // If multiple rows have the same label, we sum their measures.
                    // IMPORTANT: Skip this if we are going to Pivot (Block 4), because this grouping blindly merges 
                    // rows based on Axis Label, destroying the Legend distinction (e.g. merging "Brand A" and "Brand B").
                    const willPivot = widget.legend && dimensions.includes(widget.legend);

                    if (axisFields.length > 0 && !willPivot) {
                        const groupedMap = new Map<string, any>();
                        processedData.forEach(row => {
                            const label = row[axisKey];
                            if (!groupedMap.has(label)) {
                                groupedMap.set(label, { ...row });
                            } else {
                                const existing = groupedMap.get(label);
                                measures.forEach(m => {
                                    existing[m.field] = (existing[m.field] || 0) + (row[m.field] || 0);
                                });
                            }
                        });
                        processedData = Array.from(groupedMap.values());
                    }

                    const legendFields = new Set<string>();
                    // 4. Pivot by Legend (if applicable)
                    if (widget.legend && dimensions.includes(widget.legend)) {
                        const xFieldKey = axisKey;
                        const legendField = widget.legend;
                        const measureFields = measures.map(m => m.field);
                        const pivotMap = new Map<string, any>();

                        processedData.forEach(row => {
                            const xValue = row[xFieldKey];
                            const legendValue = String(row[legendField] || 'Other');
                            legendFields.add(legendValue);

                            if (!pivotMap.has(xValue)) {
                                pivotMap.set(xValue, { ...row });
                            }
                            const pivotRow = pivotMap.get(xValue);
                            measureFields.forEach(mf => {
                                pivotRow[legendValue] = row[mf];
                            });
                        });
                        processedData = Array.from(pivotMap.values());
                    }

                    // 5. Post-Processing Sorting
                    // We perform sort here to ensure it accounts for Pivoted totals and Axis formatting
                    if (widget.sortBy && widget.sortBy !== 'none') {
                        const [type, dir] = widget.sortBy.split('_');
                        const isDesc = dir === 'desc';

                        processedData.sort((a, b) => {
                            let valA, valB;

                            if (type === 'category') {
                                // Default alphanumeric sort on the axis label
                                valA = a[axisKey] || '';
                                valB = b[axisKey] || '';
                                // Try to assume date/number if possible
                                if (!isNaN(Date.parse(valA)) && !isNaN(Date.parse(valB))) {
                                    valA = new Date(valA).getTime();
                                    valB = new Date(valB).getTime();
                                }
                            } else {
                                // Sort by Total Value
                                const calcTotal = (row: any) => {
                                    // If pivoted, sum all legend values
                                    if (legendFields.size > 0) {
                                        return Array.from(legendFields).reduce((sum, key) => sum + (Number(row[key]) || 0), 0);
                                    }
                                    // Otherwise sum all primary measures
                                    return measures.reduce((sum, m) => sum + (Number(row[m.field]) || 0), 0);
                                };
                                valA = calcTotal(a);
                                valB = calcTotal(b);
                            }

                            if (valA < valB) return isDesc ? 1 : -1;
                            if (valA > valB) return isDesc ? -1 : 1;
                            return 0;
                        });
                    }

                    setData(processedData);

                    // 6. Quick Measures Post-Processing
                    // We do this AFTER everything else because it depends on final sorted/grouped data
                    const activeQuickMeasures = measures.filter(m => m.isQuickMeasure);
                    if (activeQuickMeasures.length > 0) {
                        const finalData = [...processedData];
                        const totalMap = new Map<string, number>();

                        // Pre-calculate totals for percentOfTotal
                        activeQuickMeasures.forEach(qm => {
                            if (qm.qmType === 'percentOfTotal') {
                                const total = finalData.reduce((sum, row) => sum + (Number(row[qm.field]) || 0), 0);
                                totalMap.set(qm.field, total);
                            }
                        });

                        // Apply calculations
                        finalData.forEach(row => {
                            activeQuickMeasures.forEach(qm => {
                                const val = Number(row[qm.field]) || 0;

                                if (qm.qmType === 'percentOfTotal') {
                                    const total = totalMap.get(qm.field) || 1;
                                    row[(qm as any).originalLabel] = total === 0 ? 0 : (val / total);
                                }
                                // Other types can be added here (runningTotal requires iteration)
                            });
                        });
                        setData(finalData);
                    } else {
                        setData(processedData);
                    }

                    (fetchData as any).pivotedSeries = Array.from(legendFields);
                }
            } catch (err: any) {
                if (isMounted && err.name !== 'AbortError') {
                    console.error("Direct Query Error:", err);
                    setError(err.message);
                }
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        const debounceTimer = setTimeout(fetchData, 100);
        return () => {
            clearTimeout(debounceTimer);
            isMounted = false;
            abortController.abort();
        };
    }, [
        dataSource?.id,
        JSON.stringify(dimensions),
        JSON.stringify(measures),
        JSON.stringify(globalFilters),
        JSON.stringify(crossFilters.filter(cf => cf.sourceWidgetId !== widget.id)),
        JSON.stringify(drillDowns[widget.id])
    ]);

    // Derived properties for Charts
    const [pivotedSeries, setPivotedSeries] = useState<string[]>([]);

    // Update pivoted series when data changes
    useEffect(() => {
        if (widget.legend && data.length > 0) {
            const fields = new Set<string>();
            const xFields = DrillDownService.getCurrentFields(widget, drillDowns[widget.id]);
            const xField = xFields[0];
            data.forEach(row => {
                Object.keys(row).forEach(key => {
                    // Filter out X-Axis, formatting keys, the legend field itself, and the original measure fields
                    // detailed condition: key is not an axis field, not a system field, not the legend field, and not in the list of measures
                    if (key !== xField && key !== '_formattedAxis' && key !== '_combinedAxis' && key !== widget.legend && !measures.map(m => m.field).includes(key)) {
                        fields.add(key);
                    }
                });
            });
            setPivotedSeries(Array.from(fields));
        } else {
            setPivotedSeries([]);
        }
    }, [
        data,
        widget.legend,
        JSON.stringify(drillDowns[widget.id]),
        JSON.stringify(measures)
    ]);

    const seriesList = useMemo(() => {
        if (pivotedSeries.length > 0) return pivotedSeries;
        if (widget.yAxisConfigs && widget.yAxisConfigs.length > 0) {
            return widget.yAxisConfigs.map(c => c.field);
        }
        return widget.yAxis ? widget.yAxis : (widget.measures ? widget.measures : []);
    }, [widget, pivotedSeries]);

    const lineSeriesList = useMemo(() => {
        if (widget.lineAxisConfigs && widget.lineAxisConfigs.length > 0) {
            return widget.lineAxisConfigs.map(c => c.field);
        }
        return [];
    }, [widget]);

    return {
        data,
        isLoading,
        error,
        chartData: data,
        series: seriesList,
        lineSeries: lineSeriesList
    };
};
