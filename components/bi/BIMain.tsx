
import React, { useState, useEffect, useRef } from 'react';
import { useLanguageStore } from '../../store/languageStore';
import BISidebar from './BISidebar';
import { DataAssetService } from './engine/DataAssetService';
import BICanvas from './canvas/BICanvas';
import BIVisualBuilder from './BIVisualBuilder';
import DashboardToolbar from './DashboardToolbar';

import GlobalFilterBar from './GlobalFilterBar';
import DataSourcesPanel from './panels/DataSourcesPanel';
import { ExportService } from './engine/ExportService';
import { SyncedTable, Connection, User } from '../../types';
import { fetchTableData, fetchTableSchema } from '../../services/bigquery';
import { useDashboardStore } from './store/dashboardStore';
import { useDataStore } from './store/dataStore';
import { useFilterStore } from './store/filterStore';
import { BIWidget, ChartType, Field } from './types';
import { useKeyboardShortcuts } from './utils/useKeyboardShortcuts';
import PageTabs from './PageTabs';
import DashboardAIChat from './DashboardAIChat';
import { getAutoTitle } from './utils/widgetUtils';
import {
    DndContext,
    useSensor,
    useSensors,
    PointerSensor,
    DragEndEvent,
    DragOverEvent,
    closestCenter,
    defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

interface BIMainProps {
    tables: SyncedTable[];
    connections: Connection[];
    currentUser: User;
    googleToken?: string | null;
    setGoogleToken: (token: string | null) => void;
    domain: string;
    isMainSidebarCollapsed?: boolean;
    onToggleMainSidebar?: () => void;
}

const BIMain: React.FC<BIMainProps> = ({
    tables,
    connections,
    currentUser,
    googleToken: initialGoogleToken,
    setGoogleToken: setGlobalGoogleToken,
    domain,
    isMainSidebarCollapsed,
    onToggleMainSidebar
}) => {
    const { t } = useLanguageStore();
    const {
        folders,
        dashboards,
        activeDashboardId,
        editingWidgetId,
        setActiveDashboard,
        setEditingWidget,
        createFolder,
        createDashboard,
        updateDashboard,
        syncDashboardDataSource,
        syncPageDataSource,
        addWidget,
        updateWidget,
        selectedWidgetIds,
        selectWidget,
        deleteWidget,
        duplicateWidget,
        groupWidgets,
        ungroupWidgets,
        selectAll,
        clearSelection,
        autoReloadInterval,
        setAutoReloadInterval,
        autoReloadSchedule,
        lastReloadTimestamp
    } = useDashboardStore();

    const { dataSources, selectedDataSourceId, clearAllBigQueryData, setGoogleToken, setConnections } = useDataStore();
    const { clearAllFilters } = useFilterStore();

    // Sync external props to local store for hooks to consume
    useEffect(() => {
        setGoogleToken(initialGoogleToken || null);
    }, [initialGoogleToken, setGoogleToken]);

    useEffect(() => {
        setConnections(connections);
    }, [connections, setConnections]);

    const [reloadTrigger, setReloadTrigger] = useState(0);
    const [metadataReloadTrigger, setMetadataReloadTrigger] = useState(0);
    const lastReloadTriggerRef = useRef(0);
    const [isAuthRequired, setIsAuthRequired] = useState(false);

    const bqConn = connections.find(c => c.type === 'BigQuery' && c.projectId);

    // Manual reload function
    const handleManualReload = async (isAutomatic = false) => {
        const { addLog } = useDataStore.getState();

        addLog({
            type: 'info',
            message: `${isAutomatic ? 'Hệ thống tự động' : 'Người dùng'} yêu cầu làm mới toàn bộ dữ liệu...`
        });

        // 1. If BigQuery connection exists, handle token refresh
        if (bqConn) {
            const clientId = process.env.GOOGLE_CLIENT_ID || '';
            const { getTokenForConnection, getGoogleToken } = await import('../../services/googleAuth');
            let validToken = await getTokenForConnection(bqConn, clientId);

            if (validToken) {
                if (validToken !== initialGoogleToken && bqConn.authType === 'GoogleMail') {
                    setGlobalGoogleToken(validToken);
                }
                setIsAuthRequired(false);
            } else if (bqConn.authType === 'GoogleMail') {
                setIsAuthRequired(true);

                if (isAutomatic) {
                    console.warn('🛑 Background reload skipped: Token expired. User must re-auth manually.');
                    addLog({
                        type: 'error',
                        message: 'Tự động làm mới thất bại: Token hết hạn. Vui lòng đăng nhập lại.'
                    });
                    return;
                }

                try {
                    validToken = await getGoogleToken(clientId);
                    setGlobalGoogleToken(validToken);
                    setIsAuthRequired(false);
                } catch (e) {
                    console.error('❌ Re-authentication failed:', e);
                    addLog({
                        type: 'error',
                        message: 'Đăng nhập lại thất bại. Vui lòng kiểm tra cài đặt trình duyệt.'
                    });
                    return;
                }
            }
        }

        // 2. Clear all data ONLY for manual trigger to force re-fetch
        // This ensures F5 doesn't wipe progress unless user explicitly clicks "Reload All"
        const { setLastReloadTimestamp } = useDashboardStore.getState();
        setLastReloadTimestamp(Date.now());
        clearAllBigQueryData();

        // Also force a fresh metadata fetch for all tables
        setMetadataReloadTrigger(prev => prev + 1);
        setReloadTrigger(prev => prev + 1);
    };

    // Dedicated re-authentication handler (for "Re-Link Account" button)
    const handleReAuth = async () => {
        if (bqConn?.authType !== 'GoogleMail') return;

        try {
            const clientId = process.env.GOOGLE_CLIENT_ID || '';
            const { getGoogleToken } = await import('../../services/googleAuth');
            const newToken = await getGoogleToken(clientId);
            setGlobalGoogleToken(newToken);
            setIsAuthRequired(false);

            // After successful auth, reload data
            const { setLastReloadTimestamp } = useDashboardStore.getState();
            setLastReloadTimestamp(Date.now());
            clearAllBigQueryData();
            setReloadTrigger(prev => prev + 1);
        } catch (e) {
            console.error('❌ Re-authentication failed:', e);
            alert('Failed to re-authenticate. Please try again or check your popup blocker settings.');
        }
    };

    // Reload a single data source
    const handleReloadDataSource = async (id: string) => {
        const { getDataSource } = useDataStore.getState();
        const ds = getDataSource(id);

        if (ds?.type === 'bigquery') {
            const connection = connections.find(c => c.id === ds.connectionId);
            if (connection) {
                try {
                    // 1. Ensure we have a valid token (refresh if needed)
                    const clientId = process.env.GOOGLE_CLIENT_ID || '';
                    const { getTokenForConnection } = await import('../../services/googleAuth');
                    const validToken = await getTokenForConnection(connection, clientId);

                    if (!validToken) {
                        setIsAuthRequired(true); // Prompt for re-auth if no token
                        return;
                    }

                    // 2. Update global token if it was refreshed
                    if (validToken !== initialGoogleToken && connection.authType === 'GoogleMail') {
                        setGlobalGoogleToken(validToken);
                    }

                    // 3. Force clean state and start sync
                    console.log(`🔄 Manual sync triggered for: ${ds.name}`);
                    const { clearTableData, setTableLoadingState } = useDataStore.getState();
                    clearTableData(id);
                    setTableLoadingState(id, true);

                    await DataAssetService.syncTable(id, validToken, connection);
                    console.log(`✅ Manual sync completed for: ${ds.name}`);
                } catch (e: any) {
                    console.error("Manual sync failed", e);
                    if (e.message === 'UNAUTHORIZED' && connection.authType === 'GoogleMail') {
                        setIsAuthRequired(true);
                    }
                }
            }
        } else {
            console.log(`🔄 Manual refresh for local source: ${id}`);
            const { clearTableData } = useDataStore.getState();
            clearTableData(id);
            setReloadTrigger(prev => prev + 1);
        }
    };

    // Auto reload timer & schedule handler
    useEffect(() => {
        const checkReload = () => {
            const now = new Date();
            const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const { autoReloadInterval, autoReloadSchedule, lastReloadTimestamp } = useDashboardStore.getState();

            // 1. Check Schedule
            if (autoReloadSchedule?.includes(currentTimeStr)) {
                // Ensure we only trigger once per minute
                const lastReloadDate = lastReloadTimestamp ? new Date(lastReloadTimestamp) : null;
                const matchesMinute = lastReloadDate &&
                    lastReloadDate.getHours() === now.getHours() &&
                    lastReloadDate.getMinutes() === now.getMinutes();

                if (!matchesMinute) {
                    handleManualReload(true);
                }
            }

            // 2. Check Interval or Cron
            if (typeof autoReloadInterval === 'number' && autoReloadInterval > 0 && lastReloadTimestamp) {
                const nextReloadTime = lastReloadTimestamp + (autoReloadInterval * 60 * 1000);
                if (Date.now() >= nextReloadTime) {
                    handleManualReload(true);
                }
            } else if (typeof autoReloadInterval === 'string' && autoReloadInterval.trim().length > 0) {
                // Standard Cron logic (5 parts: minute hour dom month dow)
                const parts = autoReloadInterval.trim().split(/\s+/);
                if (parts.length === 5) {
                    const [m, h, dom, mon, dow] = parts;

                    const check = (val: number, pattern: string) => {
                        if (pattern === '*') return true;
                        if (pattern.includes('/')) {
                            const step = parseInt(pattern.split('/')[1]);
                            return val % step === 0;
                        }
                        if (pattern.includes(',')) {
                            return pattern.split(',').map(Number).includes(val);
                        }
                        if (pattern.includes('-')) {
                            const [start, end] = pattern.split('-').map(Number);
                            return val >= start && val <= end;
                        }
                        return parseInt(pattern) === val;
                    };

                    const isMatch = check(now.getMinutes(), m) &&
                        check(now.getHours(), h) &&
                        check(now.getDate(), dom) &&
                        check(now.getMonth() + 1, mon) &&
                        check(now.getDay(), dow);

                    if (isMatch) {
                        // Ensure we only trigger once per minute
                        const lastReloadDate = lastReloadTimestamp ? new Date(lastReloadTimestamp) : null;
                        const isDifferentMinute = !lastReloadDate ||
                            lastReloadDate.getHours() !== now.getHours() ||
                            lastReloadDate.getMinutes() !== now.getMinutes() ||
                            lastReloadDate.getDate() !== now.getDate();

                        if (isDifferentMinute) {
                            handleManualReload(true);
                        }
                    }
                }
            }
        };

        const interval = setInterval(checkReload, 10000); // Check every 10s
        return () => clearInterval(interval);
    }, [handleManualReload, autoReloadInterval, autoReloadSchedule, lastReloadTimestamp]);

    const [leftPanelOpen, setLeftPanelOpen] = useState(true);
    const [rightPanelOpen, setRightPanelOpen] = useState(true);
    const [leftPanelWidth, setLeftPanelWidth] = useState(256); // Default 256px (w-64)
    const [rightPanelWidth, setRightPanelWidth] = useState(320); // Default 320px (w-80)
    const isResizingRef = useRef<'left' | 'right' | null>(null);

    const startResizing = (panel: 'left' | 'right') => (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        isResizingRef.current = panel;

        // Capture initial state
        const startX = e.clientX;
        const startWidth = panel === 'left' ? leftPanelWidth : rightPanelWidth;

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (mvEvent: MouseEvent) => {
            if (!isResizingRef.current) return;

            const currentX = mvEvent.clientX;
            const deltaX = currentX - startX;

            if (isResizingRef.current === 'left') {
                const newWidth = Math.max(200, Math.min(800, startWidth + deltaX));
                setLeftPanelWidth(newWidth);
            } else {
                const newWidth = Math.max(250, Math.min(800, startWidth - deltaX));
                setRightPanelWidth(newWidth);
            }
        };

        const handleMouseUp = () => {
            isResizingRef.current = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const [leftPanelTab, setLeftPanelTab] = useState<'data' | 'folders'>('folders');
    const googleToken = initialGoogleToken;

    // Proactively check token validity once on mount or when googleToken changes
    useEffect(() => {
        const checkAuth = async () => {
            if (!bqConn) {
                setIsAuthRequired(false);
                return;
            }

            const clientId = process.env.GOOGLE_CLIENT_ID || '';
            const { getTokenForConnection } = await import('../../services/googleAuth');

            try {
                const tokenToTest = await getTokenForConnection(bqConn, clientId);
                if (tokenToTest) {
                    // Only update global token if it's NOT a Service Account to avoid infinite loops
                    // (Service Account tokens are generated fresh every time)
                    if (bqConn.authType === 'GoogleMail' && tokenToTest !== googleToken) {
                        setGlobalGoogleToken(tokenToTest);
                    }

                    // Simple test fetch
                    const testResponse = await fetch(
                        `https://bigquery.googleapis.com/bigquery/v2/projects/${bqConn.projectId}/datasets?maxResults=1`,
                        { headers: { Authorization: `Bearer ${tokenToTest}` } }
                    );
                    setIsAuthRequired(!testResponse.ok && bqConn.authType === 'GoogleMail');
                } else {
                    setIsAuthRequired(bqConn.authType === 'GoogleMail');
                }
            } catch (e) {
                setIsAuthRequired(bqConn.authType === 'GoogleMail');
            }
        };
        checkAuth();
    }, [googleToken, connections, bqConn]);

    // Canvas UI State
    const [zoom, setZoom] = useState(1);
    const [showGrid, setShowGrid] = useState(true);
    const [previewMode, setPreviewMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
    const [activeVisualTab, setActiveVisualTab] = useState<'visualizations' | 'data' | 'format' | 'calculations'>('visualizations');
    const loadingTablesRef = useRef<Set<string>>(new Set());
    const abortControllerRef = useRef<AbortController | null>(null);
    const tableAbortControllers = useRef<Map<string, AbortController>>(new Map());

    const handleStopSync = async (dsId: string) => { // Made async
        // 1. Abort the specific controller if it exists
        const controller = tableAbortControllers.current.get(dsId);
        if (controller) {
            controller.abort();
            tableAbortControllers.current.delete(dsId);
        }

        // 2. Also remove from DataAssetService active set
        // We can't access static set directly, so we rely on store update
        const { updateDataSource, addLog, setTableLoadingState } = useDataStore.getState();

        // 3. Update store state
        updateDataSource(dsId, {
            syncStatus: 'ready', // User cancelled, so it's "ready" for next retry (or should it be 'error'?)
            isLoadingPartial: false,
            // Don't clear data, let user decide
        });
        setTableLoadingState(dsId, false);

        addLog({
            type: 'info', // Changed to info as it is user action
            message: `Tiến trình đồng bộ bị hủy bởi người dùng`,
            target: dsId
        });
    };

    const handleStopAllSyncs = () => {
        tableAbortControllers.current.forEach(c => c.abort());
        tableAbortControllers.current.clear();
        abortControllerRef.current?.abort();
        // Update all syncing sources to stopped status
        const { dataSources, updateDataSource } = useDataStore.getState();
        dataSources.forEach(ds => {
            if (ds.syncStatus === 'syncing') {
                updateDataSource(ds.id, { syncStatus: 'ready', isLoadingPartial: false });
            }
        });
    };

    // DND Sensors
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;

        const activeId = active.id as string;
        const overId = over.id as string;
        const activeData = active.data.current;
        const overData = over.data.current;

        if (!activeData) return;

        // 1. Handle Sidebar Organization (Folders/Dashboards)
        if (activeData.type === 'dashboard' || activeData.type === 'folder') {
            const { updateDashboard, updateFolder, folders } = useDashboardStore.getState();

            if (activeData.type === 'dashboard') {
                if (overData?.type === 'folder' || overId === 'workspace-root') {
                    updateDashboard(activeId, {
                        folderId: overId === 'workspace-root' ? undefined : overId
                    });
                }
            } else if (activeData.type === 'folder') {
                if (overId === activeId) return;
                if (overData?.type === 'folder' || overId === 'workspace-root') {
                    const targetParentId = overId === 'workspace-root' ? undefined : overId;

                    // Prevent nesting a folder into its own descendants
                    const isDescendant = (parentId: string, targetId: string): boolean => {
                        const subF = folders.filter(f => f.parentId === parentId);
                        if (subF.some(f => f.id === targetId)) return true;
                        return subF.some(f => isDescendant(f.id, targetId));
                    };

                    if (targetParentId && isDescendant(activeId, targetParentId)) return;

                    updateFolder(activeId, { parentId: targetParentId });
                }
            }
            return;
        }

        // 2. Handle Field Dragging (from sidebar to slots)
        if (activeData.field) {
            const field = activeData.field as Field;
            const targetSlot = overData?.slot; // e.g., 'xAxis', 'yAxis', 'legend'


            if (targetSlot && activeWidget) {
                const updates: Partial<BIWidget> = {};

                // AUTO-BIND data source if widget doesn't have one
                if (!activeWidget.dataSourceId && selectedDataSourceId) {
                    updates.dataSourceId = selectedDataSourceId;
                }

                const isDateField = field.type === 'date';

                const getTimeHierarchy = (fieldName: string) => [
                    `${fieldName}___year`,
                    `${fieldName}___half`,
                    `${fieldName}___quarter`,
                    `${fieldName}___month`,
                    `${fieldName}___day`
                ];

                if (targetSlot === 'xAxis-hierarchy') {
                    const current = activeWidget.drillDownHierarchy || [];
                    if (!current.includes(field.name)) {
                        if (isDateField) {
                            const timeParts = getTimeHierarchy(field.name);
                            updates.drillDownHierarchy = [...current, ...timeParts.filter(p => !current.includes(p))];
                        } else {
                            updates.drillDownHierarchy = [...current, field.name];
                        }
                        updates.xAxis = updates.drillDownHierarchy[0];
                    }
                } else if (targetSlot === 'legend-hierarchy') {
                    const current = activeWidget.legendHierarchy || [];
                    if (!current.includes(field.name)) {
                        if (isDateField) {
                            const timeParts = getTimeHierarchy(field.name);
                            updates.legendHierarchy = [...current, ...timeParts.filter(p => !current.includes(p))];
                        } else {
                            updates.legendHierarchy = [...current, field.name];
                        }
                        updates.legend = updates.legendHierarchy[0];
                    }
                } else if (targetSlot === 'xAxis') {
                    if (isDateField) {
                        const timeParts = getTimeHierarchy(field.name);
                        updates.drillDownHierarchy = timeParts;
                        updates.xAxis = timeParts[0];
                    } else {
                        updates.xAxis = field.name;
                    }
                } else if (targetSlot === 'yAxis') {
                    updates.yAxis = [field.name];
                } else if (targetSlot === 'yAxis-2') {
                    const current = activeWidget.yAxis || [];
                    updates.yAxis = [current[0] || '', field.name];
                } else if (targetSlot === 'yAxis-size') {
                    const current = activeWidget.yAxis || [];
                    updates.yAxis = [current[0] || '', field.name];
                } else if (targetSlot === 'yAxis-comparison') {
                    updates.comparisonValue = field.name;
                } else if (targetSlot === 'yAxis-multi') {
                    const current = activeWidget.yAxisConfigs || [];
                    if (!current.find(v => v.field === field.name)) {
                        updates.yAxisConfigs = [...current, { field: field.name, aggregation: 'sum' }];
                    }
                } else if (targetSlot === 'slicerField') {
                    updates.slicerField = field.name;
                } else if (targetSlot === 'table-columns') {
                    const current = activeWidget.columns || [];
                    if (!current.find(c => c.field === field.name)) {
                        updates.columns = [...current, { field: field.name, header: field.name }];
                    }
                } else if (targetSlot === 'pivot-rows') {
                    const current = activeWidget.pivotRows || [];
                    if (!current.includes(field.name)) {
                        if (isDateField) {
                            const timeParts = getTimeHierarchy(field.name);
                            updates.pivotRows = [...current, ...timeParts.filter(p => !current.includes(p))];
                        } else {
                            updates.pivotRows = [...current, field.name];
                        }
                    }
                } else if (targetSlot === 'pivot-cols') {
                    const current = activeWidget.pivotCols || [];
                    if (!current.includes(field.name)) {
                        if (isDateField) {
                            const timeParts = getTimeHierarchy(field.name);
                            updates.pivotCols = [...current, ...timeParts.filter(p => !current.includes(p))];
                        } else {
                            updates.pivotCols = [...current, field.name];
                        }
                    }
                } else if (targetSlot === 'pivot-values') {
                    const current = activeWidget.pivotValues || [];
                    if (!current.find(v => v.field === field.name)) {
                        updates.pivotValues = [...current, { field: field.name, aggregation: 'sum' }];
                    }
                }


                // AUTO TITLE LOGIC
                const nextWidgetState = { ...activeWidget, ...updates };
                const currentTitle = activeWidget.title || '';
                const isDefaultTitle =
                    currentTitle === 'New Chart' ||
                    currentTitle === 'New Card' ||
                    currentTitle === 'Pivot Table' ||
                    currentTitle === 'Table' ||
                    currentTitle === 'Slicer' ||
                    currentTitle === 'Filter' ||
                    currentTitle === 'Date Range' ||
                    currentTitle === 'Search' ||
                    currentTitle === '' ||
                    currentTitle.startsWith('New ');

                if (isDefaultTitle) {
                    const newTitle = getAutoTitle(nextWidgetState as BIWidget);
                    if (newTitle && newTitle !== 'New Chart' && newTitle !== '' && newTitle !== currentTitle) {
                        updates.title = newTitle;
                    }
                }

                if (Object.keys(updates).length > 0) {
                    updateWidget(activeDashboard!.id, activeWidget.id, updates);
                }
            }
        }
    };

    // Keyboard Shortcuts
    useKeyboardShortcuts({
        onSave: () => {
            if (activeDashboard) {
                // Ensure everything is committed
                updateDashboard(activeDashboard.id, { updatedAt: new Date().toISOString() });

                // Visual feedback if the button is on screen
                const btn = document.getElementById('save-btn');
                if (btn) btn.click(); // Trigger the logic already in DashboardToolbar
            }
        },
        onDelete: () => {
            if (activeDashboard) {
                const idsToDelete = [...new Set([...selectedWidgetIds, ...(editingWidgetId ? [editingWidgetId] : [])])];
                idsToDelete.forEach(id => deleteWidget(activeDashboard.id, id));
            }
        },
        onDuplicate: () => {
            if (activeDashboard) {
                const idsToDupe = [...new Set([...selectedWidgetIds, ...(editingWidgetId ? [editingWidgetId] : [])])];
                idsToDupe.forEach(id => duplicateWidget(activeDashboard.id, id));
            }
        },
        onSelectAll: selectAll,
        onDeselect: clearSelection,
        onGroup: groupWidgets,
        onUngroup: ungroupWidgets,
        onCopy: () => useDashboardStore.getState().copySelectedWidgets(),
        onPaste: () => useDashboardStore.getState().pasteWidgets(),
    });

    useEffect(() => {
        if (domain) {
            const init = async () => {
                await useDashboardStore.getState().loadFromStorage(domain);
                await useDataStore.getState().loadFromStorage(domain);
            };
            init();
        }
    }, [domain]);

    const { setSelectedDataSource } = useDataStore();



    useEffect(() => {
        const loadTablesIntoBI = async () => {
            const { loadBigQueryTable, loadExcelTable, deleteDataSource, dataSources } = useDataStore.getState();

            const connectionMap = new Map(connections.map((conn) => [conn.id, conn]));
            const resolveSourceId = (table: SyncedTable) => {
                const conn = connectionMap.get(table.connectionId);
                if (!conn) return null;
                if (conn.type === 'BigQuery') return `bq:${table.connectionId}:${table.datasetName}:${table.tableName}`;
                if (conn.type === 'Excel' || conn.type === 'GoogleSheets') return `excel:${table.id}`;
                return null;
            };

            // 1. DEDUPLICATE & SYNC WITH REGISTRY
            const activeTableMap = new Map<string, SyncedTable>();
            tables.forEach((table) => {
                const identifier = resolveSourceId(table);
                if (!identifier) return;
                if (!activeTableMap.has(identifier)) {
                    activeTableMap.set(identifier, table);
                }
            });

            // 1b. PRUNE: Remove data sources that are no longer in the registry
            const dsToDelete = dataSources.filter((ds) =>
                (ds.type === 'bigquery' || ds.type === 'excel') && !activeTableMap.has(ds.id)
            );

            if (dsToDelete.length > 0) {
                console.log(`🧹 Pruning ${dsToDelete.length} orphaned sources from BI`);
                dsToDelete.forEach((ds) => deleteDataSource(ds.id));
            }

            // 2. IDENTIFY TABLES TO PROCESS (Metadata load):
            // - Only process if Active AND (new OR forced reload)
            const currentDSIds = new Set(useDataStore.getState().dataSources.map(ds => ds.id));
            const tablesToProcess = Array.from(activeTableMap.values()).filter((table) => {
                const id = resolveSourceId(table);
                if (!id) return false;
                if (table.status !== 'Active') return false;
                if (metadataReloadTrigger > 0) return true; // Force refresh all
                return !currentDSIds.has(id) && !loadingTablesRef.current.has(id);
            });

            if (tablesToProcess.length === 0) return;

            // Mark as loading to prevent double trigger
            tablesToProcess.forEach((table) => {
                const id = resolveSourceId(table);
                if (id) loadingTablesRef.current.add(id);
            });

            const normalizeType = (bqType: string): 'string' | 'number' | 'date' | 'boolean' => {
                const t = bqType.toUpperCase();
                if (['INTEGER', 'INT64', 'FLOAT', 'FLOAT64', 'NUMERIC', 'BIGNUMERIC'].includes(t)) return 'number';
                if (['TIMESTAMP', 'DATE', 'DATETIME', 'TIME'].includes(t)) return 'date';
                if (['BOOLEAN', 'BOOL'].includes(t)) return 'boolean';
                return 'string';
            };

            const normalizeExcelType = (excelType: string): 'string' | 'number' | 'date' | 'boolean' => {
                const t = String(excelType || '').toUpperCase();
                if (t === 'NUMBER' || t === 'NUMERIC' || t === 'INT' || t === 'INTEGER' || t === 'FLOAT') return 'number';
                if (t === 'BOOLEAN' || t === 'BOOL') return 'boolean';
                if (t === 'DATE') return 'date';
                return 'string';
            };

            const excelTablesToProcess = tablesToProcess.filter((table) => {
                const type = connectionMap.get(table.connectionId)?.type;
                return type === 'Excel' || type === 'GoogleSheets';
            });
            for (const table of excelTablesToProcess) {
                const dsIdentifier = resolveSourceId(table);
                try {
                    loadExcelTable(
                        table.id,
                        table.connectionId,
                        table.tableName,
                        table.datasetName,
                        (table.schema || []).map((field: any) => ({
                            name: field.name,
                            type: normalizeExcelType(field.type),
                        })),
                        table.rowCount
                    );
                } catch (e) {
                    console.error(`Failed metadata for Excel table ${table.tableName}:`, e);
                } finally {
                    if (dsIdentifier) loadingTablesRef.current.delete(dsIdentifier);
                }
            }

            // 3. GROUP BY DATASET
            const tablesByDataset = new Map<string, { connection: any, tables: SyncedTable[] }>();
            const bqTablesToProcess = tablesToProcess.filter((table) => connectionMap.get(table.connectionId)?.type === 'BigQuery');
            for (const table of bqTablesToProcess) {
                const connection = connections.find(c => c.id === table.connectionId);
                if (!connection?.projectId) continue;

                const datasetKey = `${connection.projectId}:${table.datasetName}`;
                if (!tablesByDataset.has(datasetKey)) {
                    tablesByDataset.set(datasetKey, { connection, tables: [] });
                }
                tablesByDataset.get(datasetKey)!.tables.push(table);
            }

            // 4. BATCH LOAD metadata
            if (tablesByDataset.size === 0) {
                return;
            }

            const { fetchBatchTableMetadata } = await import('../../services/bigquery-batch');
            const { getTokenForConnection } = await import('../../services/googleAuth');
            const clientId = process.env.GOOGLE_CLIENT_ID || '';

            await Promise.all(
                Array.from(tablesByDataset.entries()).map(async ([datasetKey, { connection, tables: datasetTables }]) => {
                    const [projectId, datasetId] = datasetKey.split(':');
                    const tableIds = datasetTables.map(t => t.tableName);

                    try {
                        const validToken = await getTokenForConnection(connection, clientId);
                        if (!validToken) {
                            if (connection.authType === 'GoogleMail') setIsAuthRequired(true);
                            return;
                        }

                        if (validToken !== initialGoogleToken && connection.authType === 'GoogleMail') {
                            setGlobalGoogleToken(validToken);
                        }

                        const metadataMap = await fetchBatchTableMetadata(
                            validToken,
                            projectId,
                            datasetId,
                            tableIds
                        );

                        await Promise.all(datasetTables.map(async (table) => {
                            const dsIdentifier = resolveSourceId(table);
                            try {
                                const metadata = metadataMap[table.tableName];
                                if (!metadata) return;
                                loadBigQueryTable(
                                    table.connectionId,
                                    table.tableName,
                                    table.datasetName,
                                    null,
                                    metadata.schema.map(f => ({ name: f.name, type: normalizeType(f.type) })),
                                    metadata.rowCount // Pass the row count here!
                                );
                            } catch (e) {
                                console.error(`Failed metadata for ${table.tableName}:`, e);
                            } finally {
                                if (dsIdentifier) loadingTablesRef.current.delete(dsIdentifier);
                            }
                        }));
                    } catch (error: any) {
                        console.error(`Failed batch load for ${datasetId}:`, error);
                        if (error.message === 'UNAUTHORIZED' && connection.authType === 'GoogleMail') {
                            setIsAuthRequired(true);
                        }
                        datasetTables.forEach((table) => {
                            const id = resolveSourceId(table);
                            if (id) loadingTablesRef.current.delete(id);
                        });
                    }
                })
            );
        };

        loadTablesIntoBI();
    }, [tables, connections, initialGoogleToken, metadataReloadTrigger, dataSources]);

    const activeDashboard = dashboards.find(d => d.id === activeDashboardId);
    const activeWidget = activeDashboard?.widgets.find(w => w.id === editingWidgetId);

    // Sync selectedDataSourceId with active dashboard/page/widget context
    useEffect(() => {
        if (activeDashboard) {
            const dashboardDS = activeDashboard.dataSourceId;
            const activePageId = activeDashboard.activePageId;
            const activePage = activeDashboard.pages?.find((p: any) => p.id === activePageId);
            const pageDS = activePage?.dataSourceId;

            const effectiveDS = pageDS || activeWidget?.dataSourceId || dashboardDS;
            if (effectiveDS && (effectiveDS !== selectedDataSourceId)) {
                setSelectedDataSource(effectiveDS);
            }
        }
    }, [activeDashboardId, activeDashboard?.activePageId, editingWidgetId, activeWidget?.dataSourceId, selectedDataSourceId, setSelectedDataSource]);

    // Load actual data on demand for all required data sources
    const syncQueueControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        const loadAllRequiredData = async () => {
            if (!activeDashboardId) return;

            // Abort previous queue if still running
            if (syncQueueControllerRef.current) {
                syncQueueControllerRef.current.abort();
            }
            syncQueueControllerRef.current = new AbortController();
            const signal = syncQueueControllerRef.current.signal;

            const dashboard = dashboards.find(d => d.id === activeDashboardId);
            if (!dashboard) return;

            // 1. Collect required IDs
            const requiredIds = new Set<string>();
            const isManualReload = lastReloadTriggerRef.current !== reloadTrigger;
            const resolveTableSourceId = (table: SyncedTable): string | null => {
                const conn = connections.find((c) => c.id === table.connectionId);
                if (!conn) return null;
                if (conn.type === 'BigQuery') return `bq:${table.connectionId}:${table.datasetName}:${table.tableName}`;
                if (conn.type === 'Excel' || conn.type === 'GoogleSheets') return `excel:${table.id}`;
                return null;
            };
            const isSourceActive = (sourceId: string) =>
                tables.some((table) => resolveTableSourceId(table) === sourceId && table.status === 'Active');

            // If manual reload or dashboard is empty (Start Building screen), sync EVERYTHING in parallel
            if (isManualReload || dashboard.widgets.length === 0) {
                const { dataSources } = useDataStore.getState();
                dataSources
                    .filter(ds => ds.type === 'bigquery' || ds.type === 'excel')
                    .forEach(ds => requiredIds.add(ds.id));

                // Update ref to avoid repeated full syncs on unrelated state changes
                lastReloadTriggerRef.current = reloadTrigger;
            } else {
                if (dashboard.dataSourceId) requiredIds.add(dashboard.dataSourceId);
                if (selectedDataSourceId) requiredIds.add(selectedDataSourceId);
                dashboard.widgets.forEach(w => { if (w.dataSourceId) requiredIds.add(w.dataSourceId); });
            }

            // 2. Sync concurrently (2 at a time) to improve speed while maintaining stability
            // Browser limit is typically 6 connections per domain. 
            // Running 2 tables in parallel (each with internal concurrency) is a balanced approach.
            const MAX_CONCURRENT = 2;
            const dsIds = Array.from(requiredIds);

            const runSyncQueue = async () => {
                const queue = [...dsIds];

                // Set all pending BQ tables to queued status
                const { updateDataSource, getDataSource } = useDataStore.getState();
                queue.forEach(id => {
                    const ds = getDataSource(id);
                    const isTableActive = isSourceActive(id);

                    if (ds && ds.type === 'bigquery' && isTableActive && DataAssetService.needsSync(id)) {
                        updateDataSource(id, { syncStatus: 'queued' });
                    }
                });

                const workers = Array.from({ length: Math.min(queue.length, MAX_CONCURRENT) }).map(async () => {
                    while (queue.length > 0) {
                        if (signal.aborted) break;

                        const dsId = queue.shift();
                        if (!dsId) break;

                        const { dataSources } = useDataStore.getState();
                        const ds = dataSources.find(d => d.id === dsId);
                        const connection = connections.find(c => c.id === ds?.connectionId);

                        const isTableActive = isSourceActive(dsId);

                        if (ds && ds.type === 'bigquery' && connection && isTableActive && DataAssetService.needsSync(dsId)) {
                            // Retry logic loop to ensure 100% completion
                            let attempt = 0;
                            const MAX_RETRIES = 5;
                            let success = false;

                            while (attempt < MAX_RETRIES && !success && !signal.aborted) {
                                attempt++;
                                try {
                                    const clientId = process.env.GOOGLE_CLIENT_ID || '';
                                    const { getTokenForConnection } = await import('../../services/googleAuth');
                                    const validToken = await getTokenForConnection(connection, clientId);

                                    if (!validToken) {
                                        if (connection.authType === 'GoogleMail') setIsAuthRequired(true);
                                        break; // Cannot retry without token
                                    }

                                    if (validToken !== initialGoogleToken && connection.authType === 'GoogleMail') {
                                        setGlobalGoogleToken(validToken);
                                    }

                                    // Create granular controller for this table
                                    const tableController = new AbortController();
                                    tableAbortControllers.current.set(dsId, tableController);

                                    // If main queue aborted, abort table sync too
                                    const abortHandler = () => tableController.abort();
                                    signal.addEventListener('abort', abortHandler);

                                    console.log(`🚀 Starting sync for: ${ds.name} (Attempt ${attempt}/${MAX_RETRIES})`);
                                    await DataAssetService.syncTable(dsId, validToken, connection, {
                                        signal: tableController.signal
                                    });
                                    console.log(`✅ Finished sync for: ${ds.name}`);
                                    success = true;

                                    tableAbortControllers.current.delete(dsId);
                                    signal.removeEventListener('abort', abortHandler);
                                } catch (e: any) {
                                    tableAbortControllers.current.delete(dsId);
                                    if (e.name === 'AbortError') {
                                        console.log(`⏹️ Sync stopped for ${ds.name}`);
                                        break; // Don't retry if aborted manually
                                    } else {
                                        console.error(`Auto-sync failed for ${ds.name} (Attempt ${attempt})`, e);
                                        if (e.message === 'UNAUTHORIZED' && connection.authType === 'GoogleMail') {
                                            setIsAuthRequired(true);
                                            break; // Auth error, no point retrying immediately
                                        }

                                        // Wait before retry
                                        if (attempt < MAX_RETRIES) {
                                            const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
                                            console.log(`⏳ Retrying ${ds.name} in ${waitTime}ms...`);
                                            await new Promise(resolve => setTimeout(resolve, waitTime));
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
                await Promise.all(workers);
            };

            await runSyncQueue();
        };

        const timer = setTimeout(loadAllRequiredData, 500);
        return () => {
            clearTimeout(timer);
            // Don't abort the global queue on every small re-render, 
            // but we might want to if the component unmounts.
        };
    }, [activeDashboardId, selectedDataSourceId, initialGoogleToken, connections, reloadTrigger]);

    const handleCreateFolder = (name: string, parentId?: string) => {
        createFolder(name, parentId, currentUser.id);
    };

    const handleCreateDashboard = (folderId?: string) => {
        createDashboard({
            title: 'New Dashboard',
            folderId,
            widgets: [],
            createdBy: currentUser.id
        });
    };

    const handleSelectDataSource = (dsId: string) => {
        if (activeDashboard) {
            // Sync to active page if exists, otherwise to dashboard
            if (activeDashboard.pages && activeDashboard.activePageId) {
                const updatedPages = activeDashboard.pages.map(p =>
                    p.id === activeDashboard.activePageId ? { ...p, dataSourceId: dsId } : p
                );
                updateDashboard(activeDashboard.id, { pages: updatedPages, dataSourceId: dsId });
                syncPageDataSource(activeDashboard.id, activeDashboard.activePageId, dsId);
            } else {
                updateDashboard(activeDashboard.id, { dataSourceId: dsId });
                syncDashboardDataSource(activeDashboard.id, dsId);
            }
            setSelectedDataSource(dsId);
            setActiveVisualTab('data');
        }
    };

    const handleClearDataSource = () => {
        if (activeDashboard) {
            if (activeDashboard.pages && activeDashboard.activePageId) {
                const updatedPages = activeDashboard.pages.map(p =>
                    p.id === activeDashboard.activePageId ? { ...p, dataSourceId: undefined } : p
                );
                updateDashboard(activeDashboard.id, { pages: updatedPages, dataSourceId: undefined });
            } else {
                updateDashboard(activeDashboard.id, { dataSourceId: undefined });
            }
            setSelectedDataSource(null);
        }
    };

    const handleAddWidget = (type: string) => {
        if (!activeDashboard) return;

        let newWidget: Omit<BIWidget, 'id'>;

        if (type === 'card') {
            newWidget = { type: 'card', title: 'New KPI Card', x: 0, y: Infinity, w: 3, h: 3, enableCrossFilter: true };
        } else if (type === 'table') {
            newWidget = { type: 'table', title: 'New Table', x: 0, y: Infinity, w: 6, h: 4, enableCrossFilter: true };
        } else if (type === 'gauge') {
            newWidget = { type: 'gauge', title: 'New Gauge', x: 0, y: Infinity, w: 3, h: 3, enableCrossFilter: false };
        } else if (type === 'slicer') {
            newWidget = { type: 'slicer', title: 'Filter', x: 0, y: Infinity, w: 3, h: 4, slicerMode: 'list', multiSelect: true, enableCrossFilter: false };
        } else if (type === 'date-range') {
            newWidget = { type: 'date-range', title: 'Date Range', x: 0, y: Infinity, w: 4, h: 2, enableCrossFilter: false };
        } else if (type === 'search') {
            newWidget = { type: 'search', title: 'Search', x: 0, y: Infinity, w: 4, h: 2, enableCrossFilter: false };
        } else if (type === 'pivot') {
            newWidget = { type: 'pivot', title: 'Pivot Table', x: 0, y: Infinity, w: 12, h: 6, pivotRows: [], pivotCols: [], pivotValues: [] };
        } else {
            newWidget = {
                type: 'chart',
                title: 'New Chart',
                x: 0, y: Infinity, w: 6, h: 4,
                chartType: type as ChartType,
                stacked: type === 'stackedBar',
                enableCrossFilter: true,
                showLegend: true,
                showGrid: true,
                showLabels: false,
                legendPosition: 'bottom'
            };
        }

        // Data source inheritance is handled by the dashboardStore.addWidget method

        addWidget(activeDashboard.id, newWidget);
        setRightPanelOpen(true);
        setActiveVisualTab('data');
    };

    const handleUpdateDashboard = (dashboard: typeof activeDashboard) => {
        if (dashboard) {
            updateDashboard(dashboard.id, dashboard);
        }
    };

    const handleExport = (format: 'pdf' | 'png' | 'json') => {
        if (!activeDashboard) return;
        if (format === 'json') ExportService.exportToJSON(activeDashboard);
        else if (format === 'pdf') ExportService.exportToPDF('bi-canvas-export', activeDashboard.title);
        else if (format === 'png') ExportService.exportToPNG('bi-canvas-export', activeDashboard.title);
    };

    const isHydrated = useDashboardStore(state => state.isHydrated);
    const isDataHydrated = useDataStore(state => state.isHydrated);

    if (domain && (!isHydrated || !isDataHydrated)) {
        return (
            <div className="flex h-screen items-center justify-center bg-white dark:bg-[#020617] text-slate-900 dark:text-white transition-colors duration-300">
                <div className="text-center">
                    <i className="fas fa-circle-notch fa-spin text-4xl text-indigo-500 mb-4"></i>
                    <p className="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest text-xs animate-pulse">Initializing Dashboard Engine...</p>
                </div>
            </div>
        );
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
        >
            <div className="flex h-screen bg-white dark:bg-[#020617] text-slate-900 dark:text-white transition-colors duration-300">
                {/* Left Sidebar */}
                {leftPanelOpen ? (
                    <div style={{ width: leftPanelWidth }} className="border-r border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-950 flex flex-col relative group shrink-0 transition-[width] duration-0 ease-linear">
                        {/* Resizer */}
                        <div
                            className="absolute top-0 -right-1 w-2 h-full cursor-col-resize z-[100] transition-opacity bg-transparent hover:bg-indigo-500/50 dark:hover:bg-indigo-400/50"
                            onMouseDown={startResizing('left')}
                        />
                        {/* Visual Separator */}
                        <div className="absolute top-0 right-0 w-[1px] h-full bg-slate-200 dark:bg-white/10 group-hover:bg-indigo-500 dark:group-hover:bg-indigo-400 transition-colors" />

                        {/* Panel Toggle Button */}
                        <button
                            onClick={() => setLeftPanelOpen(false)}
                            className="absolute -right-3 bottom-6 w-6 h-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/20 rounded-full flex items-center justify-center text-slate-400 hover:text-indigo-600 dark:hover:text-white transition-all z-50 shadow-xl hover:bg-slate-50 dark:hover:bg-slate-700 font-black"
                            title={t('bi.collapse_left_panel')}
                        >
                            <i className="fas fa-chevron-left text-[10px]"></i>
                        </button>

                        <div className="flex-1 overflow-hidden">
                            <BISidebar
                                folders={folders}
                                dashboards={dashboards}
                                currentUserId={currentUser.id}
                                activeDashboardId={activeDashboardId}
                                onSelectDashboard={setActiveDashboard}
                                onCreateFolder={handleCreateFolder}
                                onCreateDashboard={handleCreateDashboard}
                                onReloadDataSource={handleReloadDataSource}
                                onStopDataSource={handleStopSync}
                                onSelectDataSource={handleSelectDataSource}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="w-0 relative">
                        <button
                            onClick={() => setLeftPanelOpen(true)}
                            className="absolute left-6 bottom-6 w-10 h-10 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 rounded-2xl flex items-center justify-center text-indigo-400 shadow-2xl transition-all z-[60] hover:scale-110 active:scale-95"
                            title={t('bi.expand_left_panel')}
                        >
                            <i className="fas fa-folder-open"></i>
                        </button>
                    </div>
                )}

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col min-w-0 relative">

                    {activeDashboard ? (
                        <div className="flex-1 flex flex-col overflow-hidden">
                            {isAuthRequired && bqConn?.authType === 'GoogleMail' && (
                                <div className="bg-indigo-600 px-10 py-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest animate-in slide-in-from-top duration-500 z-[60]">
                                    <div className="flex items-center gap-3">
                                        <i className="fas fa-lock animate-pulse"></i>
                                        <span>BigQuery Connection Expired or Invalid</span>
                                    </div>
                                    <button
                                        onClick={handleReAuth}
                                        className="bg-white text-indigo-600 px-4 py-1 rounded-lg hover:bg-white/90 transition-all shadow-lg active:scale-95"
                                    >
                                        Re-Link Account
                                    </button>
                                </div>
                            )}
                            <DashboardToolbar
                                dashboardId={activeDashboard.id}
                                currentUserId={currentUser.id}
                                onExport={handleExport}
                                onToggleVisualBuilder={() => setRightPanelOpen(!rightPanelOpen)}
                                isVisualBuilderOpen={rightPanelOpen}
                                onReload={() => handleManualReload(false)}
                                isSyncing={dataSources.some(ds => ds.syncStatus === 'syncing' || ds.isLoadingPartial)}
                                onStopAllJobs={handleStopAllSyncs}
                                // Canvas Controls
                                zoom={zoom}
                                onZoomIn={() => setZoom(z => Math.min(2, z + 0.1))}
                                onZoomOut={() => setZoom(z => Math.max(0.5, z - 0.1))}
                                onZoomReset={() => setZoom(1)}
                                showGrid={showGrid}
                                onToggleGrid={() => setShowGrid(!showGrid)}
                                previewMode={previewMode}
                                onSetPreviewMode={setPreviewMode}
                                selectedCount={selectedWidgetIds.length}
                                onAlign={(dir) => useDashboardStore.getState().alignWidgets(dir)}
                            />

                            <div className="flex-1 relative overflow-hidden bg-slate-50 dark:bg-[#020617]/50 flex flex-col">
                                {/* Filter Bar at the top */}
                                <GlobalFilterBar dashboard={activeDashboard} />

                                <div className="flex-1 relative overflow-hidden flex flex-col">

                                    <div id="bi-canvas-export" className="flex-1 w-full overflow-auto custom-scrollbar relative">
                                        <div
                                            style={{
                                                transform: `scale(${zoom})`,
                                                transformOrigin: 'top left',
                                                transition: 'transform 0.2s',
                                                width: previewMode === 'desktop' ? '100%' : previewMode === 'tablet' ? '768px' : '375px',
                                                margin: previewMode !== 'desktop' ? '0 auto' : undefined,
                                                minHeight: '100%',
                                                padding: '16px'
                                            }}
                                            className={showGrid ? "" : "no-grid"}
                                        >
                                            <BICanvas
                                                dashboard={activeDashboard}
                                                onUpdateDashboard={handleUpdateDashboard}
                                                onEditWidget={(id) => {
                                                    setEditingWidget(id);
                                                    setRightPanelOpen(true);
                                                    setActiveVisualTab('data'); // Automatically switch to Config tab when editing
                                                }}
                                                onAddWidget={handleAddWidget}
                                                dataSources={dataSources}
                                                onReloadDataSource={handleReloadDataSource}
                                                onStopDataSource={handleStopSync}
                                                onSelectDataSource={handleSelectDataSource}
                                                onClearDataSource={handleClearDataSource}
                                                setActiveVisualTab={setActiveVisualTab}
                                                readOnly={false}
                                            />
                                        </div>
                                    </div>

                                    {/* Page Navigation */}
                                    <PageTabs dashboard={activeDashboard} />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center flex-col text-slate-400 dark:text-slate-500">
                            <i className="fas fa-columns text-6xl mb-4 opacity-20"></i>
                            <p className="text-lg font-bold mb-2 text-slate-600 dark:text-slate-400">{t('bi.welcome')}</p>
                            <button onClick={() => handleCreateDashboard()} className="px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all shadow-lg active:scale-95">
                                <i className="fas fa-plus mr-2"></i> {t('bi.create_new_dashboard')}
                            </button>
                        </div>
                    )}
                </div>

                {/* Right Panel: Visual Builder */}
                {rightPanelOpen ? (
                    <div style={{ width: rightPanelWidth }} className="border-l border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-950 flex flex-col relative group shrink-0 transition-[width] duration-0 ease-linear">
                        {/* Resizer */}
                        <div
                            className="absolute top-0 -left-1 w-2 h-full cursor-col-resize z-[100] transition-opacity bg-transparent hover:bg-indigo-500/50 dark:hover:bg-indigo-400/50"
                            onMouseDown={startResizing('right')}
                        />
                        {/* Visual Separator */}
                        <div className="absolute top-0 left-0 w-[1px] h-full bg-slate-200 dark:bg-white/10 group-hover:bg-indigo-500 dark:group-hover:bg-indigo-400 transition-colors" />

                        {/* Panel Toggle Button */}
                        <button
                            onClick={() => setRightPanelOpen(false)}
                            className="absolute -left-3 bottom-6 w-6 h-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/20 rounded-full flex items-center justify-center text-slate-400 hover:text-indigo-600 dark:hover:text-white transition-all z-50 shadow-xl hover:bg-slate-50 dark:hover:bg-slate-700"
                            title={t('bi.collapse_right_panel')}
                        >
                            <i className="fas fa-chevron-right text-[10px]"></i>
                        </button>

                        <BIVisualBuilder
                            activeWidget={activeWidget}
                            activeTab={activeVisualTab}
                            setActiveTab={setActiveVisualTab}
                            onUpdateWidget={(w) => {
                                if (activeDashboard && w.id) {
                                    updateWidget(activeDashboard.id, w.id, w);
                                }
                            }}
                            onAddWidget={handleAddWidget}
                        />
                    </div>
                ) : (
                    <div className="w-0 relative">
                        <button
                            onClick={() => setRightPanelOpen(true)}
                            className="absolute right-4 bottom-6 w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-indigo-600/30 hover:scale-110 active:scale-95 transition-all z-[60]"
                            title={t('bi.expand_right_panel')}
                        >
                            <i className="fas fa-chart-bar"></i>
                        </button>
                    </div>
                )}

                {/* AI Advisor Chat */}
                {activeDashboard && <DashboardAIChat dashboard={activeDashboard} />}
            </div>
        </DndContext>
    );
};

export default BIMain;
