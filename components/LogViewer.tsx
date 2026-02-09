
import React from 'react';
import { useDataStore } from './bi/store/dataStore';
import { useLanguageStore } from '../store/languageStore';

const LogViewer: React.FC = () => {
    const { systemLogs, clearLogs } = useDataStore();
    const { t } = useLanguageStore();

    return (
        <div className="flex-1 flex flex-col h-screen bg-[#020617] overflow-hidden">
            <div className="p-8 pb-4 flex items-center justify-between border-b border-white/5 bg-slate-900/10">
                <div>
                    <h1 className="text-2xl font-black text-white tracking-tight mb-1">System Logs</h1>
                    <p className="text-slate-500 text-sm font-medium">Monitoring data synchronization and AI engine events</p>
                </div>
                <button
                    onClick={clearLogs}
                    className="px-6 py-2 rounded-xl bg-red-500/10 text-red-400 text-xs font-black uppercase tracking-widest hover:bg-red-500/20 transition-all border border-red-500/20 active:scale-95"
                >
                    Clear All Logs
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 pt-6 space-y-4 custom-scrollbar">
                {systemLogs.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50 py-20">
                        <div className="w-20 h-20 bg-slate-900 rounded-[2rem] flex items-center justify-center mb-6 border border-white/5">
                            <i className="fas fa-terminal text-3xl"></i>
                        </div>
                        <p className="text-lg font-bold italic">No system activity recorded yet</p>
                    </div>
                )}
                <div className="max-w-5xl mx-auto space-y-3">
                    {systemLogs.map((log) => (
                        <div
                            key={log.id}
                            className="group relative pl-6 pr-4 py-4 border-l-4 transition-all hover:bg-white/[0.02] bg-slate-900/30 rounded-r-2xl border-white/5"
                            style={{ borderLeftColor: log.type === 'error' ? '#ef4444' : log.type === 'success' ? '#10b981' : '#3b82f6' }}
                        >
                            {/* Glow effect for errors */}
                            {log.type === 'error' && (
                                <div className="absolute inset-y-0 left-0 w-1 bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.8)] opacity-50"></div>
                            )}

                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-3">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${log.type === 'error' ? 'bg-red-500/20 text-red-400' :
                                            log.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                                                'bg-blue-500/20 text-blue-400'
                                        }`}>
                                        {log.type}
                                    </span>
                                    {log.target && (
                                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/5 rounded text-[10px] text-slate-400 font-bold">
                                            <i className="fas fa-database text-[8px]"></i>
                                            <span className="uppercase tracking-tight">{log.target}</span>
                                        </div>
                                    )}
                                </div>
                                <span className="text-[10px] text-slate-500 font-mono font-bold tracking-tighter">
                                    {new Date(log.timestamp).toLocaleString()}
                                </span>
                            </div>
                            <div className="text-sm text-slate-200 leading-relaxed font-mono break-words whitespace-pre-wrap">
                                {log.message}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default LogViewer;
