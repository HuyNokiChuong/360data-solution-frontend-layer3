import { API_BASE } from './api';

const getAuthHeaders = () => {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
};

const parseJsonResponse = async (response: Response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success) {
        const err: any = new Error(data?.message || 'PostgreSQL request failed');
        err.status = response.status;
        err.details = data?.details || null;
        throw err;
    }
    return data;
};

export interface PostgresConnectionConfigInput {
    host: string;
    port: number;
    databaseName: string;
    username: string;
    password?: string;
    ssl: boolean;
}

export interface PostgresSchemaObject {
    schemaName: string;
    tableName: string;
    objectType: 'table' | 'view';
}

export interface PostgresColumnInfo {
    name: string;
    type: string;
    ordinalPosition: number;
    isNullable: boolean;
}

export interface PostgresObjectColumns extends PostgresSchemaObject {
    columns: PostgresColumnInfo[];
    primaryKeyColumns: string[];
}

export type PostgresImportMode = 'full' | 'incremental';

export interface PostgresTableImportInput extends PostgresSchemaObject {
    incrementalColumn?: string;
    incrementalKind?: 'timestamp' | 'id';
    upsert?: boolean;
    keyColumns?: string[];
}

export interface PostgresImportJob {
    id: string;
    connectionId: string;
    workspaceId?: string;
    status: 'queued' | 'running' | 'success' | 'failed';
    stage: 'connecting' | 'fetching_schema' | 'reading_table' | 'importing' | 'completed';
    stageOrder: number;
    importMode: PostgresImportMode;
    payload: Record<string, any>;
    progress: {
        totalTables: number;
        completedTables: number;
        currentTable: string | null;
        importedRows: number;
        currentStage: string | null;
        percentage: number;
    };
    attemptCount: number;
    errorMessage?: string;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PostgresImportHistoryItem {
    id: string;
    jobId: string;
    connectionId: string;
    host: string;
    databaseName: string;
    schemaName: string;
    tableName: string;
    rowCount: number;
    columnCount: number;
    importMode: PostgresImportMode;
    lastSyncTime: string | null;
    status: 'success' | 'failed';
    errorMessage?: string;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
}

export const testPostgresConnection = async (payload: {
    config: PostgresConnectionConfigInput;
    connectionId?: string;
}) => {
    const response = await fetch(`${API_BASE}/connections/postgres/test`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
    });
    const json = await parseJsonResponse(response);
    return json.data;
};

export const createPostgresConnection = async (payload: {
    name: string;
    config: PostgresConnectionConfigInput;
}) => {
    const response = await fetch(`${API_BASE}/connections/postgres`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
    });
    const json = await parseJsonResponse(response);
    return json.data;
};

export const updatePostgresConnection = async (
    connectionId: string,
    payload: {
        name?: string;
        config: PostgresConnectionConfigInput;
    }
) => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/postgres`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
    });
    const json = await parseJsonResponse(response);
    return json.data;
};

export const listPostgresSchemas = async (connectionId: string): Promise<string[]> => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/postgres/schemas`, {
        headers: {
            ...getAuthHeaders(),
        },
    });
    const json = await parseJsonResponse(response);
    return (json.data || []) as string[];
};

export const listPostgresObjects = async (
    connectionId: string,
    schemas: string[],
    includeViews = false
): Promise<PostgresSchemaObject[]> => {
    const url = new URL(`${API_BASE}/connections/${connectionId}/postgres/objects`);
    if (Array.isArray(schemas) && schemas.length > 0) {
        url.searchParams.set('schemas', schemas.join(','));
    }
    url.searchParams.set('includeViews', includeViews ? 'true' : 'false');

    const response = await fetch(url.toString(), {
        headers: {
            ...getAuthHeaders(),
        },
    });
    const json = await parseJsonResponse(response);
    return (json.data || []) as PostgresSchemaObject[];
};

export const fetchPostgresColumnsBatch = async (
    connectionId: string,
    objects: PostgresSchemaObject[]
): Promise<PostgresObjectColumns[]> => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/postgres/columns/batch`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify({ objects }),
    });
    const json = await parseJsonResponse(response);
    return (json.data || []) as PostgresObjectColumns[];
};

export const startPostgresImportJob = async (
    connectionId: string,
    payload: {
        importMode: PostgresImportMode;
        batchSize?: number;
        tables: PostgresTableImportInput[];
    }
): Promise<PostgresImportJob> => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/postgres/import-jobs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
    });
    const json = await parseJsonResponse(response);
    return json.data as PostgresImportJob;
};

export const getPostgresImportJob = async (
    connectionId: string,
    jobId: string
): Promise<PostgresImportJob> => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/postgres/import-jobs/${jobId}`, {
        headers: {
            ...getAuthHeaders(),
        },
    });
    const json = await parseJsonResponse(response);
    return json.data as PostgresImportJob;
};

export const listPostgresImportHistory = async (connectionId: string): Promise<PostgresImportHistoryItem[]> => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/postgres/import-history`, {
        headers: {
            ...getAuthHeaders(),
        },
    });
    const json = await parseJsonResponse(response);
    return (json.data || []) as PostgresImportHistoryItem[];
};
