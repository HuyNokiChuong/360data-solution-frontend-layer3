// ============================================
// Base Widget Component
// ============================================

import React, { ReactNode } from 'react';
import { BIWidget } from '../types';
import { useDashboardStore } from '../store/dashboardStore';

interface BaseWidgetProps {
    widget: BIWidget;
    children: ReactNode;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
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

    return (
        <div
            className={`
        h-full bg-slate-900/50 backdrop-blur-sm border 
        ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/50' : 'border-white/10'}
        ${isFiltered ? 'ring-2 ring-yellow-500/50' : ''}
        ${widget.showShadow ? 'shadow-2xl shadow-indigo-500/10' : ''}
        flex flex-col ${allowOverflow ? '' : 'overflow-hidden'} transition-all
      `}
            style={{
                fontFamily: widget.fontFamily,
                borderRadius: widget.borderRadius !== undefined ? `${widget.borderRadius}px` : '0.5rem'
            }}
            onClick={onClick ? (e) => {
                // Prevent bubbling if clicking interactive elements inside
                const target = e.target as HTMLElement;
                if (target.closest('button') || target.closest('input') || target.closest('label') || target.closest('select')) return;
                onClick(e);
            } : undefined}
        >
            {/* Title Bar */}
            <div className="drag-handle flex items-center justify-between px-3 py-2 border-b border-white/5 bg-slate-900/30 cursor-move">
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
                            className="bg-slate-800 text-white text-[13px] px-2 py-0.5 rounded outline-none w-full border border-indigo-500"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <h3
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                setIsEditingTitle(true);
                            }}
                            className="font-bold text-white truncate cursor-text hover:text-indigo-400 hover:scale-[1.02] transition-all"
                            style={{ fontSize: widget.fontSize ? `${widget.fontSize}px` : '0.875rem' }}
                            title="Double-click to rename"
                        >
                            {widget.title}
                        </h3>
                    )}
                    {isFiltered && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                            FILTERED
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-1 no-drag">
                    {onAction && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onAction.onClick();
                            }}
                            className={`p-1.5 rounded hover:bg-white/10 ${onAction.color || 'text-slate-400 hover:text-orange-400'}`}
                            title={onAction.title}
                        >
                            <i className={`fas ${onAction.icon} text-xs`}></i>
                        </button>
                    )}
                    {onEdit && (
                        <button
                            onClick={onEdit}
                            className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-indigo-400"
                            title="Edit"
                        >
                            <i className="fas fa-edit text-xs"></i>
                        </button>
                    )}
                    {onDuplicate && (
                        <button
                            onClick={onDuplicate}
                            className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-blue-400"
                            title="Duplicate"
                        >
                            <i className="fas fa-copy text-xs"></i>
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={onDelete}
                            className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-red-400"
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
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-2">
                            <i className="fas fa-circle-notch fa-spin text-2xl text-indigo-400"></i>
                            <div className="flex flex-col items-center">
                                <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Loading...</span>
                                {loadingProgress !== undefined && loadingProgress > 0 && (
                                    <span className="text-[10px] text-indigo-400 font-black mt-1 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                                        {Math.round(loadingProgress)}%
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm z-10">
                        <div className="flex flex-col items-center gap-2 text-center px-4">
                            <i className="fas fa-exclamation-triangle text-2xl text-red-400"></i>
                            <span className="text-xs text-red-400">{error}</span>
                        </div>
                    </div>
                )}

                {!loading && !error && children}
            </div>
        </div>
    );
};

export default BaseWidget;
