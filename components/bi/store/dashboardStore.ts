// ============================================
// Dashboard Store - Zustand State Management
// ============================================

import { create } from 'zustand';
import { BIDashboard, BIFolder, BIWidget, GlobalFilter, DashboardPage, SharePermission } from '../types';
import { API_BASE } from '../../../services/api';
import { isUUID } from '../../../utils/id';

interface DashboardState {
    // Data
    folders: BIFolder[];
    dashboards: BIDashboard[];
    activeDashboardId: string | null;
    editingWidgetId: string | null;
    selectedWidgetIds: string[];
    clipboard: BIWidget[];
    domain: string | null;
    autoReloadInterval: number | string; // in minutes or cron expression, 0/'Off' means off
    autoReloadSchedule: string[]; // ['08:00', '17:00']
    lastReloadTimestamp: number | null;
    isHydrated: boolean;

    // History for undo/redo
    history: BIDashboard[][];
    historyIndex: number;

    // Actions
    setActiveDashboard: (id: string | null) => void;
    setEditingWidget: (id: string | null) => void;
    selectWidget: (id: string, multi?: boolean) => void;
    setAutoReloadInterval: (interval: number | string, schedule?: string[]) => void;
    setLastReloadTimestamp: (timestamp: number) => void;
    clearSelection: () => void;
    groupWidgets: () => void;
    ungroupWidgets: () => void;
    alignWidgets: (direction: 'top' | 'bottom' | 'left' | 'right') => void;

    // Folder actions
    createFolder: (name: string, parentId?: string, createdBy?: string) => void;
    updateFolder: (id: string, updates: Partial<BIFolder>) => void;
    deleteFolder: (id: string) => void;
    shareFolder: (id: string, permissions: SharePermission[]) => void;

    // Dashboard actions
    createDashboard: (dashboard: Omit<BIDashboard, 'id' | 'createdAt' | 'updatedAt' | 'pages' | 'activePageId'>) => void;
    updateDashboard: (id: string, updates: Partial<BIDashboard>) => void;
    deleteDashboard: (id: string) => void;
    shareDashboard: (id: string, permissions: SharePermission[]) => void;
    duplicateDashboard: (id: string) => void;

    // Widget actions
    addWidget: (dashboardId: string, widget: Omit<BIWidget, 'id'>) => void;
    updateWidget: (dashboardId: string, widgetId: string, updates: Partial<BIWidget>) => void;
    deleteWidget: (dashboardId: string, widgetId: string) => void;
    duplicateWidget: (dashboardId: string, widgetId: string) => void;
    copySelectedWidgets: () => void;
    pasteWidgets: () => void;

    // Page actions
    addPage: (dashboardId: string, title?: string) => void;
    updatePage: (dashboardId: string, pageId: string, updates: Partial<DashboardPage>) => void;
    deletePage: (dashboardId: string, pageId: string) => void;
    duplicatePage: (dashboardId: string, pageId: string) => void;
    setActivePage: (dashboardId: string, pageId: string) => void;

    // Global filter actions
    addGlobalFilter: (dashboardId: string, filter: GlobalFilter) => void;
    removeGlobalFilter: (dashboardId: string, filterId: string) => void;
    syncDashboardDataSource: (dashboardId: string, dataSourceId: string, dataSourceName?: string, dataSourcePipelineName?: string) => void;
    syncPageDataSource: (dashboardId: string, pageId: string, dataSourceId: string, dataSourceName?: string, dataSourcePipelineName?: string) => void;
    selectAll: () => void;

    // History actions
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;

    // Utility
    getActiveDashboard: () => BIDashboard | undefined;
    getEditingWidget: () => BIWidget | undefined;
    loadFromStorage: (domain: string) => void;
    setDomain: (domain: string) => void;
    clearAll: () => void;
}

const getStorageKey = (domain: string | null) => domain ? `${domain}_bi_dashboard_data` : 'bi_dashboard_data';

const normalizeSharePermission = (value: unknown): SharePermission['permission'] => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'admin' || raw === 'owner') return 'admin';
    if (raw === 'edit' || raw === 'editor' || raw === 'write') return 'edit';
    return 'view';
};

const sanitizeSharePermissions = (permissions: any): SharePermission[] => {
    if (!Array.isArray(permissions)) return [];
    const dedup = new Map<string, SharePermission>();

    permissions.forEach((item) => {
        const targetType = String(item?.targetType || '').trim().toLowerCase() === 'group' ? 'group' : 'user';
        const fallbackTargetId = targetType === 'group' ? item?.groupId : item?.userId;
        const targetId = String(item?.targetId || fallbackTargetId || '').trim();
        if (!targetId) return;
        const key = `${targetType}:${targetId.toLowerCase()}`;
        const allowedPageIds = Array.isArray(item?.allowedPageIds)
            ? Array.from(new Set(item.allowedPageIds.map((id: any) => String(id || '').trim()).filter(Boolean)))
            : undefined;
        const rls = item?.rls && typeof item.rls === 'object' ? item.rls : undefined;
        dedup.set(key, {
            targetType,
            targetId,
            userId: targetType === 'user' ? targetId : undefined,
            groupId: targetType === 'group' ? targetId : undefined,
            permission: normalizeSharePermission(item?.permission),
            sharedAt: item?.sharedAt || new Date().toISOString(),
            allowedPageIds,
            rls,
        });
    });

    return Array.from(dedup.values());
};

const sanitizeFolder = (folder: BIFolder): BIFolder => ({
    ...folder,
    sharedWith: sanitizeSharePermissions(folder?.sharedWith),
});

const ensureDashboardPages = (dashboard: BIDashboard): BIDashboard => {
    const pages = Array.isArray(dashboard?.pages) ? dashboard.pages : [];
    if (pages.length === 0) {
        const pageId = `pg-default-${dashboard.id}`;
        const fallbackWidgets = Array.isArray(dashboard?.widgets) ? dashboard.widgets : [];
        return {
            ...dashboard,
            pages: [{ id: pageId, title: 'Page 1', widgets: fallbackWidgets }],
            activePageId: pageId,
            widgets: fallbackWidgets
        };
    }

    const activePageId = pages.some((p) => p.id === dashboard.activePageId)
        ? dashboard.activePageId
        : pages[0].id;
    const activeWidgets = pages.find((p) => p.id === activePageId)?.widgets || [];

    return {
        ...dashboard,
        pages,
        activePageId,
        widgets: activeWidgets
    };
};

