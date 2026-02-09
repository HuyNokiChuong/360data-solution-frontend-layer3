
import React, { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatMessage as ChatMessageType, SyncedTable } from '../../types';
import { ChatMessage } from './ChatMessage';
import { AI_MODELS } from '../../constants';

interface ChatInterfaceProps {
    messages: ChatMessageType[];
    isLoading: boolean;
    onSend: (text: string, model?: any) => void;
    onUpdateChartSQL?: (messageId: string, chartIndex: number, newSQL: string) => void;
    onUpdateMainSQL?: (messageId: string, newSQL: string) => void;
    availableTables: SyncedTable[];
    selectedTableIds: string[];
    onToggleTable: (id: string) => void;
    onSelectAllTables: () => void;
    onDeselectAllTables: () => void;
    onReauth?: () => void;
    onStop?: () => void;
    onEditMessage?: (messageId: string, newText: string) => void;
    isAdmin: boolean;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
    messages,
    isLoading,
    onSend,
    onUpdateChartSQL,
    onUpdateMainSQL,
    availableTables,
    selectedTableIds,
    onToggleTable,
    onSelectAllTables,
    onDeselectAllTables,
    onReauth,
    onStop,
    onEditMessage,
    isAdmin
}) => {
    const navigate = useNavigate();
    const [input, setInput] = useState('');
    const [activeTab, setActiveTab] = useState<'analysis' | 'data'>('analysis');
    const [isSaving, setIsSaving] = useState(false);
    const [selectedModelId, setSelectedModelId] = useState(localStorage.getItem('preferred_ai_model') || 'gemini-2.0-flash');
    const [showModelSelector, setShowModelSelector] = useState(false);

    const endRef = useRef<HTMLDivElement>(null);
    const modelSelectorRef = useRef<HTMLDivElement>(null);

    const selectedModel = AI_MODELS.find(m => m.id === selectedModelId) || AI_MODELS[0];

    useEffect(() => {
        if (activeTab === 'analysis') {
            endRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isLoading, activeTab]);

    // Click outside listener for model selector
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
                setShowModelSelector(false);
            }
        };

        if (showModelSelector) {
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showModelSelector]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;
        onSend(input, selectedModel);
        setInput('');
    };

    const selectModel = (id: string) => {
        setSelectedModelId(id);
        localStorage.setItem('preferred_ai_model', id);
        setShowModelSelector(false);
    };

    const handleSaveSelection = () => {
        setIsSaving(true);
        setTimeout(() => {
            setIsSaving(false);
            setActiveTab('analysis');
        }, 600);
    };

    return (
        <div className="flex-1 flex flex-col h-full relative overflow-hidden bg-white dark:bg-slate-950/50">
            {/* Header with Tabs */}
            <header className="h-20 border-b border-slate-200 dark:border-white/5 flex items-center justify-between px-10 shrink-0 bg-white/80 dark:bg-[#020617]/80 backdrop-blur-md sticky top-0 z-50">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-4">
                        <div className={`w-2.5 h-2.5 rounded-full ${isLoading ? 'bg-amber-500 animate-ping' : 'bg-emerald-500 shadow-[0_0_10px_#10b981]'}`}></div>
                        <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-[0.4em]">
                            {isLoading ? 'Processing Query...' : '360DATA AI ENGINE'}
                        </h2>
                    </div>

                    {onReauth && (
                        <button
                            onClick={onReauth}
                            className="text-[9px] font-black text-slate-500 uppercase tracking-widest hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center gap-2 border border-slate-200 dark:border-white/5 px-3 py-1.5 rounded-lg"
                            title="Refresh BigQuery Connection"
                        >
                            <i className="fas fa-sync-alt text-[8px]"></i>
                            Refresh Link
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-6">
                    {/* Model Indicator in Header */}
                    <div className="relative" ref={modelSelectorRef}>
                        <button
                            onClick={() => setShowModelSelector(!showModelSelector)}
                            className="flex items-center gap-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-2 rounded-xl hover:bg-slate-200 dark:hover:bg-white/10 transition-all group"
                        >
                            <i className={`${selectedModel.brandIcon} text-sm text-slate-900 dark:text-white`}></i>
                            <span className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-widest">{selectedModel.name}</span>
                            <i className={`fas fa-chevron-down text-[8px] text-slate-400 dark:text-slate-500 transition-transform ${showModelSelector ? 'rotate-180' : ''}`}></i>
                        </button>

                        {showModelSelector && (
                            <div className="absolute top-12 mt-2 right-0 w-64 bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-2 z-[60] animate-in fade-in zoom-in-95 duration-200">
                                <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest px-3 py-2 mb-1">Select Engine</div>
                                {AI_MODELS.map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => selectModel(m.id)}
                                        className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${selectedModelId === m.id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-white/5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                                    >
                                        <i className={`${m.brandIcon} text-xs`}></i>
                                        <div className="text-left">
                                            <div className="text-[10px] font-black uppercase tracking-tight">{m.name}</div>
                                            <div className="text-[8px] opacity-70 font-bold">{m.label}</div>
                                        </div>
                                    </button>
                                ))}
                                <div className="mt-2 pt-2 border-t border-white/5">
                                    <button
                                        onClick={() => navigate('/ai-config')}
                                        className="w-full p-2 text-[8px] font-black text-indigo-400 uppercase tracking-widest hover:text-indigo-300 transition-colors"
                                    >
                                        Manage API Keys
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex bg-slate-100 dark:bg-slate-900/50 p-1 rounded-xl border border-slate-200 dark:border-white/5">
                        <button
                            onClick={() => setActiveTab('analysis')}
                            className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'analysis'
                                ? 'bg-indigo-600 text-white shadow-lg'
                                : 'text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            Analysis
                        </button>
                        <button
                            onClick={() => setActiveTab('data')}
                            className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'data'
                                ? 'bg-indigo-600 text-white shadow-lg'
                                : 'text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            Data Assets
                            {selectedTableIds.length > 0 && (
                                <span className="bg-white/20 px-1.5 py-0.5 rounded text-[8px]">{selectedTableIds.length}</span>
                            )}
                        </button>
                    </div>
                </div>
            </header>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                {activeTab === 'analysis' ? (
                    <div className="flex-1 overflow-y-auto p-4 md:p-10 custom-scrollbar scroll-smooth">
                        {(messages.length === 0 && !isLoading) ? (
                            <div className="flex flex-col items-center justify-center h-full opacity-30 select-none text-center">
                                <i className="fas fa-magic text-6xl mb-6 text-indigo-500 animate-pulse"></i>
                                <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-widest mb-2">Ready to Build</h3>
                                <p className="text-sm font-bold text-slate-500">
                                    {isAdmin ? 'Choose tables in Data Assets and ask a question.' : 'Ask a question based on current data context.'}
                                </p>
                            </div>
                        ) : (
                            <div className="max-w-[96%] mx-auto space-y-12">
                                {messages.map((msg) => (
                                    <ChatMessage
                                        key={msg.id}
                                        message={msg}
                                        onUpdateChartSQL={onUpdateChartSQL}
                                        onUpdateMainSQL={onUpdateMainSQL}
                                        onEdit={onEditMessage}
                                    />
                                ))}

                                {isLoading && (
                                    <div className="flex justify-start animate-in fade-in slide-in-from-left-4 duration-500 relative group">
                                        <div className="flex flex-col gap-4 max-w-[90%]">
                                            <div className="flex items-center gap-3 px-2">
                                                <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 shadow-lg">
                                                    <i className="fas fa-robot text-[10px]"></i>
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                                                    Precision AI
                                                </span>
                                            </div>
                                            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-indigo-500/20 p-6 rounded-[2rem] shadow-2xl backdrop-blur-sm relative overflow-hidden">
                                                <div className="flex items-center gap-4 relative z-10">
                                                    <div className="flex gap-1.5">
                                                        <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                                        <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                                        <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
                                                    </div>
                                                    <span className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400 animate-pulse">
                                                        Analyzing specified data assets...
                                                    </span>
                                                </div>

                                                {/* Cancel Button Overlay */}
                                                <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px] z-20">
                                                    <button
                                                        onClick={onStop}
                                                        className="bg-red-500 text-white px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-red-500/20 transform translate-y-2 group-hover:translate-y-0 transition-all hover:bg-red-600 active:scale-95 flex items-center gap-2"
                                                    >
                                                        <i className="fas fa-stop text-[8px]"></i>
                                                        Cancel AI Job
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div ref={endRef} className="h-4" />
                            </div>
                        )}
                    </div>
                ) : (
                    /* Data Assets Selection Area */
                    <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
                        <div className="max-w-7xl mx-auto">
                            {!isAdmin && (
                                <div className="p-6 bg-amber-500/10 border border-amber-500/20 rounded-2xl mb-8 flex items-center gap-4 animate-in fade-in slide-in-from-top-4">
                                    <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500">
                                        <i className="fas fa-lock"></i>
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-black text-white uppercase tracking-widest">Read-Only View</h4>
                                        <p className="text-[10px] text-amber-400/70 font-bold mt-1">Only Administrators can modify the data asset selection for this analysis hub.</p>
                                    </div>
                                </div>
                            )}
                            <div className="flex justify-between items-center mb-10 border-b border-white/5 pb-6">
                                <div>
                                    <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Data Assets Selection</h3>
                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Select the tables you want the AI to include in its context.</p>
                                </div>
                                {isAdmin && (
                                    <div className="flex gap-4">
                                        <button
                                            onClick={onDeselectAllTables}
                                            className="text-[9px] font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors border border-white/5 px-4 py-2 rounded-lg"
                                        >
                                            Clear All
                                        </button>
                                        <button
                                            onClick={onSelectAllTables}
                                            className="text-[9px] font-black text-indigo-400 uppercase tracking-widest hover:text-indigo-300 transition-colors border border-indigo-500/20 px-4 py-2 rounded-lg bg-indigo-500/5"
                                        >
                                            Select All
                                        </button>
                                        <button
                                            onClick={handleSaveSelection}
                                            className={`text-[9px] font-black uppercase tracking-widest transition-all px-6 py-2 rounded-lg shadow-lg flex items-center gap-2 ${isSaving
                                                ? 'bg-emerald-600 text-white'
                                                : 'bg-indigo-600 text-white hover:bg-indigo-500 active:scale-95'
                                                }`}
                                        >
                                            {isSaving ? (
                                                <>
                                                    <i className="fas fa-check animate-bounce"></i>
                                                    Saved
                                                </>
                                            ) : (
                                                <>
                                                    <i className="fas fa-save"></i>
                                                    Save Selection
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {availableTables.map((table) => {
                                    const isSelected = selectedTableIds.includes(table.id);
                                    return (
                                        <div
                                            key={table.id}
                                            onClick={() => isAdmin && onToggleTable(table.id)}
                                            className={`p-6 rounded-2xl border transition-all group flex flex-col justify-between min-h-[140px] ${isSelected
                                                ? 'bg-indigo-600/10 border-indigo-500/50 shadow-lg shadow-indigo-600/10'
                                                : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/20'
                                                } ${isAdmin ? 'cursor-pointer' : 'cursor-default'}`}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                                                    <i className="fas fa-table text-xs"></i>
                                                </div>
                                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-white/20'}`}>
                                                    {isSelected && <i className="fas fa-check text-[8px] text-white"></i>}
                                                </div>
                                            </div>

                                            <div className="mt-4">
                                                <div className={`text-[11px] font-black uppercase tracking-wider mb-1 ${isSelected ? 'text-indigo-600 dark:text-white' : 'text-slate-500 dark:text-slate-400 group-hover:text-slate-950 dark:group-hover:text-white'}`}>
                                                    {table.tableName}
                                                </div>
                                                <div className="text-[9px] font-bold text-slate-600 truncate">
                                                    {table.datasetName}
                                                </div>
                                            </div>

                                            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-white/5 flex items-center justify-between">
                                                <span className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                                    {table.schema.length} Fields
                                                </span>
                                                <span className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                                    {table.rowCount?.toLocaleString() || 0} Rows
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {availableTables.length === 0 && (
                                <div className="text-center py-20 bg-slate-900/40 rounded-3xl border border-dashed border-white/5">
                                    <div className="text-slate-700 text-4xl mb-4"><i className="fas fa-database"></i></div>
                                    <h5 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">No Data Assets Synced Yet</h5>
                                    <p className="text-[9px] text-slate-500 dark:text-slate-600 mt-2 font-bold uppercase">Please connect to a source in the Data Pipeline section.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area (Only visible in Analysis Tab) */}
            {
                activeTab === 'analysis' && (
                    <div className="p-8 pt-4 bg-slate-50 dark:bg-[#020617] border-t border-slate-200 dark:border-white/5 shadow-2xl">
                        <form onSubmit={handleSubmit} className="relative max-w-[90%] mx-auto">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder={isLoading ? "AI is processing your request..." : `Ask ${selectedModel.name} for a report...`}
                                disabled={isLoading}
                                className="w-full bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-white/10 rounded-2xl pl-6 pr-20 py-5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all shadow-xl placeholder-slate-400 dark:placeholder-slate-600 font-medium"
                            />
                            <button
                                type="submit"
                                disabled={!input.trim() || isLoading || selectedTableIds.length === 0}
                                className="absolute right-3 top-2.5 bg-indigo-600 w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 active:scale-95 disabled:opacity-50 disabled:scale-100 transition-all"
                            >
                                {isLoading ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-paper-plane"></i>}
                            </button>
                        </form>
                        <div className="text-center mt-3">
                            <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest flex items-center justify-center gap-3">
                                <span className="bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20">
                                    Context: {selectedTableIds.length} Table{selectedTableIds.length !== 1 ? 's' : ''} Selected
                                </span>
                                •
                                <span className="flex items-center gap-2">
                                    <i className={selectedModel.brandIcon}></i>
                                    {selectedModel.name} Optimized
                                </span>
                            </span>
                        </div>
                    </div>
                )
            }
        </div >
    );
};
