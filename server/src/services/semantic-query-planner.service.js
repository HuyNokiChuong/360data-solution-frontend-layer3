const { query } = require('../config/db');
const { normalizeSharePermission } = require('../utils/share-permissions');

const POSTGRES_ENGINE = 'postgres';
const BIGQUERY_ENGINE = 'bigquery';
const MAX_LIMIT = 5000;

const quotePostgresIdent = (value) => `"${String(value || '').replace(/"/g, '""')}"`;
const quoteBigQueryIdent = (value) => `\`${String(value || '').replace(/`/g, '')}\``;

const parseJsonArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            return [];
        }
    }
    return [];
};

const normalizeAgg = (agg) => {
    const normalized = String(agg || 'none').trim().toLowerCase();
    if (['sum', 'avg', 'count', 'min', 'max', 'countdistinct', 'none', 'raw'].includes(normalized)) {
        return normalized;
    }
    return 'none';
};

const normalizeDir = (dir) => (String(dir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC');

const quoteColumnRef = (engine, alias, column) => {
    if (engine === BIGQUERY_ENGINE) return `${alias}.${quoteBigQueryIdent(column)}`;
    return `${alias}.${quotePostgresIdent(column)}`;
};

const normalizeHierarchyPart = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['year', 'quarter', 'half', 'month', 'week', 'day', 'hour', 'minute', 'second'].includes(normalized)) {
        return normalized;
    }
    return '';
};

const applyHierarchyPart = (engine, alias, column, hierarchyPart) => {
    const baseRef = quoteColumnRef(engine, alias, column);
    const part = normalizeHierarchyPart(hierarchyPart);
    if (!part) return baseRef;

    if (engine === BIGQUERY_ENGINE) {
        switch (part) {
            case 'year':
                return `EXTRACT(YEAR FROM ${baseRef})`;
            case 'quarter':
                return `EXTRACT(QUARTER FROM ${baseRef})`;
            case 'half':
                return `CASE WHEN ${baseRef} IS NULL THEN NULL WHEN EXTRACT(MONTH FROM ${baseRef}) <= 6 THEN 1 ELSE 2 END`;
            case 'month':
                return `EXTRACT(MONTH FROM ${baseRef})`;
            case 'week':
                return `EXTRACT(ISOWEEK FROM ${baseRef})`;
            case 'day':
                return `EXTRACT(DAY FROM ${baseRef})`;
            case 'hour':
                return `EXTRACT(HOUR FROM ${baseRef})`;
            case 'minute':
                return `EXTRACT(MINUTE FROM ${baseRef})`;
            case 'second':
                return `EXTRACT(SECOND FROM ${baseRef})`;
            default:
                return baseRef;
        }
    }

    switch (part) {
        case 'year':
            return `EXTRACT(YEAR FROM ${baseRef})`;
        case 'quarter':
            return `EXTRACT(QUARTER FROM ${baseRef})`;
        case 'half':
            return `CASE WHEN ${baseRef} IS NULL THEN NULL WHEN EXTRACT(MONTH FROM ${baseRef}) <= 6 THEN 1 ELSE 2 END`;
        case 'month':
            return `EXTRACT(MONTH FROM ${baseRef})`;
        case 'week':
            return `EXTRACT(WEEK FROM ${baseRef})`;
        case 'day':
            return `EXTRACT(DAY FROM ${baseRef})`;
        case 'hour':
            return `EXTRACT(HOUR FROM ${baseRef})`;
        case 'minute':
            return `EXTRACT(MINUTE FROM ${baseRef})`;
        case 'second':
            return `EXTRACT(SECOND FROM ${baseRef})`;
        default:
            return baseRef;
    }
};

