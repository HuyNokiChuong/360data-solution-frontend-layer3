const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const {
    ensureDefaultDataModel,
    loadModelCatalog,
    buildSemanticQueryPlan,
    executePostgresPlan,
} = require('../services/semantic-query-planner.service');

const router = express.Router();

router.use(authenticate);

const requireEditorRole = (req, res, next) => {
    if (!['Admin', 'Editor'].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: 'Only Admin or Editor can modify data model relationships',
        });
    }
    next();
};

const normalizeType = (rawType) => {
    const t = String(rawType || '').trim().toUpperCase();
    if (!t) return 'string';
    if (t.includes('BOOL')) return 'boolean';
    if (t.includes('DATE') || t.includes('TIME')) return 'date';
    if (t.includes('INT') || t.includes('NUMERIC') || t.includes('DECIMAL') || t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('REAL') || t.includes('NUMBER')) {
        return 'number';
    }
    return 'string';
};

const findFieldType = (table, columnName) => {
    const match = (table.schema || []).find((col) => String(col?.name || '').toLowerCase() === String(columnName || '').toLowerCase());
    return normalizeType(match?.type);
};

const hasColumn = (table, columnName) => {
    return (table.schema || []).some((col) => String(col?.name || '').toLowerCase() === String(columnName || '').toLowerCase());
};

