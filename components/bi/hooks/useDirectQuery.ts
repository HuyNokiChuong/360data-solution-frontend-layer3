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
    const currentDrillDownState = useMemo(() => {
        const runtimeState = drillDowns[widget.id];
        const persistedState = widget.drillDownState || null;
        return DrillDownService.resolveStateForWidget(widget, runtimeState || persistedState || undefined);
    }, [widget, drillDowns[widget.id], widget.drillDownState]);

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
                const xFields = DrillDownService.getCurrentFields(widget, currentDrillDownState);
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
    }, [widget, currentDrillDownState, dataSource, allCalculatedFields, allQuickMeasures]);

    const normalizeSemanticAggregation = useCallback((aggregation: AggregationType | undefined) => {
        const normalized = String(aggregation || 'none').trim().toLowerCase();
        if (normalized === 'countdistinct') return 'countDistinct';
        if (['sum', 'avg', 'count', 'min', 'max', 'none', 'raw', 'countDistinct'].includes(normalized)) {
            return normalized as any;
        }
        return 'none';
    }, []);

    const resolveSemanticFieldBinding = useCallback((
        fieldName: string,
        options?: {
            preferredTableIds?: Iterable<string>;
        }
    ) => {
        if (!dataSource || dataSource.type !== 'semantic_model') return null;
        const semanticFieldMap = dataSource.semanticFieldMap || {};

        const hierarchyIdx = fieldName.indexOf('___');
        const baseField = hierarchyIdx >= 0 ? fieldName.slice(0, hierarchyIdx) : fieldName;
        const hierarchyPart = hierarchyIdx >= 0 ? fieldName.slice(hierarchyIdx + 3) : '';
        const preferredTableIds = new Set(
            Array.from(options?.preferredTableIds || [])
                .map((tableId) => String(tableId || '').trim())
                .filter(Boolean)
        );

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
        const datasetHint = parts.length >= 3 ? parts[parts.length - 3].toLowerCase() : '';
        const columnKey = String(column || '').toLowerCase();
        const candidates = Object.entries(semanticFieldMap)
            .map(([key, binding]) => {
                if (!binding) return null;
                if (String(binding.column || '').toLowerCase() !== columnKey) return null;

                let score = 0;
                const bindingTableId = String(binding.tableId || '');
                const bindingTableName = String(binding.tableName || '').toLowerCase();
                const bindingDatasetName = String(binding.datasetName || '').toLowerCase();
                const semanticKey = String(key || '').toLowerCase();

                if (preferredTableIds.has(bindingTableId)) score += 500;
                if (tableHint && bindingTableName === tableHint) score += 180;
                if (datasetHint && bindingDatasetName === datasetHint) score += 80;
                if (tableHint && semanticKey.includes(`${tableHint}.`)) score += 45;
                if (datasetHint && tableHint && semanticKey.includes(`${datasetHint}.${tableHint}.`)) score += 20;

                return {
                    key,
                    binding,
                    score,
                    tableId: bindingTableId,
                };
            })
            .filter((item): item is {
                key: string;
                binding: NonNullable<typeof semanticFieldMap[string]>;
                score: number;
                tableId: string;
            } => item !== null)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.key.localeCompare(b.key);
            });

        if (candidates.length === 0) return null;
        const topScore = candidates[0].score;
        const topCandidates = candidates.filter((candidate) => candidate.score === topScore);

        if (topCandidates.length > 1) {
            const preferredMatches = topCandidates.filter((candidate) => preferredTableIds.has(candidate.tableId));
            if (preferredMatches.length === 1) {
                const preferred = preferredMatches[0];
                return {
                    tableId: preferred.binding.tableId,
                    column: preferred.binding.column,
                    hierarchyPart,
                };
            }
            return null;
        }

        const fallback = candidates[0].binding;
        return {
            tableId: fallback.tableId,
            column: fallback.column,
            hierarchyPart,
        };
    }, [dataSource]);

    const normalizeFieldToken = useCallback((value: string) => {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }, []);

    const schemaFieldKeys = useMemo(() => {
        const keys = new Set<string>();
        (dataSource?.schema || []).forEach((field) => {
            const raw = String(field?.name || '').trim().toLowerCase();
            if (!raw) return;
            keys.add(raw);

            const rawBase = raw.split('___')[0];
            keys.add(rawBase);

            const rawTail = rawBase.split('.').pop();
            if (rawTail) keys.add(rawTail);
        });
        return keys;
    }, [dataSource?.schema]);

    const isFieldCompatibleWithCurrentSource = useCallback((fieldName: string) => {
        const raw = String(fieldName || '').trim().toLowerCase();
        if (!raw) return false;

        const base = raw.split('___')[0];
        const tail = base.split('.').pop() || base;

        const calcMatched = allCalculatedFields.some((calc) => {
            const calcRaw = String(calc?.name || '').trim().toLowerCase();
            if (!calcRaw) return false;
            const calcBase = calcRaw.split('___')[0];
            const calcTail = calcBase.split('.').pop() || calcBase;
            return (
                calcRaw === raw
                || calcBase === base
                || calcTail === tail
                || calcRaw.endsWith(`.${tail}`)
            );
        });
        if (calcMatched) return true;

        if (!dataSource) return false;
        if (schemaFieldKeys.has(raw) || schemaFieldKeys.has(base) || schemaFieldKeys.has(tail)) return true;

        for (const key of schemaFieldKeys) {
            if (key.endsWith(`.${base}`) || key.endsWith(`.${tail}`)) {
                return true;
            }
        }

        return false;
    }, [allCalculatedFields, dataSource, schemaFieldKeys]);

    const scopeFiltersToCurrentSource = useCallback((filters: Filter[]) => {
        return (filters || []).filter((filter) => {
            if (!filter) return false;
            if (filter.enabled === false) return true;
            return isFieldCompatibleWithCurrentSource(filter.field);
        });
    }, [isFieldCompatibleWithCurrentSource]);

    const getMeasureOutputField = useCallback((fieldName: string, aggregation?: AggregationType) => {
        const normalizedAgg = normalizeAggregation(aggregation || 'none');
        if (dimensions.includes(fieldName)) {
            return `${fieldName}__${normalizedAgg}`;
        }
        return fieldName;
    }, [dimensions]);

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

    const formatHierarchyLevelValue = useCallback((val: any, field: string): string => {
        const toBlank = () => '(Blank)';
        const normalizePrimitive = (input: any): any => {
            if (input === null || input === undefined) return null;
            if (typeof input === 'number') return Number.isFinite(input) ? input : null;
            if (typeof input === 'string') {
                const trimmed = input.trim();
                if (!trimmed) return null;
                const lowered = trimmed.toLowerCase();
                if (lowered === 'null' || lowered === 'undefined' || lowered === 'nan') return null;
                return trimmed;
            }
            return input;
        };

        const normalized = normalizePrimitive(val);
        if (normalized === null) return toBlank();

        if (field.includes('___')) {
            const part = field.split('___')[1];
            const asNumber = Number(normalized);
            const hasNumeric = Number.isFinite(asNumber);

            const invalidIfNonPositive = ['year', 'quarter', 'half', 'month', 'day'];
            if (invalidIfNonPositive.includes(part) && hasNumeric && asNumber <= 0) {
                return toBlank();
            }

            switch (part) {
                case 'year':
                    return hasNumeric ? String(Math.trunc(asNumber)) : String(normalized);
                case 'quarter':
                    if (!hasNumeric || asNumber < 1 || asNumber > 4) return toBlank();
                    return `Q${Math.trunc(asNumber)}`;
                case 'half':
                    if (!hasNumeric || asNumber < 1 || asNumber > 2) return toBlank();
                    return `H${Math.trunc(asNumber)}`;
                case 'month': {
                    if (!hasNumeric || asNumber < 1 || asNumber > 12) return toBlank();
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const mIdx = Math.trunc(asNumber) - 1;
                    return months[mIdx] || toBlank();
                }
                case 'day':
                    if (!hasNumeric || asNumber < 1 || asNumber > 31) return toBlank();
                    return `Day ${Math.trunc(asNumber)}`;
                case 'hour':
                    if (!hasNumeric || asNumber < 0 || asNumber > 23) return toBlank();
                    return `${String(Math.trunc(asNumber)).padStart(2, '0')}:00`;
                case 'minute':
                    if (!hasNumeric || asNumber < 0 || asNumber > 59) return toBlank();
                    return `:${String(Math.trunc(asNumber)).padStart(2, '0')}`;
                case 'second':
                    if (!hasNumeric || asNumber < 0 || asNumber > 59) return toBlank();
                    return `:${String(Math.trunc(asNumber)).padStart(2, '0')}s`;
                default:
                    return String(normalized);
            }
        }

        return String(normalized);
    }, []);

    const isNullLikeFilterValue = useCallback((value: any) => {
        if (value === null || value === undefined) return true;
        if (typeof value !== 'string') return false;
        const normalized = value.trim().toLowerCase();
        return normalized === '' || normalized === '(blank)' || normalized === 'null' || normalized === 'undefined' || normalized === 'nan';
    }, []);

    const appendDrillDownFilters = useCallback((baseFilters: Filter[]): Filter[] => {
        const nextFilters = [...(baseFilters || [])];
        if (widget.type !== 'chart') return nextFilters;
        if (!currentDrillDownState || currentDrillDownState.breadcrumbs.length === 0) return nextFilters;

        currentDrillDownState.breadcrumbs.forEach((breadcrumb) => {
            const field = currentDrillDownState.hierarchy[breadcrumb.level];
            if (!field) return;
            const rawValue = breadcrumb.rawValue ?? breadcrumb.value;
            const operator: FilterOperator = isNullLikeFilterValue(rawValue) ? 'isNull' : 'equals';
            nextFilters.push({
                field,
                operator,
                value: rawValue,
                enabled: true
            });
        });

        return nextFilters;
    }, [widget.type, currentDrillDownState, isNullLikeFilterValue]);

    const isSelfSelectionPersistenceFilter = useCallback((filter: Filter) => {
        if (!filter) return false;

        if (widget.type === 'slicer') {
            return filter.id === `slicer-${widget.id}`;
        }

        if (widget.type === 'search') {
            return filter.id === `search-${widget.id}`;
        }

        if (widget.type === 'date-range') {
            return filter.id === `date-${widget.id}`;
        }

        return false;
    }, [widget.type, widget.id]);

    const widgetIntrinsicFilters = useMemo(() => {
        const candidate = Array.isArray(widget.filters) ? widget.filters : [];
        return candidate.filter((filter) => !isSelfSelectionPersistenceFilter(filter));
    }, [widget.filters, isSelfSelectionPersistenceFilter]);

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
                    if (widgetIntrinsicFilters.length > 0) semanticFilters.push(...widgetIntrinsicFilters);
                    globalFilters.forEach(gf => {
                        if (!gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)) {
                            semanticFilters.push({ field: gf.field, operator: gf.operator, value: gf.value, enabled: true });
                        }
                    });
                    const activeCrossFilters = getFiltersForWidget(widget.id);
                    semanticFilters.push(...activeCrossFilters.map(f => ({ ...f, enabled: true })));
                    const semanticFiltersWithDrill = appendDrillDownFilters(semanticFilters);

                    const semanticSelect: Array<{ tableId: string; column: string; hierarchyPart?: string; aggregation: any; alias: string }> = [];
                    const semanticGroupBy: Array<{ tableId: string; column: string; hierarchyPart?: string }> = [];
                    const semanticOrderBy: Array<{ tableId: string; column: string; hierarchyPart?: string; dir: 'ASC' | 'DESC' }> = [];
                    const semanticTableIds = new Set<string>();
                    const aliasToField = new Map<string, string>();
                    const numericAliases = new Set<string>();
                    const shouldUseGroupBy = widget.type !== 'table';

                    const addGroupBy = (tableId: string, column: string, hierarchyPart?: string) => {
                        if (semanticGroupBy.some(item =>
                            item.tableId === tableId
                            && item.column === column
                            && item.hierarchyPart === hierarchyPart
                        )) return;
                        semanticGroupBy.push({ tableId, column, hierarchyPart });
                    };

                    dimensions.forEach((dimension, index) => {
                        const binding = resolveSemanticFieldBinding(dimension, {
                            preferredTableIds: semanticTableIds,
                        });
                        if (!binding) {
                            throw new Error(`Field "${dimension}" is not mapped in semantic model`);
                        }
                        const alias = `d_${index}`;
                        semanticTableIds.add(binding.tableId);
                        semanticSelect.push({
                            tableId: binding.tableId,
                            column: binding.column,
                            hierarchyPart: binding.hierarchyPart || undefined,
                            aggregation: 'none',
                            alias,
                        });
                        if (shouldUseGroupBy) {
                            addGroupBy(binding.tableId, binding.column, binding.hierarchyPart || undefined);
                        }
                        aliasToField.set(alias, dimension);
                    });

                    measures.forEach((measure, index) => {
                        if ((measure as any).expression) {
                            throw new Error(`Calculated field "${measure.field}" is not supported in semantic model direct query`);
                        }

                        const binding = resolveSemanticFieldBinding(measure.field, {
                            preferredTableIds: semanticTableIds,
                        });
                        if (!binding) {
                            throw new Error(`Field "${measure.field}" is not mapped in semantic model`);
                        }
                        const alias = `m_${index}`;
                        semanticTableIds.add(binding.tableId);
                        semanticSelect.push({
                            tableId: binding.tableId,
                            column: binding.column,
                            hierarchyPart: binding.hierarchyPart || undefined,
                            aggregation: normalizeSemanticAggregation(measure.aggregation),
                            alias,
                        });
                        aliasToField.set(alias, getMeasureOutputField(measure.field, measure.aggregation));
                        numericAliases.add(alias);
                    });

                    const semanticFiltersForPlanner = semanticFiltersWithDrill
                        .filter(filter => filter?.enabled !== false)
                        .map((filter) => {
                            const binding = resolveSemanticFieldBinding(filter.field, {
                                preferredTableIds: semanticTableIds,
                            });
                            if (!binding) return null;
                            return {
                                tableId: binding.tableId,
                                column: binding.column,
                                hierarchyPart: binding.hierarchyPart || undefined,
                                operator: filter.operator,
                                value: filter.value,
                                value2: filter.value2,
                            };
                        })
                        .filter(Boolean) as Array<{
                            tableId: string;
                            column: string;
                            hierarchyPart?: string;
                            operator: string;
                            value?: any;
                            value2?: any;
                        }>;

                    if (widget.sortBy && widget.sortBy !== 'none') {
                        const [sortType, sortDir] = widget.sortBy.split('_');
                        const dir = String(sortDir || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

                        if (sortType === 'category') {
                            dimensions.forEach((dimension) => {
                                const binding = resolveSemanticFieldBinding(dimension, {
                                    preferredTableIds: semanticTableIds,
                                });
                                if (!binding) return;
                                semanticOrderBy.push({
                                    tableId: binding.tableId,
                                    column: binding.column,
                                    hierarchyPart: binding.hierarchyPart || undefined,
                                    dir,
                                });
                            });
                        } else if (sortType === 'value') {
                            const firstMeasure = measures[0];
                            if (firstMeasure) {
                                const binding = resolveSemanticFieldBinding(firstMeasure.field, {
                                    preferredTableIds: semanticTableIds,
                                });
                                if (binding) {
                                    semanticOrderBy.push({
                                        tableId: binding.tableId,
                                        column: binding.column,
                                        hierarchyPart: binding.hierarchyPart || undefined,
                                        dir,
                                    });
                                }
                            }
                        }
                    } else if (dimensions.length > 0) {
                        const isTemporalDimension = (dimension: string) => {
                            if (dimension.includes('___')) return true;
                            const baseField = dimension.split('___')[0];
                            const parts = baseField.split('.');
                            const columnOnly = parts[parts.length - 1] || baseField;
                            const tail2 = parts.length >= 2 ? parts.slice(-2).join('.') : '';
                            const candidates = [dimension, baseField, tail2, columnOnly]
                                .map((item) => String(item || '').toLowerCase())
                                .filter(Boolean);

                            const fieldDef = (dataSource.schema || []).find((field) => {
                                const key = String(field.name || '').toLowerCase();
                                return candidates.some((candidate) => key === candidate || key.endsWith(`.${candidate}`));
                            });
                            return fieldDef?.type === 'date';
                        };

                        if (dimensions.some(isTemporalDimension)) {
                            dimensions.forEach((dimension) => {
                                const binding = resolveSemanticFieldBinding(dimension, {
                                    preferredTableIds: semanticTableIds,
                                });
                                if (!binding) return;
                                semanticOrderBy.push({
                                    tableId: binding.tableId,
                                    column: binding.column,
                                    hierarchyPart: binding.hierarchyPart || undefined,
                                    dir: 'ASC',
                                });
                            });
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
                        groupBy: shouldUseGroupBy && semanticGroupBy.length > 0 ? semanticGroupBy : undefined,
                        orderBy: semanticOrderBy.length > 0 ? semanticOrderBy : undefined,
                        limit: widget.type === 'table' ? 100 : 1000,
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
                                    nextRow[fieldName] = null;
                                } else if (typeof rawVal === 'number') {
                                    nextRow[fieldName] = rawVal;
                                } else {
                                    const parsed = parseFloat(String(rawVal));
                                    nextRow[fieldName] = Number.isNaN(parsed) ? null : parsed;
                                }
                            } else {
                                nextRow[fieldName] = rawVal;
                            }
                        });
                        return nextRow;
                    });

                    if (widget.type !== 'chart') {
                        setData(normalizedData);
                    } else {
                        let processedData = normalizedData;

                        if (dimensions.length === 0 && measures.length > 0) {
                            processedData = normalizedData.map((row) => ({
                                ...row,
                                _autoCategory: row._autoCategory || 'Total',
                            }));
                        }

                        const axisFields = DrillDownService.getCurrentFields(widget, currentDrillDownState);
                        const axisKey = (currentDrillDownState?.mode === 'expand' && axisFields.length > 1)
                            ? '_combinedAxis'
                            : '_formattedAxis';

                        if (axisFields.length > 0) {
                            processedData = processedData.map((row) => {
                                let label = '';
                                const rawAxisValue = row[axisFields[Math.max(0, axisFields.length - 1)]];
                                if (currentDrillDownState?.mode === 'expand' && axisFields.length > 1) {
                                    label = axisFields.map((field) => formatHierarchyLevelValue(row[field], field)).reverse().join('\n');
                                } else {
                                    label = formatHierarchyLevelValue(row[axisFields[0]], axisFields[0]);
                                }
                                return {
                                    ...row,
                                    [axisKey]: label,
                                    _rawAxisValue: rawAxisValue,
                                };
                            });
                        }

                        const willPivot = widget.legend && dimensions.includes(widget.legend);
                        if (axisFields.length > 0 && !willPivot) {
                            const groupedMap = new Map<string, any>();
                            processedData.forEach((row) => {
                                const label = row[axisKey];
                                if (!groupedMap.has(label)) {
                                    groupedMap.set(label, { ...row });
                                } else {
                                    const existing = groupedMap.get(label);
                                    measures.forEach((m) => {
                                        const outputField = getMeasureOutputField(m.field, m.aggregation);
                                        existing[outputField] = (existing[outputField] || 0) + (row[outputField] || 0);
                                    });
                                }
                            });
                            processedData = Array.from(groupedMap.values());
                        }

                        const legendFields = new Set<string>();
                        if (widget.legend && dimensions.includes(widget.legend)) {
                            const xFieldKey = axisKey;
                            const legendField = widget.legend;
                            const legendMeasureField = measures[0]
                                ? getMeasureOutputField(measures[0].field, measures[0].aggregation)
                                : undefined;
                            const pivotMap = new Map<string, any>();

                            if (legendMeasureField) {
                                processedData.forEach((row) => {
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
                                processedData = Array.from(pivotMap.values());
                            }
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
                                        return measures.reduce((sum, m) => {
                                            const outputField = getMeasureOutputField(m.field, m.aggregation);
                                            return sum + (Number(row[outputField]) || 0);
                                        }, 0);
                                    };
                                    valA = calcTotal(a);
                                    valB = calcTotal(b);
                                }

                                if (valA < valB) return isDesc ? 1 : -1;
                                if (valA > valB) return isDesc ? -1 : 1;
                                return 0;
                            });
                        }

                        const activeQuickMeasures = measures.filter((m) => m.isQuickMeasure);
                        if (activeQuickMeasures.length > 0) {
                            const finalData = [...processedData];
                            const totalMap = new Map<string, number>();

                            activeQuickMeasures.forEach((qm) => {
                                if (qm.qmType === 'percentOfTotal') {
                                    const total = finalData.reduce((sum, row) => sum + (Number(row[qm.field]) || 0), 0);
                                    totalMap.set(qm.field, total);
                                }
                            });

                            finalData.forEach((row) => {
                                activeQuickMeasures.forEach((qm) => {
                                    const val = Number(row[qm.field]) || 0;
                                    if (qm.qmType === 'percentOfTotal') {
                                        const total = totalMap.get(qm.field) || 1;
                                        row[(qm as any).originalLabel] = total === 0 ? 0 : (val / total);
                                    }
                                });
                            });
                            processedData = finalData;
                        }

                        setData(processedData);
                    }
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

                    if (widgetIntrinsicFilters.length > 0) localFilters.push(...widgetIntrinsicFilters);
                    globalFilters.forEach(gf => {
                        if (!gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)) {
                            localFilters.push({ field: gf.field, operator: gf.operator, value: gf.value, enabled: true });
                        }
                    });

                    const activeCrossFilters = getFiltersForWidget(widget.id);
                    localFilters.push(...activeCrossFilters.map(f => ({ ...f, enabled: true })));
                    const localFiltersWithDrill = appendDrillDownFilters(localFilters);

                    const compatibleLocalFilters = scopeFiltersToCurrentSource(localFiltersWithDrill);
                    const filteredRows = compatibleLocalFilters.length > 0
                        ? applyFilters(rawRows, compatibleLocalFilters)
                        : rawRows;

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
                            const outputField = getMeasureOutputField(m.field, m.aggregation);
                            totalRow[outputField] = aggregateValues(filteredRows, m.field, m.aggregation);
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
                            const outputField = getMeasureOutputField(m.field, m.aggregation);
                            nextRow[outputField] = aggregateValues(groupRows, m.field, m.aggregation);
                        });
                        return nextRow;
                    });

                    const axisFields = DrillDownService.getCurrentFields(widget, currentDrillDownState);
                    let processedData = aggregatedRows;
                    const axisKey = (currentDrillDownState?.mode === 'expand' && axisFields.length > 1) ? '_combinedAxis' : '_formattedAxis';

                    if (axisFields.length > 0) {
                        processedData = processedData.map(row => {
                            let label = '';
                            const rawAxisValue = row[axisFields[Math.max(0, axisFields.length - 1)]];
                            if (currentDrillDownState?.mode === 'expand' && axisFields.length > 1) {
                                label = axisFields.map(f => formatHierarchyLevelValue(row[f], f)).reverse().join('\n');
                            } else {
                                label = formatHierarchyLevelValue(row[axisFields[0]], axisFields[0]);
                            }
                            return { ...row, [axisKey]: label, _rawAxisValue: rawAxisValue };
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
                                    const outputField = getMeasureOutputField(m.field, m.aggregation);
                                    existing[outputField] = (existing[outputField] || 0) + (row[outputField] || 0);
                                });
                            }
                        });
                        processedData = Array.from(groupedMap.values());
                    }

                    const legendFields = new Set<string>();
                    if (widget.legend && dimensions.includes(widget.legend)) {
                        const xFieldKey = axisKey;
                        const legendField = widget.legend;
                        const legendMeasureField = measures[0]
                            ? getMeasureOutputField(measures[0].field, measures[0].aggregation)
                            : undefined;
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
                                    return measures.reduce((sum, m) => {
                                        const outputField = getMeasureOutputField(m.field, m.aggregation);
                                        return sum + (Number(row[outputField]) || 0);
                                    }, 0);
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
                if (widgetIntrinsicFilters.length > 0) bqFilters.push(...widgetIntrinsicFilters);
                globalFilters.forEach(gf => {
                    if (!gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)) {
                        bqFilters.push({ field: gf.field, operator: gf.operator, value: gf.value, enabled: true });
                    }
                });
                const activeCrossFilters = getFiltersForWidget(widget.id);
                bqFilters.push(...activeCrossFilters.map(f => ({ ...f, enabled: true })));
                const bqFiltersWithDrill = appendDrillDownFilters(bqFilters);

                const scopedDimensions = dimensions.filter((field) => isFieldCompatibleWithCurrentSource(field));
                const scopedMeasures = measures.filter((measure) => isFieldCompatibleWithCurrentSource(measure.field));

                if (scopedDimensions.length === 0 && scopedMeasures.length === 0) {
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
                        bqSortBy = scopedDimensions;
                    } else if (type === 'value') {
                        bqSortBy = scopedMeasures[0] ? `${scopedMeasures[0].field}_${scopedMeasures[0].aggregation}` : undefined;
                    }
                } else if (scopedDimensions.length > 0) {
                    // AUTO-DETECT TIME SERIES: Sort by all dimensions ASC by default if no explicit sort
                    const firstDim = scopedDimensions[0];
                    const isTimeHierarchy = firstDim.includes('___');
                    const fieldDef = dataSource.schema.find(f => f.name === firstDim.split('___')[0]);
                    const isDateType = fieldDef?.type === 'date' ||
                        firstDim.toLowerCase().includes('date') ||
                        firstDim.toLowerCase().includes('time');

                    if (isTimeHierarchy || isDateType) {
                        bqSortBy = scopedDimensions;
                        bqSortDir = 'ASC';
                    } else if (['pie', 'donut'].includes(widget.chartType || widget.type)) {
                        // Smart default for Pie/Donut: Biggest slice first
                        bqSortBy = scopedMeasures[0] ? `${scopedMeasures[0].field}_${scopedMeasures[0].aggregation}` : undefined;
                        bqSortDir = 'DESC';
                    }
                }

                const bqDimensions = scopedDimensions.map(d => {
                    const calcField = allCalculatedFields.find(c => c.name === d);
                    if (calcField) {
                        let expr = calcField.formula;
                        expr = expr.replace(/\[(.*?)\]/g, (match, p1) => `\`${p1}\``);
                        return { field: d, expression: expr };
                    }
                    return d;
                });

                const scopedBqFilters = scopeFiltersToCurrentSource(bqFiltersWithDrill as Filter[]);
                const finalFilters = scopedBqFilters.map(f => {
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
                        measures: scopedMeasures,
                        filters: finalFilters,
                        sortBy: bqSortBy,
                        sortDir: bqSortDir,
                        limit: widget.type === 'table' ? 100 : 1000,
                        signal: abortController.signal
                    }
                );

                if (isMounted) {
                    // 1. Normalize data: Map SQL aliases to field names and ensure numeric types
                    let normalizedData = result.map(row => {
                        const newRow: Record<string, any> = {};

                        // Copy dimension values (handle hierarchy case-insensitively)
                        scopedDimensions.forEach(dim => {
                            if (row[dim] !== undefined) {
                                newRow[dim] = row[dim];
                            } else {
                                const matchedKey = Object.keys(row).find(k => k.toLowerCase() === dim.toLowerCase());
                                if (matchedKey) newRow[dim] = row[matchedKey];
                            }
                        });

                        // Extract measures
                        scopedMeasures.forEach(m => {
                            const sqlAlias = `${m.field}_${m.aggregation}`;
                            const findKey = (obj: any, target: string) =>
                                Object.keys(obj).find(k => k.toLowerCase() === target.toLowerCase());

                            const matchedAlias = findKey(row, sqlAlias);
                            const matchedField = findKey(row, m.field);

                            let rawVal = matchedAlias ? row[matchedAlias] : (matchedField ? row[matchedField] : undefined);
                            let val: number | null = null;
                            if (rawVal !== null && rawVal !== undefined) {
                                if (typeof rawVal === 'number') val = rawVal;
                                else {
                                    const parsed = parseFloat(String(rawVal));
                                    val = isNaN(parsed) ? null : parsed;
                                }
                            }
                            const outputField = getMeasureOutputField(m.field, m.aggregation);
                            newRow[outputField] = val;
                        });
                        return newRow;
                    });

                    if (widget.type !== 'chart') {
                        setData(normalizedData);
                        return;
                    }

                    if (scopedDimensions.length === 0 && scopedMeasures.length > 0) {
                        normalizedData = normalizedData.map((row) => ({
                            ...row,
                            _autoCategory: row._autoCategory || 'Total',
                        }));
                    }

                    const axisFields = DrillDownService.getCurrentFields(widget, currentDrillDownState)
                        .filter((field) => scopedDimensions.includes(field));

                    let processedData = normalizedData;

                    // 2. Add Axis Labels
                    const axisKey = (currentDrillDownState?.mode === 'expand' && axisFields.length > 1) ? '_combinedAxis' : '_formattedAxis';

                    if (axisFields.length > 0) {
                        processedData = processedData.map(row => {
                            let label = '';
                            const rawAxisValue = row[axisFields[Math.max(0, axisFields.length - 1)]];
                            if (currentDrillDownState?.mode === 'expand' && axisFields.length > 1) {
                                label = axisFields.map(f => formatHierarchyLevelValue(row[f], f)).reverse().join('\n');
                            } else {
                                label = formatHierarchyLevelValue(row[axisFields[0]], axisFields[0]);
                            }
                            return { ...row, [axisKey]: label, _rawAxisValue: rawAxisValue };
                        });
                    }

                    // 3. CRITICAL FIX: Group by Axis Label to prevent duplicates and ensure Tooltip consistency
                    // If multiple rows have the same label, we sum their measures.
                    // IMPORTANT: Skip this if we are going to Pivot (Block 4), because this grouping blindly merges 
                    // rows based on Axis Label, destroying the Legend distinction (e.g. merging "Brand A" and "Brand B").
                    const willPivot = widget.legend && scopedDimensions.includes(widget.legend);

                        if (axisFields.length > 0 && !willPivot) {
                            const groupedMap = new Map<string, any>();
                            processedData.forEach(row => {
                                const label = row[axisKey];
                                if (!groupedMap.has(label)) {
                                    groupedMap.set(label, { ...row });
                                } else {
                                    const existing = groupedMap.get(label);
                                    scopedMeasures.forEach(m => {
                                        const outputField = getMeasureOutputField(m.field, m.aggregation);
                                        existing[outputField] = (existing[outputField] || 0) + (row[outputField] || 0);
                                    });
                                }
                            });
                            processedData = Array.from(groupedMap.values());
                        }

                    const legendFields = new Set<string>();
                    // 4. Pivot by Legend (if applicable)
                    if (widget.legend && scopedDimensions.includes(widget.legend)) {
                        const xFieldKey = axisKey;
                        const legendField = widget.legend;
                        const legendMeasureField = scopedMeasures[0]
                            ? getMeasureOutputField(scopedMeasures[0].field, scopedMeasures[0].aggregation)
                            : undefined;
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
                                    return scopedMeasures.reduce((sum, m) => {
                                        const outputField = getMeasureOutputField(m.field, m.aggregation);
                                        return sum + (Number(row[outputField]) || 0);
                                    }, 0);
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
                    const activeQuickMeasures = scopedMeasures.filter(m => m.isQuickMeasure);
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
        JSON.stringify(dataSource?.schema || []),
        JSON.stringify(dataSource?.semanticTableIds || []),
        JSON.stringify(dataSource?.semanticFieldMap || {}),
        JSON.stringify(allCalculatedFields || []),
        JSON.stringify(dimensions),
        JSON.stringify(measures),
        JSON.stringify(widgetIntrinsicFilters),
        JSON.stringify(globalFilters),
        JSON.stringify(crossFilters.filter(cf => cf.sourceWidgetId !== widget.id)),
        JSON.stringify(currentDrillDownState),
        isFieldCompatibleWithCurrentSource,
        isNullLikeFilterValue,
        appendDrillDownFilters
    ]);

    // Derived properties for Charts
    const [pivotedSeries, setPivotedSeries] = useState<string[]>([]);

    // Update pivoted series when data changes
    useEffect(() => {
        if (widget.legend && data.length > 0) {
            const systemKeys = new Set(['_formattedAxis', '_combinedAxis', '_rawAxisValue', '_autoCategory']);
            const normalizeKey = (value: string | undefined) => String(value || '').trim().toLowerCase();

            const xFields = DrillDownService.getCurrentFields(widget, currentDrillDownState).filter(Boolean);
            const normalizedDimensions = new Set((dimensions || []).map((dim) => normalizeKey(dim)));
            const normalizedXFields = new Set(xFields.map((field) => normalizeKey(field)));
            const normalizedMeasureFields = new Set((measures || []).map((measure) => normalizeKey(measure.field)));
            const normalizedMeasureOutputs = new Set(
                (measures || []).map((measure) => normalizeKey(getMeasureOutputField(measure.field, measure.aggregation)))
            );
            const normalizedLegendField = normalizeKey(widget.legend);

            const stats = new Map<string, { hasFinite: boolean; hasNonZero: boolean; absTotal: number }>();

            data.forEach((row) => {
                Object.entries(row || {}).forEach(([key, rawValue]) => {
                    const normalizedKey = normalizeKey(key);
                    if (!normalizedKey) return;
                    if (key.startsWith('_') || systemKeys.has(key)) return;
                    if (normalizedLegendField && normalizedKey === normalizedLegendField) return;
                    if (normalizedDimensions.has(normalizedKey) || normalizedXFields.has(normalizedKey)) return;
                    if (normalizedMeasureFields.has(normalizedKey) || normalizedMeasureOutputs.has(normalizedKey)) return;

                    const stat = stats.get(key) || { hasFinite: false, hasNonZero: false, absTotal: 0 };
                    const numeric = Number(rawValue);
                    if (Number.isFinite(numeric)) {
                        stat.hasFinite = true;
                        if (numeric !== 0) stat.hasNonZero = true;
                        stat.absTotal += Math.abs(numeric);
                    }
                    stats.set(key, stat);
                });
            });

            const nextSeries = Array.from(stats.entries())
                .filter(([, stat]) => stat.hasFinite && stat.hasNonZero)
                .sort((a, b) => b[1].absTotal - a[1].absTotal)
                .map(([key]) => key);

            setPivotedSeries(nextSeries);
        } else {
            setPivotedSeries([]);
        }
    }, [
        data,
        widget.legend,
        JSON.stringify(dimensions),
        JSON.stringify(currentDrillDownState),
        JSON.stringify(measures),
        getMeasureOutputField
    ]);

    const seriesList = useMemo(() => {
        const sanitizeSeries = (items: string[]) =>
            items.filter((item) => {
                const key = String(item || '').trim();
                return key.length > 0 && !key.startsWith('_');
            });

        if (pivotedSeries.length > 0) return sanitizeSeries(pivotedSeries);

        const mapConfiguredField = (field: string) => {
            const matchedMeasure = measures.find((m) => m.field === field);
            if (!matchedMeasure) return field;
            return getMeasureOutputField(matchedMeasure.field, matchedMeasure.aggregation);
        };

        if (widget.yAxisConfigs && widget.yAxisConfigs.length > 0) {
            return sanitizeSeries(widget.yAxisConfigs.map(c => mapConfiguredField(c.field)));
        }

        if (widget.yAxis && widget.yAxis.length > 0) {
            return sanitizeSeries(widget.yAxis.map((field) => mapConfiguredField(field)));
        }

        if (widget.measures && widget.measures.length > 0) {
            return sanitizeSeries(widget.measures.map((field) => mapConfiguredField(field)));
        }

        return sanitizeSeries(Array.from(
            new Set(
                measures
                    .map((m) => getMeasureOutputField(m.field, m.aggregation))
                    .filter(Boolean)
            )
        ));
    }, [widget.yAxisConfigs, widget.yAxis, widget.measures, pivotedSeries, measures, getMeasureOutputField]);

    const lineSeriesList = useMemo(() => {
        if (widget.lineAxisConfigs && widget.lineAxisConfigs.length > 0) {
            return widget.lineAxisConfigs.map(c => getMeasureOutputField(c.field, c.aggregation));
        }
        return [];
    }, [widget.lineAxisConfigs, getMeasureOutputField]);

    return {
        data,
        isLoading,
        error,
        chartData: data,
        series: seriesList,
        lineSeries: lineSeriesList
    };
};
