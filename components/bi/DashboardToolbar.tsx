import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useDashboardStore } from './store/dashboardStore';
import { useFilterStore } from './store/filterStore';
import { useLanguageStore } from '../../store/languageStore';
import { ShareModal } from './modals/ShareModal';
import { SharePermission, ShareSavePayload } from './types';

interface DashboardToolbarProps {
    dashboardId: string;
    onExport?: (format: 'pdf' | 'png' | 'json') => void;
    onToggleVisualBuilder?: () => void;
    isVisualBuilderOpen?: boolean;
    onReload?: () => void;
    // Canvas Controls
    zoom?: number;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onZoomReset?: () => void;
    showGrid?: boolean;
    onToggleGrid?: () => void;
    previewMode?: 'desktop' | 'tablet' | 'mobile';
    onSetPreviewMode?: (mode: 'desktop' | 'tablet' | 'mobile') => void;
    selectedCount?: number;
    onAlign?: (direction: 'top' | 'bottom' | 'left' | 'right') => void;
    onStopAllJobs?: () => void;
    isSyncing?: boolean;
    currentUserId?: string;
    currentUserEmail?: string;
}

const DashboardToolbar: React.FC<DashboardToolbarProps> = ({
    dashboardId,
    onExport,
    onToggleVisualBuilder,
    isVisualBuilderOpen,
    onReload,
    zoom = 1,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    showGrid = false,
    onToggleGrid,
    previewMode = 'desktop',
    onSetPreviewMode,
    selectedCount = 0,
    onAlign,
    onStopAllJobs,
    isSyncing = false,
    currentUserId,
    currentUserEmail
}) => {
    const { t } = useLanguageStore();
    const {
        folders,
        dashboards,
        updateDashboard,
        setActiveDashboard,
        autoReloadInterval,
        setAutoReloadInterval,
        autoReloadSchedule,
        lastReloadTimestamp
    } = useDashboardStore();

    const { clearAllFilters, crossFilters, removeCrossFilter } = useFilterStore();

    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const activeDashboard = dashboards.find(d => d.id === dashboardId);
    const { shareDashboard } = useDashboardStore();

    const dashboard = dashboards.find(d => d.id === dashboardId);
    const currentPageWidgetIds = useMemo(() => {
        if (!dashboard) return new Set<string>();
        const activePage = dashboard.pages?.find((p) => p.id === dashboard.activePageId);
        const pageWidgets = activePage ? activePage.widgets : (dashboard.widgets || []);
        return new Set(pageWidgets.map((w) => w.id));
    }, [dashboard?.id, dashboard?.activePageId, dashboard?.pages, dashboard?.widgets]);

    const currentPageCrossFilters = useMemo(() => {
        if (!dashboard || currentPageWidgetIds.size === 0) return [];

        return crossFilters.filter((cf) => {
            if (currentPageWidgetIds.has(cf.sourceWidgetId)) return true;
            return (cf.affectedWidgetIds || []).some((id) => currentPageWidgetIds.has(id));
        });
    }, [dashboard?.id, crossFilters, currentPageWidgetIds]);

    const hasActiveFilters = currentPageCrossFilters.length > 0;
    const [title, setTitle] = useState(dashboard?.title || '');
    const [showSettings, setShowSettings] = useState(false);
    const [reloadMode, setReloadMode] = useState<'interval' | 'cron'>(typeof autoReloadInterval === 'string' && autoReloadInterval.includes(' ') ? 'cron' : 'interval');
    const [nextReloadIn, setNextReloadIn] = useState<number | null>(null);
    const settingsRef = useRef<HTMLDivElement>(null);
    const normalizeIdentity = (value?: string) => String(value || '').trim().toLowerCase();
    const isCurrentUser = (value?: string) => {
        const candidate = normalizeIdentity(value);
        if (!candidate) return false;
        return candidate === normalizeIdentity(currentUserId) || candidate === normalizeIdentity(currentUserEmail);
    };
    const currentPermission = dashboard?.sharedWith?.find((p) => isCurrentUser(p.userId))?.permission;

    // Click outside to close settings
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
                setShowSettings(false);
            }
        };

        if (showSettings) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showSettings]);

    // Sync local state if dashboard changes
    useEffect(() => {
        if (dashboard) {
            setTitle(dashboard.title);
        }
    }, [dashboard?.id, dashboard?.title]);

    // Countdown timer for auto-reload events (Interval + Schedule)
    useEffect(() => {
        const updateCountdown = () => {
            const now = new Date();
            let minRemaining = Infinity;

            // 1. Check Interval
            if (typeof autoReloadInterval === 'number' && autoReloadInterval > 0 && lastReloadTimestamp) {
                const nextIntervalTime = lastReloadTimestamp + (autoReloadInterval * 60 * 1000);
                const remaining = Math.max(0, Math.floor((nextIntervalTime - now.getTime()) / 1000));
                minRemaining = Math.min(minRemaining, remaining);
            }

            // 1b. Check Cron (Simplified for now as requested)
            if (autoReloadInterval === '* * * 1 *') {
                // For now just treat it as 1m if it's the specific cron string
                // In a real app we'd use a cron parser
                if (lastReloadTimestamp) {
                    const nextIntervalTime = lastReloadTimestamp + (1 * 60 * 1000);
                    const remaining = Math.max(0, Math.floor((nextIntervalTime - now.getTime()) / 1000));
                    minRemaining = Math.min(minRemaining, remaining);
                }
            }

            // 2. Check Schedule
            if (autoReloadSchedule && autoReloadSchedule.length > 0) {
                autoReloadSchedule.forEach(time => {
                    const [hours, mins] = time.split(':').map(Number);
                    const scheduleDate = new Date();
                    scheduleDate.setHours(hours, mins, 0, 0);

                    if (scheduleDate.getTime() <= now.getTime()) {
                        scheduleDate.setDate(scheduleDate.getDate() + 1);
                    }

                    const remaining = Math.max(0, Math.floor((scheduleDate.getTime() - now.getTime()) / 1000));
                    minRemaining = Math.min(minRemaining, remaining);
                });
            }

            setNextReloadIn(minRemaining === Infinity ? null : minRemaining);
        };

        const timer = setInterval(updateCountdown, 1000);
        updateCountdown();
        return () => clearInterval(timer);
    }, [autoReloadInterval, autoReloadSchedule, lastReloadTimestamp]);

    const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');

    // Auto-save visual feedback
    // Use stable, scalar dependencies to avoid update loops from large array/object refs.
    useEffect(() => {
        if (!dashboard) return;
        setSaveStatus((prev) => (prev === 'saving' ? prev : 'saving'));
        const timer = setTimeout(() => {
            setSaveStatus('saved');
        }, 1500);
        return () => clearTimeout(timer);
    }, [
        dashboard?.id,
        dashboard?.updatedAt,
        dashboard?.widgets?.length,
        dashboard?.globalFilters?.length,
    ]);

    const handleClearFilters = () => {
        if (currentPageCrossFilters.length > 0) {
            const sourceIds = Array.from(new Set(currentPageCrossFilters.map((cf) => cf.sourceWidgetId)));
            sourceIds.forEach((sourceId) => removeCrossFilter(sourceId));
        } else {
            clearAllFilters();
        }

        // Visual feedback
        const btn = document.getElementById('clear-filters-btn');
        if (btn) {
            btn.classList.add('scale-95');
            setTimeout(() => {
                btn.classList.remove('scale-95');
            }, 150);
        }
    };

    if (!dashboard) return null;

    return (
        <header className="h-14 border-b border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/50 flex items-center justify-between px-4 transition-colors duration-300">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 group">
                    {/* Only show back button? Or title edit? */}
                    <button
                        onClick={() => setActiveDashboard(null)}
                        className="p-2 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                        title={t('bi.back_to_list')}
                    >
                        <i className="fas fa-arrow-left"></i>
                    </button>
                    <div className="relative flex items-center">
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            onBlur={() => updateDashboard(dashboard.id, { title })}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    updateDashboard(dashboard.id, { title });
                                    (e.target as HTMLInputElement).blur();
                                }
                            }}
                            disabled={currentPermission !== 'admin' && currentPermission !== 'edit' && !isCurrentUser(dashboard.createdBy)}
                            className="bg-transparent border-none text-lg font-bold text-slate-900 dark:text-white outline-none focus:ring-0 min-w-[200px] hover:bg-slate-50 dark:hover:bg-white/5 disabled:hover:bg-transparent rounded px-2 -ml-2 transition-colors focus:bg-slate-100 dark:focus:bg-white/10"
                        />
                        {(currentPermission === 'admin' || currentPermission === 'edit' || isCurrentUser(dashboard.createdBy)) && (
                            <button
                                className="ml-2 text-slate-500 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Edit Title"
                                onClick={(e) => {
                                    const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                                    input?.focus();
                                }}
                            >
                                <i className="fas fa-pen text-xs"></i>
                            </button>
                        )}
                    </div>
                </div>
                {/* Clear Filters Button */}
                {hasActiveFilters && (
                    <>
                        <div className="h-6 w-px bg-slate-200 dark:bg-white/10 mx-2"></div>
                        <button
                            id="clear-filters-btn"
                            onClick={handleClearFilters}
                            className="px-3 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-600/20 hover:bg-orange-100 dark:hover:bg-orange-600/30 text-orange-600 dark:text-orange-400 text-xs font-bold transition-all flex items-center border border-orange-100 dark:border-orange-500/30 shadow-sm"
                            title={t('bi.clear_filters')}
                        >
                            <i className="fas fa-times-circle mr-2"></i>
                            {t('bi.clear_filters')} ({currentPageCrossFilters.length.toLocaleString()})
                        </button>
                    </>
                )}
            </div>

            <div className="flex items-center gap-3">
                {/* Canvas Controls (Moved from bottom) */}
                <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800/50 p-1 rounded-xl border border-slate-200 dark:border-white/5 mr-2">
                    {/* View Modes */}
                    <div className="flex items-center rounded-lg p-0 gap-1">
                        <button
                            onClick={() => onSetPreviewMode?.('desktop')}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${previewMode === 'desktop' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/5'}`}
                            title="Desktop View"
                        >
                            <i className="fas fa-desktop text-[10px]"></i>
                        </button>
                        <button
                            onClick={() => onSetPreviewMode?.('tablet')}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${previewMode === 'tablet' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/5'}`}
                            title="Tablet View"
                        >
                            <i className="fas fa-tablet-alt text-[10px]"></i>
                        </button>
                        <button
                            onClick={() => onSetPreviewMode?.('mobile')}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${previewMode === 'mobile' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/5'}`}
                            title="Mobile View"
                        >
                            <i className="fas fa-mobile-alt text-[10px]"></i>
                        </button>
                    </div>

                    <div className="w-px h-6 bg-slate-200 dark:bg-white/10 mx-1"></div>

                    {/* Alignment Controls - Only show when multiple selected */}
                    {selectedCount !== undefined && selectedCount > 1 && (
                        <>
                            <div className="flex items-center gap-1">
                                <button onClick={() => onAlign?.('left')} className="w-7 h-7 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center" title="Align Left">
                                    <i className="fas fa-align-left text-[10px]"></i>
                                </button>
                                <button onClick={() => onAlign?.('top')} className="w-7 h-7 rounded-lg hover:bg-white/10 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center" title="Align Top">
                                    <i className="fas fa-align-left rotate-90 text-[10px]"></i>
                                </button>
                            </div>
                            <div className="w-px h-6 bg-slate-200 dark:bg-white/10 mx-1"></div>
                        </>
                    )}

                    {/* Grid Toggle */}
                    <button
                        onClick={onToggleGrid}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${showGrid ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/10'}`}
                        title="Toggle Grid"
                    >
                        <i className="fas fa-border-all text-[10px]"></i>
                    </button>

                    <div className="w-px h-6 bg-slate-200 dark:bg-white/10 mx-1"></div>

                    {/* Zoom Controls */}
                    <div className="flex items-center gap-2">
                        <span
                            onClick={onZoomReset}
                            className="text-[10px] font-black w-8 text-center cursor-pointer text-slate-500 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors select-none"
                            title="Reset Zoom"
                        >
                            {Math.round((zoom || 1) * 100)}%
                        </span>
                        <div className="flex items-center gap-0.5">
                            <button
                                onClick={onZoomOut}
                                className="w-6 h-6 rounded-md bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors border border-slate-200 dark:border-white/5"
                            >
                                <i className="fas fa-minus text-[8px]"></i>
                            </button>
                            <button
                                onClick={onZoomIn}
                                className="w-6 h-6 rounded-md bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors border border-slate-200 dark:border-white/5"
                            >
                                <i className="fas fa-plus text-[8px]"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-white/5 whitespace-nowrap shadow-sm">
                    {saveStatus === 'saving' ? (
                        <>
                            <i className="fas fa-circle-notch fa-spin text-indigo-400 text-[10px]"></i>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('bi.saving')}</span>
                        </>
                    ) : (
                        <>
                            <i className="fas fa-cloud-upload-alt text-green-500 text-[10px]"></i>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('bi.auto_saved')}</span>
                        </>
                    )}
                </div>

                <div className="h-6 w-px bg-slate-200 dark:bg-white/10 mx-2"></div>

                <div className="flex items-center gap-2">
                    {(currentPermission === 'admin' || isCurrentUser(dashboard.createdBy)) && (
                        <button
                            onClick={() => setIsShareModalOpen(true)}
                            className="p-2 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                            title="Share Dashboard"
                        >
                            <i className="fas fa-share-alt"></i>
                        </button>
                    )}
                    <button
                        onClick={() => onExport?.('pdf')}
                        className="p-2 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                        title={t('bi.export_pdf')}
                    >
                        <i className="fas fa-file-pdf"></i>
                    </button>
                    <button
                        onClick={() => onExport?.('png')}
                        className="p-2 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                        title={t('bi.export_image')}
                    >
                        <i className="fas fa-file-image"></i>
                    </button>
                </div>

                <div className="h-6 w-px bg-slate-200 dark:bg-white/10 mx-2"></div>

                <button
                    onClick={onToggleVisualBuilder}
                    className={`p-2 rounded hover:bg-slate-100 dark:hover:bg-white/10 transition-colors ${isVisualBuilderOpen ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30' : 'text-slate-500 dark:text-slate-400'}`}
                    title={t('bi.toggle_visual_builder')}
                >
                    <i className="fas fa-chart-bar"></i>
                </button>
            </div>

            {activeDashboard && (
                <ShareModal
                    isOpen={isShareModalOpen}
                    onClose={() => setIsShareModalOpen(false)}
                    title={activeDashboard.title}
                    itemType="dashboard"
                    permissions={activeDashboard.sharedWith || []}
                    dashboard={activeDashboard}
                    onSave={(email, payload: ShareSavePayload) => {
                        const dashboardRole = payload.roles['dashboard'];
                        const rlsCfg = payload.dashboardRLS[activeDashboard.id];
                        if (activeDashboard) {
                            let newPerms = [...(activeDashboard.sharedWith || [])].filter(p => p.userId !== email);
                            if (dashboardRole !== 'none') {
                                newPerms.push({
                                    userId: email,
                                    permission: dashboardRole,
                                    sharedAt: new Date().toISOString(),
                                    allowedPageIds: rlsCfg?.allowedPageIds || [],
                                    rls: rlsCfg || { allowedPageIds: [], rules: [] },
                                });
                            }
                            shareDashboard(activeDashboard.id, newPerms);
                        }
                    }}
                />
            )
            }
        </header >
    );
};

export default DashboardToolbar;
