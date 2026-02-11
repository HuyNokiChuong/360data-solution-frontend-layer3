const API_BASE = 'http://localhost:3001/api';

const getAuthHeaders = () => {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
};

const parseJsonResponse = async (response: Response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success) {
        const err: any = new Error(data?.message || 'Google Sheets request failed');
        err.status = response.status;
        err.details = data?.details || null;
        throw err;
    }
    return data;
};

export interface GoogleSheetsFileItem {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
}

export interface GoogleSheetTabItem {
    sheetId: number;
    title: string;
    index: number;
    gridProperties?: {
        rowCount?: number;
        columnCount?: number;
    };
}

export interface GoogleSheetSelectionInput {
    sheetId: number;
    sheetName: string;
    headerMode: 'first_row' | 'auto_columns';
}

export const connectGoogleSheetsOAuth = async (payload: {
    authCode: string;
    connectionId?: string;
    connectionName?: string;
}) => {
    const response = await fetch(`${API_BASE}/connections/google-sheets/oauth/connect`, {
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

export const listGoogleSheetsFiles = async (
    connectionId: string,
    options?: { search?: string; pageToken?: string; pageSize?: number }
): Promise<{ files: GoogleSheetsFileItem[]; nextPageToken: string | null }> => {
    const url = new URL(`${API_BASE}/connections/${connectionId}/google-sheets/files`);
    if (options?.search) url.searchParams.set('search', options.search);
    if (options?.pageToken) url.searchParams.set('pageToken', options.pageToken);
    if (options?.pageSize) url.searchParams.set('pageSize', String(options.pageSize));

    const response = await fetch(url.toString(), {
        headers: {
            ...getAuthHeaders(),
        },
    });
    const json = await parseJsonResponse(response);
    return {
        files: (json.data || []) as GoogleSheetsFileItem[],
        nextPageToken: json.nextPageToken || null,
    };
};

export const resolveGoogleSheetsUrl = async (connectionId: string, rawUrl: string): Promise<GoogleSheetsFileItem> => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/google-sheets/resolve-url`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify({ url: rawUrl }),
    });

    const json = await parseJsonResponse(response);
    return json.data as GoogleSheetsFileItem;
};

export const listGoogleSheetsTabs = async (
    connectionId: string,
    fileId: string
): Promise<{ spreadsheetId: string; spreadsheetTitle: string; sheets: GoogleSheetTabItem[] }> => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/google-sheets/files/${fileId}/sheets`, {
        headers: {
            ...getAuthHeaders(),
        },
    });
    const json = await parseJsonResponse(response);
    return json.data as { spreadsheetId: string; spreadsheetTitle: string; sheets: GoogleSheetTabItem[] };
};

export const preflightGoogleSheetsImport = async (
    connectionId: string,
    payload: {
        fileId: string;
        sheets: GoogleSheetSelectionInput[];
    }
) => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/google-sheets/preflight`, {
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

export const importGoogleSheetsData = async (
    connectionId: string,
    payload: {
        fileId: string;
        fileName?: string;
        sheets: GoogleSheetSelectionInput[];
        allowEmptySheets?: boolean;
        confirmOverwrite?: boolean;
        syncMode?: 'manual' | 'interval';
        syncIntervalMinutes?: number;
    }
) => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/google-sheets/import`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
    });

    const json = await parseJsonResponse(response);
    return {
        tables: json.data || [],
        warnings: json.warnings || [],
        metadata: json.metadata || null,
    };
};

export const updateGoogleSheetsSyncSettings = async (
    connectionId: string,
    payload: { mode: 'manual' | 'interval'; intervalMinutes?: number }
) => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/google-sheets/sync-settings`, {
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

export const manualSyncGoogleSheets = async (
    connectionId: string,
    payload?: {
        fileId: string;
        fileName?: string;
        sheets: GoogleSheetSelectionInput[];
        allowEmptySheets?: boolean;
    }
) => {
    const response = await fetch(`${API_BASE}/connections/${connectionId}/google-sheets/manual-sync`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify(payload || {}),
    });
    const json = await parseJsonResponse(response);
    return {
        tables: json.data || [],
        warnings: json.warnings || [],
        lastSyncTime: json.last_sync_time || null,
    };
};
