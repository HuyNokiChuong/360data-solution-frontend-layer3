/**
 * API Client - Centralized service for all backend API calls
 * Manages JWT token, base URL, and provides typed methods for every endpoint.
 */

/**
 * Dynamic API Base URL:
 * - Development (localhost): directly hits backend at localhost:3001
 * - Production: uses relative path (Nginx proxies /api → backend:3001)
 */
const API_BASE_URL = (() => {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:3001';
    }
    // In production, Nginx proxies /api requests to the backend
    return `${window.location.protocol}//${window.location.host}`;
})();

// ==========================================
// Token Management
// ==========================================

export const getAuthToken = (): string | null => {
    return localStorage.getItem('auth_token');
};

export const setAuthToken = (token: string): void => {
    localStorage.setItem('auth_token', token);
};

export const clearAuthToken = (): void => {
    localStorage.removeItem('auth_token');
};

// ==========================================
// Base Fetch Helper
// ==========================================

async function apiFetch<T = any>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const token = getAuthToken();

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
    });

    const data = await res.json();

    if (!res.ok) {
        const error = new Error(data.message || `API Error: ${res.status}`);
        (error as any).status = res.status;
        (error as any).code = data.code;
        throw error;
    }

    return data;
}

// ==========================================
// Auth API
// ==========================================

export const authApi = {
    register: (body: {
        email: string;
        password: string;
        name: string;
        phoneNumber?: string;
        level?: string;
        department?: string;
        industry?: string;
        companySize?: string;
    }) =>
        apiFetch('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    verify: (body: { email: string; code: string }) =>
        apiFetch('/api/auth/verify', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    resendCode: (body: { email: string }) =>
        apiFetch('/api/auth/resend-code', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    login: (body: { email: string; password: string }) =>
        apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    logout: () =>
        apiFetch('/api/auth/logout', { method: 'POST' }),

    me: () => apiFetch('/api/auth/me'),
};

// ==========================================
// Users API
// ==========================================

export const usersApi = {
    list: () => apiFetch('/api/users'),

    update: (id: string, body: Record<string, any>) =>
        apiFetch(`/api/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        }),

    delete: (id: string) =>
        apiFetch(`/api/users/${id}`, { method: 'DELETE' }),

    invite: (body: {
        email: string;
        name: string;
        role: string;
    }) =>
        apiFetch('/api/users/invite', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
};

// ==========================================
// Connections API
// ==========================================

export const connectionsApi = {
    list: () => apiFetch('/api/connections'),

    create: (body: {
        name: string;
        type: string;
        authType?: string;
        email?: string;
        projectId?: string;
        serviceAccountKey?: string;
    }) =>
        apiFetch('/api/connections', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    update: (id: string, body: Record<string, any>) =>
        apiFetch(`/api/connections/${id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        }),

    delete: (id: string) =>
        apiFetch(`/api/connections/${id}`, { method: 'DELETE' }),

    getTables: (connectionId: string) =>
        apiFetch(`/api/connections/${connectionId}/tables`),

    syncTables: (connectionId: string, tables: any[]) =>
        apiFetch(`/api/connections/${connectionId}/tables`, {
            method: 'POST',
            body: JSON.stringify({ tables }),
        }),
};

// ==========================================
// Dashboards API
// ==========================================

export const dashboardsApi = {
    list: () => apiFetch('/api/dashboards'),

    get: (id: string) => apiFetch(`/api/dashboards/${id}`),

    create: (body: Record<string, any>) =>
        apiFetch('/api/dashboards', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    update: (id: string, body: Record<string, any>) =>
        apiFetch(`/api/dashboards/${id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        }),

    delete: (id: string) =>
        apiFetch(`/api/dashboards/${id}`, { method: 'DELETE' }),

    // Pages
    addPage: (dashboardId: string, body: Record<string, any>) =>
        apiFetch(`/api/dashboards/${dashboardId}/pages`, {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    updatePage: (dashboardId: string, pageId: string, body: Record<string, any>) =>
        apiFetch(`/api/dashboards/${dashboardId}/pages/${pageId}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        }),

    deletePage: (dashboardId: string, pageId: string) =>
        apiFetch(`/api/dashboards/${dashboardId}/pages/${pageId}`, { method: 'DELETE' }),

    // Widgets
    addWidget: (dashboardId: string, body: Record<string, any>) =>
        apiFetch(`/api/dashboards/${dashboardId}/widgets`, {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    updateWidget: (dashboardId: string, widgetId: string, body: Record<string, any>) =>
        apiFetch(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        }),

    deleteWidget: (dashboardId: string, widgetId: string) =>
        apiFetch(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, { method: 'DELETE' }),

    // Global Filters
    addGlobalFilter: (dashboardId: string, body: Record<string, any>) =>
        apiFetch(`/api/dashboards/${dashboardId}/global-filters`, {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    removeGlobalFilter: (dashboardId: string, filterId: string) =>
        apiFetch(`/api/dashboards/${dashboardId}/global-filters/${filterId}`, { method: 'DELETE' }),
};

// ==========================================
// Folders API
// ==========================================

export const foldersApi = {
    list: () => apiFetch('/api/folders'),

    create: (body: { name: string; parentId?: string; icon?: string; color?: string }) =>
        apiFetch('/api/folders', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    update: (id: string, body: Record<string, any>) =>
        apiFetch(`/api/folders/${id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        }),

    delete: (id: string) =>
        apiFetch(`/api/folders/${id}`, { method: 'DELETE' }),
};

// ==========================================
// Sessions (Ask AI / Reports) API
// ==========================================

export const sessionsApi = {
    list: () => apiFetch('/api/sessions'),

    create: (body: { title: string }) =>
        apiFetch('/api/sessions', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    get: (id: string) => apiFetch(`/api/sessions/${id}`),

    update: (id: string, body: { title: string }) =>
        apiFetch(`/api/sessions/${id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
        }),

    delete: (id: string) =>
        apiFetch(`/api/sessions/${id}`, { method: 'DELETE' }),

    getMessages: (sessionId: string) =>
        apiFetch(`/api/sessions/${sessionId}/messages`),

    addMessage: (sessionId: string, body: {
        role: string;
        content: string;
        visualData?: any;
        sqlTrace?: string;
        executionTime?: number;
    }) =>
        apiFetch(`/api/sessions/${sessionId}/messages`, {
            method: 'POST',
            body: JSON.stringify(body),
        }),
};
