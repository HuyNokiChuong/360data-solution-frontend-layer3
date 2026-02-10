// ============================================
// Dashboard Store - Zustand State Management
// ============================================

import { create } from 'zustand';
import { BIDashboard, BIFolder, BIWidget, GlobalFilter, DashboardPage, SharePermission } from '../types';
import { dashboardsApi, foldersApi } from '../../../services/apiClient';

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
    syncDashboardDataSource: (dashboardId: string, dataSourceId: string, dataSourceName?: string) => void;
    syncPageDataSource: (dashboardId: string, pageId: string, dataSourceId: string, dataSourceName?: string) => void;
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

const saveToStorage = (state: DashboardState) => {
    if (!state.isHydrated || !state.domain) {
        return;
    }

    try {
        const storageKey = getStorageKey(state.domain);

        // Safety check: don't save empty state if we previously had data
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

// Helper: fire-and-forget API sync (non-blocking)
const syncApi = (fn: () => Promise<any>) => {
    fn().catch(e => console.error('[DashboardStore] API sync failed:', e));
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
        const folderId = `f-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        set((state) => ({
            folders: [
                ...state.folders,
                {
                    id: folderId,
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
        saveToStorage(get());
        syncApi(async () => {
            const res = await foldersApi.create({ name, parentId });
            if (res.success && res.data?.id) {
                // Update local ID with DB ID
                set(state => ({ folders: state.folders.map(f => f.id === folderId ? { ...f, id: res.data.id } : f) }));
                saveToStorage(get());
            }
        });
    },

    updateFolder: (id, updates) => {
        set((state) => ({
            folders: state.folders.map(f => f.id === id ? { ...f, ...updates } : f)
        }));
        saveToStorage(get());
        syncApi(() => foldersApi.update(id, updates));
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
        saveToStorage(get());
        syncApi(() => foldersApi.delete(id));
    },

    shareFolder: (id, permissions) => {
        set((state) => ({
            folders: state.folders.map(f => f.id === id ? { ...f, sharedWith: permissions } : f)
        }));
        saveToStorage(get());
    },

    createDashboard: (dashboard) => {
        const pageId = `pg-${Date.now()}`;
        const dashboardId = `d-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const newDashboard: BIDashboard = {
            ...dashboard,
            id: dashboardId,
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
        set((state) => ({
            dashboards: [...state.dashboards, newDashboard],
            activeDashboardId: newDashboard.id
        }));
        saveToStorage(get());
        syncApi(async () => {
            const res = await dashboardsApi.create({
                title: dashboard.title,
                description: dashboard.description,
                folderId: dashboard.folderId,
                dataSourceId: dashboard.dataSourceId,
                dataSourceName: dashboard.dataSourceName,
            });
            if (res.success && res.data?.id) {
                set(state => ({
                    dashboards: state.dashboards.map(d => d.id === dashboardId ? { ...d, id: res.data.id } : d),
                    activeDashboardId: state.activeDashboardId === dashboardId ? res.data.id : state.activeDashboardId
                }));
                saveToStorage(get());
            }
        });
    },

    updateDashboard: (id, updates) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === id ? { ...d, ...updates, updatedAt: new Date().toISOString() } : d
            )
        }));
        saveToStorage(get());
        syncApi(() => dashboardsApi.update(id, updates));
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
        saveToStorage(get());
        syncApi(() => dashboardsApi.delete(id));
    },

    shareDashboard: (id, permissions) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === id ? { ...d, sharedWith: permissions, updatedAt: new Date().toISOString() } : d
            )
        }));
        saveToStorage(get());
        syncApi(() => dashboardsApi.update(id, { sharedWith: permissions }));
    },

    duplicateDashboard: (id) => {
        const state = get();
        const original = state.dashboards.find(d => d.id === id);
        if (!original) return;

        const suffix = Math.random().toString(36).substring(2, 7);
        const originalPages = original.pages && original.pages.length > 0
            ? original.pages
            : [{ id: `pg-default-${original.id}`, title: 'Page 1', widgets: original.widgets || [] }];

        const duplicate: BIDashboard = {
            ...original,
            id: `d-${Date.now()}-${suffix}`,
            title: `${original.title} (Copy)`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pages: originalPages.map(p => ({
                ...p,
                id: `pg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                widgets: p.widgets.map(w => ({
                    ...w,
                    id: `w-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
                }))
            }))
        };
        duplicate.activePageId = duplicate.pages[0].id;
        duplicate.widgets = duplicate.pages[0].widgets;

        set((state) => ({
            dashboards: [...state.dashboards, duplicate],
            activeDashboardId: duplicate.id
        }));
        saveToStorage(get());
    },

    addWidget: (dashboardId, widget) => {
        const newWidget: BIWidget = {
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
                    const widgetWithDS = { ...newWidget, dataSourceId: newWidget.dataSourceId || pageDataSourceId || d.dataSourceId };

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
            editingWidgetId: newWidget.id
        }));
        saveToStorage(get());
        syncApi(() => dashboardsApi.addWidget(dashboardId, newWidget));
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
        syncApi(() => dashboardsApi.updateWidget(dashboardId, widgetId, updates));
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
        syncApi(() => dashboardsApi.deleteWidget(dashboardId, widgetId));
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
        syncApi(() => dashboardsApi.addPage(dashboardId, { title }));
    },

    updatePage: (dashboardId, pageId, updates) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === dashboardId ? { ...d, pages: (d.pages || []).map(p => p.id === pageId ? { ...p, ...updates } : p), updatedAt: new Date().toISOString() } : d
            )
        }));
        saveToStorage(get());
        syncApi(() => dashboardsApi.updatePage(dashboardId, pageId, updates));
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
        syncApi(() => dashboardsApi.deletePage(dashboardId, pageId));
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
        syncApi(() => dashboardsApi.addGlobalFilter(dashboardId, filter));
    },

    removeGlobalFilter: (dashboardId, filterId) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === dashboardId ? { ...d, globalFilters: (d.globalFilters || []).filter(f => f.id !== filterId), updatedAt: new Date().toISOString() } : d
            )
        }));
        saveToStorage(get());
        syncApi(() => dashboardsApi.removeGlobalFilter(dashboardId, filterId));
    },

    syncDashboardDataSource: (dashboardId, dataSourceId, dataSourceName) => {
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
                        widgets: p.widgets.map(w => ({ ...w, dataSourceId: w.dataSourceId || dataSourceId, dataSourceName: w.dataSourceName || dataSourceName }))
                    })),
                    widgets: (d.widgets || []).map(w => ({ ...w, dataSourceId: w.dataSourceId || dataSourceId, dataSourceName: w.dataSourceName || dataSourceName })),
                    updatedAt: new Date().toISOString()
                } : d
            )
        }));
        saveToStorage(get());
    },

    syncPageDataSource: (dashboardId, pageId, dataSourceId, dataSourceName) => {
        set((state) => ({
            dashboards: state.dashboards.map(d =>
                d.id === dashboardId ? {
                    ...d,
                    pages: (d.pages || []).map(p =>
                        p.id === pageId ? {
                            ...p,
                            dataSourceId,
                            dataSourceName,
                            widgets: p.widgets.map(w => ({ ...w, dataSourceId, dataSourceName }))
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

        // Try API first, fallback to localStorage
        const loadFromAPI = async () => {
            try {
                const [dashRes, folderRes] = await Promise.all([
                    dashboardsApi.list(),
                    foldersApi.list()
                ]);

                if (dashRes.success && dashRes.data && dashRes.data.length > 0) {
                    let migratedDashboards = dashRes.data as BIDashboard[];
                    migratedDashboards = migratedDashboards.map((d: any) => {
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
                    });

                    const activeDashboardId = migratedDashboards.length > 0 ? migratedDashboards[0].id : null;

                    set({
                        folders: folderRes.success ? folderRes.data || [] : [],
                        dashboards: migratedDashboards,
                        activeDashboardId,
                        history: [migratedDashboards],
                        historyIndex: 0,
                        domain,
                        isHydrated: true
                    });
                    return; // Success - don't fallback
                }
            } catch (e) {
                console.warn('[DashboardStore] API load failed, falling back to localStorage:', e);
            }

            // Fallback to localStorage
            loadFromLocalStorage();
        };

        const loadFromLocalStorage = () => {
            try {
                const storageKey = getStorageKey(domain);
                const data = localStorage.getItem(storageKey);

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
                    });

                    const activeDashboardId = migratedDashboards.some(d => d.id === savedActiveDashboardId)
                        ? savedActiveDashboardId
                        : (migratedDashboards.length > 0 ? migratedDashboards[0].id : null);

                    set({
                        folders: parsed.folders || [],
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
                }
            } catch (e) {
                console.error('Failed to load dashboard data', e);
                set({ isHydrated: true, domain });
            }
        };

        loadFromAPI();
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
