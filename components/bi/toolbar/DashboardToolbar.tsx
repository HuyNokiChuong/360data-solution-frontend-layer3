
import React, { useState, useRef } from 'react';
import { BIDashboard } from '../types';

interface DashboardToolbarProps {
    dashboard: BIDashboard | null;
    onSave?: (dashboard: BIDashboard) => void;
    onLoad?: (dashboard: BIDashboard) => void;
    onExportPNG?: () => void;
    onExportPDF?: () => void;
    onExportJSON?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
}

const DashboardToolbar: React.FC<DashboardToolbarProps> = ({
    dashboard,
    onSave,
    onLoad,
    onExportPNG,
    onExportPDF,
    onExportJSON,
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false
}) => {
    const [showExportMenu, setShowExportMenu] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSave = () => {
        if (dashboard && onSave) {
            onSave(dashboard);
        }
    };

    const handleLoadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onLoad) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                onLoad(json);
            } catch (error) {
                console.error('Failed to load dashboard:', error);
                alert('Failed to load dashboard file');
            }
        };
        reader.readAsText(file);

        // Reset input
        e.target.value = '';
    };

    const handleExportJSON = () => {
        if (!dashboard || !onExportJSON) return;
        onExportJSON();
        setShowExportMenu(false);
    };

    return (
        <div className="h-14 bg-slate-900/50 border-b border-white/5 flex items-center justify-between px-4">
            {/* Left Section - Dashboard Info */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <i className="fas fa-chart-line text-indigo-400 text-lg"></i>
                    <div>
                        <h1 className="text-sm font-bold text-slate-200">
                            {dashboard?.title || 'Untitled Dashboard'}
                        </h1>
                        <p className="text-[10px] text-slate-500">
                            {dashboard?.widgets.length || 0} widgets
                        </p>
                    </div>
                </div>
            </div>

            {/* Center Section - Actions */}
            <div className="flex items-center gap-2">
                {/* Undo/Redo */}
                <div className="flex items-center gap-1 mr-2">
                    <button
                        onClick={onUndo}
                        disabled={!canUndo}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${canUndo
                                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                                : 'bg-slate-900/50 text-slate-600 cursor-not-allowed'
                            }`}
                        title="Undo (Ctrl+Z)"
                    >
                        <i className="fas fa-undo"></i>
                    </button>
                    <button
                        onClick={onRedo}
                        disabled={!canRedo}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${canRedo
                                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                                : 'bg-slate-900/50 text-slate-600 cursor-not-allowed'
                            }`}
                        title="Redo (Ctrl+Y)"
                    >
                        <i className="fas fa-redo"></i>
                    </button>
                </div>

                {/* Save */}
                <button
                    onClick={handleSave}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-all"
                    title="Save Dashboard"
                >
                    <i className="fas fa-save mr-2"></i>
                    Save
                </button>

                {/* Load */}
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg transition-all"
                    title="Load Dashboard"
                >
                    <i className="fas fa-folder-open mr-2"></i>
                    Load
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleLoadFile}
                    className="hidden"
                />

                {/* Export Menu */}
                <div className="relative">
                    <button
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg transition-all"
                        title="Export Dashboard"
                    >
                        <i className="fas fa-download mr-2"></i>
                        Export
                        <i className={`fas fa-chevron-down ml-2 text-[10px] transition-transform ${showExportMenu ? 'rotate-180' : ''}`}></i>
                    </button>

                    {showExportMenu && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setShowExportMenu(false)}
                            ></div>
                            <div className="absolute right-0 mt-2 w-48 bg-slate-800 border border-white/10 rounded-lg shadow-xl z-20 overflow-hidden">
                                <button
                                    onClick={handleExportJSON}
                                    className="w-full px-4 py-2 text-left text-xs text-slate-300 hover:bg-slate-700 transition-colors flex items-center gap-2"
                                >
                                    <i className="fas fa-file-code text-blue-400"></i>
                                    Export as JSON
                                </button>
                                <button
                                    onClick={() => {
                                        onExportPNG?.();
                                        setShowExportMenu(false);
                                    }}
                                    className="w-full px-4 py-2 text-left text-xs text-slate-300 hover:bg-slate-700 transition-colors flex items-center gap-2"
                                >
                                    <i className="fas fa-image text-green-400"></i>
                                    Export as PNG
                                </button>
                                <button
                                    onClick={() => {
                                        onExportPDF?.();
                                        setShowExportMenu(false);
                                    }}
                                    className="w-full px-4 py-2 text-left text-xs text-slate-300 hover:bg-slate-700 transition-colors flex items-center gap-2"
                                >
                                    <i className="fas fa-file-pdf text-red-400"></i>
                                    Export as PDF
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Right Section - View Options */}
            <div className="flex items-center gap-2">
                <button
                    className="px-3 py-1.5 bg-slate-800/50 hover:bg-slate-700 text-slate-400 text-xs rounded-lg transition-all"
                    title="View Settings"
                >
                    <i className="fas fa-cog"></i>
                </button>
                <button
                    className="px-3 py-1.5 bg-slate-800/50 hover:bg-slate-700 text-slate-400 text-xs rounded-lg transition-all"
                    title="Fullscreen"
                >
                    <i className="fas fa-expand"></i>
                </button>
            </div>
        </div>
    );
};

export default DashboardToolbar;
