import { BIDashboard, BIWidget } from './types';
import { useDashboardStore } from './store/dashboardStore';
import { useLanguageStore } from '../../store/languageStore';
import React, { useState, useMemo } from 'react';
import SlicerWidget from './widgets/SlicerWidget';
import DateRangeWidget from './widgets/DateRangeWidget';
import SearchWidget from './widgets/SearchWidget';

interface GlobalFilterBarProps {
    dashboard: BIDashboard;
}

const GlobalFilterBar: React.FC<GlobalFilterBarProps> = ({ dashboard }) => {
    const { t } = useLanguageStore();
    const { updateWidget } = useDashboardStore();
    const [openFilterId, setOpenFilterId] = useState<string | null>(null);

    const globalFilters = useMemo(() => {
        const activePage = dashboard.pages?.find((p) => p.id === dashboard.activePageId);
        const pageWidgets = activePage ? activePage.widgets : (dashboard.widgets || []);

        return pageWidgets.filter(w => w.isGlobalFilter && ['slicer', 'date-range', 'search'].includes(w.type));
    }, [dashboard.pages, dashboard.widgets, dashboard.activePageId]);

    if (globalFilters.length === 0) return null;

    return (
        <div className="bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-white/5 px-6 py-2.5 flex items-center gap-3 overflow-visible z-[100] transition-colors duration-300">
            <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 mr-2 shrink-0">
                <i className="fas fa-filter text-[10px]"></i>
                <span className="text-[9px] font-black uppercase tracking-[2px]">{t('bi.filters_label')}</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                {globalFilters.map(widget => (
                    <div key={widget.id} className="relative">
                        {/* Filter Pill */}
                        <button
                            onClick={() => setOpenFilterId(openFilterId === widget.id ? null : widget.id)}
                            className={`
                                flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all
                                ${openFilterId === widget.id
                                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                                    : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:border-indigo-500 dark:hover:border-indigo-500/50 hover:text-indigo-600 dark:hover:text-white'
                                }
                            `}
                        >
                            <span className="text-[10px] font-bold truncate max-w-[100px]">{widget.title}</span>
                            <i className={`fas fa-chevron-down text-[8px] transition-transform ${openFilterId === widget.id ? 'rotate-180' : ''}`}></i>
                        </button>

                        {/* Dropdown Content - Always rendered but hidden if not open to allow filter hydration */}
                        <div className={openFilterId === widget.id ? "block" : "hidden"}>
                            <div
                                className="fixed inset-0 z-[110]"
                                onClick={() => setOpenFilterId(null)}
                            />
                            <div className="absolute top-full left-0 mt-2 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-indigo-500/30 rounded-2xl shadow-xl dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[120] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                <div className="px-3 py-2 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between">
                                    <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">{widget.title}</span>
                                    <button
                                        onClick={() => updateWidget(dashboard.id, widget.id, { isGlobalFilter: false })}
                                        className="text-slate-400 dark:text-slate-600 hover:text-red-500 p-1 transition-colors"
                                        title={t('bi.move_to_canvas')}
                                    >
                                        <i className="fas fa-external-link-alt text-[8px]"></i>
                                    </button>
                                </div>
                                <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                                    {widget.type === 'slicer' && <SlicerWidget widget={widget} isGlobalMode />}
                                    {widget.type === 'date-range' && <DateRangeWidget widget={widget} isGlobalMode />}
                                    {widget.type === 'search' && <SearchWidget widget={widget} isGlobalMode />}
                                </div>
                            </div>
                        </div>

                        {/* Headless Hydration: If the dropdown is NOT open, we still need to mount the widget to run its useEffect */}
                        {openFilterId !== widget.id && (
                            <div className="hidden">
                                {widget.type === 'slicer' && <SlicerWidget widget={widget} isGlobalMode />}
                                {widget.type === 'date-range' && <DateRangeWidget widget={widget} isGlobalMode />}
                                {widget.type === 'search' && <SearchWidget widget={widget} isGlobalMode />}
                            </div>
                        )}
                    </div>
                ))}

                <button
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-slate-200 dark:border-white/10 text-slate-400 dark:text-slate-600 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-300 dark:hover:border-indigo-500/30 transition-all font-medium"
                    title={t('bi.add_from_canvas')}
                >
                    <i className="fas fa-plus text-[8px]"></i>
                    <span className="text-[10px] font-bold">{t('bi.add_btn_small')}</span>
                </button>
            </div>
        </div>
    );
};

export default GlobalFilterBar;
