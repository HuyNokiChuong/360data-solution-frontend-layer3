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
    const role = String(req.user?.role || '').trim().toLowerCase();
    const canEdit = role === 'admin' || role === 'editor' || role === 'super admin' || role === 'super_admin' || role === 'superadmin';
    if (!canEdit) {
        return res.status(403).json({
            success: false,
            message: 'Only Admin, Editor, or Super Admin can modify data model relationships',
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

const normalizeToken = (value) => String(value || '').trim().toLowerCase();

const toSingular = (tableName) => {
    const normalized = normalizeToken(tableName).replace(/[^a-z0-9_]/g, '_');
    if (!normalized) return normalized;
    if (normalized.endsWith('ies') && normalized.length > 3) return `${normalized.slice(0, -3)}y`;
    if (normalized.endsWith('ses') && normalized.length > 3) return normalized.slice(0, -2);
    if (normalized.endsWith('s') && normalized.length > 1) return normalized.slice(0, -1);
    return normalized;
};

const toPlural = (tableName) => {
    const singular = toSingular(tableName);
    if (!singular) return singular;
    if (singular.endsWith('y') && singular.length > 1) return `${singular.slice(0, -1)}ies`;
    if (singular.endsWith('s')) return `${singular}es`;
    return `${singular}s`;
};

const getTableNameVariants = (tableName) => {
    const normalized = normalizeToken(tableName).replace(/[^a-z0-9_]/g, '_');
    const singular = toSingular(normalized);
    const plural = toPlural(normalized);
    return Array.from(new Set([normalized, singular, plural])).filter(Boolean);
};

const areTableNamesLikelyRelated = (leftTableName, rightTableName) => {
    const left = getTableNameVariants(leftTableName);
    const right = getTableNameVariants(rightTableName);
    for (const l of left) {
        for (const r of right) {
            if (!l || !r) continue;
            if (l === r) return true;
            if (l.length > 2 && r.length > 2 && (l.includes(r) || r.includes(l))) return true;
            if (l.startsWith(`${r}_`) || r.startsWith(`${l}_`)) return true;
        }
    }
    return false;
};

const isIdLikeColumnName = (columnName) => {
    const c = normalizeToken(columnName);
    return c === 'id' || c.endsWith('_id') || c.endsWith('_uuid');
};

const isForeignKeyLikeColumnName = (columnName) => {
    const c = normalizeToken(columnName);
    return (c.endsWith('_id') || c.endsWith('_uuid')) && c !== 'id';
};

const GENERIC_NON_KEY_COLUMN_NAMES = new Set([
    'name',
    'email',
    'status',
    'type',
    'created_at',
    'updated_at',
    'deleted_at',
    'phone',
    'phone_number',
    'description',
    'title',
    'note',
    'notes',
    'tag',
    'tags',
]);

const isGenericNonKeyColumnName = (columnName) => {
    const c = normalizeToken(columnName);
    if (!c || isIdLikeColumnName(c)) return false;
    return GENERIC_NON_KEY_COLUMN_NAMES.has(c);
};

const clampScore = (value, min = 0, max = 99) => Math.max(min, Math.min(max, Number(value) || 0));

const buildRelationshipCanonicalKey = ({
    fromTableId,
    fromColumn,
    toTableId,
    toColumn,
}) => {
    const left = `${fromTableId}:${String(fromColumn || '').toLowerCase()}`;
    const right = `${toTableId}:${String(toColumn || '').toLowerCase()}`;
    return left < right ? `${left}|${right}` : `${right}|${left}`;
};

const isPrimaryKeyLikeColumnName = (tableName, columnName) => {
    const c = normalizeToken(columnName);
    if (c === 'id') return true;

    const variants = getTableNameVariants(tableName);
    return variants.some((v) => c === `${v}_id` || c === `${v}_uuid`);
};

const columnReferencesTable = (columnName, tableName) => {
    const c = normalizeToken(columnName);
    if (!c) return false;
    const variants = getTableNameVariants(tableName);
    return variants.some((v) => c === `${v}_id` || c === `${v}_uuid`);
};

const analyzeRelationshipByName = ({
    tableA,
    tableB,
    columnA,
    columnB,
}) => {
    const nameA = normalizeToken(columnA);
    const nameB = normalizeToken(columnB);
    const aPkLike = isPrimaryKeyLikeColumnName(tableA?.tableName, nameA);
    const bPkLike = isPrimaryKeyLikeColumnName(tableB?.tableName, nameB);
    const aFkLike = isForeignKeyLikeColumnName(nameA);
    const bFkLike = isForeignKeyLikeColumnName(nameB);
    const aRefersB = columnReferencesTable(nameA, tableB?.tableName);
    const bRefersA = columnReferencesTable(nameB, tableA?.tableName);
    const sameName = nameA && nameB && nameA === nameB;
    const sameIdLikeName = sameName && isIdLikeColumnName(nameA);

    let relationshipType = 'n-n';
    let confidence = 'none';
    const reasons = [];

    if (aRefersB && bPkLike) {
        relationshipType = 'n-1';
        confidence = 'strong';
        reasons.push('from_fk_to_target_pk');
    } else if (bRefersA && aPkLike) {
        relationshipType = '1-n';
        confidence = 'strong';
        reasons.push('to_fk_to_source_pk');
    } else if (aPkLike && bPkLike && sameIdLikeName) {
        relationshipType = '1-1';
        confidence = 'medium';
        reasons.push('pk_to_pk_same_name');
    } else if (aFkLike && bPkLike) {
        relationshipType = 'n-1';
        confidence = 'weak';
        reasons.push('fk_like_to_pk_like');
    } else if (bFkLike && aPkLike) {
        relationshipType = '1-n';
        confidence = 'weak';
        reasons.push('pk_like_to_fk_like');
    } else if (aFkLike && bFkLike && (aRefersB || bRefersA || sameName)) {
        relationshipType = 'n-n';
        confidence = 'weak';
        reasons.push('fk_to_fk');
    } else if (sameIdLikeName) {
        relationshipType = '1-1';
        confidence = 'weak';
        reasons.push('same_id_like_name');
    }

    const likelyJoin = (aRefersB && bPkLike)
        || (bRefersA && aPkLike)
        || (sameIdLikeName && aPkLike && bPkLike);

    return {
        relationshipType,
        confidence,
        reasons,
        likelyJoin,
        aPkLike,
        bPkLike,
        aFkLike,
        bFkLike,
        aRefersB,
        bRefersA,
        sameName,
    };
};

const isLikelyJoinPairByName = ({
    tableA,
    tableB,
    columnA,
    columnB,
}) => {
    const analysis = analyzeRelationshipByName({
        tableA,
        tableB,
        columnA,
        columnB,
    });
    return analysis.likelyJoin;
};

const inferRelationshipTypeByName = ({
    tableA,
    tableB,
    columnA,
    columnB,
}) => {
    const analysis = analyzeRelationshipByName({
        tableA,
        tableB,
        columnA,
        columnB,
    });
    return analysis.relationshipType;
};

const confidenceRank = (confidence) => {
    if (confidence === 'strong') return 3;
    if (confidence === 'medium') return 2;
    if (confidence === 'weak') return 1;
    return 0;
};

const relationshipTypeRank = (relationshipType) => {
    if (relationshipType === 'n-1') return 4;
    if (relationshipType === '1-n') return 3;
    if (relationshipType === '1-1') return 2;
    if (relationshipType === 'n-n') return 1;
    return 0;
};

const buildDirectionalCandidateByName = ({
    fromTable,
    fromColumn,
    toTable,
    toColumn,
}) => {
    const analysis = analyzeRelationshipByName({
        tableA: fromTable,
        tableB: toTable,
        columnA: fromColumn,
        columnB: toColumn,
    });

    return {
        fromTable,
        fromColumn,
        toTable,
        toColumn,
        relationshipType: analysis.relationshipType,
        analysis,
    };
};

const pickBestDirectionalCandidateByName = ({
    tableA,
    columnA,
    tableB,
    columnB,
}) => {
    const candidates = [
        buildDirectionalCandidateByName({
            fromTable: tableA,
            fromColumn: columnA,
            toTable: tableB,
            toColumn: columnB,
        }),
        buildDirectionalCandidateByName({
            fromTable: tableB,
            fromColumn: columnB,
            toTable: tableA,
            toColumn: columnA,
        }),
    ].filter((item) => item.analysis.likelyJoin);

    if (candidates.length === 0) return null;

    candidates.sort((left, right) => {
        const confidenceDiff = confidenceRank(right.analysis.confidence) - confidenceRank(left.analysis.confidence);
        if (confidenceDiff !== 0) return confidenceDiff;

        const typeDiff = relationshipTypeRank(right.relationshipType) - relationshipTypeRank(left.relationshipType);
        if (typeDiff !== 0) return typeDiff;

        const leftKey = `${left.fromTable.id}:${String(left.fromColumn).toLowerCase()}:${left.toTable.id}:${String(left.toColumn).toLowerCase()}`;
        const rightKey = `${right.fromTable.id}:${String(right.fromColumn).toLowerCase()}:${right.toTable.id}:${String(right.toColumn).toLowerCase()}`;
        return leftKey.localeCompare(rightKey);
    });

    return candidates[0];
};

const normalizeStoredRelationshipType = (row) => {
    if (!row) return null;
    const current = String(row.relationship_type || '').trim();
    if (!current) return null;

    const analysis = analyzeRelationshipByName({
        tableA: { tableName: row.from_table },
        tableB: { tableName: row.to_table },
        columnA: row.from_column,
        columnB: row.to_column,
    });

    if (analysis.confidence === 'none') return current;
    return analysis.relationshipType;
};

const quotePostgresIdent = (value) => `"${String(value || '').replace(/"/g, '""')}"`;

const isSafePostgresRuntimeRef = (runtimeRef) => {
    const ref = String(runtimeRef || '');
    if (!ref) return false;
    if (ref.includes(';')) return false;
    return /^[a-zA-Z0-9_."`]+$/.test(ref);
};

const getPostgresColumnProfile = async (table, columnName) => {
    if (!table || table.runtimeEngine !== 'postgres' || !table.runtimeRef) return null;
    if (!isSafePostgresRuntimeRef(table.runtimeRef)) return null;

    const columnSql = quotePostgresIdent(columnName);
    const profile = await query(
        `SELECT
            COUNT(*)::bigint AS total_rows,
            COUNT(${columnSql})::bigint AS non_null_rows,
            COUNT(DISTINCT ${columnSql})::bigint AS distinct_rows
         FROM ${table.runtimeRef}`
    );
    const row = profile.rows[0] || {};
    const totalRows = Number(row.total_rows || 0);
    const nonNullRows = Number(row.non_null_rows || 0);
    const distinctRows = Number(row.distinct_rows || 0);
    const unique = nonNullRows > 0 && distinctRows === nonNullRows;

    return {
        totalRows,
        nonNullRows,
        distinctRows,
        unique,
    };
};

const getPostgresOverlapProfile = async ({
    fromTable,
    fromColumn,
    toTable,
    toColumn,
}) => {
    if (!fromTable || !toTable) return null;
    if (fromTable.runtimeEngine !== 'postgres' || toTable.runtimeEngine !== 'postgres') return null;
    if (!fromTable.runtimeRef || !toTable.runtimeRef) return null;
    if (!isSafePostgresRuntimeRef(fromTable.runtimeRef) || !isSafePostgresRuntimeRef(toTable.runtimeRef)) return null;

    const fromCol = quotePostgresIdent(fromColumn);
    const toCol = quotePostgresIdent(toColumn);

    const overlap = await query(
        `WITH from_vals AS (
            SELECT DISTINCT ${fromCol} AS v
            FROM ${fromTable.runtimeRef}
            WHERE ${fromCol} IS NOT NULL
            LIMIT 20000
        ),
        to_vals AS (
            SELECT DISTINCT ${toCol} AS v
            FROM ${toTable.runtimeRef}
            WHERE ${toCol} IS NOT NULL
            LIMIT 20000
        ),
        overlap_vals AS (
            SELECT f.v
            FROM from_vals f
            INNER JOIN to_vals t ON t.v = f.v
        )
        SELECT
            (SELECT COUNT(*)::bigint FROM from_vals) AS from_distinct,
            (SELECT COUNT(*)::bigint FROM to_vals) AS to_distinct,
            (SELECT COUNT(*)::bigint FROM overlap_vals) AS overlap_distinct`
    );

    const row = overlap.rows?.[0] || {};
    const fromDistinct = Number(row.from_distinct || 0);
    const toDistinct = Number(row.to_distinct || 0);
    const overlapDistinct = Number(row.overlap_distinct || 0);
    const coverageFrom = fromDistinct > 0 ? overlapDistinct / fromDistinct : 0;
    const coverageTo = toDistinct > 0 ? overlapDistinct / toDistinct : 0;

    return {
        hasOverlap: overlapDistinct > 0,
        fromDistinct,
        toDistinct,
        overlapDistinct,
        coverageFrom,
        coverageTo,
    };
};

const getPostgresColumnProfileCached = async ({
    table,
    columnName,
    profileCache,
}) => {
    if (!profileCache) {
        return getPostgresColumnProfile(table, columnName);
    }

    const cacheKey = `${table?.id || 'table'}:${String(columnName || '').toLowerCase()}`;
    if (!profileCache.has(cacheKey)) {
        profileCache.set(cacheKey, getPostgresColumnProfile(table, columnName));
    }
    return profileCache.get(cacheKey);
};

const getPostgresOverlapProfileCached = async ({
    fromTable,
    fromColumn,
    toTable,
    toColumn,
    overlapCache,
}) => {
    if (!overlapCache) {
        return getPostgresOverlapProfile({ fromTable, fromColumn, toTable, toColumn });
    }

    const cacheKey = `${fromTable?.id || 'from'}:${String(fromColumn || '').toLowerCase()}->${toTable?.id || 'to'}:${String(toColumn || '').toLowerCase()}`;
    if (!overlapCache.has(cacheKey)) {
        overlapCache.set(cacheKey, getPostgresOverlapProfile({ fromTable, fromColumn, toTable, toColumn }));
    }
    return overlapCache.get(cacheKey);
};

const inferRelationshipTypeByProfile = (fromProfile, toProfile) => {
    if (!fromProfile || !toProfile) return 'n-n';
    if (fromProfile.unique && toProfile.unique) return '1-1';
    if (fromProfile.unique && !toProfile.unique) return '1-n';
    if (!fromProfile.unique && toProfile.unique) return 'n-1';
    return 'n-n';
};

const inferRelationshipForCreate = async ({
    fromTable,
    fromColumn,
    toTable,
    toColumn,
    profileCache,
    overlapCache,
}) => {
    const nameAnalysis = analyzeRelationshipByName({
        tableA: fromTable,
        tableB: toTable,
        columnA: fromColumn,
        columnB: toColumn,
    });
    const byName = nameAnalysis.relationshipType;

    let inferredType = byName;
    let byProfile = null;
    let fromProfile = null;
    let toProfile = null;
    let hasOverlap = null;
    let overlapProfile = null;
    const ambiguousSharedForeignKey = (
        nameAnalysis.aFkLike
        && nameAnalysis.bFkLike
        && !nameAnalysis.aRefersB
        && !nameAnalysis.bRefersA
    );

    if (fromTable.runtimeEngine === 'postgres' && toTable.runtimeEngine === 'postgres' && fromTable.runtimeRef && toTable.runtimeRef) {
        try {
            [fromProfile, toProfile] = await Promise.all([
                getPostgresColumnProfileCached({ table: fromTable, columnName: fromColumn, profileCache }),
                getPostgresColumnProfileCached({ table: toTable, columnName: toColumn, profileCache }),
            ]);

            if (fromProfile && toProfile && fromProfile.nonNullRows > 0 && toProfile.nonNullRows > 0) {
                byProfile = inferRelationshipTypeByProfile(fromProfile, toProfile);

                if (ambiguousSharedForeignKey) {
                    inferredType = 'n-n';
                } else if (nameAnalysis.confidence === 'strong') {
                    inferredType = byName;
                } else if (!nameAnalysis.likelyJoin) {
                    inferredType = byProfile;
                } else if (nameAnalysis.confidence === 'medium' && byProfile !== 'n-n') {
                    inferredType = byProfile;
                } else if (nameAnalysis.confidence === 'weak' && byProfile !== 'n-n' && byProfile !== '1-1') {
                    inferredType = byProfile;
                }
            }

            overlapProfile = await getPostgresOverlapProfileCached({
                fromTable,
                fromColumn,
                toTable,
                toColumn,
                overlapCache,
            });
            hasOverlap = overlapProfile ? overlapProfile.hasOverlap : null;
        } catch (err) {
            // Fallback to naming heuristics if profiling query fails.
            fromProfile = null;
            toProfile = null;
            hasOverlap = null;
            overlapProfile = null;
        }
    }

    return {
        relationshipType: inferredType,
        byName,
        byProfile,
        byNameConfidence: nameAnalysis.confidence,
        ambiguousSharedForeignKey,
        fromProfile,
        toProfile,
        hasOverlap,
        overlapProfile,
    };
};

const calculateSuggestionScore = ({
    typeA,
    typeB,
    relationshipType,
    analysis,
    fromColumn,
    toColumn,
    inferred,
}) => {
    if (typeA !== typeB) return 0;
    if (inferred?.hasOverlap === false) return 0;

    let score = 0;

    if (analysis?.likelyJoin) score += 40;
    else if (inferred?.byProfile) score += 24;
    else return 0;

    score += 20; // datatype match

    score += confidenceRank(analysis?.confidence) * 10;

    if (analysis?.aRefersB || analysis?.bRefersA) score += 16;
    if (analysis?.aFkLike || analysis?.bFkLike) score += 8;
    if ((analysis?.aRefersB && analysis?.bPkLike) || (analysis?.bRefersA && analysis?.aPkLike)) score += 16;

    if (inferred?.byProfile) {
        score += 14;
        if (inferred.byProfile === relationshipType) score += 10;
        else score -= 8;
    }

    if (inferred?.overlapProfile) {
        const minCoverage = Math.min(
            Number(inferred.overlapProfile.coverageFrom || 0),
            Number(inferred.overlapProfile.coverageTo || 0)
        );
        const maxCoverage = Math.max(
            Number(inferred.overlapProfile.coverageFrom || 0),
            Number(inferred.overlapProfile.coverageTo || 0)
        );

        if (minCoverage >= 0.9) score += 22;
        else if (minCoverage >= 0.6) score += 16;
        else if (maxCoverage >= 0.6) score += 9;
        else if (maxCoverage >= 0.3) score += 4;
        else score -= 10;

        if (Number(inferred.overlapProfile.overlapDistinct || 0) <= 1) score -= 8;
    }

    if (relationshipType === 'n-1' || relationshipType === '1-n') score += 12;
    if (relationshipType === '1-1') score += 6;
    if (relationshipType === 'n-n') score -= 2;

    if ((isGenericNonKeyColumnName(fromColumn) || isGenericNonKeyColumnName(toColumn))
        && !(isIdLikeColumnName(fromColumn) || isIdLikeColumnName(toColumn))) {
        score -= 30;
    }

    if (!analysis?.aPkLike && !analysis?.bPkLike && relationshipType === '1-1' && !inferred?.byProfile) score -= 22;

    return clampScore(score);
};

const suggestionSignalRank = (suggestion) => {
    const reasons = Array.isArray(suggestion?.reasons) ? suggestion.reasons : [];
    if (reasons.includes('from_fk_to_target_pk') || reasons.includes('to_fk_to_source_pk')) return 4;
    if (reasons.includes('table_reference_pattern')) return 3;
    if (reasons.some((reason) => String(reason).startsWith('profile_'))) return 2;
    if (reasons.includes('same_id_like_name')) return 1;
    return 0;
};

const relationshipTypePreferenceRank = (type) => {
    if (type === 'n-1' || type === '1-n') return 4;
    if (type === '1-1') return 3;
    if (type === 'n-n') return 1;
    return 0;
};

const pickPreferredSuggestion = (current, candidate) => {
    if (!current) return candidate;
    if (!candidate) return current;

    if (candidate.confidence !== current.confidence) {
        return candidate.confidence > current.confidence ? candidate : current;
    }

    const currentValid = current.validationStatus === 'valid' ? 1 : 0;
    const candidateValid = candidate.validationStatus === 'valid' ? 1 : 0;
    if (candidateValid !== currentValid) {
        return candidateValid > currentValid ? candidate : current;
    }

    const signalDiff = suggestionSignalRank(candidate) - suggestionSignalRank(current);
    if (signalDiff !== 0) return signalDiff > 0 ? candidate : current;

    const relationDiff = relationshipTypePreferenceRank(candidate.relationshipType) - relationshipTypePreferenceRank(current.relationshipType);
    if (relationDiff !== 0) return relationDiff > 0 ? candidate : current;

    const currentKey = `${current.fromTableId}:${String(current.fromColumn).toLowerCase()}->${current.toTableId}:${String(current.toColumn).toLowerCase()}`;
    const candidateKey = `${candidate.fromTableId}:${String(candidate.fromColumn).toLowerCase()}->${candidate.toTableId}:${String(candidate.toColumn).toLowerCase()}`;
    return candidateKey.localeCompare(currentKey) < 0 ? candidate : current;
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

        const normalizedRows = rows.rows.map((row) => {
            const normalizedType = normalizeStoredRelationshipType(row);
            if (!normalizedType || normalizedType === row.relationship_type) return row;
            return {
                ...row,
                relationship_type: normalizedType,
            };
        });

        const updates = normalizedRows
            .filter((row, idx) => row.relationship_type !== rows.rows[idx].relationship_type)
            .map((row) => ({
                id: row.id,
                relationshipType: row.relationship_type,
            }));

        if (updates.length > 0) {
            await Promise.all(
                updates.map((item) => query(
                    `UPDATE model_relationships mr
                     SET relationship_type = $1,
                         updated_at = NOW()
                     FROM data_models dm
                     WHERE mr.id = $2
                       AND mr.data_model_id = dm.id
                       AND dm.workspace_id = $3`,
                    [item.relationshipType, item.id, req.user.workspace_id]
                ))
            );
        }

        res.json({
            success: true,
            data: normalizedRows.map(toRelationshipResponse),
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

        const requestedRelationshipType = ['1-1', '1-n', 'n-1', 'n-n'].includes(payload.relationshipType)
            ? payload.relationshipType
            : null;

        const inferred = await inferRelationshipForCreate({
            fromTable,
            fromColumn,
            toTable,
            toColumn,
        });

        // Always auto-detect cardinality unless caller explicitly forces non-executable n-n.
        const relationshipType = requestedRelationshipType === 'n-n'
            ? 'n-n'
            : inferred.relationshipType;
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
        } else if (inferred.hasOverlap === false) {
            validationStatus = 'invalid';
            invalidReason = 'Columns have no overlapping values';
        } else if (!isLikelyJoinPairByName({
            tableA: fromTable,
            tableB: toTable,
            columnA: fromColumn,
            columnB: toColumn,
        }) && inferred.hasOverlap !== true) {
            validationStatus = 'invalid';
            invalidReason = 'Selected columns do not look like a key relationship';
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

        const suggestionsByKey = new Map();
        const profileCache = new Map();
        const overlapCache = new Map();
        const existingRelationshipKeys = new Set(
            (catalog.relationships || []).map((rel) => buildRelationshipCanonicalKey({
                fromTableId: rel.from_table_id,
                fromColumn: rel.from_column,
                toTableId: rel.to_table_id,
                toColumn: rel.to_column,
            }))
        );

        for (let i = 0; i < tables.length; i += 1) {
            for (let j = i + 1; j < tables.length; j += 1) {
                const tableA = tables[i];
                const tableB = tables[j];
                let bestPairSuggestion = null;

                const colsA = (tableA.schema || []).filter((col) => col?.name);
                const colsB = (tableB.schema || []).filter((col) => col?.name);

                for (const a of colsA) {
                    for (const b of colsB) {
                        const typeA = findFieldType(tableA, a.name);
                        const typeB = findFieldType(tableB, b.name);
                        if (typeA !== typeB) continue;

                        const normalizedA = normalizeToken(a.name);
                        const normalizedB = normalizeToken(b.name);
                        if (!normalizedA || !normalizedB) continue;

                        const byNameCandidate = pickBestDirectionalCandidateByName({
                            tableA,
                            columnA: a.name,
                            tableB,
                            columnB: b.name,
                        });

                        const bothPostgres = tableA.runtimeEngine === 'postgres' && tableB.runtimeEngine === 'postgres';
                        const directionalSeeds = [];

                        if (byNameCandidate) {
                            directionalSeeds.push({
                                fromTable: byNameCandidate.fromTable,
                                fromColumn: byNameCandidate.fromColumn,
                                toTable: byNameCandidate.toTable,
                                toColumn: byNameCandidate.toColumn,
                                seedReason: 'name_pattern',
                            });
                        }

                        if (bothPostgres && normalizedA === normalizedB && isIdLikeColumnName(normalizedA)) {
                            directionalSeeds.push(
                                { fromTable: tableA, fromColumn: a.name, toTable: tableB, toColumn: b.name, seedReason: 'same_id_like_name' },
                                { fromTable: tableB, fromColumn: b.name, toTable: tableA, toColumn: a.name, seedReason: 'same_id_like_name' }
                            );
                        }

                        if (directionalSeeds.length === 0) continue;

                        const uniqueSeedKeys = new Set();
                        for (const seed of directionalSeeds) {
                            if (seed.fromTable.runtimeEngine !== seed.toTable.runtimeEngine) continue;

                            const seedKey = `${seed.fromTable.id}:${String(seed.fromColumn).toLowerCase()}->${seed.toTable.id}:${String(seed.toColumn).toLowerCase()}`;
                            if (uniqueSeedKeys.has(seedKey)) continue;
                            uniqueSeedKeys.add(seedKey);

                            const fromColumnType = findFieldType(seed.fromTable, seed.fromColumn);
                            const toColumnType = findFieldType(seed.toTable, seed.toColumn);
                            if (fromColumnType !== toColumnType) continue;

                            const inferred = await inferRelationshipForCreate({
                                fromTable: seed.fromTable,
                                fromColumn: seed.fromColumn,
                                toTable: seed.toTable,
                                toColumn: seed.toColumn,
                                profileCache,
                                overlapCache,
                            });

                            const analysis = analyzeRelationshipByName({
                                tableA: seed.fromTable,
                                tableB: seed.toTable,
                                columnA: seed.fromColumn,
                                columnB: seed.toColumn,
                            });

                            if (inferred.hasOverlap === false) continue;
                            if (!analysis.likelyJoin && !inferred.byProfile) continue;

                            const relationshipType = inferred.relationshipType;
                            if (relationshipType === 'n-n' && !inferred.byProfile && analysis.confidence === 'none') continue;

                            const normalizedFromColumn = normalizeToken(seed.fromColumn);
                            const normalizedToColumn = normalizeToken(seed.toColumn);
                            const plainIdPair = normalizedFromColumn === 'id' && normalizedToColumn === 'id';
                            const hasExplicitReferencePattern = analysis.aRefersB || analysis.bRefersA;
                            const tableNamesRelated = areTableNamesLikelyRelated(seed.fromTable.tableName, seed.toTable.tableName);
                            const bothForeignKeyLike = analysis.aFkLike && analysis.bFkLike;
                            const hasStrongPattern = hasExplicitReferencePattern || analysis.confidence === 'strong';

                            // Two FK columns with same name across unrelated tables usually point to a 3rd dimension table.
                            // Avoid suggesting direct relationship to prevent wrong planner joins.
                            if (bothForeignKeyLike && !hasExplicitReferencePattern && !tableNamesRelated) continue;

                            // Avoid id->id auto links across unrelated entities (usually accidental overlap).
                            if (plainIdPair && !tableNamesRelated) continue;

                            if (inferred.ambiguousSharedForeignKey) continue;

                            if (!hasStrongPattern && isGenericNonKeyColumnName(normalizedFromColumn) && isGenericNonKeyColumnName(normalizedToColumn)) {
                                continue;
                            }

                            const score = calculateSuggestionScore({
                                typeA: fromColumnType,
                                typeB: toColumnType,
                                relationshipType,
                                analysis,
                                fromColumn: seed.fromColumn,
                                toColumn: seed.toColumn,
                                inferred,
                            });

                            const hasProfileEvidence = Boolean(
                                inferred.byProfile
                                && inferred.overlapProfile
                                && Math.max(
                                    Number(inferred.overlapProfile.coverageFrom || 0),
                                    Number(inferred.overlapProfile.coverageTo || 0)
                                ) >= 0.6
                            );
                            const minScore = hasStrongPattern ? 72 : (hasProfileEvidence ? 86 : 92);
                            const requiredScore = relationshipType === 'n-n' ? (minScore + 6) : minScore;
                            if (score < requiredScore) continue;

                            let validationStatus = 'valid';
                            let invalidReason = null;
                            if (relationshipType === 'n-n') {
                                validationStatus = 'invalid';
                                invalidReason = 'n-n relationship is not executable by semantic planner';
                            }

                            const canonicalKey = buildRelationshipCanonicalKey({
                                fromTableId: seed.fromTable.id,
                                fromColumn: seed.fromColumn,
                                toTableId: seed.toTable.id,
                                toColumn: seed.toColumn,
                            });
                            if (existingRelationshipKeys.has(canonicalKey)) continue;

                            const minCoveragePct = inferred?.overlapProfile
                                ? Math.round(Math.min(
                                    Number(inferred.overlapProfile.coverageFrom || 0),
                                    Number(inferred.overlapProfile.coverageTo || 0)
                                ) * 100)
                                : null;

                            const suggestion = {
                                id: canonicalKey,
                                dataModelId,
                                fromTableId: seed.fromTable.id,
                                fromTable: seed.fromTable.tableName,
                                fromColumn: seed.fromColumn,
                                toTableId: seed.toTable.id,
                                toTable: seed.toTable.tableName,
                                toColumn: seed.toColumn,
                                relationshipType,
                                crossFilterDirection: 'single',
                                confidence: score,
                                validationStatus,
                                invalidReason: invalidReason || undefined,
                                reasons: Array.from(new Set([
                                    ...(analysis.reasons || []),
                                    seed.seedReason,
                                    inferred.byProfile ? `profile_${inferred.byProfile}` : null,
                                    minCoveragePct !== null ? `overlap_${minCoveragePct}pct` : null,
                                    fromColumnType === toColumnType ? 'same_datatype' : null,
                                    (analysis.aFkLike || analysis.bFkLike) ? 'foreign_key_pattern' : null,
                                    (analysis.aRefersB || analysis.bRefersA) ? 'table_reference_pattern' : null,
                                ].filter(Boolean))),
                            };

                            bestPairSuggestion = pickPreferredSuggestion(bestPairSuggestion, suggestion);
                        }
                    }
                }

                if (bestPairSuggestion) {
                    const existing = suggestionsByKey.get(bestPairSuggestion.id);
                    suggestionsByKey.set(
                        bestPairSuggestion.id,
                        pickPreferredSuggestion(existing, bestPairSuggestion)
                    );
                }
            }
        }

        const suggestions = Array.from(suggestionsByKey.values());
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