const sanitizeDashboard = (dashboard: BIDashboard): BIDashboard => ({
    ...ensureDashboardPages(dashboard),
    sharedWith: sanitizeSharePermissions(dashboard?.sharedWith),
});

const toTimestamp = (value: unknown): number => {
    if (!value) return 0;
    const ts = Date.parse(String(value));
    return Number.isFinite(ts) ? ts : 0;
};

const mergeDashboardsPreferNewestLocal = (
    localDashboards: BIDashboard[],
    remoteDashboards: BIDashboard[]
): BIDashboard[] => {
    const localById = new Map(localDashboards.map((dashboard) => [dashboard.id, dashboard]));
    const remoteById = new Map(remoteDashboards.map((dashboard) => [dashboard.id, dashboard]));

    const merged = remoteDashboards.map((remoteDashboard) => {
        const localDashboard = localById.get(remoteDashboard.id);
        if (!localDashboard) return remoteDashboard;

        const localUpdatedAt = toTimestamp(localDashboard.updatedAt);
        const remoteUpdatedAt = toTimestamp(remoteDashboard.updatedAt);

        if (localUpdatedAt > remoteUpdatedAt) {
            return sanitizeDashboard(localDashboard);
        }

        return remoteDashboard;
    });

    // Keep local dashboards that are not on backend yet (e.g. optimistic/local-only edits).
    localDashboards.forEach((localDashboard) => {
        if (!remoteById.has(localDashboard.id)) {
            merged.push(sanitizeDashboard(localDashboard));
        }
    });

    return merged;
};

const GRID_COLUMNS = 12;

type WidgetLayoutBox = Pick<BIWidget, 'x' | 'y' | 'w' | 'h'>;

const normalizeSpan = (value: number | undefined, min = 1, max = GRID_COLUMNS): number => {
    const fallback = min;
    const numeric = Number.isFinite(value as number) ? Math.round(value as number) : fallback;
    return Math.max(min, Math.min(max, numeric));
};

const normalizeWidgetBox = (widget: Partial<WidgetLayoutBox>): WidgetLayoutBox => ({
    x: Math.max(0, normalizeSpan(widget.x, 0, GRID_COLUMNS - 1)),
    y: Math.max(0, normalizeSpan(widget.y, 0, Number.MAX_SAFE_INTEGER)),
    w: normalizeSpan(widget.w, 1, GRID_COLUMNS),
    h: normalizeSpan(widget.h, 1, Number.MAX_SAFE_INTEGER),
});

const boxesCollide = (a: WidgetLayoutBox, b: WidgetLayoutBox): boolean => {
    return (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
    );
};

const isAreaFree = (
    x: number,
    y: number,
    w: number,
    h: number,
    occupied: WidgetLayoutBox[]
): boolean => {
    const candidate: WidgetLayoutBox = { x, y, w, h };
    return occupied.every((box) => !boxesCollide(candidate, box));
};

const findNextFlowPosition = (
    existingWidgets: BIWidget[],
    targetWidth: number,
    targetHeight: number
): { x: number; y: number } => {
    const occupied = existingWidgets
        .filter((widget) => !widget.isGlobalFilter)
        .map((widget) => normalizeWidgetBox(widget));

    const maxBottom = occupied.reduce((max, box) => Math.max(max, box.y + box.h), 0);
    const scanMaxY = Math.max(maxBottom + targetHeight + 50, targetHeight + 1);
    const maxX = Math.max(0, GRID_COLUMNS - targetWidth);

    for (let y = 0; y <= scanMaxY; y++) {
        for (let x = 0; x <= maxX; x++) {
            if (isAreaFree(x, y, targetWidth, targetHeight, occupied)) {
                return { x, y };
            }
        }
    }

    return { x: 0, y: maxBottom };
};

const saveToStorage = (state: DashboardState) => {
    if (!state.isHydrated || !state.domain) {
        // console.warn('Sync skipped: Store not hydrated or domain missing');
        return;
    }

    try {
        const storageKey = getStorageKey(state.domain);

        // Safety check: don't save empty state if we previously had data
        // This is a last-resort guard against race conditions
        if (state.dashboards.length === 0 && state.folders.length === 0) {
            const existing = localStorage.getItem(storageKey);
            if (existing) {
                const parsed = JSON.parse(existing);
                if (parsed.dashboards?.length > 0 || parsed.folders?.length > 0) {
                    console.warn('⚠️ Prevented overwriting non-empty storage with empty state');
                    return;
                }
            }
        }

        localStorage.setItem(storageKey, JSON.stringify({
            folders: state.folders,
            dashboards: state.dashboards,
            activeDashboardId: state.activeDashboardId,
            autoReloadInterval: state.autoReloadInterval,
            autoReloadSchedule: state.autoReloadSchedule,
            lastReloadTimestamp: state.lastReloadTimestamp
        }));
    } catch (e) {
        if (e instanceof Error && e.name === 'QuotaExceededError') {
            console.error('🛑 LocalStorage quota exceeded for Dashboards');
        } else {
            console.error('Failed to save dashboard data', e);
        }
    }
};

const widgetAutosaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const widgetAutosaveControllers = new Map<string, AbortController>();

