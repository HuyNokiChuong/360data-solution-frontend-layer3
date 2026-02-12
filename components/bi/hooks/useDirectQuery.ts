import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { BIWidget, Filter, FilterOperator, AggregationType } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import { fetchAggregatedData, runQuery } from '../../../services/bigquery';
import { fetchExcelTableData } from '../../../services/excel';
import { executeSemanticQuery, planSemanticQuery } from '../../../services/dataModeling';
import { DrillDownService } from '../engine/DrillDownService';
import { getFieldValue } from '../engine/utils';
import { applyFilters } from '../engine/dataProcessing';
import { aggregate as aggregateValues } from '../engine/calculations';
import { coerceAggregationForFieldType, normalizeAggregation } from '../../../utils/aggregation';
import { normalizeFieldType } from '../../../utils/schema';

/**
 * Unified hook for Direct Query data fetching from BigQuery.
 * This hook replaces useAggregatedData and provides support for Charts, Tables, Pivot Tables, etc.
 */
export const useDirectQuery = (widget: BIWidget) => {
    const { getDataSource, connections, dataSources, updateDataSource, loadTableData, addLog } = useDataStore();
    const { crossFilters, drillDowns, getFiltersForWidget } = useFilterStore();
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));
    const updateWidget = useDashboardStore(state => state.updateWidget);
    const globalFilters = activeDashboard?.globalFilters || [];
    const lastMissingLogKeyRef = useRef<string | null>(null);
    const lastRecoveredLogKeyRef = useRef<string | null>(null);

    const [data, setData] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const allCalculatedFields = useMemo(() => ([
        ...(activeDashboard?.calculatedFields || []),
        ...(widget.calculatedFields || [])
    ]), [activeDashboard?.calculatedFields, widget.calculatedFields]);
    const allQuickMeasures = useMemo(() => ([
        ...(activeDashboard?.quickMeasures || []),
        ...(widget.quickMeasures || [])
    ]), [activeDashboard?.quickMeasures, widget.quickMeasures]);

    const dataSource = useMemo(() => {
        let ds = widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;

        // --- AUTO-RECOVERY ---
        // If ID references a deleted table, try to find it by NAME (Case-Insensitive)
        if (!ds && widget.dataSourceName) {
            const normalizedSavedName = widget.dataSourceName.toLowerCase().trim();
            const preferredType =
                widget.dataSourceId?.startsWith('bq:')
                    ? 'bigquery'
                    : widget.dataSourceId?.startsWith('excel:')
                        ? 'excel'
                        : null;

            ds = dataSources.find(d => {
                if (preferredType && d.type !== preferredType) return false;

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

    const pipelineNameFromId = useMemo(() => {
        const resolveByConnection = (connectionId?: string) =>
            connectionId ? connections.find(c => c.id === connectionId)?.name : undefined;

        if (widget.dataSourceId?.startsWith('bq:')) {
            const connectionId = widget.dataSourceId.split(':')[1];
            return resolveByConnection(connectionId);
        }

        if (dataSource?.connectionId) {
            return resolveByConnection(dataSource.connectionId);
        }

        return undefined;
    }, [widget.dataSourceId, dataSource?.connectionId, connections]);

    const pipelineNameForLog = dataSource?.connectionId
        ? connections.find(c => c.id === dataSource.connectionId)?.name
        : undefined;
    const tableNameForLog = dataSource?.tableName || widget.dataSourceName || dataSource?.name || 'Unknown Table';

    useEffect(() => {
        if (!activeDashboard || !dataSource || !widget.id) return;

        const currentById = widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
        const recoveredByName = !currentById && !!widget.dataSourceName;
        const needsRebind = recoveredByName && widget.dataSourceId !== dataSource.id;

        if (!needsRebind) return;

        updateWidget(activeDashboard.id, widget.id, {
            dataSourceId: dataSource.id,
            dataSourceName: dataSource.tableName || dataSource.name,
            dataSourcePipelineName: pipelineNameForLog || widget.dataSourcePipelineName || pipelineNameFromId
        });

        const recoverPipeline = pipelineNameForLog || widget.dataSourcePipelineName || pipelineNameFromId || 'Unknown Pipeline';
        const recoverTable = dataSource.tableName || dataSource.name || widget.dataSourceName || 'Unknown Table';
        const recoverKey = `${widget.id}:${recoverPipeline}:${recoverTable}:recovered`;
        if (lastRecoveredLogKeyRef.current !== recoverKey) {
            addLog({
                type: 'success',
                target: recoverTable,
                message: `Auto-recovered source. Pipeline: ${recoverPipeline} | Table: ${recoverTable}`
            });
            lastRecoveredLogKeyRef.current = recoverKey;
        }
    }, [
        activeDashboard,
        dataSource,
        addLog,
        pipelineNameForLog,
        pipelineNameFromId,
        widget.id,
        widget.dataSourceId,
        widget.dataSourceName,
        widget.dataSourcePipelineName,
        getDataSource,
        updateWidget
    ]);

    useEffect(() => {
        if (dataSource) {
            lastMissingLogKeyRef.current = null;
            return;
        }

        if (!widget.dataSourceId && !widget.dataSourceName) return;

        const missingPipeline = widget.dataSourcePipelineName || pipelineNameFromId || 'Unknown Pipeline';
        const missingTable = tableNameForLog;
        const missingKey = `${widget.id}:${missingPipeline}:${missingTable}:missing`;

        if (lastMissingLogKeyRef.current === missingKey) return;

        addLog({
            type: 'error',
            target: missingTable,
            message: `Missing source detected. Pipeline: ${missingPipeline} | Table: ${missingTable}`
        });
        lastMissingLogKeyRef.current = missingKey;
    }, [
        dataSource,
        addLog,
        pipelineNameFromId,
        tableNameForLog,
        widget.id,
        widget.dataSourceId,
        widget.dataSourceName,
        widget.dataSourcePipelineName
    ]);

    // Identify Dimensions and Measures based on widget type
    const { dimensions, measures } = useMemo(() => {
        let dims: string[] = [];
        let meass: { field: string; aggregation: AggregationType; expression?: string; isQuickMeasure?: boolean; qmType?: string; qmField?: string }[] = [];

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
                        meass.push({ field: c.field, aggregation: normalizeAggregation(c.aggregation || 'sum') });
                    });
                } else if (widget.yAxis && widget.yAxis.length > 0) {
                    // Fallback to yAxis array
                    widget.yAxis.forEach(field => {
                        meass.push({ field, aggregation: normalizeAggregation(widget.aggregation || 'sum') });
                    });
                }

                // Support for Pie/Donut charts that use widget.values
                if (widget.values && widget.values.length > 0) {
                    widget.values.forEach(field => {
                        // Avoid duplicates if already added via yAxisConfigs/yAxis
                        if (!meass.some(m => m.field === field)) {
                            meass.push({ field, aggregation: normalizeAggregation(widget.aggregation || 'sum') });
                        }
                    });
                }

                // Support for widget.measures (alternative naming)
                if (widget.measures && widget.measures.length > 0) {
                    widget.measures.forEach(field => {
                        if (!meass.some(m => m.field === field)) {
                            meass.push({ field, aggregation: normalizeAggregation(widget.aggregation || 'sum') });
                        }
                    });
                }

                // Support for lineAxisConfigs (Combo charts)
                if (widget.lineAxisConfigs && widget.lineAxisConfigs.length > 0) {
                    widget.lineAxisConfigs.forEach(c => {
                        meass.push({ field: c.field, aggregation: normalizeAggregation(c.aggregation || 'sum') });
                    });
                }

                // If user only drags dimension(s) without any explicit measure,
                // auto-create COUNT on the first dimension so chart still renders values.
                if (dims.length > 0 && meass.length === 0) {
                    meass.push({ field: dims[0], aggregation: 'count' });
                }
                break;

            case 'pivot':
                // Pivot must always query the full configured hierarchy.
                // Per-node expand/collapse is handled at widget rendering layer, not by query-level drill state.
                const pivotRows = widget.pivotRows || [];
                dims.push(...pivotRows);
                if (widget.pivotCols) dims.push(...widget.pivotCols);
                const pivotMeasureSeen = new Set<string>();
                const pushPivotMeasure = (field: string | undefined, aggregation: AggregationType | undefined) => {
                    if (!field) return;
                    const agg = normalizeAggregation(aggregation || 'sum');
                    const key = `${field}::${agg}`;
                    if (pivotMeasureSeen.has(key)) return;
                    pivotMeasureSeen.add(key);
                    meass.push({ field, aggregation: agg });
                };
                if (widget.pivotValues) {
                    widget.pivotValues.forEach(v => {
                        pushPivotMeasure(v.field, v.aggregation);
                        (v.conditionalFormatting || []).forEach((rule: any) => {
                            if (rule?.compareMode === 'field' && rule?.compareField) {
                                pushPivotMeasure(rule.compareField, rule.compareAggregation || 'sum');
                            }
                        });
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
                    meass.push({ field: metricField, aggregation: normalizeAggregation(widget.aggregation || 'sum') });
                }
                if (widget.comparisonValue) {
                    meass.push({ field: widget.comparisonValue, aggregation: normalizeAggregation(widget.aggregation || 'sum') });
                }
                break;

            case 'slicer':
                if (widget.slicerField) {
                    dims.push(widget.slicerField);
                }
                break;
        }

        // AUTO-CORRECT AGGREGATION based on field type schema
        if (dataSource?.schema) {
            meass = meass.map(m => {
                const fieldDef = dataSource.schema.find(f => f.name === m.field);
                return {
                    ...m,
                    aggregation: coerceAggregationForFieldType(m.aggregation, fieldDef?.type)
                };
            });
        }

        // process calculated fields (SQL Injection)
        meass = meass.map(m => {
            const calcField = allCalculatedFields.find(c => c.name === m.field);
            if (calcField) {
                let expr = calcField.formula;
                // Transpile [Field] to `Field`
                expr = expr.replace(/\[(.*?)\]/g, (match, p1) => `\`${p1}\``);
                return { ...m, expression: expr };
            }

            // process quick measures (Client-side Post-Processing mostly)
            const quickMeasure = allQuickMeasures.find(qm => qm.label === m.field);
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
    }, [widget, drillDowns, dataSource, allCalculatedFields, allQuickMeasures]);

    const normalizeSemanticAggregation = useCallback((aggregation: AggregationType | undefined) => {
        const normalized = String(aggregation || 'none').trim().toLowerCase();
        if (normalized === 'countdistinct') return 'countDistinct';
        if (['sum', 'avg', 'count', 'min', 'max', 'none', 'raw', 'countDistinct'].includes(normalized)) {
            return normalized as any;
        }
        return 'none';
    }, []);

    const resolveSemanticFieldBinding = useCallback((fieldName: string) => {
        if (!dataSource || dataSource.type !== 'semantic_model') return null;
        const semanticFieldMap = dataSource.semanticFieldMap || {};

        const hierarchyIdx = fieldName.indexOf('___');
        const baseField = hierarchyIdx >= 0 ? fieldName.slice(0, hierarchyIdx) : fieldName;
        const hierarchyPart = hierarchyIdx >= 0 ? fieldName.slice(hierarchyIdx + 3) : '';

        const direct = semanticFieldMap[fieldName] || semanticFieldMap[baseField];
        if (direct) {
            return {
                tableId: direct.tableId,
                column: direct.column,
                hierarchyPart,
            };
        }

        const parts = baseField.split('.');
        const column = parts[parts.length - 1];
        const tableHint = parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : '';
        const fallbackKey = Object.keys(semanticFieldMap).find((key) => {
            const binding = semanticFieldMap[key];
            if (!binding || String(binding.column || '').toLowerCase() !== String(column || '').toLowerCase()) {
                return false;
            }
            if (!tableHint) return true;
            return key.toLowerCase().includes(`${tableHint}.`);
        });

        if (!fallbackKey) return null;
        const fallback = semanticFieldMap[fallbackKey];
        return {
            tableId: fallback.tableId,
            column: fallback.column,
            hierarchyPart,
        };
    }, [dataSource]);

    const normalizeFieldToken = useCallback((value: string) => {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }, []);

    const resolveLegendLabel = useCallback((row: Record<string, any>, legendField: string): string => {
        let rawLegend = getFieldValue(row, legendField);

        // Extra fallback: tolerate key-style mismatches such as snake_case vs camelCase.
        if (rawLegend === undefined) {
            const target = normalizeFieldToken(legendField);
            const looseKey = Object.keys(row || {}).find((key) => normalizeFieldToken(key) === target);
            if (looseKey) {
                rawLegend = row[looseKey];
            }
        }

        if (rawLegend === null || rawLegend === undefined) return '(Blank)';
        if (typeof rawLegend === 'string') {
            const trimmed = rawLegend.trim();
            return trimmed.length > 0 ? trimmed : '(Blank)';
        }
        return String(rawLegend);
    }, [normalizeFieldToken]);

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

            if (dataSource.type === 'semantic_model') {
                setIsLoading(true);
                setError(null);

                try {
                    if (dimensions.length === 0 && measures.length === 0) {
                        setData([]);
                        setIsLoading(false);
                        return;
                    }

                    const semanticFilters: Filter[] = [];
                    if (widget.filters) semanticFilters.push(...widget.filters);
                    globalFilters.forEach(gf => {
                        if (!gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)) {
                            semanticFilters.push({ field: gf.field, operator: gf.operator, value: gf.value, enabled: true });
                        }
                    });
                    const activeCrossFilters = getFiltersForWidget(widget.id);
                    semanticFilters.push(...activeCrossFilters.map(f => ({ ...f, enabled: true })));

                    const semanticSelect: Array<{ tableId: string; column: string; aggregation: any; alias: string }> = [];
                    const semanticGroupBy: Array<{ tableId: string; column: string }> = [];
                    const semanticOrderBy: Array<{ tableId: string; column: string; dir: 'ASC' | 'DESC' }> = [];
                    const semanticTableIds = new Set<string>();
                    const aliasToField = new Map<string, string>();
                    const numericAliases = new Set<string>();

                    const addGroupBy = (tableId: string, column: string) => {
                        if (semanticGroupBy.some(item => item.tableId === tableId && item.column === column)) return;
                        semanticGroupBy.push({ tableId, column });
                    };

                    dimensions.forEach((dimension, index) => {
                        const binding = resolveSemanticFieldBinding(dimension);
                        if (!binding) {
                            throw new Error(`Field "${dimension}" is not mapped in semantic model`);
                        }
                        if (binding.hierarchyPart) {
                            throw new Error(`Hierarchy field "${dimension}" is not supported in semantic mode yet`);
                        }

                        const alias = `d_${index}`;
                        semanticTableIds.add(binding.tableId);
                        semanticSelect.push({
                            tableId: binding.tableId,
                            column: binding.column,
                            aggregation: 'none',
                            alias,
                        });
                        addGroupBy(binding.tableId, binding.column);
                        aliasToField.set(alias, dimension);
                    });

                    measures.forEach((measure, index) => {
                        if ((measure as any).expression) {
                            throw new Error(`Calculated field "${measure.field}" is not supported in semantic model direct query`);
                        }

                        const binding = resolveSemanticFieldBinding(measure.field);
                        if (!binding) {
                            throw new Error(`Field "${measure.field}" is not mapped in semantic model`);
                        }
                        if (binding.hierarchyPart) {
                            throw new Error(`Hierarchy field "${measure.field}" is not supported in semantic mode yet`);
                        }

                        const alias = `m_${index}`;
                        semanticTableIds.add(binding.tableId);
                        semanticSelect.push({
                            tableId: binding.tableId,
                            column: binding.column,
                            aggregation: normalizeSemanticAggregation(measure.aggregation),
                            alias,
                        });
                        aliasToField.set(alias, measure.field);
                        numericAliases.add(alias);
                    });

                    const semanticFiltersForPlanner = semanticFilters
                        .filter(filter => filter?.enabled !== false)
                        .map((filter) => {
                            const binding = resolveSemanticFieldBinding(filter.field);
                            if (!binding || binding.hierarchyPart) return null;
                            semanticTableIds.add(binding.tableId);
                            return {
                                tableId: binding.tableId,
                                column: binding.column,
                                operator: filter.operator,
                                value: filter.value,
                                value2: filter.value2,
                            };
                        })
                        .filter(Boolean) as Array<{
                            tableId: string;
                            column: string;
                            operator: string;
                            value?: any;
                            value2?: any;
                        }>;

                    if (widget.sortBy && widget.sortBy !== 'none') {
                        const [sortType, sortDir] = widget.sortBy.split('_');
                        const dir = String(sortDir || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

                        if (sortType === 'category') {
                            dimensions.forEach((dimension) => {
                                const binding = resolveSemanticFieldBinding(dimension);
                                if (!binding || binding.hierarchyPart) return;
                                semanticOrderBy.push({
                                    tableId: binding.tableId,
                                    column: binding.column,
                                    dir,
                                });
                            });
                        } else if (sortType === 'value') {
                            const firstMeasure = measures[0];
                            if (firstMeasure) {
                                const binding = resolveSemanticFieldBinding(firstMeasure.field);
                                if (binding && !binding.hierarchyPart) {
                                    semanticOrderBy.push({
                                        tableId: binding.tableId,
                                        column: binding.column,
                                        dir,
                                    });
                                }
                            }
                        }
                    }

                    if (semanticTableIds.size === 0 || semanticSelect.length === 0) {
                        setData([]);
                        setIsLoading(false);
                        return;
                    }

                    const request: any = {
                        dataModelId: dataSource.dataModelId,
                        dashboardId: activeDashboard?.id,
                        pageId: activeDashboard?.activePageId,
                        tableIds: Array.from(semanticTableIds),
                        select: semanticSelect,
                        filters: semanticFiltersForPlanner,
                        groupBy: semanticGroupBy.length > 0 ? semanticGroupBy : undefined,
                        orderBy: semanticOrderBy.length > 0 ? semanticOrderBy : undefined,
                        limit: widget.type === 'table' ? (widget.pageSize || 100) : 1000,
                    };

                    const planned = await planSemanticQuery(request);
                    let resultRows: any[] = [];

                    if (planned.engine === 'postgres') {
                        const executed = await executeSemanticQuery(request);
                        resultRows = executed.rows || [];
                    } else {
                        const preferredConnection = dataSource.connectionId
                            ? connections.find(c => c.id === dataSource.connectionId)
                            : connections.find(c => c.type === 'BigQuery' && c.projectId);

                        if (!preferredConnection?.projectId) {
                            throw new Error('Missing BigQuery project for semantic execution');
                        }

                        const { getTokenForConnection, getGoogleClientId } = await import('../../../services/googleAuth');
                        const clientId = getGoogleClientId();
                        const token = await getTokenForConnection(preferredConnection, clientId);
                        if (!token) {
                            throw new Error('Relink your account to execute semantic query');
                        }

                        resultRows = await runQuery(token, preferredConnection.projectId, planned.sql, abortController.signal);
                    }

                    if (!isMounted) return;

                    const normalizedData = (resultRows || []).map((row) => {
                        const nextRow: Record<string, any> = {};
                        aliasToField.forEach((fieldName, alias) => {
                            const rawVal = row[alias];
                            if (numericAliases.has(alias)) {
                                if (rawVal === null || rawVal === undefined || rawVal === '') {
                                    nextRow[fieldName] = 0;
                                } else if (typeof rawVal === 'number') {
                                    nextRow[fieldName] = rawVal;
                                } else {
                                    const parsed = parseFloat(String(rawVal));
                                    nextRow[fieldName] = Number.isNaN(parsed) ? 0 : parsed;
                                }
                            } else {
                                nextRow[fieldName] = rawVal;
                            }
                        });
                        return nextRow;
                    });

                    setData(normalizedData);
                } catch (err: any) {
                    if (isMounted && err.name !== 'AbortError') {
                        console.error('Semantic Direct Query Error:', err);
                        setError(err.message || 'Failed to execute semantic query');
                        setData([]);
                    }
                } finally {
                    if (isMounted) setIsLoading(false);
                }
                return;
            }

            if (dataSource.type !== 'bigquery') {
                const processLocalData = (rawRows: any[]) => {
                    const localFilters: Filter[] = [];

                    if (widget.filters) localFilters.push(...widget.filters);
                    globalFilters.forEach(gf => {
                        if (!gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)) {
                            localFilters.push({ field: gf.field, operator: gf.operator, value: gf.value, enabled: true });
                        }
                    });

                    const activeCrossFilters = getFiltersForWidget(widget.id);
                    localFilters.push(...activeCrossFilters.map(f => ({ ...f, enabled: true })));

                    const drillDownState = drillDowns[widget.id];
                    if (widget.type === 'chart' && drillDownState && drillDownState.breadcrumbs.length > 0) {
                        drillDownState.breadcrumbs.forEach(bc => {
                            localFilters.push({
                                field: drillDownState.hierarchy[bc.level],
                                operator: 'equals',
                                value: bc.value,
                                enabled: true
                            });
                        });
                    }

                    const filteredRows = localFilters.length > 0 ? applyFilters(rawRows, localFilters) : rawRows;

                    if (widget.type !== 'chart') {
                        setData(filteredRows);
                        return;
                    }

                    if (dimensions.length === 0) {
                        if (measures.length === 0) {
                            setData([]);
                            return;
                        }

                        const totalRow: Record<string, any> = { _autoCategory: 'Total' };
                        measures.forEach((m) => {
                            totalRow[m.field] = aggregateValues(filteredRows, m.field, m.aggregation);
                        });
                        setData([totalRow]);
                        return;
                    }

                    const grouped = new Map<string, any[]>();
                    filteredRows.forEach(row => {
                        const parts = dimensions.map(d => String(getFieldValue(row, d) ?? '(Blank)'));
                        const key = parts.join('__360__');
                        if (!grouped.has(key)) grouped.set(key, []);
                        grouped.get(key)!.push(row);
                    });

                    const aggregatedRows: any[] = Array.from(grouped.values()).map(groupRows => {
                        const first = groupRows[0] || {};
                        const nextRow: Record<string, any> = {};
                        dimensions.forEach(dim => {
                            nextRow[dim] = getFieldValue(first, dim);
                        });
                        measures.forEach(m => {
                            nextRow[m.field] = aggregateValues(groupRows, m.field, m.aggregation);
                        });
                        return nextRow;
                    });

                    const axisFields = DrillDownService.getCurrentFields(widget, drillDownState);
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

                    let processedData = aggregatedRows;
                    const axisKey = (drillDownState?.mode === 'expand' && axisFields.length > 1) ? '_combinedAxis' : '_formattedAxis';

                    if (axisFields.length > 0) {
                        processedData = processedData.map(row => {
                            let label = '';
                            if (drillDownState?.mode === 'expand' && axisFields.length > 1) {
                                label = axisFields.map(f => formatLevelValue(row[f], f)).reverse().join('\n');
                            } else {
                                label = formatLevelValue(row[axisFields[0]], axisFields[0]);
                            }
                            return { ...row, [axisKey]: label };
                        });
                    }

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
                    if (widget.legend && dimensions.includes(widget.legend)) {
                        const xFieldKey = axisKey;
                        const legendField = widget.legend;
                        const legendMeasureField = measures[0]?.field;
                        const pivotMap = new Map<string, any>();

                        if (legendMeasureField) {
                            processedData.forEach(row => {
                                const xValue = row[xFieldKey] ?? '(Blank)';
                                const legendValue = resolveLegendLabel(row, legendField);
                                legendFields.add(legendValue);

                                if (!pivotMap.has(xValue)) {
                                    pivotMap.set(xValue, { ...row });
                                }
                                const pivotRow = pivotMap.get(xValue);
                                const prevVal = Number(pivotRow[legendValue]) || 0;
                                const incomingVal = Number(row[legendMeasureField]) || 0;
                                pivotRow[legendValue] = prevVal + incomingVal;
                            });
                        }
                        processedData = Array.from(pivotMap.values());
                    }

                    if (widget.sortBy && widget.sortBy !== 'none') {
                        const [type, dir] = widget.sortBy.split('_');
                        const isDesc = dir === 'desc';

                        processedData.sort((a, b) => {
                            let valA: any;
                            let valB: any;

                            if (type === 'category') {
                                valA = a[axisKey] || '';
                                valB = b[axisKey] || '';
                                if (!isNaN(Date.parse(valA)) && !isNaN(Date.parse(valB))) {
                                    valA = new Date(valA).getTime();
                                    valB = new Date(valB).getTime();
                                }
                            } else {
                                const calcTotal = (row: any) => {
                                    if (legendFields.size > 0) {
                                        return Array.from(legendFields).reduce((sum, key) => sum + (Number(row[key]) || 0), 0);
                                    }
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
                };

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
                        let backendSchema: { name: string; type: 'string' | 'number' | 'date' | 'boolean' }[] | null = null;

                        while (hasMore) {
                            const page = await fetchExcelTableData(tableId, offset, pageSize);
                            const pageRows = page.rows || [];
                            if (!backendSchema && Array.isArray(page.schema) && page.schema.length > 0) {
                                backendSchema = page.schema.map((field) => ({
                                    name: field.name,
                                    type: normalizeFieldType(field.type),
                                }));
                            }

                            allRows.push(...pageRows);
                            totalRows = page.totalRows ?? totalRows;
                            offset += pageRows.length;
                            hasMore = !!page.hasMore && pageRows.length > 0;
                        }

                        if (!isMounted) return;

                        loadTableData(dataSource.id, allRows);
                        updateDataSource(dataSource.id, {
                            schema: backendSchema || dataSource.schema,
                            isLoaded: true,
                            isLoadingPartial: false,
                            syncStatus: 'ready',
                            totalRows: totalRows || allRows.length,
                            lastSyncAt: new Date().toISOString(),
                        });
                        processLocalData(allRows);
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
                    processLocalData(dataSource.data || []);
                }
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const connection = connections.find(c => c.id === dataSource.connectionId);
                const projectId = connection?.projectId;

                if (!projectId) throw new Error("Missing Project ID");

                const { getTokenForConnection, getGoogleClientId } = await import('../../../services/googleAuth');
                const clientId = getGoogleClientId();
                const token = connection ? await getTokenForConnection(connection, clientId) : null;

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
                if (widget.type === 'chart' && drillDownState && drillDownState.breadcrumbs.length > 0) {
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
                    const calcField = allCalculatedFields.find(c => c.name === d);
                    if (calcField) {
                        let expr = calcField.formula;
                        expr = expr.replace(/\[(.*?)\]/g, (match, p1) => `\`${p1}\``);
                        return { field: d, expression: expr };
                    }
                    return d;
                });

                const finalFilters = bqFilters.map(f => {
                    const calcField = allCalculatedFields.find(c => c.name === f.field);
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
                    let normalizedData = result.map(row => {
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

                    if (widget.type !== 'chart') {
                        setData(normalizedData);
                        return;
                    }

                    if (dimensions.length === 0 && measures.length > 0) {
                        normalizedData = normalizedData.map((row) => ({
                            ...row,
                            _autoCategory: row._autoCategory || 'Total',
                        }));
                    }

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
                        const legendMeasureField = measures[0]?.field;
                        const pivotMap = new Map<string, any>();

                        if (legendMeasureField) {
                            processedData.forEach(row => {
                                const xValue = row[xFieldKey] ?? '(Blank)';
                                const legendValue = resolveLegendLabel(row, legendField);
                                legendFields.add(legendValue);

                                if (!pivotMap.has(xValue)) {
                                    pivotMap.set(xValue, { ...row });
                                }
                                const pivotRow = pivotMap.get(xValue);
                                const prevVal = Number(pivotRow[legendValue]) || 0;
                                const incomingVal = Number(row[legendMeasureField]) || 0;
                                pivotRow[legendValue] = prevVal + incomingVal;
                            });
                        }
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
        dataSource?.dataModelId,
        dataSource?.semanticEngine,
        JSON.stringify(dataSource?.semanticTableIds || []),
        JSON.stringify(dataSource?.semanticFieldMap || {}),
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
