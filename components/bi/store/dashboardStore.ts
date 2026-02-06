// ============================================
// Dashboard Store - Zustand State Management
// ============================================

import { create } from 'zustand';
import { BIDashboard, BIFolder, BIWidget, GlobalFilter, DashboardPage, SharePermission } from '../types';

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
    createFolder: (name: string, parentId?: string) => void;
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
    syncDashboardDataSource: (dashboardId: string, dataSourceId: string) => void;
    syncPageDataSource: (dashboardId: string, pageId: string, dataSourceId: string) => void;
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

const saveToStorage = (folders: BIFolder[], dashboards: BIDashboard[], activeDashboardId: string | null, domain: string | null, autoReloadInterval: number | string, autoReloadSchedule: string[], lastReloadTimestamp: number | null) => {
    try {
        localStorage.setItem(getStorageKey(domain), JSON.stringify({
            folders, dashboards, activeDashboardId, autoReloadInterval, autoReloadSchedule, lastReloadTimestamp
        }));
    } catch (e) {
        console.error('Failed to save dashboard data', e);
    }
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

    // Setters
    setDomain: (domain) => set({ domain }),
    setAutoReloadInterval: (interval: number | string, schedule?: string[]) => set((state) => {
        const newState = {
            autoReloadInterval: interval,
            autoReloadSchedule: schedule || state.autoReloadSchedule
        };
        saveToStorage(state.folders, state.dashboards, state.activeDashboardId, state.domain, interval, schedule || state.autoReloadSchedule, state.lastReloadTimestamp);
        return newState;
    }),
    setLastReloadTimestamp: (timestamp: number) => set((state) => {
        saveToStorage(state.folders, state.dashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, timestamp);
        return { lastReloadTimestamp: timestamp };
    }),
    setActiveDashboard: (id) => set((state) => {
        saveToStorage(state.folders, state.dashboards, id, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { activeDashboardId: id, editingWidgetId: null, selectedWidgetIds: [] };
    }),
    setEditingWidget: (id) => set({ editingWidgetId: id, selectedWidgetIds: id ? [id] : [] }),

    selectWidget: (id, multi = false) => set((state) => {
        const dashboard = state.dashboards.find(d => d.id === state.activeDashboardId);
        if (!dashboard) return state;

        const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
        const widgets = activePage ? activePage.widgets : (dashboard.widgets || []);
        const widget = widgets.find(w => w.id === id);

        // If widget is part of a group, select all group members
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

    clearSelection: () => set((state) => {
        saveToStorage(state.folders, state.dashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { selectedWidgetIds: [], editingWidgetId: null };
    }),

    groupWidgets: () => set((state) => {
        const { activeDashboardId, selectedWidgetIds } = state;
        if (!activeDashboardId || selectedWidgetIds.length < 2) return state;

        const groupId = `g-${Date.now()}`;

        const newState = {
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
        saveToStorage(state.folders, newState.dashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return newState;
    }),

    alignWidgets: (direction) => set((state) => {
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

        const newState = {
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
        saveToStorage(state.folders, newState.dashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return newState;
    }),

    ungroupWidgets: () => set((state) => {
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

        const newState = {
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
        saveToStorage(state.folders, newState.dashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return newState;
    }),

    createFolder: (name, parentId) => set((state) => {
        const newFolders = [
            ...state.folders,
            {
                id: `f-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                name,
                parentId,
                createdAt: new Date().toISOString(),
                createdBy: 'current-user', // Mock
                sharedWith: []
            }
        ];
        saveToStorage(newFolders, state.dashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { folders: newFolders };
    }),

    updateFolder: (id, updates) => set((state) => {
        const newFolders = state.folders.map(f => f.id === id ? { ...f, ...updates } : f);
        saveToStorage(newFolders, state.dashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { folders: newFolders };
    }),

    deleteFolder: (id) => set((state) => {
        const getAllChildFolderIds = (parentId: string): string[] => {
            const children = state.folders.filter(f => f.parentId === parentId);
            let ids = children.map(c => c.id);
            children.forEach(c => {
                ids = [...ids, ...getAllChildFolderIds(c.id)];
            });
            return ids;
        };
        const folderIdsToDelete = [id, ...getAllChildFolderIds(id)];
        const newFolders = state.folders.filter(f => !folderIdsToDelete.includes(f.id));
        const newDashboards = state.dashboards.map(d =>
            folderIdsToDelete.includes(d.folderId || '') ? { ...d, folderId: undefined } : d
        );
        saveToStorage(newFolders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { folders: newFolders, dashboards: newDashboards };
    }),

    shareFolder: (id, permissions) => set((state) => {
        const newFolders = state.folders.map(f => f.id === id ? { ...f, sharedWith: permissions } : f);
        saveToStorage(newFolders, state.dashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { folders: newFolders };
    }),

    createDashboard: (dashboard) => set((state) => {
        const pageId = `pg-${Date.now()}`;
        const newDashboard: BIDashboard = {
            ...dashboard,
            id: `d-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            widgets: [],
            pages: [{ id: pageId, title: 'Page 1', widgets: [] }],
            activePageId: pageId
        };
        const newDashboards = [...state.dashboards, newDashboard];
        saveToStorage(state.folders, newDashboards, newDashboard.id, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards, activeDashboardId: newDashboard.id };
    }),

    updateDashboard: (id, updates) => set((state) => {
        const newDashboards = state.dashboards.map(d =>
            d.id === id ? { ...d, ...updates, updatedAt: new Date().toISOString() } : d
        );
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards };
    }),

    deleteDashboard: (id) => set((state) => {
        const newDashboards = state.dashboards.filter(d => d.id !== id);
        const newActiveId = state.activeDashboardId === id ? null : state.activeDashboardId;
        saveToStorage(state.folders, newDashboards, newActiveId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return {
            dashboards: newDashboards,
            activeDashboardId: newActiveId
        };
    }),

    shareDashboard: (id, permissions) => set((state) => {
        const newDashboards = state.dashboards.map(d =>
            d.id === id ? { ...d, sharedWith: permissions, updatedAt: new Date().toISOString() } : d
        );
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards };
    }),

    duplicateDashboard: (id) => set((state) => {
        const original = state.dashboards.find(d => d.id === id);
        if (!original) return state;

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

        const newDashboards = [...state.dashboards, duplicate];
        saveToStorage(state.folders, newDashboards, duplicate.id, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards, activeDashboardId: duplicate.id };
    }),

    addWidget: (dashboardId, widget) => set((state) => {
        const newWidget: BIWidget = {
            ...widget,
            id: `w-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
        };
        const newDashboards = state.dashboards.map(d => {
            if (d.id === dashboardId) {
                const activePage = (d.pages || []).find(p => p.id === d.activePageId);
                const pageDataSourceId = activePage?.dataSourceId;
                const widgetWithDS = { ...newWidget, dataSourceId: newWidget.dataSourceId || pageDataSourceId || d.dataSourceId };

                if (d.pages && d.pages.length > 0) {
                    const updatedPages = d.pages.map(p =>
                        p.id === d.activePageId ? { ...p, widgets: [...p.widgets, widgetWithDS] } : p
                    );
                    const activeWidgets = updatedPages.find(page => page.id === d.activePageId)?.widgets || [];
                    return { ...d, pages: updatedPages, widgets: activeWidgets, updatedAt: new Date().toISOString() };
                } else {
                    const updatedWidgets = [...(d.widgets || []), widgetWithDS];
                    return { ...d, widgets: updatedWidgets, updatedAt: new Date().toISOString() };
                }
            }
            return d;
        });
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards, editingWidgetId: newWidget.id };
    }),

    updateWidget: (dashboardId, widgetId, updates) => set((state) => {
        const newDashboards = state.dashboards.map(d => {
            if (d.id === dashboardId) {
                if (d.pages && d.pages.length > 0) {
                    const updatedPages = d.pages.map(p => ({
                        ...p,
                        widgets: p.widgets.map(w => w.id === widgetId ? { ...w, ...updates } : w)
                    }));
                    const activeWidgets = updatedPages.find(page => page.id === d.activePageId)?.widgets || [];
                    return { ...d, pages: updatedPages, widgets: activeWidgets, updatedAt: new Date().toISOString() };
                } else {
                    const updatedWidgets = (d.widgets || []).map(w => w.id === widgetId ? { ...w, ...updates } : w);
                    return { ...d, widgets: updatedWidgets, updatedAt: new Date().toISOString() };
                }
            }
            return d;
        });
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards };
    }),

    deleteWidget: (dashboardId, widgetId) => set((state) => {
        const newDashboards = state.dashboards.map(d => {
            if (d.id === dashboardId) {
                if (d.pages && d.pages.length > 0) {
                    const updatedPages = d.pages.map(p => ({
                        ...p,
                        widgets: p.widgets.filter(w => w.id !== widgetId)
                    }));
                    const activeWidgets = updatedPages.find(page => page.id === d.activePageId)?.widgets || [];
                    return { ...d, pages: updatedPages, widgets: activeWidgets, updatedAt: new Date().toISOString() };
                } else {
                    const updatedWidgets = (d.widgets || []).filter(w => w.id !== widgetId);
                    return { ...d, widgets: updatedWidgets, updatedAt: new Date().toISOString() };
                }
            }
            return d;
        });
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards, editingWidgetId: state.editingWidgetId === widgetId ? null : state.editingWidgetId };
    }),

    duplicateWidget: (dashboardId, widgetId) => set((state) => {
        const dashboard = state.dashboards.find(d => d.id === dashboardId);
        if (!dashboard) return state;

        const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
        const currentWidgets = activePage ? activePage.widgets : (dashboard.widgets || []);
        const widget = currentWidgets.find(w => w.id === widgetId);
        if (!widget) return state;

        const duplicate: BIWidget = {
            ...widget,
            id: `w-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            x: widget.x + 1,
            y: widget.y + 1
        };

        const updatedWidgets = [...currentWidgets, duplicate];

        const newDashboards = state.dashboards.map(d => {
            if (d.id === dashboardId) {
                if (d.pages && d.pages.length > 0) {
                    const updatedPages = d.pages.map(p => p.id === d.activePageId ? { ...p, widgets: updatedWidgets } : p);
                    return { ...d, pages: updatedPages, widgets: updatedWidgets, updatedAt: new Date().toISOString() };
                } else {
                    return { ...d, widgets: updatedWidgets, updatedAt: new Date().toISOString() };
                }
            }
            return d;
        });

        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards, selectedWidgetIds: [duplicate.id], editingWidgetId: duplicate.id };
    }),

    copySelectedWidgets: () => set((state) => {
        const dashboard = state.dashboards.find(d => d.id === state.activeDashboardId);
        if (!dashboard || state.selectedWidgetIds.length === 0) return state;
        const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
        const widgets = activePage ? activePage.widgets : (dashboard.widgets || []);

        const widgetsToCopy = widgets
            .filter(w => state.selectedWidgetIds.includes(w.id))
            .map(w => ({ ...w }));
        return { clipboard: widgetsToCopy };
    }),

    pasteWidgets: () => set((state) => {
        const { activeDashboardId, clipboard, dashboards } = state;
        if (!activeDashboardId || clipboard.length === 0) return state;
        const dashboard = dashboards.find(d => d.id === activeDashboardId);
        if (!dashboard) return state;

        const timestamp = Date.now();
        const pastedWidgets: BIWidget[] = clipboard.map((w, idx) => ({
            ...w,
            id: `w-${timestamp}-${idx}-${Math.random().toString(36).substring(2, 7)}`,
            x: w.x + 1,
            y: w.y + 1,
            groupId: w.groupId ? `g-pasted-${timestamp}-${w.groupId}` : undefined
        }));

        const newDashboards = dashboards.map(d => {
            if (d.id === activeDashboardId) {
                if (d.pages && d.pages.length > 0) {
                    const updatedPages = d.pages.map(p =>
                        p.id === d.activePageId ? { ...p, widgets: [...p.widgets, ...pastedWidgets] } : p
                    );
                    const activeWidgets = updatedPages.find(page => page.id === d.activePageId)?.widgets || [];
                    return { ...d, pages: updatedPages, widgets: activeWidgets, updatedAt: new Date().toISOString() };
                } else {
                    const updatedWidgets = [...(d.widgets || []), ...pastedWidgets];
                    return { ...d, widgets: updatedWidgets, updatedAt: new Date().toISOString() };
                }
            }
            return d;
        });

        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return {
            dashboards: newDashboards,
            selectedWidgetIds: pastedWidgets.map(w => w.id),
            editingWidgetId: pastedWidgets.length === 1 ? pastedWidgets[0].id : null
        };
    }),

    addPage: (dashboardId, title = 'New Page') => set((state) => {
        const pageId = `pg-${Date.now()}`;
        const newDashboards = state.dashboards.map(d => {
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
        });
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards, selectedWidgetIds: [], editingWidgetId: null };
    }),

    updatePage: (dashboardId, pageId, updates) => set((state) => {
        const newDashboards = state.dashboards.map(d =>
            d.id === dashboardId ? { ...d, pages: (d.pages || []).map(p => p.id === pageId ? { ...p, ...updates } : p), updatedAt: new Date().toISOString() } : d
        );
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards };
    }),

    deletePage: (dashboardId, pageId) => set((state) => {
        const newDashboards = state.dashboards.map(d => {
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
        });
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards, selectedWidgetIds: [], editingWidgetId: null };
    }),

    duplicatePage: (dashboardId, pageId) => set((state) => {
        const dashboard = state.dashboards.find(d => d.id === dashboardId);
        if (!dashboard || !dashboard.pages) return state;
        const page = dashboard.pages.find(p => p.id === pageId);
        if (!page) return state;

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

        const newDashboards = state.dashboards.map(d =>
            d.id === dashboardId ? {
                ...d,
                pages: [...d.pages, duplicatedPage],
                activePageId: newPageId,
                widgets: duplicatedPage.widgets,
                updatedAt: new Date().toISOString()
            } : d
        );
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards, selectedWidgetIds: [], editingWidgetId: null };
    }),

    setActivePage: (dashboardId, pageId) => set((state) => {
        const newDashboards = state.dashboards.map(d =>
            d.id === dashboardId ? { ...d, activePageId: pageId, widgets: (d.pages || []).find(p => p.id === pageId)?.widgets || [] } : d
        );
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards, selectedWidgetIds: [], editingWidgetId: null };
    }),

    addGlobalFilter: (dashboardId, filter) => set((state) => {
        const newDashboards = state.dashboards.map(d =>
            d.id === dashboardId ? { ...d, globalFilters: [...(d.globalFilters || []), filter], updatedAt: new Date().toISOString() } : d
        );
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards };
    }),

    removeGlobalFilter: (dashboardId, filterId) => set((state) => {
        const newDashboards = state.dashboards.map(d =>
            d.id === dashboardId ? { ...d, globalFilters: (d.globalFilters || []).filter(f => f.id !== filterId), updatedAt: new Date().toISOString() } : d
        );
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards };
    }),

    syncDashboardDataSource: (dashboardId, dataSourceId) => set((state) => {
        const newDashboards = state.dashboards.map(d =>
            d.id === dashboardId ? {
                ...d,
                dataSourceId,
                // Only sync widgets not on pages or if pages don't exist
                pages: (d.pages || []).map(p => ({
                    ...p,
                    dataSourceId: p.dataSourceId || dataSourceId, // Only update if page doesn't have one
                    widgets: p.widgets.map(w => ({ ...w, dataSourceId: w.dataSourceId || dataSourceId }))
                })),
                widgets: (d.widgets || []).map(w => ({ ...w, dataSourceId: w.dataSourceId || dataSourceId })),
                updatedAt: new Date().toISOString()
            } : d
        );
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards };
    }),

    syncPageDataSource: (dashboardId, pageId, dataSourceId) => set((state) => {
        const newDashboards = state.dashboards.map(d =>
            d.id === dashboardId ? {
                ...d,
                pages: (d.pages || []).map(p =>
                    p.id === pageId ? {
                        ...p,
                        dataSourceId,
                        widgets: p.widgets.map(w => ({ ...w, dataSourceId }))
                    } : p
                ),
                updatedAt: new Date().toISOString()
            } : d
        );
        saveToStorage(state.folders, newDashboards, state.activeDashboardId, state.domain, state.autoReloadInterval, state.autoReloadSchedule, state.lastReloadTimestamp);
        return { dashboards: newDashboards };
    }),

    undo: () => {
        const { history, historyIndex, folders, domain, activeDashboardId, autoReloadInterval, autoReloadSchedule, lastReloadTimestamp } = get();
        if (historyIndex > 0) {
            const newDashboards = history[historyIndex - 1];
            saveToStorage(folders, newDashboards, activeDashboardId, domain, autoReloadInterval, autoReloadSchedule, lastReloadTimestamp);
            set({ dashboards: newDashboards, historyIndex: historyIndex - 1 });
        }
    },

    redo: () => {
        const { history, historyIndex, folders, domain, activeDashboardId, autoReloadInterval, autoReloadSchedule, lastReloadTimestamp } = get();
        if (historyIndex < history.length - 1) {
            const newDashboards = history[historyIndex + 1];
            saveToStorage(folders, newDashboards, activeDashboardId, domain, autoReloadInterval, autoReloadSchedule, lastReloadTimestamp);
            set({ dashboards: newDashboards, historyIndex: historyIndex + 1 });
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
        try {
            const data = localStorage.getItem(getStorageKey(domain));
            if (data) {
                const parsed = JSON.parse(data);
                const activeDashboardId = parsed.activeDashboardId || null;
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
                set({
                    folders: parsed.folders || [],
                    dashboards: migratedDashboards,
                    activeDashboardId,
                    history: [migratedDashboards],
                    historyIndex: 0,
                    domain,
                    autoReloadInterval: parsed.autoReloadInterval || 0,
                    autoReloadSchedule: parsed.autoReloadSchedule || [],
                    lastReloadTimestamp: parsed.lastReloadTimestamp || null
                });
            } else {
                set({
                    folders: [],
                    dashboards: [],
                    activeDashboardId: null,
                    history: [],
                    historyIndex: -1,
                    domain,
                    autoReloadSchedule: [],
                    lastReloadTimestamp: null
                });
            }
        } catch (e) {
            console.error('Failed to load dashboard data', e);
        }
    },

    clearAll: () => {
        const { domain, autoReloadInterval, autoReloadSchedule, lastReloadTimestamp } = get();
        saveToStorage([], [], null, domain, autoReloadInterval, autoReloadSchedule, lastReloadTimestamp);
        set({
            folders: [], dashboards: [], activeDashboardId: null, editingWidgetId: null,
            selectedWidgetIds: [], history: [], historyIndex: -1
        });
    },

    selectAll: () => set((state) => {
        const dashboard = state.dashboards.find(d => d.id === state.activeDashboardId);
        if (!dashboard) return state;

        const activePage = dashboard.pages?.find(p => p.id === dashboard.activePageId);
        const widgets = activePage ? activePage.widgets : (dashboard.widgets || []);
        const allIds = widgets.map(w => w.id);

        return {
            selectedWidgetIds: allIds,
            editingWidgetId: allIds.length > 0 ? allIds[allIds.length - 1] : null
        };
    })
}));
