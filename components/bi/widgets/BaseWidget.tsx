// ============================================
// Base Widget Component
// ============================================

import React, { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BIWidget } from '../types';
import { useDashboardStore } from '../store/dashboardStore';
import { useFilterStore } from '../store/filterStore';
import { DrillDownService } from '../engine/DrillDownService';

interface BaseWidgetProps {
    widget: BIWidget;
    children: ReactNode;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    onExportExcel?: () => void;
    isSelected?: boolean;
    isFiltered?: boolean;
    loading?: boolean;
    loadingProgress?: number;
    error?: string;
    onClick?: (e: React.MouseEvent) => void;
    onAction?: {
        icon: string;
        onClick: () => void;
        title: string;
        color?: string;
    };
    allowOverflow?: boolean;
}

const BaseWidget: React.FC<BaseWidgetProps> = ({
    widget,
    children,
    onEdit,
    onDelete,
    onDuplicate,
    onExportExcel,
    isSelected = false,
    isFiltered = false,
    loading = false,
    loadingProgress,
    error,
    onClick,
    onAction,
    allowOverflow = false
}) => {
    const [isEditingTitle, setIsEditingTitle] = React.useState(false);
    const [isFullscreen, setIsFullscreen] = React.useState(false);
    const [titleValue, setTitleValue] = React.useState(widget.title);
    const { updateWidget, activeDashboardId } = useDashboardStore();

    React.useEffect(() => {
        setTitleValue(widget.title);
    }, [widget.title]);

    const handleTitleSubmit = () => {
        if (titleValue.trim() && activeDashboardId) {
            updateWidget(activeDashboardId, widget.id, { title: titleValue.trim() });
        }
        setIsEditingTitle(false);
    };

    const setDrillDown = useFilterStore(state => state.setDrillDown);
    const drillDownState = useFilterStore(state => state.drillDowns[widget.id]);

    // Determine hierarchy
    const hierarchy = (widget.drillDownHierarchy && widget.drillDownHierarchy.length > 0)
        ? widget.drillDownHierarchy
        : (widget.type === 'pivot' && widget.pivotRows && widget.pivotRows.length > 0)
            ? widget.pivotRows
            : [];

    const hasHierarchy = hierarchy.length > 0;

    const handleDrillUp = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (drillDownState) {
            const newState = DrillDownService.drillUp(drillDownState);
            setDrillDown(widget.id, newState);
        }
    };

    const handleDrillToNextLevel = (e: React.MouseEvent) => {
        e.stopPropagation();
        const currentState = drillDownState || DrillDownService.initDrillDown(widget);
        if (currentState) {
            const newState = DrillDownService.drillToNextLevel(currentState);
            if (newState) setDrillDown(widget.id, newState);
        }
    };

    const handleExpandNextLevel = (e: React.MouseEvent) => {
        e.stopPropagation();
        const currentState = drillDownState || DrillDownService.initDrillDown(widget);
        if (currentState) {
            const newState = DrillDownService.expandNextLevel(currentState);
            if (newState) setDrillDown(widget.id, newState);
        }
    };

    const content = (
        <div
            className={`
        ${isFullscreen ? 'fixed inset-0 z-[99999] w-screen h-screen bg-slate-50 dark:bg-[#020617]' : 'h-full bg-white dark:bg-slate-900/50 backdrop-blur-sm'} border 
        ${isSelected && !isFullscreen ? 'border-indigo-500 ring-2 ring-indigo-500/50' : 'border-slate-200 dark:border-white/10'}
        ${isFiltered ? 'ring-2 ring-yellow-500/50' : ''}
        ${widget.showShadow && !isFullscreen ? 'shadow-xl shadow-slate-200/50 dark:shadow-indigo-500/10' : ''}
        flex flex-col ${allowOverflow ? '' : 'overflow-hidden'} transition-all group/widget
      `}
            style={{
                fontFamily: widget.fontFamily,
                borderRadius: isFullscreen ? '0' : (widget.borderRadius !== undefined ? `${widget.borderRadius}px` : '0.5rem'),
                zIndex: isFullscreen ? 99999 : undefined
            }}
            onClick={onClick ? (e) => {
                // Prevent bubbling if clicking interactive elements inside
                const target = e.target as HTMLElement;
                if (target.closest('button') || target.closest('input') || target.closest('label') || target.closest('select')) return;
                onClick(e);
            } : undefined}
        >
            {/* Title Bar */}
            <div className="drag-handle flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-slate-900/30 cursor-move">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    {isEditingTitle ? (
                        <input
                            autoFocus
                            value={titleValue}
                            onChange={(e) => setTitleValue(e.target.value)}
                            onBlur={handleTitleSubmit}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleTitleSubmit();
                                if (e.key === 'Escape') {
                                    setTitleValue(widget.title);
                                    setIsEditingTitle(false);
                                }
                            }}
                            className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-[13px] px-2 py-0.5 rounded outline-none w-full border border-indigo-500 no-drag"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <h3
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                setIsEditingTitle(true);
                            }}
                            className="font-bold text-slate-800 dark:text-white truncate cursor-text hover:text-indigo-400 transition-all flex items-center gap-2 group/title no-drag"
                            style={{ fontSize: widget.fontSize ? `${widget.fontSize}px` : '0.875rem' }}
                            title="Double-click to rename"
                        >
                            {widget.title}
                            <i className="fas fa-pen text-[9px] text-slate-400 dark:text-slate-500 opacity-0 group-hover/widget:opacity-100 group-hover/title:text-indigo-400 transition-all"></i>
                        </h3>
                    )}
                    {isFiltered && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/10 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-500/30">
                            FILTERED
                        </span>
                    )}
                    {drillDownState && drillDownState.breadcrumbs.length > 0 && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 max-w-[200px] truncate shrink-0">
                            <i className="fas fa-sitemap text-[8px] text-indigo-500 dark:text-indigo-400"></i>
                            <span className="text-[9px] font-black text-indigo-600 dark:text-indigo-300 uppercase tracking-tighter">
                                {drillDownState.breadcrumbs.map(bc => bc.value).join(' / ')}
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1 no-drag">
                    {/* Drill Controls (Power BI Style) */}
                    {hasHierarchy && (
                        <div className="flex items-center gap-0.5 mr-2 pr-2 border-r border-slate-200 dark:border-white/10 shrink-0">
                            <button
                                onClick={handleDrillUp}
                                disabled={!drillDownState || drillDownState.currentLevel === 0}
                                className={`p-1.5 rounded transition-all ${drillDownState && drillDownState.currentLevel > 0
                                    ? 'text-indigo-500 dark:text-indigo-400 hover:bg-indigo-500/10 hover:scale-110'
                                    : 'text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-30'
                                    }`}
                                title="Drill Up"
                            >
                                <i className="fas fa-arrow-up text-[10px]"></i>
                            </button>
                            <button
                                onClick={handleDrillToNextLevel}
                                disabled={drillDownState && drillDownState.currentLevel >= hierarchy.length - 1}
                                className={`p-1.5 rounded transition-all ${!(drillDownState && drillDownState.currentLevel >= hierarchy.length - 1)
                                    ? 'text-indigo-500 dark:text-indigo-400 hover:bg-indigo-500/10 hover:scale-110'
                                    : 'text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-30'
                                    }`}
                                title="Drill to Next Level"
                            >
                                <i className="fas fa-angle-double-down text-[10px]"></i>
                            </button>
                            <button
                                onClick={handleExpandNextLevel}
                                disabled={drillDownState && drillDownState.currentLevel >= hierarchy.length - 1}
                                className={`p-1.5 rounded transition-all ${!(drillDownState && drillDownState.currentLevel >= hierarchy.length - 1)
                                    ? 'text-indigo-500 dark:text-indigo-400 hover:bg-indigo-500/10 hover:scale-110'
                                    : 'text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-30'
                                    }`}
                                title="Expand All Down"
                            >
                                <i className="fas fa-level-down-alt text-[10px]"></i>
                            </button>
                        </div>
                    )}
                    {onAction && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onAction.onClick();
                            }}
                            className={`p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 ${onAction.color || 'text-slate-500 dark:text-slate-400 hover:text-orange-500'}`}
                            title={onAction.title}
                        >
                            <i className={`fas ${onAction.icon} text-xs`}></i>
                        </button>
                    )}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsFullscreen(!isFullscreen);
                        }}
                        className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-indigo-500"
                        title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                    >
                        <i className={`fas fa-${isFullscreen ? 'compress' : 'expand'} text-xs`}></i>
                    </button>
                    {onExportExcel && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onExportExcel();
                            }}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-emerald-500"
                            title="Export Excel"
                        >
                            <i className="fas fa-file-download text-xs"></i>
                        </button>
                    )}
                    {onEdit && (
                        <button
                            onClick={onEdit}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-indigo-500"
                            title="Edit"
                        >
                            <i className="fas fa-edit text-xs"></i>
                        </button>
                    )}
                    {onDuplicate && (
                        <button
                            onClick={onDuplicate}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-blue-500"
                            title="Duplicate"
                        >
                            <i className="fas fa-copy text-xs"></i>
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={onDelete}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 hover:text-red-500"
                            title="Delete"
                        >
                            <i className="fas fa-trash text-xs"></i>
                        </button>
                    )}
                </div>
            </div>

            {/* Content Area */}
            <div className={`flex-1 p-2 relative ${allowOverflow ? 'overflow-visible' : 'overflow-auto'}`}>
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-2">
                            <i className="fas fa-circle-notch fa-spin text-2xl text-indigo-500 dark:text-indigo-400"></i>
                            <div className="flex flex-col items-center">
                                <span className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest">Loading...</span>
                                {loadingProgress !== undefined && loadingProgress > 0 && (
                                    <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-black mt-1 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-500/20">
                                        {Math.round(loadingProgress)}%
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-2 text-center px-4">
                            <i className="fas fa-exclamation-triangle text-2xl text-red-500 dark:text-red-400"></i>
                            <span className="text-xs text-red-500 dark:text-red-400">{error}</span>
                        </div>
                    </div>
                )}

                {!loading && !error && children}
            </div>
        </div>
    );

    if (isFullscreen) {
        return (
            <>
                <div className="w-full h-full opacity-0 pointer-events-none" />
                {createPortal(content, document.body)}
            </>
        );
    }

    return content;
};

export default BaseWidget;
