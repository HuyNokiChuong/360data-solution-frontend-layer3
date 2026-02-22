const { query } = require('../config/db');

const toObject = (value) => (value && typeof value === 'object' ? value : {});

const backendPort = Number(process.env.BACKEND_PORT || 3001);
const backendHost = String(process.env.BACKEND_HOST || '').trim() || '127.0.0.1';
const BACKEND_BASE = `http://${backendHost}:${backendPort}`;

const normalizeText = (value) => String(value || '').trim();
const normalizeToken = (value) => String(value || '').trim().toLowerCase();

const invokeInternalApi = async ({ authHeader, method = 'GET', path, body }) => {
    const response = await fetch(`${BACKEND_BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
        const message = payload?.message || `Action failed (${response.status})`;
        const err = new Error(message);
        err.status = response.status;
        err.payload = payload;
        throw err;
    }

    return payload;
};

const resolveConnectionId = async ({ workspaceId, connectionId, connectionName }) => {
    if (connectionId) return connectionId;
    if (!connectionName) return null;

    const result = await query(
        `SELECT id
         FROM connections
         WHERE workspace_id = $1
           AND is_deleted = FALSE
           AND LOWER(name) = LOWER($2)
         LIMIT 1`,
        [workspaceId, connectionName]
    );

    return result.rows[0]?.id || null;
};

const resolveTableId = async ({ workspaceId, tableId, tableName, datasetName }) => {
    if (tableId) return tableId;
    if (!tableName) return null;

    const values = [workspaceId, tableName];
    let where = `LOWER(st.table_name) = LOWER($2)`;

    if (datasetName) {
        values.push(datasetName);
        where = `${where} AND LOWER(COALESCE(st.dataset_name, '')) = LOWER($3)`;
    }

    const result = await query(
        `SELECT st.id
         FROM synced_tables st
         JOIN connections c ON c.id = st.connection_id
         WHERE c.workspace_id = $1
           AND c.is_deleted = FALSE
           AND st.is_deleted = FALSE
           AND ${where}
         LIMIT 1`,
        values
    );

    return result.rows[0]?.id || null;
};

const normalizeUserLookupToken = (value) => normalizeText(value).replace(/^@+/, '');

const resolveUserId = async ({ workspaceId, userId, email, userName, userTarget }) => {
    if (userId) return userId;
    if (email) {
        const result = await query(
            `SELECT id
             FROM users
             WHERE workspace_id = $1
               AND LOWER(email) = LOWER($2)
             LIMIT 1`,
            [workspaceId, email]
        );
        return result.rows[0]?.id || null;
    }

    const lookup = normalizeUserLookupToken(userName || userTarget);
    if (!lookup) return null;

    const exactByName = await query(
        `SELECT id, name, email
         FROM users
         WHERE workspace_id = $1
           AND LOWER(name) = LOWER($2)
         LIMIT 5`,
        [workspaceId, lookup]
    );
    if (exactByName.rows.length === 1) {
        return exactByName.rows[0].id;
    }
    if (exactByName.rows.length > 1) {
        throw new Error(`Có nhiều user trùng tên "${lookup}". Vui lòng dùng email hoặc userId.`);
    }

    const fuzzyMatch = await query(
        `SELECT id, name, email
         FROM users
         WHERE workspace_id = $1
           AND (
             split_part(LOWER(email), '@', 1) = LOWER($2)
             OR LOWER(name) LIKE LOWER($3)
           )
         ORDER BY joined_at DESC
         LIMIT 5`,
        [workspaceId, lookup, `%${lookup}%`]
    );
    if (fuzzyMatch.rows.length === 1) {
        return fuzzyMatch.rows[0].id;
    }
    if (fuzzyMatch.rows.length > 1) {
        throw new Error(`Có ${fuzzyMatch.rows.length} user khớp "${lookup}". Vui lòng dùng email hoặc userId.`);
    }

    return null;
};

const resolveDataModelId = async ({ workspaceId, dataModelId, dataModelTarget }) => {
    const explicitId = normalizeText(dataModelId);
    if (explicitId) return explicitId;

    const target = normalizeText(dataModelTarget);
    if (!target) return null;

    const exactByName = await query(
        `SELECT id
         FROM data_models
         WHERE workspace_id = $1
           AND LOWER(name) = LOWER($2)
         LIMIT 5`,
        [workspaceId, target]
    );
    if (exactByName.rows.length === 1) return exactByName.rows[0].id;
    if (exactByName.rows.length > 1) {
        throw new Error(`Có nhiều data model tên "${target}". Vui lòng dùng dataModelId cụ thể.`);
    }

    const fuzzyMatch = await query(
        `SELECT id
         FROM data_models
         WHERE workspace_id = $1
           AND LOWER(name) LIKE LOWER($2)
         ORDER BY created_at DESC
         LIMIT 5`,
        [workspaceId, `%${target}%`]
    );
    if (fuzzyMatch.rows.length === 1) return fuzzyMatch.rows[0].id;
    if (fuzzyMatch.rows.length > 1) {
        throw new Error(`Có ${fuzzyMatch.rows.length} data model khớp "${target}". Vui lòng dùng dataModelId cụ thể.`);
    }

    throw new Error(`Không tìm thấy data model "${target}". Vui lòng kiểm tra lại tên hoặc dùng dataModelId.`);
};

const resolveModelTableIdByName = async ({ authHeader, dataModelId, tableName }) => {
    if (!tableName) return null;

    const querySuffix = dataModelId ? `?dataModelId=${encodeURIComponent(dataModelId)}` : '';
    const payload = await invokeInternalApi({
        authHeader,
        method: 'GET',
        path: `/api/data-modeling/tables${querySuffix}`,
    });

    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const normalized = normalizeToken(tableName);

    const found = rows.find((row) => {
        const tableToken = normalizeToken(row?.tableName);
        const datasetToken = normalizeToken(row?.datasetName);
        const combo = normalizeToken(`${row?.datasetName || ''}.${row?.tableName || ''}`);
        return tableToken === normalized || combo === normalized || `${datasetToken}.${tableToken}` === normalized;
    });

    return found?.id || null;
};

const ensureArg = (value, message) => {
    if (value === undefined || value === null || value === '') {
        throw new Error(message);
    }
    return value;
};

const executeConnectionsCreateBigQuery = async ({ authHeader, args }) => {
    const body = {
        name: String(args.name || args.connectionName || 'BigQuery Connection').trim(),
        type: 'BigQuery',
        authType: String(args.authType || 'GoogleMail'),
        email: args.email || null,
        status: 'Connected',
        projectId: ensureArg(args.projectId, 'projectId is required for BigQuery connection'),
        serviceAccountKey: args.serviceAccountKey || null,
        tableCount: Number(args.tableCount || 0),
    };

    return invokeInternalApi({
        authHeader,
        method: 'POST',
        path: '/api/connections',
        body,
    });
};

const executeConnectionsCreatePostgres = async ({ authHeader, args }) => {
    const config = toObject(args.config);
    const body = {
        name: String(args.name || args.connectionName || 'PostgreSQL Connection').trim(),
        config: {
            host: ensureArg(config.host || args.host, 'host is required for PostgreSQL connection'),
            port: Number(config.port || args.port || 5432),
            databaseName: ensureArg(config.databaseName || args.databaseName, 'databaseName is required for PostgreSQL connection'),
            username: ensureArg(config.username || args.username, 'username is required for PostgreSQL connection'),
            password: ensureArg(config.password || args.password, 'password is required for PostgreSQL connection'),
            ssl: Boolean(config.ssl ?? args.ssl ?? false),
        },
    };

    return invokeInternalApi({
        authHeader,
        method: 'POST',
        path: '/api/connections/postgres',
        body,
    });
};

const executeConnectionsDelete = async ({ authHeader, args, user }) => {
    const connectionId = await resolveConnectionId({
        workspaceId: user.workspace_id,
        connectionId: args.connectionId,
        connectionName: args.connectionName,
    });

    ensureArg(connectionId, 'connectionId/connectionName is required');

    return invokeInternalApi({
        authHeader,
        method: 'DELETE',
        path: `/api/connections/${connectionId}`,
    });
};

const executeTablesToggleStatus = async ({ authHeader, args, user }) => {
    const tableId = await resolveTableId({
        workspaceId: user.workspace_id,
        tableId: args.tableId,
        tableName: args.tableName,
        datasetName: args.datasetName,
    });

    ensureArg(tableId, 'tableId/tableName is required');

    const status = args.status ? String(args.status) : undefined;
    return invokeInternalApi({
        authHeader,
        method: 'PATCH',
        path: `/api/connections/tables/${tableId}/status`,
        body: status ? { status } : {},
    });
};

const executeTablesDelete = async ({ authHeader, args, user }) => {
    const tableId = await resolveTableId({
        workspaceId: user.workspace_id,
        tableId: args.tableId,
        tableName: args.tableName,
        datasetName: args.datasetName,
    });

    ensureArg(tableId, 'tableId/tableName is required');

    return invokeInternalApi({
        authHeader,
        method: 'DELETE',
        path: `/api/connections/tables/${tableId}`,
    });
};

const executeAutoDetectRelationships = async ({ authHeader, args, user }) => {
    const dataModelId = await resolveDataModelId({
        workspaceId: user.workspace_id,
        dataModelId: args.dataModelId,
        dataModelTarget: args.dataModelTarget,
    });
    return invokeInternalApi({
        authHeader,
        method: 'POST',
        path: '/api/data-modeling/relationships/auto-detect',
        body: {
            dataModelId: dataModelId || undefined,
            tableIds: Array.isArray(args.tableIds) ? args.tableIds : undefined,
        },
    });
};

const executeCreateRelationship = async ({ authHeader, args, user }) => {
    const dataModelId = await resolveDataModelId({
        workspaceId: user.workspace_id,
        dataModelId: args.dataModelId,
        dataModelTarget: args.dataModelTarget,
    });

    let fromTableId = args.fromTableId;
    let toTableId = args.toTableId;

    if (!fromTableId && args.fromTableName) {
        fromTableId = await resolveModelTableIdByName({ authHeader, dataModelId, tableName: args.fromTableName });
    }
    if (!toTableId && args.toTableName) {
        toTableId = await resolveModelTableIdByName({ authHeader, dataModelId, tableName: args.toTableName });
    }

    ensureArg(fromTableId, 'fromTableId/fromTableName is required');
    ensureArg(toTableId, 'toTableId/toTableName is required');
    ensureArg(args.fromColumn, 'fromColumn is required');
    ensureArg(args.toColumn, 'toColumn is required');

    return invokeInternalApi({
        authHeader,
        method: 'POST',
        path: '/api/data-modeling/relationships',
        body: {
            dataModelId,
            fromTableId,
            toTableId,
            fromColumn: args.fromColumn,
            toColumn: args.toColumn,
            relationshipType: args.relationshipType,
            crossFilterDirection: args.crossFilterDirection,
        },
    });
};

const executeDeleteRelationship = async ({ authHeader, args }) => {
    const relationshipId = ensureArg(args.relationshipId || args.id, 'relationshipId is required');

    return invokeInternalApi({
        authHeader,
        method: 'DELETE',
        path: `/api/data-modeling/relationships/${relationshipId}`,
    });
};

const executeInviteUser = async ({ authHeader, args }) => {
    ensureArg(args.email, 'email is required');
    ensureArg(args.name, 'name is required');

    return invokeInternalApi({
        authHeader,
        method: 'POST',
        path: '/api/users/invite',
        body: {
            name: args.name,
            email: args.email,
            role: args.role || 'Viewer',
            groupName: args.groupName || args.group || undefined,
            note: args.note,
            tags: Array.isArray(args.tags) ? args.tags : undefined,
        },
    });
};

const executeUpdateUser = async ({ authHeader, args, user }) => {
    const userId = await resolveUserId({
        workspaceId: user.workspace_id,
        userId: args.userId,
        email: args.email,
        userName: args.userName,
        userTarget: args.userTarget,
    });
    ensureArg(userId, 'userId/email/userName is required');

    return invokeInternalApi({
        authHeader,
        method: 'PUT',
        path: `/api/users/${userId}`,
        body: {
            name: args.name,
            role: args.role,
            groupName: args.groupName || args.group || undefined,
            note: args.note,
            tags: Array.isArray(args.tags) ? args.tags : undefined,
        },
    });
};

const executeToggleUserStatus = async ({ authHeader, args, user }) => {
    const userId = await resolveUserId({
        workspaceId: user.workspace_id,
        userId: args.userId,
        email: args.email,
        userName: args.userName,
        userTarget: args.userTarget,
    });
    ensureArg(userId, 'userId/email/userName is required');

    const desiredStatusRaw = normalizeToken(args.desiredStatus);
    const desiredStatus = desiredStatusRaw === 'active'
        ? 'Active'
        : ((desiredStatusRaw === 'disabled' || desiredStatusRaw === 'disable' || desiredStatusRaw === 'inactive')
            ? 'Disabled'
            : null);

    if (desiredStatus) {
        const current = await query(
            `SELECT status
             FROM users
             WHERE id = $1
               AND workspace_id = $2
             LIMIT 1`,
            [userId, user.workspace_id]
        );
        const currentStatus = String(current.rows[0]?.status || '').trim();
        if (!currentStatus) {
            throw new Error('User not found');
        }
        if (currentStatus === desiredStatus) {
            return {
                success: true,
                data: {
                    id: userId,
                    status: currentStatus,
                    skipped: true,
                },
            };
        }
    }

    return invokeInternalApi({
        authHeader,
        method: 'PUT',
        path: `/api/users/${userId}/status`,
    });
};

const executeDeleteUser = async ({ authHeader, args, user }) => {
    const userId = await resolveUserId({
        workspaceId: user.workspace_id,
        userId: args.userId,
        email: args.email,
        userName: args.userName,
        userTarget: args.userTarget,
    });
    ensureArg(userId, 'userId/email/userName is required');

    return invokeInternalApi({
        authHeader,
        method: 'DELETE',
        path: `/api/users/${userId}`,
    });
};

const executeAssistantServerAction = async ({ action, authHeader, user }) => {
    const actionType = String(action?.actionType || '').trim();
    const args = toObject(action?.args);

    switch (actionType) {
        case 'connections.create_bigquery':
            return executeConnectionsCreateBigQuery({ authHeader, args, user });
        case 'connections.create_postgres':
            return executeConnectionsCreatePostgres({ authHeader, args, user });
        case 'connections.delete_connection':
            return executeConnectionsDelete({ authHeader, args, user });

        case 'tables.toggle_status':
            return executeTablesToggleStatus({ authHeader, args, user });
        case 'tables.delete':
            return executeTablesDelete({ authHeader, args, user });

        case 'data_modeling.auto_detect_relationships':
            return executeAutoDetectRelationships({ authHeader, args, user });
        case 'data_modeling.create_relationship':
            return executeCreateRelationship({ authHeader, args, user });
        case 'data_modeling.delete_relationship':
            return executeDeleteRelationship({ authHeader, args, user });

        case 'users.invite':
            return executeInviteUser({ authHeader, args, user });
        case 'users.update':
            return executeUpdateUser({ authHeader, args, user });
        case 'users.toggle_status':
            return executeToggleUserStatus({ authHeader, args, user });
        case 'users.delete':
            return executeDeleteUser({ authHeader, args, user });

        default:
            throw new Error(`Unsupported server action: ${actionType}`);
    }
};

module.exports = {
    executeAssistantServerAction,
};
