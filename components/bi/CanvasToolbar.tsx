
// ============================================
// Canvas Toolbar - Zoom & View Controls
// ============================================

import React from 'react';

interface CanvasToolbarProps {
    zoom: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomReset: () => void;
    showGrid: boolean;
    onToggleGrid: () => void;
    previewMode: 'desktop' | 'tablet' | 'mobile';
    onSetPreviewMode: (mode: 'desktop' | 'tablet' | 'mobile') => void;
    selectedCount?: number;
    onAlign?: (direction: 'top' | 'bottom' | 'left' | 'right') => void;
}

const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
    zoom,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    showGrid,
    onToggleGrid,
    previewMode,
    onSetPreviewMode,
    selectedCount = 0,
    onAlign
}) => {
    return (
        <div className="absolute bottom-14 right-6 flex items-center bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl z-50 p-1.5 gap-2">
            {/* View Modes */}
            <div className="flex items-center bg-white/5 rounded-xl p-1">
                <button
                    onClick={() => onSetPreviewMode('desktop')}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${previewMode === 'desktop' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                    title="Desktop"
                >
                    <i className="fas fa-desktop text-xs"></i>
                </button>
                <button
                    onClick={() => onSetPreviewMode('tablet')}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${previewMode === 'tablet' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                    title="Tablet"
                >
                    <i className="fas fa-tablet-alt text-xs"></i>
                </button>
                <button
                    onClick={() => onSetPreviewMode('mobile')}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${previewMode === 'mobile' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                    title="Mobile"
                >
                    <i className="fas fa-mobile-alt text-xs"></i>
                </button>
            </div>

            {/* Separator */}
            <div className="w-px h-8 bg-white/10 mx-0.5"></div>

            {/* Alignment Controls - Only show when multiple selected */}
            {selectedCount !== undefined && selectedCount > 1 && (
                <>
                    <div className="flex items-center gap-1">
                        <button onClick={() => onAlign?.('left')} className="w-9 h-9 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center" title="Align Left">
                            <i className="fas fa-align-left text-xs"></i>
                        </button>
                        <button onClick={() => onAlign?.('top')} className="w-9 h-9 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center" title="Align Top">
                            <i className="fas fa-align-left rotate-90 text-xs"></i>
                        </button>
                    </div>
                    <div className="w-px h-8 bg-white/10 mx-0.5"></div>
                </>
            )}

            {/* Grid Toggle */}
            <button
                onClick={onToggleGrid}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${showGrid ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                title="Toggle Grid"
            >
                <i className="fas fa-border-all text-xs"></i>
            </button>

            {/* Separator */}
            <div className="w-px h-8 bg-white/10 mx-0.5"></div>

            {/* Zoom Controls */}
            <div className="flex items-center bg-white/5 rounded-xl p-1 pr-1 gap-2">
                <span
                    onClick={onZoomReset}
                    className="text-[11px] font-black w-12 text-center cursor-pointer text-slate-300 hover:text-indigo-400 transition-colors select-none"
                    title="Reset Zoom"
                >
                    {Math.round(zoom * 100)}%
                </span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={onZoomOut}
                        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center transition-colors border border-white/5"
                    >
                        <i className="fas fa-minus text-[10px]"></i>
                    </button>
                    <button
                        onClick={onZoomIn}
                        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center transition-colors border border-white/5"
                    >
                        <i className="fas fa-plus text-[10px]"></i>
                    </button>
                </div>
            </div>

        </div>
    );
};

export default CanvasToolbar;
