import React from 'react';
import { ChatMessage as ChatMessageType, KPIConfig, DashboardConfig } from '../../types';
import { ChartRenderer } from './ChartRenderer';

interface ChatMessageProps {
    message: ChatMessageType;
    onUpdateChartSQL?: (messageId: string, chartIndex: number, newSQL: string) => void;
    onUpdateMainSQL?: (messageId: string, newSQL: string) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, onUpdateChartSQL, onUpdateMainSQL }) => {
    const isUser = message.role === 'user';
    const { visualData, sqlTrace } = message;
    const [showMainSQL, setShowMainSQL] = React.useState(false);
    const [editedMainSQL, setEditedMainSQL] = React.useState(sqlTrace || '');
    const [isExecuting, setIsExecuting] = React.useState(false);

    const handleExecuteMainSQL = async () => {
        if (!onUpdateMainSQL) return;
        setIsExecuting(true);
        await onUpdateMainSQL(message.id, editedMainSQL);
        setIsExecuting(false);
        setShowMainSQL(false);
    };

    return (
        <div className={`flex w-full mb-12 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-4`}>
                {/* Avatar / Identity */}
                <div className="flex items-center gap-4 px-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shadow-lg ${isUser ? 'bg-slate-700 text-white order-2' : 'bg-indigo-600 text-white order-1'
                        }`}>
                        {isUser ? 'U' : <i className="fas fa-robot"></i>}
                    </div>
                    <span className={`text-xs font-black uppercase tracking-widest ${isUser ? 'text-slate-500 order-1' : 'text-indigo-400 order-2'
                        }`}>
                        {isUser ? 'You' : 'Precision AI'}
                    </span>
                </div>

                {/* Bubble */}
                <div className={`p-8 rounded-[2rem] border shadow-2xl backdrop-blur-sm ${isUser
                    ? 'bg-slate-800/80 border-white/5 text-slate-200 rounded-tr-none'
                    : 'bg-black/40 border-indigo-500/20 text-slate-300 rounded-tl-none w-full'
                    }`}>
                    {/* Text Content */}
                    {message.content && (
                        <div className="prose prose-invert prose-base max-w-none mb-6 whitespace-pre-wrap leading-loose font-medium text-base">
                            {message.content}
                        </div>
                    )}

                    {/* Visual Data (If AI and has data) */}
                    {!isUser && visualData && (
                        <div className="space-y-10 mt-8">
                            {/* Dashboard Summary Title */}
                            <div className="border-b border-indigo-500/20 pb-6 flex justify-between items-start">
                                <div>
                                    <h3 className="text-2xl font-black text-white uppercase tracking-tight mb-3">{visualData.title}</h3>
                                    <p className="text-base text-slate-400 font-medium italic leading-relaxed">{visualData.summary}</p>
                                </div>
                                {onUpdateMainSQL && (
                                    <button
                                        onClick={() => setShowMainSQL(!showMainSQL)}
                                        className="bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 p-2 rounded-lg transition-all flex items-center gap-2 border border-indigo-500/20"
                                        title="Debug KPI SQL"
                                    >
                                        <i className="fas fa-code text-[10px]"></i>
                                        <span className="text-[9px] font-black uppercase tracking-widest">KPI SQL</span>
                                    </button>
                                )}
                            </div>

                            {/* Main SQL Editor (Floating/Overlay style) */}
                            {showMainSQL && (
                                <div className="bg-slate-950 border border-indigo-500/30 rounded-2xl p-6 space-y-4 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
                                    <div className="flex justify-between items-center">
                                        <h5 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                                            <i className="fas fa-terminal text-indigo-500"></i>
                                            Main SQL Debugger (KPIs)
                                        </h5>
                                        <button onClick={() => setShowMainSQL(false)} className="text-slate-500 hover:text-white"><i className="fas fa-times"></i></button>
                                    </div>
                                    <textarea
                                        value={editedMainSQL}
                                        onChange={(e) => setEditedMainSQL(e.target.value)}
                                        className="w-full h-40 bg-black border border-white/10 rounded-xl p-4 text-[10px] font-mono text-emerald-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                                        placeholder="Enter SQL for KPIs..."
                                    />
                                    <button
                                        onClick={handleExecuteMainSQL}
                                        disabled={isExecuting}
                                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/30"
                                    >
                                        {isExecuting ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-play"></i>}
                                        {isExecuting ? 'Running Query...' : 'Update All KPIs'}
                                    </button>
                                </div>
                            )}

                            {/* KPIs */}
                            {visualData.kpis && visualData.kpis.length > 0 && (
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                    {visualData.kpis.map((kpi, idx) => (
                                        <div key={idx} className="bg-slate-900/50 p-6 rounded-2xl border border-white/5 flex flex-col hover:border-indigo-500/30 transition-colors">
                                            <span className="text-xs font-black text-slate-500 uppercase tracking-widest truncate mb-2">{kpi.label}</span>
                                            <span className={`text-3xl font-black mt-1 truncate ${typeof kpi.value === 'string' && kpi.value.length > 20 ? 'text-sm text-red-400 break-all whitespace-normal' : 'text-white'}`}>
                                                {typeof kpi.value === 'number' ? kpi.value.toLocaleString() : kpi.value}
                                            </span>
                                            {kpi.status && (
                                                <div className={`text-xs font-bold mt-3 flex items-center gap-2 ${kpi.status === 'increase' ? 'text-emerald-400' : kpi.status === 'decrease' ? 'text-red-400' : 'text-slate-400'
                                                    }`}>
                                                    <i className={`fas fa-arrow-${kpi.status === 'increase' ? 'up' : kpi.status === 'decrease' ? 'down' : 'right'}`}></i>
                                                    {kpi.trend}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Charts Grid */}
                            {visualData.charts && visualData.charts.length > 0 && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {visualData.charts.map((chart, idx) => (
                                        <ChartRenderer
                                            key={idx}
                                            chart={chart}
                                            index={idx}
                                            onUpdateSQL={onUpdateChartSQL ? (newSQL) => onUpdateChartSQL(message.id, idx, newSQL) : undefined}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* Strategic Insights */}
                            {visualData.insights && visualData.insights.length > 0 && (
                                <div className="bg-indigo-900/10 border border-indigo-500/20 rounded-[2rem] p-8 space-y-6">
                                    <div className="flex items-center gap-4 mb-4">
                                        <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
                                            <i className="fas fa-brain text-lg"></i>
                                        </div>
                                        <h4 className="text-base font-black text-white uppercase tracking-widest">Strategic Synthesis</h4>
                                    </div>

                                    <div className="space-y-6">
                                        {visualData.insights.map((ins, idx) => (
                                            <div key={idx} className="relative pl-8 border-l-2 border-indigo-500/30">
                                                <h5 className="text-sm font-black text-indigo-300 uppercase tracking-[0.1em] mb-2">{ins.title}</h5>
                                                <p className="text-sm text-slate-300 mb-3 font-medium leading-relaxed">{ins.analysis}</p>
                                                <div className="bg-white/5 rounded-lg p-4 inline-block w-full">
                                                    <span className="text-xs font-black text-emerald-400 uppercase tracking-widest mr-2">Recommendation:</span>
                                                    <span className="text-sm text-white font-bold">{ins.recommendation}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Timestamp */}
                <span className="text-xs font-black opacity-30 px-4 uppercase">{new Date().toLocaleTimeString()}</span>
            </div>
        </div>
    );
};
