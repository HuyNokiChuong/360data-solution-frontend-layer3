import React, { useState, useEffect, useRef } from 'react';
import { useDashboardStore } from './store/dashboardStore';
import { useFilterStore } from './store/filterStore';
import { useLanguageStore } from '../../store/languageStore';
import { ShareModal } from './modals/ShareModal';
import { SharePermission } from './types';

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
    isSyncing = false
}) => {
    const { t } = useLanguageStore();
    const {
        folders,
        dashboards,
        updateDashboard,
        undo,
        redo,
        canUndo,
        canRedo,
        setActiveDashboard,
        autoReloadInterval,
        setAutoReloadInterval,
        autoReloadSchedule,
        lastReloadTimestamp
    } = useDashboardStore();

    const { clearAllFilters, crossFilters } = useFilterStore();
    const hasActiveFilters = crossFilters.length > 0;

    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const activeDashboard = dashboards.find(d => d.id === dashboardId);
    const { shareDashboard } = useDashboardStore();

    const dashboard = dashboards.find(d => d.id === dashboardId);
    const [title, setTitle] = useState(dashboard?.title || '');
    const [showSettings, setShowSettings] = useState(false);
    const [reloadMode, setReloadMode] = useState<'interval' | 'cron'>(typeof autoReloadInterval === 'string' && autoReloadInterval.includes(' ') ? 'cron' : 'interval');
    const [nextReloadIn, setNextReloadIn] = useState<number | null>(null);
    const settingsRef = useRef<HTMLDivElement>(null);

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
    useEffect(() => {
        if (!dashboard) return;
        setSaveStatus('saving');
        const timer = setTimeout(() => {
            setSaveStatus('saved');
        }, 1500);
        return () => clearTimeout(timer);
    }, [dashboards, folders, dashboard?.globalFilters]);

    const handleClearFilters = () => {
        clearAllFilters();

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
        <header className="h-14 border-b border-white/5 bg-slate-900/50 flex items-center justify-between px-4">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 group">
                    <button
                        onClick={() => setActiveDashboard(null)}
                        className="p-2 rounded hover:bg-white/10 text-slate-400"
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
                            className="bg-transparent border-none text-lg font-bold text-white outline-none focus:ring-0 min-w-[200px] hover:bg-white/5 rounded px-2 -ml-2 transition-colors focus:bg-white/10"
                        />
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
                    </div>
                </div>

                <div className="h-6 w-px bg-white/10 mx-2"></div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={undo}
                        disabled={!canUndo()}
                        className={`p-2 rounded text-slate-400 transition-colors ${canUndo() ? 'hover:text-white hover:bg-white/10' : 'opacity-30 cursor-not-allowed'}`}
                        title={`${t('bi.undo')} (Cmd+Z)`}
                    >
                        <i className="fas fa-undo"></i>
                    </button>
                    <button
                        onClick={redo}
                        disabled={!canRedo()}
                        className={`p-2 rounded text-slate-400 transition-colors ${canRedo() ? 'hover:text-white hover:bg-white/10' : 'opacity-30 cursor-not-allowed'}`}
                        title={`${t('bi.redo')} (Cmd+Shift+Z)`}
                    >
                        <i className="fas fa-redo"></i>
                    </button>
                    <div className="h-6 w-px bg-white/10 mx-2"></div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={onReload}
                            className="p-2 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors relative group"
                            title={t('bi.reload_data')}
                        >
                            <i className="fas fa-sync-alt"></i>
                            {nextReloadIn !== null && (
                                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-indigo-600 text-white text-[9px] font-bold rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                    {Math.floor(nextReloadIn / 60)}m {nextReloadIn % 60}s
                                </div>
                            )}
                        </button>
                        {isSyncing && (
                            <button
                                onClick={onStopAllJobs}
                                className="p-2 rounded text-red-500 hover:bg-red-500/10 transition-colors"
                                title="Stop All Jobs"
                            >
                                <i className="fas fa-stop"></i>
                            </button>
                        )}
                        {nextReloadIn !== null && (
                            <span className="text-[10px] font-mono text-indigo-400 font-bold">
                                {Math.floor(nextReloadIn / 60)}:{String(nextReloadIn % 60).padStart(2, '0')}
                            </span>
                        )}
                        <div className="relative">
                            <button
                                onClick={() => setShowSettings(!showSettings)}
                                className={`p-2 rounded transition-colors ${showSettings ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                                title={t('bi.auto_reload_settings')}
                            >
                                <i className="fas fa-cog"></i>
                            </button>

                            {showSettings && (
                                <div
                                    ref={settingsRef}
                                    className="absolute left-0 top-full mt-2 w-64 bg-slate-900 border border-white/10 rounded-lg shadow-2xl z-50 p-3 overflow-visible animate-in fade-in zoom-in duration-200"
                                >
                                    {/* Selection Toggle */}
                                    <div className="flex p-1 bg-slate-800 rounded-lg mb-4 border border-white/5">
                                        <button
                                            onClick={() => setReloadMode('interval')}
                                            className={`flex-1 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${reloadMode === 'interval' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                                        >
                                            Interval
                                        </button>
                                        <button
                                            onClick={() => setReloadMode('cron')}
                                            className={`flex-1 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${reloadMode === 'cron' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                                        >
                                            Cron
                                        </button>
                                    </div>

                                    {reloadMode === 'interval' ? (
                                        <>
                                            <div className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Sync Frequency</div>
                                            <div className="grid grid-cols-4 gap-1 mb-4">
                                                {[0, 15, 30, 60].map((mins) => (
                                                    <button
                                                        key={mins}
                                                        onClick={() => setAutoReloadInterval(mins)}
                                                        className={`px-2 py-1.5 rounded text-[10px] font-bold transition-all border ${autoReloadInterval === mins ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-800 border-white/5 text-slate-400 hover:bg-white/5'}`}
                                                    >
                                                        {mins === 0 ? 'Off' : `${mins}m`}
                                                    </button>
                                                ))}
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Cron Expression</div>
                                            <div className="mb-3">
                                                <input
                                                    type="text"
                                                    placeholder="* * * * *"
                                                    value={typeof autoReloadInterval === 'string' ? autoReloadInterval : ''}
                                                    onChange={(e) => setAutoReloadInterval(e.target.value)}
                                                    className="w-full bg-slate-800 border-white/10 text-white text-[10px] rounded px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                                                />
                                            </div>
                                            <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-lg p-3 mb-4">
                                                <p className="text-[9px] text-slate-400 leading-relaxed mb-3">
                                                    To fully customize scheduling, use the "cron" syntax. You can specify minute, hour, day of month, month, and day of week.
                                                </p>
                                                <div className="space-y-1.5">
                                                    {[
                                                        { exp: '0 * * * *', desc: 'Every hour' },
                                                        { exp: '*/5 * * * *', desc: 'Every 5 mins' },
                                                        { exp: '5 4 * * *', desc: '4:05 AM UTC' },
                                                        { exp: '30 */4 * * *', desc: 'Min 30 every 4h' },
                                                        { exp: '0 0 */2 * *', desc: 'Every other day' },
                                                        { exp: '0 0 * * 1', desc: 'Every Monday' }
                                                    ].map(item => (
                                                        <div key={item.exp} className="flex items-center justify-between text-[8px]">
                                                            <code className="text-indigo-400 font-bold bg-indigo-500/10 px-1 rounded">{item.exp}</code>
                                                            <span className="text-slate-500 italic">{item.desc}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <p className="text-[8px] text-indigo-400/70 mt-3 font-medium flex items-center gap-1.5">
                                                    <i className="fas fa-external-link-alt text-[7px]"></i>
                                                    Use crontab.guru to generate syntax.
                                                </p>
                                            </div>
                                        </>
                                    )}

                                    <div className="h-px bg-white/5 my-3"></div>

                                    {/* Schedule management */}
                                    <div className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Fixed Time Syncs</div>
                                    <div className="space-y-1 mb-3 max-h-32 overflow-y-auto custom-scrollbar pr-1">
                                        {autoReloadSchedule.length === 0 ? (
                                            <div className="text-[10px] text-slate-600 italic py-2 text-center">No fixed times set</div>
                                        ) : (
                                            autoReloadSchedule.sort().map(time => (
                                                <div key={time} className="flex items-center justify-between bg-slate-800/50 rounded px-2 py-1 border border-white/5 group">
                                                    <span className="text-xs font-mono text-indigo-400 font-bold">{time}</span>
                                                    <button
                                                        onClick={() => setAutoReloadInterval(autoReloadInterval, autoReloadSchedule.filter(t => t !== time))}
                                                        className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        <i className="fas fa-times text-[10px]"></i>
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    <div className="flex gap-2 mb-4">
                                        <div className="relative flex-1">
                                            <i className="far fa-clock absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-[10px]"></i>
                                            <input
                                                type="time"
                                                className="w-full bg-slate-800 border-white/10 text-white text-[10px] rounded pl-7 pr-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500"
                                                id="new-schedule-time"
                                            />
                                        </div>
                                        <button
                                            onClick={() => {
                                                const input = document.getElementById('new-schedule-time') as HTMLInputElement;
                                                if (input.value && !autoReloadSchedule.includes(input.value)) {
                                                    setAutoReloadInterval(autoReloadInterval, [...autoReloadSchedule, input.value]);
                                                    input.value = '';
                                                }
                                            }}
                                            className="px-3 py-1.5 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 rounded text-[9px] font-black uppercase transition-all hover:bg-indigo-600 hover:text-white"
                                        >
                                            Add
                                        </button>
                                    </div>

                                    <button
                                        onClick={() => setShowSettings(false)}
                                        className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/40 hover:bg-indigo-500 active:scale-95"
                                    >
                                        Save & Close Settings
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Clear Filters Button */}
                {hasActiveFilters && (
                    <>
                        <div className="h-6 w-px bg-white/10 mx-2"></div>
                        <button
                            id="clear-filters-btn"
                            onClick={handleClearFilters}
                            className="px-3 py-1.5 rounded-lg bg-orange-600/20 hover:bg-orange-600/30 text-orange-400 text-xs font-bold transition-all flex items-center border border-orange-500/30"
                            title={t('bi.clear_filters')}
                        >
                            <i className="fas fa-times-circle mr-2"></i>
                            {t('bi.clear_filters')} ({crossFilters.length.toLocaleString()})
                        </button>
                    </>
                )}
            </div>

            <div className="flex items-center gap-3">
                {/* Canvas Controls (Moved from bottom) */}
                <div className="flex items-center gap-2 bg-slate-800/50 p-1 rounded-xl border border-white/5 mr-2">
                    {/* View Modes */}
                    <div className="flex items-center rounded-lg p-0 gap-1">
                        <button
                            onClick={() => onSetPreviewMode?.('desktop')}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${previewMode === 'desktop' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                            title="Desktop View"
                        >
                            <i className="fas fa-desktop text-[10px]"></i>
                        </button>
                        <button
                            onClick={() => onSetPreviewMode?.('tablet')}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${previewMode === 'tablet' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                            title="Tablet View"
                        >
                            <i className="fas fa-tablet-alt text-[10px]"></i>
                        </button>
                        <button
                            onClick={() => onSetPreviewMode?.('mobile')}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${previewMode === 'mobile' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                            title="Mobile View"
                        >
                            <i className="fas fa-mobile-alt text-[10px]"></i>
                        </button>
                    </div>

                    <div className="w-px h-6 bg-white/10 mx-1"></div>

                    {/* Alignment Controls - Only show when multiple selected */}
                    {selectedCount !== undefined && selectedCount > 1 && (
                        <>
                            <div className="flex items-center gap-1">
                                <button onClick={() => onAlign?.('left')} className="w-7 h-7 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center" title="Align Left">
                                    <i className="fas fa-align-left text-[10px]"></i>
                                </button>
                                <button onClick={() => onAlign?.('top')} className="w-7 h-7 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center" title="Align Top">
                                    <i className="fas fa-align-left rotate-90 text-[10px]"></i>
                                </button>
                            </div>
                            <div className="w-px h-6 bg-white/10 mx-1"></div>
                        </>
                    )}

                    {/* Grid Toggle */}
                    <button
                        onClick={onToggleGrid}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${showGrid ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                        title="Toggle Grid"
                    >
                        <i className="fas fa-border-all text-[10px]"></i>
                    </button>

                    <div className="w-px h-6 bg-white/10 mx-1"></div>

                    {/* Zoom Controls */}
                    <div className="flex items-center gap-2">
                        <span
                            onClick={onZoomReset}
                            className="text-[10px] font-black w-8 text-center cursor-pointer text-slate-300 hover:text-indigo-400 transition-colors select-none"
                            title="Reset Zoom"
                        >
                            {Math.round((zoom || 1) * 100)}%
                        </span>
                        <div className="flex items-center gap-0.5">
                            <button
                                onClick={onZoomOut}
                                className="w-6 h-6 rounded-md bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center transition-colors border border-white/5"
                            >
                                <i className="fas fa-minus text-[8px]"></i>
                            </button>
                            <button
                                onClick={onZoomIn}
                                className="w-6 h-6 rounded-md bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center transition-colors border border-white/5"
                            >
                                <i className="fas fa-plus text-[8px]"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-white/5 whitespace-nowrap">
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

                <div className="h-6 w-px bg-white/10 mx-2"></div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsShareModalOpen(true)}
                        className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white"
                        title="Share Dashboard"
                    >
                        <i className="fas fa-share-alt"></i>
                    </button>
                    <button
                        onClick={() => onExport?.('pdf')}
                        className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white"
                        title={t('bi.export_pdf')}
                    >
                        <i className="fas fa-file-pdf"></i>
                    </button>
                    <button
                        onClick={() => onExport?.('png')}
                        className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white"
                        title={t('bi.export_image')}
                    >
                        <i className="fas fa-image"></i>
                    </button>
                </div>

                <div className="h-6 w-px bg-white/10 mx-2"></div>

                <button
                    onClick={onToggleVisualBuilder}
                    className={`p-2 rounded hover:bg-white/10 transition-colors ${isVisualBuilderOpen ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-400'}`}
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
                    onSave={(perms) => {
                        shareDashboard(activeDashboard.id, perms);
                    }}
                />
            )
            }
        </header >
    );
};

export default DashboardToolbar;