const scheduleWidgetAutosave = (dashboardId: string, getState: () => DashboardState) => {
    const existingTimer = widgetAutosaveTimers.get(dashboardId);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
        widgetAutosaveTimers.delete(dashboardId);

        const token = localStorage.getItem('auth_token');
        if (!token || !isUUID(dashboardId)) return;

        const dashboard = getState().dashboards.find((d) => d.id === dashboardId);
        if (!dashboard) return;

        const previousController = widgetAutosaveControllers.get(dashboardId);
        if (previousController) {
            previousController.abort();
        }

        const controller = new AbortController();
        widgetAutosaveControllers.set(dashboardId, controller);

        fetch(`${API_BASE}/dashboards/${dashboardId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            signal: controller.signal,
            body: JSON.stringify({
                pages: dashboard.pages || [],
                widgets: dashboard.widgets || [],
                activePageId: dashboard.activePageId
            })
        })
            .catch((err) => {
                if (err?.name !== 'AbortError') {
                    console.error('Failed to auto-save widget state', err);
                }
            })
            .finally(() => {
                if (widgetAutosaveControllers.get(dashboardId) === controller) {
                    widgetAutosaveControllers.delete(dashboardId);
                }
            });
    }, 180);

    widgetAutosaveTimers.set(dashboardId, timer);
};

export const useDashboardStore = create<DashboardState>((set, get) => ({
    // Initial state
    folders: [],
    dashboards: [],
    activeDashboardId: null,
    editingWidgetId: null,
    selectedWidgetIds: [],
    clipboard: [],
    history: [],
    historyIndex: -1,
    domain: null,
    autoReloadInterval: 0,
    autoReloadSchedule: [],
    lastReloadTimestamp: null,
    isHydrated: false,

    // Setters
    setDomain: (domain) => set({ domain }),

    setAutoReloadInterval: (interval: number | string, schedule?: string[]) => {
        set((state) => ({
            autoReloadInterval: interval,
            autoReloadSchedule: schedule || state.autoReloadSchedule
        }));
        saveToStorage(get());
    },

    setLastReloadTimestamp: (timestamp: number) => {
        set({ lastReloadTimestamp: timestamp });
        saveToStorage(get());
    },

    setActiveDashboard: (id) => {
        set({ activeDashboardId: id, editingWidgetId: null, selectedWidgetIds: [] });
        saveToStorage(get());
    },

    setEditingWidget: (id) => set({ editingWidgetId: id, selectedWidgetIds: id ? [id] : [] }),

    selectWidget: (id, multi = false) => set((state) => {
        const dashboard = state.dashboards.find(d => d.id === state.activeDashboardId);
        if (!dashboard) return state;

        const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
        const widgets = activePage ? activePage.widgets : (dashboard.widgets || []);
        const widget = widgets.find(w => w.id === id);

        let idsToSelect = [id];
        if (widget?.groupId) {
            const groupMembers = widgets.filter(w => w.groupId === widget.groupId);
            idsToSelect = groupMembers.map(w => w.id);
        }

        let newSelected = [...state.selectedWidgetIds];

        if (multi) {
            const allSelected = idsToSelect.every(wid => newSelected.includes(wid));
            if (allSelected) {
                newSelected = newSelected.filter(wid => !idsToSelect.includes(wid));
            } else {
                newSelected = [...new Set([...newSelected, ...idsToSelect])];
            }
        } else {
            newSelected = idsToSelect;
        }

        return {
            selectedWidgetIds: newSelected,
            editingWidgetId: newSelected.includes(id) ? id : (newSelected.length > 0 ? newSelected[newSelected.length - 1] : null)
        };
    }),

    clearSelection: () => {
        set({ selectedWidgetIds: [], editingWidgetId: null });
        saveToStorage(get());
    },

    groupWidgets: () => {
        set((state) => {
            const { activeDashboardId, selectedWidgetIds } = state;
            if (!activeDashboardId || selectedWidgetIds.length < 2) return state;

            const groupId = `g-${Date.now()}`;
            return {
                dashboards: state.dashboards.map(d => {
                    if (d.id === activeDashboardId) {
                        if (d.pages && d.pages.length > 0) {
                            const updatedPages = d.pages.map(p =>
                                p.id === d.activePageId
                                    ? {
                                        ...p,
                                        widgets: p.widgets.map(w =>
                                            selectedWidgetIds.includes(w.id) ? { ...w, groupId } : w
                                        )
                                    }
                                    : p
                            );
                            const activeWidgets = updatedPages.find(page => page.id === d.activePageId)?.widgets || [];
                            return { ...d, pages: updatedPages, widgets: activeWidgets, updatedAt: new Date().toISOString() };
                        } else {
                            const updatedWidgets = (d.widgets || []).map(w => selectedWidgetIds.includes(w.id) ? { ...w, groupId } : w);
                            return { ...d, widgets: updatedWidgets, updatedAt: new Date().toISOString() };
                        }
                    }
                    return d;
                })
            };
        });
        saveToStorage(get());
    },

    alignWidgets: (direction) => {
        set((state) => {
            const { activeDashboardId, selectedWidgetIds } = state;
            if (!activeDashboardId || selectedWidgetIds.length < 2) return state;

            const dashboard = state.dashboards.find(d => d.id === activeDashboardId);
            if (!dashboard) return state;

            const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
            const currentWidgets = activePage ? activePage.widgets : (dashboard.widgets || []);
            const selectedWidgets = currentWidgets.filter(w => selectedWidgetIds.includes(w.id));

            const updatedWidgets = [...currentWidgets];
            if (direction === 'top') {
                const minY = Math.min(...selectedWidgets.map(w => w.y));
                updatedWidgets.forEach((w, i) => { if (selectedWidgetIds.includes(w.id)) updatedWidgets[i] = { ...w, y: minY }; });
            } else if (direction === 'bottom') {
                const maxY = Math.max(...selectedWidgets.map(w => w.y + w.h));
                updatedWidgets.forEach((w, i) => { if (selectedWidgetIds.includes(w.id)) updatedWidgets[i] = { ...w, y: maxY - w.h }; });
            } else if (direction === 'left') {
                const minX = Math.min(...selectedWidgets.map(w => w.x));
                updatedWidgets.forEach((w, i) => { if (selectedWidgetIds.includes(w.id)) updatedWidgets[i] = { ...w, x: minX }; });
            } else if (direction === 'right') {
                const maxX = Math.max(...selectedWidgets.map(w => w.x + w.w));
                updatedWidgets.forEach((w, i) => { if (selectedWidgetIds.includes(w.id)) updatedWidgets[i] = { ...w, x: maxX - w.w }; });
            }

            return {
                dashboards: state.dashboards.map(d => {
                    if (d.id === activeDashboardId) {
                        if (d.pages && d.pages.length > 0) {
                            const updatedPages = d.pages.map(p => p.id === d.activePageId ? { ...p, widgets: updatedWidgets } : p);
                            return { ...d, pages: updatedPages, widgets: updatedWidgets, updatedAt: new Date().toISOString() };
                        } else {
                            return { ...d, widgets: updatedWidgets, updatedAt: new Date().toISOString() };
                        }
                    }
                    return d;
                })
            };
        });
        saveToStorage(get());
    },

    ungroupWidgets: () => {
        set((state) => {
            const { activeDashboardId, selectedWidgetIds } = state;
            if (!activeDashboardId || selectedWidgetIds.length === 0) return state;

            const dashboard = state.dashboards.find(d => d.id === activeDashboardId);
            if (!dashboard) return state;

            const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
            const currentWidgets = activePage ? activePage.widgets : (dashboard.widgets || []);

            const groupIdsToDissolve = new Set<string>();
            selectedWidgetIds.forEach(id => {
                const w = currentWidgets.find(widget => widget.id === id);
                if (w?.groupId) groupIdsToDissolve.add(w.groupId);
            });

            if (groupIdsToDissolve.size === 0) return state;

            const updatedWidgets = currentWidgets.map(w =>
                w.groupId && groupIdsToDissolve.has(w.groupId) ? { ...w, groupId: undefined } : w
            );

            return {
                dashboards: state.dashboards.map(d => {
                    if (d.id === activeDashboardId) {
                        if (d.pages && d.pages.length > 0) {
                            const updatedPages = d.pages.map(p => p.id === d.activePageId ? { ...p, widgets: updatedWidgets } : p);
                            return { ...d, pages: updatedPages, widgets: updatedWidgets, updatedAt: new Date().toISOString() };
                        } else {
                            return { ...d, widgets: updatedWidgets, updatedAt: new Date().toISOString() };
                        }
                    }
                    return d;
                })
            };
        });
        saveToStorage(get());
    },

    createFolder: (name, parentId, createdBy) => {
        const tempId = `f-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        set((state) => ({
            folders: [
                ...state.folders,
                {
                    id: tempId,
                    name,
                    parentId,
                    createdAt: new Date().toISOString(),
                    createdBy: createdBy || 'current-user',
                    sharedWith: createdBy ? [{
                        userId: createdBy,
                        permission: 'admin',
                        sharedAt: new Date().toISOString()
                    }] : []
                }
            ]
        }));

        // Sync to Backend
        const token = localStorage.getItem('auth_token');
        if (token) {
            fetch(`${API_BASE}/folders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name, parentId })
            })
                .then(res => res.json())
                .then(resData => {
                    if (resData.success) {
                        set((state) => ({
                            folders: state.folders.map(f => f.id === tempId ? resData.data : f)
                        }));
                    }
                }).catch(console.error);
        }
        saveToStorage(get());
    },

    updateFolder: (id, updates) => {
        set((state) => ({
            folders: state.folders.map(f => f.id === id ? { ...f, ...updates } : f)
        }));
        // Sync to Backend
        const token = localStorage.getItem('auth_token');
        if (token) {
            fetch(`${API_BASE}/folders/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(updates)
            }).catch(console.error);
        }
        saveToStorage(get());
    },

    deleteFolder: (id) => {
        set((state) => {
            const getAllChildFolderIds = (parentId: string): string[] => {
                const children = state.folders.filter(f => f.parentId === parentId);
                let ids = children.map(c => c.id);
                children.forEach(c => {
                    ids = [...ids, ...getAllChildFolderIds(c.id)];
                });
                return ids;
            };
            const folderIdsToDelete = [id, ...getAllChildFolderIds(id)];
            return {
                folders: state.folders.filter(f => !folderIdsToDelete.includes(f.id)),
                dashboards: state.dashboards.map(d =>
                    folderIdsToDelete.includes(d.folderId || '') ? { ...d, folderId: undefined } : d
                )
            };
        });
        // Sync to Backend (cascade deletes children via FK)
        const token = localStorage.getItem('auth_token');
        if (token) {
            fetch(`${API_BASE}/folders/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(console.error);
        }
        saveToStorage(get());
    },

    shareFolder: (id, permissions) => {
        const normalizedPermissions = sanitizeSharePermissions(permissions);
        const prevFolders = get().folders;
        set((state) => ({
            folders: state.folders.map(f => f.id === id ? { ...f, sharedWith: normalizedPermissions } : f)
        }));
        // Sync to Backend
        const token = localStorage.getItem('auth_token');
        if (token) {
            fetch(`${API_BASE}/folders/${id}/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ permissions: normalizedPermissions })
            })
                .then(async (res) => {
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || data?.success === false) {
                        throw new Error(data?.message || 'Failed to share folder');
                    }
                })
                .catch((err) => {
                    console.error(err);
                    set({ folders: prevFolders });
                    alert(err?.message || 'Failed to share folder');
                });
        }
        saveToStorage(get());
    },

    createDashboard: (dashboard) => {
        const pageId = `pg-${Date.now()}`;
        const newDashboard: BIDashboard = {
            ...dashboard,
            enableCrossFilter: dashboard.enableCrossFilter ?? true,
            id: `d-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            widgets: [],
            pages: [{ id: pageId, title: 'Page 1', widgets: [] }],
            activePageId: pageId,
            sharedWith: dashboard.createdBy ? [{
                userId: dashboard.createdBy,
                permission: 'admin',
                sharedAt: new Date().toISOString()
            }] : []
        };
        const token = localStorage.getItem('auth_token');
        if (!token) {
            alert('Bạn cần đăng nhập để tạo dashboard và lưu lên server.');
            return;
        }

        set((state) => ({
            dashboards: [...state.dashboards, newDashboard],
            activeDashboardId: newDashboard.id
        }));

        // Sync to Backend
        fetch(`${API_BASE}/dashboards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                title: dashboard.title,
                description: dashboard.description,
                folderId: dashboard.folderId,
                dataSourceId: dashboard.dataSourceId,
                dataSourceName: dashboard.dataSourceName
            })
        })
            .then(async (res) => {
                const payload = await res.json().catch(() => ({}));
                if (!res.ok || !payload?.success || !payload?.data?.id) {
                    throw new Error(payload?.message || `Failed to create dashboard (${res.status})`);
                }

                // Update with real backend data (including real ID)
                set((state) => ({
                    dashboards: state.dashboards.map(d => d.id === newDashboard.id ? payload.data : d),
                    activeDashboardId: state.activeDashboardId === newDashboard.id ? payload.data.id : state.activeDashboardId
                }));
                saveToStorage(get());
            })
            .catch((err) => {
                console.error('Failed to create dashboard on backend:', err);
                set((state) => {
                    const remaining = state.dashboards.filter((d) => d.id !== newDashboard.id);
                    const nextActive = state.activeDashboardId === newDashboard.id
                        ? (remaining[0]?.id || null)
                        : state.activeDashboardId;
                    return {
                        dashboards: remaining,
                        activeDashboardId: nextActive
                    };
                });
                alert(err?.message || 'Không thể tạo dashboard trên server.');
                saveToStorage(get());
            });
        saveToStorage(get());
    },

    updateDashboard: (id, updates) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === id ? { ...d, ...updates, updatedAt: new Date().toISOString() } : d
            )
        }));
        // Sync to Backend
        const token = localStorage.getItem('auth_token');
        if (token && isUUID(id)) {
            fetch(`${API_BASE}/dashboards/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(updates)
            }).catch(console.error);
        }
        saveToStorage(get());
    },

    deleteDashboard: (id) => {
        set((state) => {
            const newDashboards = state.dashboards.filter(d => d.id !== id);
            const newActiveId = state.activeDashboardId === id ? null : state.activeDashboardId;
            return {
                dashboards: newDashboards,
                activeDashboardId: newActiveId
            };
        });
        // Sync to Backend
        const token = localStorage.getItem('auth_token');
        if (token && isUUID(id)) {
            fetch(`${API_BASE}/dashboards/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(console.error);
        }
        saveToStorage(get());
    },

    shareDashboard: (id, permissions) => {
        const normalizedPermissions = sanitizeSharePermissions(permissions);
        const prevDashboards = get().dashboards;
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === id ? { ...d, sharedWith: normalizedPermissions, updatedAt: new Date().toISOString() } : d
            )
        }));
        // Sync to Backend
        const token = localStorage.getItem('auth_token');
        if (token && isUUID(id)) {
            fetch(`${API_BASE}/dashboards/${id}/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ permissions: normalizedPermissions })
            })
                .then(async (res) => {
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || data?.success === false) {
                        throw new Error(data?.message || 'Failed to share dashboard');
                    }
                })
                .catch((err) => {
                    console.error(err);
                    set({ dashboards: prevDashboards });
                    alert(err?.message || 'Failed to share dashboard');
                });
        }
        saveToStorage(get());
    },

    duplicateDashboard: (id) => {
        const state = get();
        const original = state.dashboards.find(d => d.id === id);
        if (!original) return;
        const token = localStorage.getItem('auth_token');
        if (!token) {
            alert('Bạn cần đăng nhập để nhân bản dashboard.');
            return;
        }

        const suffix = Math.random().toString(36).substring(2, 8);
        const originalPages = original.pages && original.pages.length > 0
            ? original.pages
            : [{ id: `pg-default-${original.id}`, title: 'Page 1', widgets: original.widgets || [] }];

        const pageIdMap = new Map<string, string>();
        const timestampBase = Date.now();

        const duplicatedPages: DashboardPage[] = originalPages.map((page, pageIdx) => {
            const nextPageId = `pg-${timestampBase}-${pageIdx}-${Math.random().toString(36).substring(2, 7)}`;
            pageIdMap.set(page.id, nextPageId);

            const duplicatedWidgets = (page.widgets || []).map((widget, widgetIdx) => {
                const nextWidgetId = `w-${timestampBase}-${pageIdx}-${widgetIdx}-${Math.random().toString(36).substring(2, 8)}`;
                return {
                    ...widget,
                    id: nextWidgetId
                };
            });

            return {
                ...page,
                id: nextPageId,
                widgets: duplicatedWidgets
            };
        });

        const duplicatedActivePageId = pageIdMap.get(original.activePageId || '') || duplicatedPages[0]?.id || '';
        const duplicatedActiveWidgets = duplicatedPages.find((page) => page.id === duplicatedActivePageId)?.widgets || [];

        fetch(`${API_BASE}/dashboards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                title: `${original.title} (Copy)`,
                description: original.description,
                folderId: original.folderId,
                dataSourceId: original.dataSourceId,
                dataSourceName: original.dataSourceName,
                enableCrossFilter: original.enableCrossFilter ?? true,
                pages: duplicatedPages,
                widgets: duplicatedActiveWidgets,
                activePageId: duplicatedActivePageId,
            })
        })
            .then(async (res) => {
                const payload = await res.json().catch(() => ({}));
                if (!res.ok || !payload?.success || !payload?.data?.id) {
                    throw new Error(payload?.message || `Failed to duplicate dashboard (${res.status})`);
                }

                const duplicatedDashboard: BIDashboard = {
                    ...payload.data,
                    globalFilters: Array.isArray(original.globalFilters) ? original.globalFilters : [],
                    calculatedFields: Array.isArray(original.calculatedFields) ? original.calculatedFields : [],
                    quickMeasures: Array.isArray(original.quickMeasures) ? original.quickMeasures : [],
                    layout: original.layout || {},
                    theme: original.theme || {},
                };

                set((current) => ({
                    dashboards: [...current.dashboards, duplicatedDashboard],
                    activeDashboardId: duplicatedDashboard.id
                }));
                saveToStorage(get());

                // Persist the remaining dashboard-level settings that are not part of POST /dashboards payload.
                fetch(`${API_BASE}/dashboards/${payload.data.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({
                        globalFilters: duplicatedDashboard.globalFilters,
                        calculatedFields: duplicatedDashboard.calculatedFields,
                        quickMeasures: duplicatedDashboard.quickMeasures,
                        layout: duplicatedDashboard.layout,
                        theme: duplicatedDashboard.theme,
                    })
                }).catch((persistErr) => {
                    console.error('Failed to persist duplicated dashboard settings:', persistErr);
                });
            })
            .catch((err) => {
                console.error('Failed to duplicate dashboard:', err);
                alert(err?.message || 'Không thể nhân bản dashboard.');
            });
    },

    addWidget: (dashboardId, widget) => {
        const baseWidget: BIWidget = {
            enableCrossFilter: true,
            showLegend: true,
            legendPosition: 'bottom',
            showGrid: true,
            showLabels: false,
            ...widget,
            id: `w-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
        };
        set((state) => ({
            dashboards: state.dashboards.map(d => {
                if (d.id === dashboardId) {
                    const activePage = (d.pages || []).find(p => p.id === d.activePageId);
                    const pageDataSourceId = activePage?.dataSourceId;
                    const currentWidgets = activePage ? activePage.widgets : (d.widgets || []);

                    const normalizedWidth = normalizeSpan(baseWidget.w, 1, GRID_COLUMNS);
                    const normalizedHeight = normalizeSpan(baseWidget.h, 1, Number.MAX_SAFE_INTEGER);
                    const hasFiniteX = Number.isFinite(baseWidget.x);
                    const hasFiniteY = Number.isFinite(baseWidget.y);
                    const shouldAutoPlace =
                        !hasFiniteX ||
                        !hasFiniteY ||
                        baseWidget.y === Infinity ||
                        baseWidget.x < 0 ||
                        baseWidget.y < 0 ||
                        baseWidget.x + normalizedWidth > GRID_COLUMNS;

                    const positionedWidget = (() => {
                        if (shouldAutoPlace) {
                            const nextPos = findNextFlowPosition(currentWidgets, normalizedWidth, normalizedHeight);
                            return {
                                ...baseWidget,
                                x: nextPos.x,
                                y: nextPos.y,
                                w: normalizedWidth,
                                h: normalizedHeight
                            };
                        }

                        return {
                            ...baseWidget,
                            x: Math.max(0, Math.min(GRID_COLUMNS - normalizedWidth, Math.round(baseWidget.x))),
                            y: Math.max(0, Math.round(baseWidget.y)),
                            w: normalizedWidth,
                            h: normalizedHeight
                        };
                    })();

                    const widgetWithDS = {
                        ...positionedWidget,
                        dataSourceId: positionedWidget.dataSourceId || pageDataSourceId || d.dataSourceId
                    };

                    if (d.pages && d.pages.length > 0) {
                        const updatedPages = d.pages.map(p =>
                            p.id === d.activePageId ? { ...p, widgets: [...p.widgets, widgetWithDS] } : p
                        );
                        return { ...d, pages: updatedPages, widgets: updatedPages.find(page => page.id === d.activePageId)?.widgets || [], updatedAt: new Date().toISOString() };
                    } else {
                        return { ...d, widgets: [...(d.widgets || []), widgetWithDS], updatedAt: new Date().toISOString() };
                    }
                }
                return d;
            }),
            editingWidgetId: baseWidget.id
        }));
        saveToStorage(get());
    },

    updateWidget: (dashboardId, widgetId, updates) => {
        set((state) => ({
            dashboards: state.dashboards.map(d => {
                if (d.id === dashboardId) {
                    if (d.pages && d.pages.length > 0) {
                        const updatedPages = d.pages.map(p => ({
                            ...p,
                            widgets: p.widgets.map(w => w.id === widgetId ? { ...w, ...updates } : w)
                        }));
                        return { ...d, pages: updatedPages, widgets: updatedPages.find(page => page.id === d.activePageId)?.widgets || [], updatedAt: new Date().toISOString() };
                    } else {
                        return { ...d, widgets: (d.widgets || []).map(w => w.id === widgetId ? { ...w, ...updates } : w), updatedAt: new Date().toISOString() };
                    }
                }
                return d;
            })
        }));
        saveToStorage(get());
        scheduleWidgetAutosave(dashboardId, get);
    },

    deleteWidget: (dashboardId, widgetId) => {
        set((state) => ({
            dashboards: state.dashboards.map(d => {
                if (d.id === dashboardId) {
                    if (d.pages && d.pages.length > 0) {
                        const updatedPages = d.pages.map(p => ({
                            ...p,
                            widgets: p.widgets.filter(w => w.id !== widgetId)
                        }));
                        return { ...d, pages: updatedPages, widgets: updatedPages.find(page => page.id === d.activePageId)?.widgets || [], updatedAt: new Date().toISOString() };
                    } else {
                        return { ...d, widgets: (d.widgets || []).filter(w => w.id !== widgetId), updatedAt: new Date().toISOString() };
                    }
                }
                return d;
            }),
            editingWidgetId: state.editingWidgetId === widgetId ? null : state.editingWidgetId
        }));
        saveToStorage(get());
    },

    duplicateWidget: (dashboardId, widgetId) => {
        const state = get();
        const dashboard = state.dashboards.find(d => d.id === dashboardId);
        if (!dashboard) return;

        const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
        const currentWidgets = activePage ? activePage.widgets : (dashboard.widgets || []);
        const widget = currentWidgets.find(w => w.id === widgetId);
        if (!widget) return;

        const duplicate: BIWidget = {
            ...widget,
            id: `w-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            x: widget.x + 1,
            y: widget.y + 1
        };

        set((state) => ({
            dashboards: state.dashboards.map(d => {
                if (d.id === dashboardId) {
                    if (d.pages && d.pages.length > 0) {
                        const updatedPages = d.pages.map(p => p.id === d.activePageId ? { ...p, widgets: [...currentWidgets, duplicate] } : p);
                        return { ...d, pages: updatedPages, widgets: updatedPages.find(page => page.id === d.activePageId)?.widgets || [], updatedAt: new Date().toISOString() };
                    } else {
                        return { ...d, widgets: [...currentWidgets, duplicate], updatedAt: new Date().toISOString() };
                    }
                }
                return d;
            }),
            selectedWidgetIds: [duplicate.id],
            editingWidgetId: duplicate.id
        }));
        saveToStorage(get());
    },

    copySelectedWidgets: () => {
        const state = get();
        const dashboard = state.dashboards.find(d => d.id === state.activeDashboardId);
        if (!dashboard || state.selectedWidgetIds.length === 0) return;
        const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
        const widgets = activePage ? activePage.widgets : (dashboard.widgets || []);

        const widgetsToCopy = widgets
            .filter(w => state.selectedWidgetIds.includes(w.id))
            .map(w => ({ ...w }));
        set({ clipboard: widgetsToCopy });
    },

    pasteWidgets: () => {
        const state = get();
        const { activeDashboardId, clipboard, dashboards } = state;
        if (!activeDashboardId || clipboard.length === 0) return;

        const timestamp = Date.now();
        const pastedWidgets: BIWidget[] = clipboard.map((w, idx) => ({
            ...w,
            id: `w-${timestamp}-${idx}-${Math.random().toString(36).substring(2, 7)}`,
            x: w.x + 1,
            y: w.y + 1,
            groupId: w.groupId ? `g-pasted-${timestamp}-${w.groupId}` : undefined
        }));

        set((state) => ({
            dashboards: dashboards.map(d => {
                if (d.id === activeDashboardId) {
                    if (d.pages && d.pages.length > 0) {
                        const updatedPages = d.pages.map(p =>
                            p.id === d.activePageId ? { ...p, widgets: [...p.widgets, ...pastedWidgets] } : p
                        );
                        return { ...d, pages: updatedPages, widgets: updatedPages.find(page => page.id === d.activePageId)?.widgets || [], updatedAt: new Date().toISOString() };
                    } else {
                        return { ...d, widgets: [...(d.widgets || []), ...pastedWidgets], updatedAt: new Date().toISOString() };
                    }
                }
                return d;
            }),
            selectedWidgetIds: pastedWidgets.map(w => w.id),
            editingWidgetId: pastedWidgets.length === 1 ? pastedWidgets[0].id : null
        }));
        saveToStorage(get());
    },

    addPage: (dashboardId, title = 'New Page') => {
        const pageId = `pg-${Date.now()}`;
        set((state) => ({
            dashboards: state.dashboards.map(d => {
                if (d.id === dashboardId) {
                    const newPage = { id: pageId, title, widgets: [], dataSourceId: d.dataSourceId };
                    const currentPages = d.pages || [];
                    return {
                        ...d,
                        pages: [...currentPages, newPage],
                        activePageId: pageId,
                        widgets: [],
                        updatedAt: new Date().toISOString()
                    };
                }
                return d;
            }),
            selectedWidgetIds: [],
            editingWidgetId: null
        }));
        saveToStorage(get());
    },

    updatePage: (dashboardId, pageId, updates) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === dashboardId ? { ...d, pages: (d.pages || []).map(p => p.id === pageId ? { ...p, ...updates } : p), updatedAt: new Date().toISOString() } : d
            )
        }));
        saveToStorage(get());
    },

    deletePage: (dashboardId, pageId) => {
        set((state) => ({
            dashboards: state.dashboards.map(d => {
                if (d.id === dashboardId && d.pages) {
                    const remainingPages = d.pages.filter(p => p.id !== pageId);
                    if (remainingPages.length === 0) return d;
                    const newActiveId = d.activePageId === pageId ? remainingPages[0].id : d.activePageId;
                    return {
                        ...d,
                        pages: remainingPages,
                        activePageId: newActiveId,
                        widgets: remainingPages.find(p => p.id === newActiveId)?.widgets || [],
                        updatedAt: new Date().toISOString()
                    };
                }
                return d;
            }),
            selectedWidgetIds: [],
            editingWidgetId: null
        }));
        saveToStorage(get());
    },

    duplicatePage: (dashboardId, pageId) => {
        const state = get();
        const dashboard = state.dashboards.find(d => d.id === dashboardId);
        if (!dashboard || !dashboard.pages) return;
        const page = dashboard.pages.find(p => p.id === pageId);
        if (!page) return;

        const newPageId = `pg-${Date.now()}`;
        const duplicatedPage: DashboardPage = {
            ...page,
            id: newPageId,
            title: `${page.title} (Copy)`,
            widgets: page.widgets.map(w => ({
                ...w,
                id: `w-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
            }))
        };

        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === dashboardId ? {
                    ...d,
                    pages: [...d.pages, duplicatedPage],
                    activePageId: newPageId,
                    widgets: duplicatedPage.widgets,
                    updatedAt: new Date().toISOString()
                } : d
            ),
            selectedWidgetIds: [],
            editingWidgetId: null
        }));
        saveToStorage(get());
    },

    setActivePage: (dashboardId, pageId) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === dashboardId ? { ...d, activePageId: pageId, widgets: (d.pages || []).find(p => p.id === pageId)?.widgets || [] } : d
            ),
            selectedWidgetIds: [],
            editingWidgetId: null
        }));
        saveToStorage(get());
    },

    addGlobalFilter: (dashboardId, filter) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === dashboardId ? { ...d, globalFilters: [...(d.globalFilters || []), filter], updatedAt: new Date().toISOString() } : d
            )
        }));
        saveToStorage(get());
    },

    removeGlobalFilter: (dashboardId, filterId) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === dashboardId ? { ...d, globalFilters: (d.globalFilters || []).filter(f => f.id !== filterId), updatedAt: new Date().toISOString() } : d
            )
        }));
        saveToStorage(get());
    },

    syncDashboardDataSource: (dashboardId, dataSourceId, dataSourceName, dataSourcePipelineName) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === dashboardId ? {
                    ...d,
                    dataSourceId,
                    dataSourceName,
                    pages: (d.pages || []).map(p => ({
                        ...p,
                        dataSourceId: p.dataSourceId || dataSourceId,
                        dataSourceName: p.dataSourceName || dataSourceName,
                        widgets: p.widgets.map(w => ({
                            ...w,
                            dataSourceId: w.dataSourceId || dataSourceId,
                            dataSourceName: w.dataSourceName || dataSourceName,
                            dataSourcePipelineName: w.dataSourcePipelineName || dataSourcePipelineName
                        }))
                    })),
                    widgets: (d.widgets || []).map(w => ({
                        ...w,
                        dataSourceId: w.dataSourceId || dataSourceId,
                        dataSourceName: w.dataSourceName || dataSourceName,
                        dataSourcePipelineName: w.dataSourcePipelineName || dataSourcePipelineName
                    })),
                    updatedAt: new Date().toISOString()
                } : d
            )
        }));
        saveToStorage(get());
    },

    syncPageDataSource: (dashboardId, pageId, dataSourceId, dataSourceName, dataSourcePipelineName) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === dashboardId ? {
                    ...d,
                    pages: (d.pages || []).map(p =>
                        p.id === pageId ? {
                            ...p,
                            dataSourceId,
                            dataSourceName,
                            widgets: p.widgets.map(w => ({ ...w, dataSourceId, dataSourceName, dataSourcePipelineName }))
                        } : p
                    ),
                    updatedAt: new Date().toISOString()
                } : d
            )
        }));
        saveToStorage(get());
    },

    undo: () => {
        const { history, historyIndex } = get();
        if (historyIndex > 0) {
            const newDashboards = history[historyIndex - 1];
            set({ dashboards: newDashboards, historyIndex: historyIndex - 1 });
            saveToStorage(get());
        }
    },

    redo: () => {
        const { history, historyIndex } = get();
        if (historyIndex < history.length - 1) {
            const newDashboards = history[historyIndex + 1];
            set({ dashboards: newDashboards, historyIndex: historyIndex + 1 });
            saveToStorage(get());
        }
    },

    canUndo: () => get().historyIndex > 0,
    canRedo: () => get().historyIndex < get().history.length - 1,

    getActiveDashboard: () => {
        const { dashboards, activeDashboardId } = get();
        return dashboards.find(d => d.id === activeDashboardId);
    },

    getEditingWidget: () => {
        const { dashboards, activeDashboardId, editingWidgetId } = get();
        const dashboard = dashboards.find(d => d.id === activeDashboardId);
        if (!dashboard) return undefined;
        const widgets = dashboard.pages && dashboard.pages.length > 0
            ? dashboard.pages.find(p => p.id === dashboard.activePageId)?.widgets
            : dashboard.widgets;
        return widgets?.find(w => w.id === editingWidgetId);
    },

    loadFromStorage: (domain) => {
        if (!domain) return;
        try {
            const storageKey = getStorageKey(domain);
            const data = localStorage.getItem(storageKey);
            const token = localStorage.getItem('auth_token');

            const syncFromBackend = (preferredActiveDashboardId: string | null) => {
                if (!token) return;
                Promise.all([
                    fetch(`${API_BASE}/folders`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json()),
                    fetch(`${API_BASE}/dashboards`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.json())
                ]).then(([folderRes, dashboardRes]) => {
                    if (folderRes.success && dashboardRes.success) {
                        const nextFolders = (folderRes.data || []).map(sanitizeFolder);
                        const nextDashboards = (dashboardRes.data || []).map(sanitizeDashboard);
                        set((state) => {
                            // Once backend sync succeeds, keep only UUID-backed locals to avoid ghost local-only dashboards.
                            const localDashboards = (state.dashboards || []).filter((dashboard) => isUUID(dashboard.id));
                            const mergedDashboards = mergeDashboardsPreferNewestLocal(localDashboards, nextDashboards);
                            const activeFromState = state.activeDashboardId;
                            const activeDashboardId = mergedDashboards.some((d) => d.id === activeFromState)
                                ? activeFromState
                                : (mergedDashboards.some((d) => d.id === preferredActiveDashboardId)
                                    ? preferredActiveDashboardId
                                    : (mergedDashboards[0]?.id || null));
                            return {
                                folders: nextFolders,
                                dashboards: mergedDashboards,
                                activeDashboardId,
                                history: [mergedDashboards],
                                historyIndex: 0,
                                isHydrated: true
                            };
                        });
                    }
                }).catch(console.error);
            };

            if (data) {
                const parsed = JSON.parse(data);
                const savedActiveDashboardId = parsed.activeDashboardId || null;

                let migratedDashboards = (parsed.dashboards || []) as BIDashboard[];
                migratedDashboards = migratedDashboards.map(d => {
                    if (!d.pages || d.pages.length === 0) {
                        const pageId = `pg-default-${d.id}`;
                        return {
                            ...d,
                            pages: [{ id: pageId, title: 'Page 1', widgets: d.widgets || [] }],
                            activePageId: pageId,
                            widgets: d.widgets || []
                        };
                    }
                    return d;
                }).map(sanitizeDashboard);
                const migratedFolders = (parsed.folders || []).map(sanitizeFolder);

                // Ensure activeDashboardId is valid, or pick the first one if one exists
                const activeDashboardId = migratedDashboards.some(d => d.id === savedActiveDashboardId)
                    ? savedActiveDashboardId
                    : (migratedDashboards.length > 0 ? migratedDashboards[0].id : null);

                set({
                    folders: migratedFolders,
                    dashboards: migratedDashboards,
                    activeDashboardId,
                    history: [migratedDashboards],
                    historyIndex: 0,
                    domain,
                    autoReloadInterval: parsed.autoReloadInterval || 0,
                    autoReloadSchedule: parsed.autoReloadSchedule || [],
                    lastReloadTimestamp: parsed.lastReloadTimestamp || null,
                    isHydrated: true
                });

                syncFromBackend(activeDashboardId);
                // console.log(`✅ Loaded ${migratedDashboards.length} dashboards for domain ${domain}`);
            } else {
                set({
                    folders: [],
                    dashboards: [],
                    activeDashboardId: null,
                    domain,
                    isHydrated: true,
                    history: [[]],
                    historyIndex: 0
                });
                syncFromBackend(null);
                // console.log(`ℹ️ No dashboards found for domain ${domain}`);
            }
        } catch (e) {
            console.error('Failed to load dashboard data', e);
            set({ isHydrated: true, domain }); // Still mark as hydrated to allow saving new data
        }
    },

    clearAll: () => {
        set({
            folders: [], dashboards: [], activeDashboardId: null, editingWidgetId: null,
            selectedWidgetIds: [], history: [], historyIndex: -1
        });
        saveToStorage(get());
    },

    selectAll: () => {
        const state = get();
        const dashboard = state.dashboards.find(d => d.id === state.activeDashboardId);
        if (!dashboard) return;
        const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
        const widgets = activePage ? activePage.widgets : (dashboard.widgets || []);
        set({ selectedWidgetIds: widgets.map(w => w.id) });
    }
}));