const toRelationshipResponse = (row) => ({
    id: row.id,
    dataModelId: row.data_model_id,
    fromTable: row.from_table,
    fromColumn: row.from_column,
    toTable: row.to_table,
    toColumn: row.to_column,
    fromTableId: row.from_table_id,
    toTableId: row.to_table_id,
    relationshipType: row.relationship_type,
    crossFilterDirection: row.cross_filter_direction,
    validationStatus: row.validation_status,
    invalidReason: row.invalid_reason || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const calculateSuggestionScore = ({
    columnA,
    columnB,
    typeA,
    typeB,
    tableA,
    tableB,
}) => {
    let score = 0;
    const nameA = String(columnA || '').toLowerCase();
    const nameB = String(columnB || '').toLowerCase();

    if (nameA === nameB) score += 45;
    if (typeA === typeB) score += 25;

    const tableAName = String(tableA.tableName || '').toLowerCase();
    const tableBName = String(tableB.tableName || '').toLowerCase();

    const fkPatternA = nameA.endsWith('_id');
    const fkPatternB = nameB.endsWith('_id');

    if (fkPatternA || fkPatternB) score += 15;

    if (fkPatternA && nameA === `${tableBName}_id`) score += 20;
    if (fkPatternB && nameB === `${tableAName}_id`) score += 20;

    if ((nameA === 'id' && fkPatternB) || (nameB === 'id' && fkPatternA)) score += 10;

    return Math.min(score, 99);
};

const inferRelationshipDirection = ({
    tableA,
    tableB,
    columnA,
    columnB,
}) => {
    const nameA = String(columnA || '').toLowerCase();
    const nameB = String(columnB || '').toLowerCase();
    const tableAName = String(tableA.tableName || '').toLowerCase();
    const tableBName = String(tableB.tableName || '').toLowerCase();

    if (nameA === `${tableBName}_id` && (nameB === 'id' || nameB.endsWith('_id'))) {
        return {
            fromTable: tableA,
            fromColumn: columnA,
            toTable: tableB,
            toColumn: columnB,
            relationshipType: '1-n',
        };
    }

    if (nameB === `${tableAName}_id` && (nameA === 'id' || nameA.endsWith('_id'))) {
        return {
            fromTable: tableB,
            fromColumn: columnB,
            toTable: tableA,
            toColumn: columnA,
            relationshipType: '1-n',
        };
    }

    if (nameA === 'id' && nameB === 'id') {
        return {
            fromTable: tableA,
            fromColumn: columnA,
            toTable: tableB,
            toColumn: columnB,
            relationshipType: '1-1',
        };
    }

    return {
        fromTable: tableA,
        fromColumn: columnA,
        toTable: tableB,
        toColumn: columnB,
        relationshipType: '1-n',
    };
};

router.get('/default-model', async (req, res) => {
    try {
        const model = await ensureDefaultDataModel(req.user.workspace_id, 'Workspace Default Model');
        await loadModelCatalog(req.user.workspace_id, model.id);
        res.json({
            success: true,
            data: {
                id: model.id,
                workspaceId: model.workspace_id,
                name: model.name,
                isDefault: model.is_default,
                createdAt: model.created_at,
                updatedAt: model.updated_at,
            },
        });
    } catch (err) {
        console.error('Get default model error:', err);
        res.status(500).json({ success: false, message: 'Failed to load default model' });
    }
});

router.get('/tables', async (req, res) => {
    try {
        const model = await ensureDefaultDataModel(req.user.workspace_id, 'Workspace Default Model');
        const catalog = await loadModelCatalog(req.user.workspace_id, req.query.dataModelId || model.id);

        res.json({
            success: true,
            data: catalog.tables.map((table) => ({
                id: table.id,
                syncedTableId: table.syncedTableId,
                tableName: table.tableName,
                datasetName: table.datasetName,
                sourceId: table.sourceId,
                sourceType: table.sourceType,
                runtimeEngine: table.runtimeEngine,
                runtimeRef: table.runtimeRef,
                isExecutable: table.isExecutable,
                executableReason: table.executableReason || undefined,
                schema: table.schema || [],
            })),
            meta: {
                dataModelId: catalog.model.id,
                dataModelName: catalog.model.name,
            },
        });
    } catch (err) {
        const status = Number(err.status || 500);
        console.error('Get model tables error:', err);
        res.status(Number.isFinite(status) ? status : 500).json({
            success: false,
            message: err.message || 'Failed to load model tables',
        });
    }
});

router.get('/relationships', async (req, res) => {
    try {
        const model = await ensureDefaultDataModel(req.user.workspace_id, 'Workspace Default Model');
        const dataModelId = req.query.dataModelId || model.id;

        const rows = await query(
            `SELECT mr.*
             FROM model_relationships mr
             JOIN data_models dm ON dm.id = mr.data_model_id
             WHERE mr.data_model_id = $1
               AND dm.workspace_id = $2
             ORDER BY mr.created_at ASC`,
            [dataModelId, req.user.workspace_id]
        );

        res.json({
            success: true,
            data: rows.rows.map(toRelationshipResponse),
        });
    } catch (err) {
        console.error('Get relationships error:', err);
        res.status(500).json({ success: false, message: 'Failed to load relationships' });
    }
});

router.post('/relationships', requireEditorRole, async (req, res) => {
    try {
        const payload = req.body || {};
        const model = await ensureDefaultDataModel(req.user.workspace_id, 'Workspace Default Model');
        const dataModelId = payload.dataModelId || model.id;

        const catalog = await loadModelCatalog(req.user.workspace_id, dataModelId);

        const fromTable = catalog.tables.find((table) => table.id === payload.fromTableId || table.syncedTableId === payload.fromTableId);
        const toTable = catalog.tables.find((table) => table.id === payload.toTableId || table.syncedTableId === payload.toTableId);

        if (!fromTable || !toTable) {
            return res.status(400).json({ success: false, message: 'fromTableId/toTableId not found in data model' });
        }

        const fromColumn = String(payload.fromColumn || '').trim();
        const toColumn = String(payload.toColumn || '').trim();
        if (!fromColumn || !toColumn) {
            return res.status(400).json({ success: false, message: 'fromColumn and toColumn are required' });
        }

        if (!hasColumn(fromTable, fromColumn) || !hasColumn(toTable, toColumn)) {
            return res.status(400).json({
                success: false,
                message: 'Column does not exist in selected table schema',
            });
        }

        const relationshipType = ['1-1', '1-n', 'n-n'].includes(payload.relationshipType)
            ? payload.relationshipType
            : '1-n';
        const crossFilterDirection = ['single', 'both'].includes(payload.crossFilterDirection)
            ? payload.crossFilterDirection
            : 'single';

        let validationStatus = 'valid';
        let invalidReason = null;

        if (relationshipType === 'n-n') {
            validationStatus = 'invalid';
            invalidReason = 'n-n relationship is not executable by semantic planner';
        } else if (fromTable.runtimeEngine !== toTable.runtimeEngine) {
            validationStatus = 'invalid';
            invalidReason = 'Cross-source relationship cannot be executed at runtime';
        } else if (!fromTable.runtimeRef || !toTable.runtimeRef) {
            validationStatus = 'invalid';
            invalidReason = 'One or more tables do not have runtime references';
        } else if (findFieldType(fromTable, fromColumn) !== findFieldType(toTable, toColumn)) {
            validationStatus = 'invalid';
            invalidReason = 'Column datatype mismatch';
        }

        const inserted = await query(
            `INSERT INTO model_relationships (
                data_model_id,
                from_table,
                from_column,
                to_table,
                to_column,
                from_table_id,
                to_table_id,
                relationship_type,
                cross_filter_direction,
                validation_status,
                invalid_reason
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (data_model_id, from_table_id, from_column, to_table_id, to_column)
            DO UPDATE SET
                relationship_type = EXCLUDED.relationship_type,
                cross_filter_direction = EXCLUDED.cross_filter_direction,
                validation_status = EXCLUDED.validation_status,
                invalid_reason = EXCLUDED.invalid_reason,
                updated_at = NOW()
            RETURNING *`,
            [
                dataModelId,
                fromTable.tableName,
                fromColumn,
                toTable.tableName,
                toColumn,
                fromTable.id,
                toTable.id,
                relationshipType,
                crossFilterDirection,
                validationStatus,
                invalidReason,
            ]
        );

        res.status(201).json({
            success: true,
            data: toRelationshipResponse(inserted.rows[0]),
        });
    } catch (err) {
        console.error('Create relationship error:', err);
        res.status(500).json({ success: false, message: 'Failed to create relationship' });
    }
});

router.delete('/relationships/:id', requireEditorRole, async (req, res) => {
    try {
        const deleted = await query(
            `DELETE FROM model_relationships mr
             USING data_models dm
             WHERE mr.id = $1
               AND mr.data_model_id = dm.id
               AND dm.workspace_id = $2
             RETURNING mr.id`,
            [req.params.id, req.user.workspace_id]
        );

        if (deleted.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Relationship not found' });
        }

        res.json({ success: true, message: 'Relationship deleted' });
    } catch (err) {
        console.error('Delete relationship error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete relationship' });
    }
});

router.post('/relationships/auto-detect', async (req, res) => {
    try {
        const payload = req.body || {};
        const model = await ensureDefaultDataModel(req.user.workspace_id, 'Workspace Default Model');
        const dataModelId = payload.dataModelId || model.id;
        const catalog = await loadModelCatalog(req.user.workspace_id, dataModelId);

        const includeIds = new Set(Array.isArray(payload.tableIds) ? payload.tableIds : []);
        const tables = includeIds.size > 0
            ? catalog.tables.filter((table) => includeIds.has(table.id) || includeIds.has(table.syncedTableId))
            : catalog.tables;

        const suggestions = [];
        const seen = new Set();

        for (let i = 0; i < tables.length; i += 1) {
            for (let j = i + 1; j < tables.length; j += 1) {
                const tableA = tables[i];
                const tableB = tables[j];

                const colsA = (tableA.schema || []).filter((col) => col?.name);
                const colsB = (tableB.schema || []).filter((col) => col?.name);

                colsA.forEach((a) => {
                    colsB.forEach((b) => {
                        const typeA = normalizeType(a.type);
                        const typeB = normalizeType(b.type);
                        const score = calculateSuggestionScore({
                            columnA: a.name,
                            columnB: b.name,
                            typeA,
                            typeB,
                            tableA,
                            tableB,
                        });

                        if (score < 55) return;

                        const inferred = inferRelationshipDirection({
                            tableA,
                            tableB,
                            columnA: a.name,
                            columnB: b.name,
                        });

                        let validationStatus = 'valid';
                        let invalidReason = null;
                        if (inferred.relationshipType === 'n-n') {
                            validationStatus = 'invalid';
                            invalidReason = 'n-n relationship is not executable by semantic planner';
                        } else if (inferred.fromTable.runtimeEngine !== inferred.toTable.runtimeEngine) {
                            validationStatus = 'invalid';
                            invalidReason = 'Cross-source relationship cannot be executed';
                        } else if (typeA !== typeB) {
                            validationStatus = 'invalid';
                            invalidReason = 'Column datatype mismatch';
                        }

                        const dedupeKey = [
                            inferred.fromTable.id,
                            inferred.fromColumn.toLowerCase(),
                            inferred.toTable.id,
                            inferred.toColumn.toLowerCase(),
                        ].join(':');
                        if (seen.has(dedupeKey)) return;
                        seen.add(dedupeKey);

                        suggestions.push({
                            id: dedupeKey,
                            dataModelId,
                            fromTableId: inferred.fromTable.id,
                            fromTable: inferred.fromTable.tableName,
                            fromColumn: inferred.fromColumn,
                            toTableId: inferred.toTable.id,
                            toTable: inferred.toTable.tableName,
                            toColumn: inferred.toColumn,
                            relationshipType: inferred.relationshipType,
                            crossFilterDirection: 'single',
                            confidence: score,
                            validationStatus,
                            invalidReason: invalidReason || undefined,
                            reasons: [
                                String(a.name).toLowerCase() === String(b.name).toLowerCase() ? 'same_column_name' : null,
                                typeA === typeB ? 'same_datatype' : null,
                                (String(a.name).toLowerCase().endsWith('_id') || String(b.name).toLowerCase().endsWith('_id')) ? 'foreign_key_pattern' : null,
                            ].filter(Boolean),
                        });
                    });
                });
            }
        }

        suggestions.sort((a, b) => b.confidence - a.confidence);

        res.json({
            success: true,
            data: suggestions,
            meta: {
                dataModelId,
                total: suggestions.length,
            },
        });
    } catch (err) {
        console.error('Auto detect relationships error:', err);
        res.status(500).json({ success: false, message: 'Failed to auto-detect relationships' });
    }
});

router.post('/query/plan', async (req, res) => {
    try {
        const plan = await buildSemanticQueryPlan({
            workspaceId: req.user.workspace_id,
            userEmail: req.user.email,
            request: req.body || {},
        });

        res.json({
            success: true,
            data: plan,
        });
    } catch (err) {
        const status = Number(err.status || 400);
        console.error('Build semantic query plan error:', err);
        res.status(Number.isFinite(status) ? status : 400).json({
            success: false,
            message: err.message || 'Failed to build query plan',
            code: err.code || 'PLAN_BUILD_FAILED',
        });
    }
});

router.post('/query/execute', async (req, res) => {
    try {
        const execution = await executePostgresPlan({
            workspaceId: req.user.workspace_id,
            userEmail: req.user.email,
            request: req.body || {},
        });

        res.json({
            success: true,
            data: {
                rows: execution.rows,
                rowCount: execution.rowCount,
                plan: execution.plan,
            },
        });
    } catch (err) {
        const status = Number(err.status || 400);
        console.error('Execute semantic query error:', err);
        res.status(Number.isFinite(status) ? status : 400).json({
            success: false,
            message: err.message || 'Failed to execute semantic query',
            code: err.code || 'QUERY_EXECUTION_FAILED',
        });
    }
});

module.exports = router;
