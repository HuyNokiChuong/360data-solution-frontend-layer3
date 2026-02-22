import { API_BASE } from './api';

const getAuthHeaders = () => {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
};

const toBase64 = async (file: File): Promise<string> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Không thể đọc file'));
        reader.readAsDataURL(file);
    });

    const base64 = dataUrl.split(',')[1] || '';
    if (!base64) throw new Error('File upload không hợp lệ');
    return base64;
};

const parseJsonResponse = async (response: Response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success) {
        throw new Error(data?.message || 'Excel request failed');
    }
    return data;
};

export interface ExcelPreviewSheet {
    sheetName: string;
    rowCount: number;
    columnCount: number;
    isEmpty: boolean;
    warnings?: string[];
}

export interface ExcelPreviewResponse {
    fileName: string;
    sheetCount: number;
    sheets: ExcelPreviewSheet[];
}

export interface ExcelImportResult {
    data: any[];
    warnings: string[];
}

export interface ExcelTableDataResponse {
    tableId: string;
    offset: number;
    limit: number;
    totalRows: number;
    hasMore: boolean;
    schema: { name: string; type: string }[];
    rows: Record<string, any>[];
}

export const uploadExcelForPreview = async (file: File): Promise<ExcelPreviewResponse> => {
    const fileBase64 = await toBase64(file);
    const response = await fetch(`${API_BASE}/connections/excel/upload`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify({
            fileName: file.name,
            fileBase64,
        }),
    });

    const json = await parseJsonResponse(response);
    return json.data as ExcelPreviewResponse;
};

export const fetchExcelDatasets = async (): Promise<string[]> => {
    const response = await fetch(`${API_BASE}/connections/excel/datasets`, {
        headers: {
            ...getAuthHeaders(),
        },
    });
    const json = await parseJsonResponse(response);
    return (json.data || []) as string[];
};

export const importExcelSheets = async (
    connectionId: string,
    file: File,
    datasetName: string,
    sheetNames: string[]
): Promise<ExcelImportResult> => {
    const fileBase64 = await toBase64(file);
    const response = await fetch(`${API_BASE}/connections/${connectionId}/excel/import`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify({
            fileName: file.name,
            fileBase64,
            datasetName,
            sheetNames,
        }),
    });

    const json = await parseJsonResponse(response);
    return {
        data: json.data || [],
        warnings: json.warnings || [],
    };
};

export const fetchExcelTableData = async (
    tableId: string,
    offset = 0,
    limit = 200
): Promise<ExcelTableDataResponse> => {
    const url = new URL(`${API_BASE}/connections/tables/${tableId}/data`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(limit));

    const response = await fetch(url.toString(), {
        headers: {
            ...getAuthHeaders(),
        },
    });

    const json = await parseJsonResponse(response);
    return json.data as ExcelTableDataResponse;
};