const sanitizeAlias = (value) => String(value || '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'col';

const ensureDefaultDataModel = async (workspaceId, preferredName) => {
    const existing = await query(
        `SELECT *
         FROM data_models
         WHERE workspace_id = $1
           AND is_default = TRUE
         ORDER BY created_at ASC
         LIMIT 1`,
        [workspaceId]
    );

    if (existing.rows[0]) return existing.rows[0];

    const inserted = await query(
        `INSERT INTO data_models (workspace_id, name, is_default)
         VALUES ($1, $2, TRUE)
         RETURNING *`,
        [workspaceId, preferredName || 'Default Data Model']
    );

    return inserted.rows[0];
};

const resolveDataModel = async (workspaceId, dataModelId) => {
    if (!dataModelId) {
        return ensureDefaultDataModel(workspaceId, 'Workspace Default Model');
    }

    const result = await query(
        `SELECT *
         FROM data_models
         WHERE id = $1
           AND workspace_id = $2
         LIMIT 1`,
        [dataModelId, workspaceId]
    );

    if (!result.rows[0]) {
        const err = new Error('Data model not found');
        err.status = 404;
        throw err;
    }

    return result.rows[0];
};

const syncModelTablesForWorkspace = async (workspaceId, dataModelId) => {
    await query(
        `INSERT INTO model_tables (
            data_model_id,
            synced_table_id,
            table_name,
            dataset_name,
            source_id,
            source_type,
            runtime_engine,
            runtime_ref
        )
        SELECT
            $1,
            st.id,
            st.table_name,
            st.dataset_name,
            c.id,
            c.type,
            COALESCE(mrt.runtime_engine, CASE WHEN c.type = 'BigQuery' THEN 'bigquery' ELSE 'postgres' END),
            mrt.runtime_ref
        FROM synced_tables st
        JOIN connections c ON c.id = st.connection_id
        LEFT JOIN model_runtime_tables mrt ON mrt.synced_table_id = st.id
        WHERE st.is_deleted = FALSE
          AND c.is_deleted = FALSE
          AND c.workspace_id = $2
        ON CONFLICT (data_model_id, synced_table_id)
        DO UPDATE SET
            table_name = EXCLUDED.table_name,
            dataset_name = EXCLUDED.dataset_name,
            source_id = EXCLUDED.source_id,
            source_type = EXCLUDED.source_type,
            runtime_engine = EXCLUDED.runtime_engine,
            runtime_ref = EXCLUDED.runtime_ref,
            updated_at = NOW()`,
        [dataModelId, workspaceId]
    );
};

const loadModelCatalog = async (workspaceId, dataModelId) => {
    const model = await resolveDataModel(workspaceId, dataModelId);
    await syncModelTablesForWorkspace(workspaceId, model.id);

    const tablesResult = await query(
        `SELECT
            mt.*,
            st.schema_def,
            st.connection_id,
            c.project_id,
            c.type AS connection_type,
            mrt.runtime_engine AS runtime_engine_catalog,
            mrt.runtime_ref AS runtime_ref_catalog,
            mrt.runtime_schema,
            mrt.runtime_table,
            mrt.is_executable,
            mrt.executable_reason
         FROM model_tables mt
         JOIN synced_tables st ON st.id = mt.synced_table_id
         JOIN connections c ON c.id = st.connection_id
         LEFT JOIN model_runtime_tables mrt ON mrt.synced_table_id = st.id
         WHERE mt.data_model_id = $1
           AND st.is_deleted = FALSE
           AND c.is_deleted = FALSE
           AND c.workspace_id = $2
         ORDER BY mt.dataset_name, mt.table_name`,
        [model.id, workspaceId]
    );

    const relResult = await query(
        `SELECT *
         FROM model_relationships
         WHERE data_model_id = $1
         ORDER BY created_at ASC`,
        [model.id]
    );

    const tables = tablesResult.rows.map((row) => {
        const schema = parseJsonArray(row.schema_def);
        const runtimeEngine = row.runtime_engine_catalog || row.runtime_engine || (row.connection_type === 'BigQuery' ? BIGQUERY_ENGINE : POSTGRES_ENGINE);

        let runtimeRef = row.runtime_ref_catalog || row.runtime_ref || null;
        if (!runtimeRef && runtimeEngine === BIGQUERY_ENGINE && row.project_id && row.dataset_name && row.table_name) {
            runtimeRef = `\`${row.project_id}.${row.dataset_name}.${row.table_name}\``;
        }

        return {
            id: row.id,
            syncedTableId: row.synced_table_id,
            tableName: row.table_name,
            datasetName: row.dataset_name,
            sourceId: row.source_id,
            sourceType: row.source_type,
            runtimeEngine,
            runtimeRef,
            runtimeSchema: row.runtime_schema || null,
            runtimeTable: row.runtime_table || null,
            isExecutable: row.is_executable !== false,
            executableReason: row.executable_reason || null,
            schema,
        };
    });

    return {
        model,
        tables,
        relationships: relResult.rows || [],
    };
};

const resolveTableByInput = (tables, tableIdOrSyncedId) => {
    return tables.find((table) => table.id === tableIdOrSyncedId || table.syncedTableId === tableIdOrSyncedId) || null;
};

const buildAdjacency = (relationships) => {
    const adj = new Map();
    const pushEdge = (fromId, toId, rel, reverse = false) => {
        if (!adj.has(fromId)) adj.set(fromId, []);
        adj.get(fromId).push({
            relationship: rel,
            nextTableId: toId,
            reverse,
        });
    };

    relationships.forEach((rel) => {
        if (rel.validation_status !== 'valid') return;
        if (rel.relationship_type === 'n-n') return;
        pushEdge(rel.from_table_id, rel.to_table_id, rel, false);
        pushEdge(rel.to_table_id, rel.from_table_id, rel, true);
    });

    return adj;
};

const bfsPath = (adj, startId, targetId) => {
    const queue = [startId];
    const visited = new Set([startId]);
    const parent = new Map();

    while (queue.length > 0) {
        const current = queue.shift();
        if (current === targetId) break;

        const neighbors = adj.get(current) || [];
        neighbors.forEach((edge) => {
            if (visited.has(edge.nextTableId)) return;
            visited.add(edge.nextTableId);
            parent.set(edge.nextTableId, {
                prev: current,
                edge,
            });
            queue.push(edge.nextTableId);
        });
    }

    if (!visited.has(targetId)) return null;

    const path = [];
    let cursor = targetId;
    while (cursor !== startId) {
        const item = parent.get(cursor);
        if (!item) return null;
        path.push(item.edge);
        cursor = item.prev;
    }

    return path.reverse();
};

const collectJoinEdges = (adj, rootId, targetIds, tableById = null) => {
    const selected = new Map();

    targetIds.forEach((targetId) => {
        if (targetId === rootId) return;
        const path = bfsPath(adj, rootId, targetId);
        if (!path) {
            const targetMeta = tableById ? tableById.get(targetId) : null;
            const targetLabel = targetMeta
                ? `${targetMeta.datasetName || 'dataset'}.${targetMeta.tableName || targetId}`
                : targetId;
            const err = new Error(`No valid relationship path from root table to target table (${targetLabel})`);
            err.code = 'NO_RELATIONSHIP_PATH';
            throw err;
        }
        path.forEach((step) => {
            selected.set(step.relationship.id, step.relationship);
        });
    });

    return Array.from(selected.values());
};

const collectTableIds = (items) => {
    const ids = [];
    (items || []).forEach((item) => {
        if (item && item.tableId) ids.push(item.tableId);
    });
    return ids;
};

const combineLogicalClauses = (parts) => {
    if (!parts || parts.length === 0) return '';
    let expr = `(${parts[0].sql})`;
    for (let i = 1; i < parts.length; i += 1) {
        const logical = String(parts[i].logical || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND';
        expr = `(${expr} ${logical} (${parts[i].sql}))`;
    }
    return expr;
};

const isNullLikeFilterValue = (value) => {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === '' || normalized === '(blank)' || normalized === 'null' || normalized === 'undefined' || normalized === 'nan';
};

const buildPostgresFilterClause = (aliasByTableId, filters, params) => {
    const clauses = [];

    const pushParam = (value) => {
        params.push(value);
        return `$${params.length}`;
    };

    (filters || []).forEach((filter) => {
        const alias = aliasByTableId.get(filter.tableId);
        if (!alias || !filter.column) return;

        const colRef = applyHierarchyPart(POSTGRES_ENGINE, alias, filter.column, filter.hierarchyPart);
        const textRef = `CAST(${colRef} AS TEXT)`;
        const operator = String(filter.operator || 'equals');
        const value = filter.value;

        switch (operator) {
            case 'equals':
                if (isNullLikeFilterValue(value)) {
                    clauses.push({ logical: filter.logical, sql: `${colRef} IS NULL` });
                } else {
                    clauses.push({ logical: filter.logical, sql: `${colRef} = ${pushParam(value)}` });
                }
                break;
            case 'notEquals':
                if (isNullLikeFilterValue(value)) {
                    clauses.push({ logical: filter.logical, sql: `${colRef} IS NOT NULL` });
                } else {
                    clauses.push({ logical: filter.logical, sql: `${colRef} != ${pushParam(value)}` });
                }
                break;
            case 'contains':
                clauses.push({ logical: filter.logical, sql: `${textRef} ILIKE ${pushParam(`%${value}%`)}` });
                break;
            case 'notContains':
                clauses.push({ logical: filter.logical, sql: `${textRef} NOT ILIKE ${pushParam(`%${value}%`)}` });
                break;
            case 'startsWith':
                clauses.push({ logical: filter.logical, sql: `${textRef} ILIKE ${pushParam(`${value}%`)}` });
                break;
            case 'endsWith':
                clauses.push({ logical: filter.logical, sql: `${textRef} ILIKE ${pushParam(`%${value}`)}` });
                break;
            case 'greaterThan':
                clauses.push({ logical: filter.logical, sql: `${colRef} > ${pushParam(value)}` });
                break;
            case 'greaterOrEqual':
                clauses.push({ logical: filter.logical, sql: `${colRef} >= ${pushParam(value)}` });
                break;
            case 'lessThan':
                clauses.push({ logical: filter.logical, sql: `${colRef} < ${pushParam(value)}` });
                break;
            case 'lessOrEqual':
                clauses.push({ logical: filter.logical, sql: `${colRef} <= ${pushParam(value)}` });
                break;
            case 'between':
                clauses.push({ logical: filter.logical, sql: `${colRef} BETWEEN ${pushParam(value)} AND ${pushParam(filter.value2)}` });
                break;
            case 'in': {
                const values = Array.isArray(value) ? value : [value];
                const placeholders = values.map((val) => pushParam(val));
                clauses.push({ logical: filter.logical, sql: `${colRef} IN (${placeholders.join(', ')})` });
                break;
            }
            case 'notIn': {
                const values = Array.isArray(value) ? value : [value];
                const placeholders = values.map((val) => pushParam(val));
                clauses.push({ logical: filter.logical, sql: `${colRef} NOT IN (${placeholders.join(', ')})` });
                break;
            }
            case 'isNull':
                clauses.push({ logical: filter.logical, sql: `${colRef} IS NULL` });
                break;
            case 'isNotNull':
                clauses.push({ logical: filter.logical, sql: `${colRef} IS NOT NULL` });
                break;
            default:
                if (isNullLikeFilterValue(value)) {
                    clauses.push({ logical: filter.logical, sql: `${colRef} IS NULL` });
                } else {
                    clauses.push({ logical: filter.logical, sql: `${colRef} = ${pushParam(value)}` });
                }
                break;
        }
    });

    const merged = combineLogicalClauses(clauses);
    return merged ? [merged] : [];
};

const sanitizeBigQueryValue = (value) => {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    const escaped = String(value).replace(/'/g, "''");
    return `'${escaped}'`;
};

const buildBigQueryFilterClause = (aliasByTableId, filters) => {
    const clauses = [];

    (filters || []).forEach((filter) => {
        const alias = aliasByTableId.get(filter.tableId);
        if (!alias || !filter.column) return;

        const colRef = applyHierarchyPart(BIGQUERY_ENGINE, alias, filter.column, filter.hierarchyPart);
        const textRef = `CAST(${colRef} AS STRING)`;
        const operator = String(filter.operator || 'equals');
        const value = filter.value;

        switch (operator) {
            case 'equals':
                if (isNullLikeFilterValue(value)) {
                    clauses.push({ logical: filter.logical, sql: `${colRef} IS NULL` });
                } else {
                    clauses.push({ logical: filter.logical, sql: `${colRef} = ${sanitizeBigQueryValue(value)}` });
                }
                break;
            case 'notEquals':
                if (isNullLikeFilterValue(value)) {
                    clauses.push({ logical: filter.logical, sql: `${colRef} IS NOT NULL` });
                } else {
                    clauses.push({ logical: filter.logical, sql: `${colRef} != ${sanitizeBigQueryValue(value)}` });
                }
                break;
            case 'contains':
                clauses.push({ logical: filter.logical, sql: `${textRef} LIKE ${sanitizeBigQueryValue(`%${value}%`)}` });
                break;
            case 'notContains':
                clauses.push({ logical: filter.logical, sql: `${textRef} NOT LIKE ${sanitizeBigQueryValue(`%${value}%`)}` });
                break;
            case 'startsWith':
                clauses.push({ logical: filter.logical, sql: `${textRef} LIKE ${sanitizeBigQueryValue(`${value}%`)}` });
                break;
            case 'endsWith':
                clauses.push({ logical: filter.logical, sql: `${textRef} LIKE ${sanitizeBigQueryValue(`%${value}`)}` });
                break;
            case 'greaterThan':
                clauses.push({ logical: filter.logical, sql: `${colRef} > ${sanitizeBigQueryValue(value)}` });
                break;
            case 'greaterOrEqual':
                clauses.push({ logical: filter.logical, sql: `${colRef} >= ${sanitizeBigQueryValue(value)}` });
                break;
            case 'lessThan':
                clauses.push({ logical: filter.logical, sql: `${colRef} < ${sanitizeBigQueryValue(value)}` });
                break;
            case 'lessOrEqual':
                clauses.push({ logical: filter.logical, sql: `${colRef} <= ${sanitizeBigQueryValue(value)}` });
                break;
            case 'between':
                clauses.push({ logical: filter.logical, sql: `${colRef} BETWEEN ${sanitizeBigQueryValue(value)} AND ${sanitizeBigQueryValue(filter.value2)}` });
                break;
            case 'in': {
                const values = Array.isArray(value) ? value : [value];
                const rendered = values.map((val) => sanitizeBigQueryValue(val)).join(', ');
                clauses.push({ logical: filter.logical, sql: `${colRef} IN (${rendered})` });
                break;
            }
            case 'notIn': {
                const values = Array.isArray(value) ? value : [value];
                const rendered = values.map((val) => sanitizeBigQueryValue(val)).join(', ');
                clauses.push({ logical: filter.logical, sql: `${colRef} NOT IN (${rendered})` });
                break;
            }
            case 'isNull':
                clauses.push({ logical: filter.logical, sql: `${colRef} IS NULL` });
                break;
            case 'isNotNull':
                clauses.push({ logical: filter.logical, sql: `${colRef} IS NOT NULL` });
                break;
            default:
                if (isNullLikeFilterValue(value)) {
                    clauses.push({ logical: filter.logical, sql: `${colRef} IS NULL` });
                } else {
                    clauses.push({ logical: filter.logical, sql: `${colRef} = ${sanitizeBigQueryValue(value)}` });
                }
                break;
        }
    });

    const merged = combineLogicalClauses(clauses);
    return merged ? [merged] : [];
};

const mapRlsOperator = (operator) => {
    const mapping = {
        eq: 'equals',
        in: 'in',
        neq: 'notEquals',
        gt: 'greaterThan',
        gte: 'greaterOrEqual',
        lt: 'lessThan',
        lte: 'lessOrEqual',
        between: 'between',
        contains: 'contains',
        startsWith: 'startsWith',
        endsWith: 'endsWith',
        isNull: 'isNull',
        isNotNull: 'isNotNull',
    };
    return mapping[operator] || 'equals';
};

const parseJsonObject = (value) => {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (err) {
            return {};
        }
    }
    if (typeof value === 'object') return value;
    return {};
};

const parsePageIdsFromDashboardPages = (pagesRaw) => {
    const pages = parseJsonArray(pagesRaw);
    return pages
        .map((p) => String(p?.id || '').trim())
        .filter(Boolean);
};

const resolveRlsTableBinding = (catalog, selectedTables, fieldName) => {
    const selectedSet = new Set((selectedTables || []).map((t) => t.id));
    const candidates = (catalog.tables || []).filter((table) => selectedSet.has(table.id) && (table.schema || []).some((col) => col.name === fieldName));
    if (candidates[0]) return candidates[0];
    return null;
};

const permissionRankExpr = `
CASE
    WHEN ds.permission = 'admin' THEN 3
    WHEN ds.permission = 'edit' THEN 2
    ELSE 1
END
`;

const loadDashboardShareRlsContext = async ({ workspaceId, userEmail, userGroupName, dashboardId }) => {
    if (!dashboardId || !userEmail) return null;
    const result = await query(
        `SELECT permission, allowed_page_ids, rls_config, d.pages
         FROM dashboard_shares ds
         JOIN dashboards d ON d.id = ds.dashboard_id
         WHERE ds.dashboard_id = $1
           AND (
                (
                    COALESCE((to_jsonb(ds)->>'target_type'), 'user') = 'user'
                    AND LOWER(COALESCE((to_jsonb(ds)->>'target_id'), ds.user_id)) = LOWER($2)
                )
                OR (
                    COALESCE((to_jsonb(ds)->>'target_type'), 'user') = 'group'
                    AND $3 <> ''
                    AND LOWER(COALESCE((to_jsonb(ds)->>'target_id'), ds.user_id)) = LOWER($3)
                )
           )
           AND d.workspace_id = $4
         ORDER BY ${permissionRankExpr} DESC
         LIMIT 1`,
        [dashboardId, userEmail, String(userGroupName || '').trim(), workspaceId]
    );
    return result.rows[0] || null;
};

const buildSemanticQueryPlan = async ({ workspaceId, request, userEmail, userGroupName }) => {
    const payload = request || {};
    const catalog = await loadModelCatalog(workspaceId, payload.dataModelId);

    const select = Array.isArray(payload.select) ? payload.select : [];
    const groupByInput = Array.isArray(payload.groupBy) ? payload.groupBy : [];
    const orderByInput = Array.isArray(payload.orderBy) ? payload.orderBy : [];
    const filters = Array.isArray(payload.filters) ? [...payload.filters] : [];
    const explicitTableIds = Array.isArray(payload.tableIds) ? payload.tableIds : [];

    const requiredTableIds = new Set([
        ...explicitTableIds,
        ...collectTableIds(select),
        ...collectTableIds(groupByInput),
        ...collectTableIds(orderByInput),
    ]);
    const optionalFilterTableIds = new Set(collectTableIds(filters));
    if (requiredTableIds.size === 0) {
        optionalFilterTableIds.forEach((tableId) => requiredTableIds.add(tableId));
    }

    const requestTableIds = new Set([
        ...requiredTableIds,
        ...optionalFilterTableIds,
    ]);

    if (requestTableIds.size === 0) {
        const err = new Error('At least one table must be selected');
        err.status = 400;
        throw err;
    }

    const selectedTables = Array.from(requestTableIds)
        .map((tableId) => resolveTableByInput(catalog.tables, tableId))
        .filter(Boolean);

    if (selectedTables.length === 0) {
        const err = new Error('No selected tables found in data model');
        err.status = 400;
        throw err;
    }

    const selectedTableMap = new Map(selectedTables.map((table) => [table.id, table]));
    const catalogTableMap = new Map(catalog.tables.map((table) => [table.id, table]));

    const nonExecutable = selectedTables.find((table) => table.isExecutable === false || !table.runtimeRef);
    if (nonExecutable) {
        const err = new Error(nonExecutable.executableReason || `Table ${nonExecutable.tableName} is not executable`);
        err.status = 400;
        err.code = 'TABLE_NOT_EXECUTABLE';
        throw err;
    }

    const engines = new Set(selectedTables.map((table) => table.runtimeEngine));
    if (engines.size > 1) {
        const err = new Error('Cross-source execution is blocked. Selected tables must belong to the same runtime engine.');
        err.status = 400;
        err.code = 'CROSS_SOURCE_BLOCKED';
        throw err;
    }

    const engine = Array.from(engines)[0];
    const adjacency = buildAdjacency(catalog.relationships);
    const rootCandidateIds = [
        ...collectTableIds(select),
        ...collectTableIds(groupByInput),
        ...collectTableIds(orderByInput),
        ...explicitTableIds,
    ];
    const rootTable = rootCandidateIds
        .map((tableId) => resolveTableByInput(catalog.tables, tableId))
        .find(Boolean) || selectedTables[0];

    const toCanonicalTableIds = (ids) => {
        const canonical = [];
        ids.forEach((tableId) => {
            const tableRef = resolveTableByInput(catalog.tables, tableId);
            if (tableRef) canonical.push(tableRef.id);
        });
        return Array.from(new Set(canonical));
    };

    const requiredCanonicalIds = toCanonicalTableIds(Array.from(requiredTableIds));
    const requiredCanonicalSet = new Set(requiredCanonicalIds);
    const optionalFilterCanonicalIds = toCanonicalTableIds(Array.from(optionalFilterTableIds));
    const skippedFilterTableIds = new Set();

    const joinRelationshipMap = new Map();
    collectJoinEdges(adjacency, rootTable.id, requiredCanonicalIds, catalogTableMap).forEach((rel) => {
        joinRelationshipMap.set(rel.id, rel);
    });

    optionalFilterCanonicalIds.forEach((targetId) => {
        if (targetId === rootTable.id) return;
        if (requiredCanonicalSet.has(targetId)) return;

        const path = bfsPath(adjacency, rootTable.id, targetId);
        if (!path) {
            skippedFilterTableIds.add(targetId);
            return;
        }
        path.forEach((step) => {
            joinRelationshipMap.set(step.relationship.id, step.relationship);
        });
    });

    const joinRelationships = Array.from(joinRelationshipMap.values());

    const aliasByTableId = new Map();
    aliasByTableId.set(rootTable.id, 't1');

    const joinsSql = [];
    const pending = [...joinRelationships];
    let aliasCounter = 2;

    while (pending.length > 0) {
        const index = pending.findIndex((rel) => {
            const hasFrom = aliasByTableId.has(rel.from_table_id);
            const hasTo = aliasByTableId.has(rel.to_table_id);
            return (hasFrom && !hasTo) || (!hasFrom && hasTo);
        });

        if (index === -1) {
            const err = new Error('Cannot resolve join graph for selected tables');
            err.status = 400;
            err.code = 'JOIN_GRAPH_ERROR';
            throw err;
        }

        const rel = pending.splice(index, 1)[0];
        const hasFrom = aliasByTableId.has(rel.from_table_id);
        const fromTableId = hasFrom ? rel.from_table_id : rel.to_table_id;
        const toTableId = hasFrom ? rel.to_table_id : rel.from_table_id;

        const fromAlias = aliasByTableId.get(fromTableId);
        const toAlias = `t${aliasCounter++}`;
        aliasByTableId.set(toTableId, toAlias);

        const joinFromColumn = hasFrom ? rel.from_column : rel.to_column;
        const joinToColumn = hasFrom ? rel.to_column : rel.from_column;
        const toTable = selectedTableMap.get(toTableId) || resolveTableByInput(catalog.tables, toTableId);

        joinsSql.push(
            `INNER JOIN ${toTable.runtimeRef} ${toAlias} ON ${quoteColumnRef(engine, fromAlias, joinFromColumn)} = ${quoteColumnRef(engine, toAlias, joinToColumn)}`
        );
    }

    const shareContext = await loadDashboardShareRlsContext({
        workspaceId,
        userEmail,
        userGroupName,
        dashboardId: payload.dashboardId,
    });
    if (shareContext && normalizeSharePermission(shareContext.permission) !== 'admin') {
        const allowedPageIdsRaw = parseJsonArray(shareContext.allowed_page_ids);
        const allowedPageIds = allowedPageIdsRaw.length > 0
            ? allowedPageIdsRaw.map((id) => String(id))
            : parsePageIdsFromDashboardPages(shareContext.pages);
        const requestedPageId = payload.pageId ? String(payload.pageId) : '';
        if (!requestedPageId || (allowedPageIds.length > 0 && !allowedPageIds.includes(requestedPageId))) {
            const err = new Error('Access denied: page is not allowed by RLS policy');
            err.status = 403;
            err.code = 'RLS_PAGE_DENIED';
            throw err;
        }

        const rlsConfig = parseJsonObject(shareContext.rls_config);
        const rlsRules = Array.isArray(rlsConfig.rules) ? rlsConfig.rules : [];
        rlsRules.forEach((rule) => {
            const conditions = Array.isArray(rule?.conditions) && rule.conditions.length > 0
                ? rule.conditions
                : [rule];

            conditions.forEach((condition, idx) => {
                const field = String(condition?.field || '').trim();
                if (!field) return;
                const boundTable = resolveRlsTableBinding(catalog, selectedTables, field);
                if (!boundTable) return;

                const normalized = {
                    tableId: boundTable.id,
                    column: field,
                    operator: mapRlsOperator(condition.operator),
                    logical: idx === 0
                        ? 'AND'
                        : (String(rule.combinator || rule.logical || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'),
                    value: condition.value,
                    value2: condition.value2,
                };

                if (normalized.operator === 'in') {
                    normalized.value = Array.isArray(condition.values) ? condition.values : [];
                }

                filters.push(normalized);
            });
        });
    }

    const normalizedFilters = filters
        .map((item) => {
            const tableRef = resolveTableByInput(catalog.tables, item?.tableId);
            if (!tableRef) return null;
            return { ...item, tableId: tableRef.id };
        })
        .filter(Boolean)
        .filter((item) => !skippedFilterTableIds.has(item.tableId));

    const selectParts = [];
    const groupByParts = [];
    const defaultGroupByParts = [];
    const orderByParts = [];
    const params = [];

    const defaultSelect = select.length === 0
        ? [{ tableId: rootTable.id, column: '*', aggregation: 'none', alias: 'row' }]
        : select;

    let hasAggregation = false;
    defaultSelect.forEach((item, idx) => {
        const tableRef = resolveTableByInput(catalog.tables, item.tableId) || selectedTables.find((t) => t.id === item.tableId);
        if (!tableRef) return;
        const alias = aliasByTableId.get(tableRef.id);
        if (!alias) return;

        const agg = normalizeAgg(item.aggregation);
        const isStar = item.column === '*';
        const baseExpr = isStar ? `${alias}.*` : quoteColumnRef(engine, alias, item.column);
        const hierarchyExpr = isStar ? baseExpr : applyHierarchyPart(engine, alias, item.column, item.hierarchyPart);

        let expr = hierarchyExpr;
        if (agg !== 'none' && agg !== 'raw') {
            hasAggregation = true;
            if (agg === 'countdistinct') expr = `COUNT(DISTINCT ${hierarchyExpr})`;
            else expr = `${agg.toUpperCase()}(${hierarchyExpr})`;
        }

        const aliasName = sanitizeAlias(item.alias || `${tableRef.tableName}_${item.column}_${agg}_${idx}`);
        selectParts.push(`${expr} AS ${engine === BIGQUERY_ENGINE ? quoteBigQueryIdent(aliasName) : quotePostgresIdent(aliasName)}`);

        if (agg === 'none' || agg === 'raw') {
            if (!isStar) defaultGroupByParts.push(hierarchyExpr);
        }
    });

    if (groupByInput.length > 0) {
        groupByInput.forEach((item) => {
            const tableRef = resolveTableByInput(catalog.tables, item.tableId) || selectedTables.find((t) => t.id === item.tableId);
            if (!tableRef) return;
            const alias = aliasByTableId.get(tableRef.id);
            if (!alias || !item.column) return;
            groupByParts.push(applyHierarchyPart(engine, alias, item.column, item.hierarchyPart));
        });
    } else if (hasAggregation) {
        const unique = new Set(defaultGroupByParts);
        groupByParts.push(...Array.from(unique));
    }

    orderByInput.forEach((item) => {
        const tableRef = resolveTableByInput(catalog.tables, item.tableId) || selectedTables.find((t) => t.id === item.tableId);
        if (!tableRef) return;
        const alias = aliasByTableId.get(tableRef.id);
        if (!alias || !item.column) return;
        orderByParts.push(`${applyHierarchyPart(engine, alias, item.column, item.hierarchyPart)} ${normalizeDir(item.dir)}`);
    });

    const whereClauses = engine === BIGQUERY_ENGINE
        ? buildBigQueryFilterClause(aliasByTableId, normalizedFilters)
        : buildPostgresFilterClause(aliasByTableId, normalizedFilters, params);

    const limitRaw = Number(payload.limit);
    const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(Math.trunc(limitRaw), MAX_LIMIT))
        : 1000;

    const fromSql = `FROM ${rootTable.runtimeRef} ${aliasByTableId.get(rootTable.id)}`;
    const sql = [
        `SELECT ${selectParts.length > 0 ? selectParts.join(', ') : `${aliasByTableId.get(rootTable.id)}.*`}`,
        fromSql,
        ...joinsSql,
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '',
        groupByParts.length > 0 ? `GROUP BY ${groupByParts.join(', ')}` : '',
        orderByParts.length > 0 ? `ORDER BY ${orderByParts.join(', ')}` : '',
        `LIMIT ${limit}`,
    ].filter(Boolean).join('\n');

    return {
        dataModelId: catalog.model.id,
        dataModelName: catalog.model.name,
        engine,
        sql,
        params,
        rootTable: {
            id: rootTable.id,
            tableName: rootTable.tableName,
            datasetName: rootTable.datasetName,
        },
        selectedTables: selectedTables.map((table) => ({
            id: table.id,
            tableName: table.tableName,
            datasetName: table.datasetName,
            sourceType: table.sourceType,
            runtimeEngine: table.runtimeEngine,
            runtimeRef: table.runtimeRef,
        })),
        relationshipsUsed: joinRelationships.map((rel) => ({
            id: rel.id,
            fromTableId: rel.from_table_id,
            fromTable: rel.from_table,
            fromColumn: rel.from_column,
            toTableId: rel.to_table_id,
            toTable: rel.to_table,
            toColumn: rel.to_column,
            relationshipType: rel.relationship_type,
            crossFilterDirection: rel.cross_filter_direction,
        })),
    };
};

const executePostgresPlan = async ({ workspaceId, request, userEmail, userGroupName }) => {
    const payload = request || {};
    const rawSql = typeof payload.rawSql === 'string' ? payload.rawSql.trim() : '';

    if (rawSql) {
        const startsWithSelect = /^(select|with)\s/i.test(rawSql);
        const hasForbidden = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i.test(rawSql);
        if (!startsWithSelect || hasForbidden) {
            const err = new Error('Only read-only SELECT/CTE SQL is allowed for execution');
            err.status = 400;
            err.code = 'UNSAFE_SQL';
            throw err;
        }

        const tableIds = Array.isArray(payload.tableIds) ? payload.tableIds : [];
        if (tableIds.length === 0) {
            const err = new Error('tableIds are required when executing raw SQL');
            err.status = 400;
            err.code = 'MISSING_TABLE_SCOPE';
            throw err;
        }

        const validationPlan = await buildSemanticQueryPlan({
            workspaceId,
            userEmail,
            userGroupName,
            request: {
                dataModelId: payload.dataModelId,
                tableIds,
                select: [{ tableId: tableIds[0], column: '*', aggregation: 'none', alias: 'row' }],
                limit: 1,
            },
        });
        if (validationPlan.engine !== POSTGRES_ENGINE) {
            const err = new Error('Execution endpoint only supports postgres runtime. Use /query/plan for bigquery SQL.');
            err.status = 400;
            err.code = 'ENGINE_NOT_SUPPORTED';
            throw err;
        }

        const result = await query(rawSql);
        return {
            plan: {
                ...validationPlan,
                sql: rawSql,
                params: [],
            },
            rows: result.rows || [],
            rowCount: result.rowCount || (result.rows || []).length,
        };
    }

    const plan = await buildSemanticQueryPlan({ workspaceId, request: payload, userEmail, userGroupName });
    if (plan.engine !== POSTGRES_ENGINE) {
        const err = new Error('Execution endpoint only supports postgres runtime. Use /query/plan for bigquery SQL.');
        err.status = 400;
        err.code = 'ENGINE_NOT_SUPPORTED';
        throw err;
    }

    const result = await query(plan.sql, plan.params || []);
    return {
        plan,
        rows: result.rows || [],
        rowCount: result.rowCount || (result.rows || []).length,
    };
};

module.exports = {
    POSTGRES_ENGINE,
    BIGQUERY_ENGINE,
    MAX_LIMIT,
    ensureDefaultDataModel,
    loadModelCatalog,
    buildSemanticQueryPlan,
    executePostgresPlan,
};
