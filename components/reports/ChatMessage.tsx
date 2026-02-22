import React from 'react';
import { ChatMessage as ChatMessageType } from '../../types';
import { ChartRenderer } from './ChartRenderer';
import { stripBigQueryProjectPrefixFromSql } from '../../utils/sql';

interface ChatMessageProps {
    message: ChatMessageType;
    onUpdateChartSQL?: (messageId: string, chartIndex: number, newSQL: string) => void;
    onUpdateMainSQL?: (messageId: string, newSQL: string) => void;
    onEdit?: (messageId: string, newText: string) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, onUpdateChartSQL, onUpdateMainSQL, onEdit }) => {
    const isUser = message.role === 'user';
    const { visualData, sqlTrace } = message;
    const [showMainSQL, setShowMainSQL] = React.useState(false);
    const [editedMainSQL, setEditedMainSQL] = React.useState(stripBigQueryProjectPrefixFromSql(sqlTrace || ''));
    const [isExecuting, setIsExecuting] = React.useState(false);
    const [isEditing, setIsEditing] = React.useState(false);
    const [editedContent, setEditedContent] = React.useState(message.content);

    React.useEffect(() => {
        setEditedMainSQL(stripBigQueryProjectPrefixFromSql(sqlTrace || ''));
    }, [sqlTrace]);

    const handleExecuteMainSQL = async () => {
        if (!onUpdateMainSQL) return;
        setIsExecuting(true);
        await onUpdateMainSQL(message.id, editedMainSQL);
        setIsExecuting(false);
        setShowMainSQL(false);
    };

    const handleSaveEdit = () => {
        if (onEdit && editedContent.trim() !== '') {
            onEdit(message.id, editedContent);
            setIsEditing(false);
        }
    };

    return (
        <div className={`flex w-full mb-12 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-4`}>
                {/* Avatar / Identity */}
                <div className={`flex items-center gap-3 px-2 ${isUser ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black shadow-lg ${isUser ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                        }`}>
                        {isUser ? 'U' : <i className="fas fa-robot"></i>}
                    </div>
                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${isUser ? 'text-indigo-400' : 'text-slate-500'
                        }`}>
                        {isUser ? 'Bạn' : 'AI Chính xác'}
                    </span>
                </div>

                {/* Bubble */}
                <div className={`p-6 rounded-[2rem] border shadow-2xl backdrop-blur-sm relative group/bubble ${isUser
                    ? 'bg-slate-100 dark:bg-slate-800/80 border-slate-200 dark:border-white/5 text-slate-900 dark:text-slate-200'
                    : 'bg-white dark:bg-slate-900/40 border-slate-200 dark:border-indigo-500/20 text-slate-700 dark:text-slate-300 w-full'
                    }`}>
                    {/* User Edit Icon */}
                    {isUser && onEdit && !isEditing && (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="absolute -left-12 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-indigo-600/20 text-indigo-400 opacity-0 group-hover/bubble:opacity-100 transition-all hover:bg-indigo-600 hover:text-white flex items-center justify-center border border-indigo-500/30"
                            title="Sửa ngữ cảnh"
                        >
                            <i className="fas fa-edit text-[10px]"></i>
                        </button>
                    )}

                    {/* Text Content / Edit Field */}
                    {isUser && isEditing ? (
                        <div className="space-y-4 min-w-[300px]">
                            <textarea
                                value={editedContent}
                                onChange={(e) => setEditedContent(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-indigo-500/30 rounded-xl p-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 min-h-[100px] resize-none font-medium"
                                autoFocus
                            />
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => { setIsEditing(false); setEditedContent(message.content); }}
                                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-indigo-600 dark:hover:text-white transition-colors"
                                >
                                    Hủy
                                </button>
                                <button
                                    onClick={handleSaveEdit}
                                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/20"
                                >
                                    Lưu & chạy lại
                                </button>
                            </div>
                        </div>
                    ) : message.content && (
                        <div className="prose dark:prose-invert prose-base max-w-none mb-6 whitespace-pre-wrap leading-loose font-medium text-base text-slate-900 dark:text-slate-300">
                            {message.content}
                        </div>
                    )}

                    {/* Visual Data (If AI and has data) */}
                    {!isUser && visualData && (
                        <div className="space-y-10 mt-8">
                            {/* Dashboard Summary Title */}
                            <div className="border-b border-slate-100 dark:border-indigo-500/20 pb-6 flex justify-between items-start">
                                <div>
                                    <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-3">{visualData.title}</h3>
                                    <p className="text-base text-slate-500 dark:text-slate-400 font-medium italic leading-relaxed">{visualData.summary}</p>
                                </div>
                                {onUpdateMainSQL && (
                                    <button
                                        onClick={() => setShowMainSQL(!showMainSQL)}
                                        className="bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 p-2 rounded-lg transition-all flex items-center gap-2 border border-indigo-500/20"
                                        title="Gỡ lỗi SQL KPI"
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
                                        <h5 className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
                                            <i className="fas fa-terminal text-indigo-500"></i>
                                            Trình gỡ lỗi SQL chính (KPI)
                                        </h5>
                                        <button onClick={() => setShowMainSQL(false)} className="text-slate-500 hover:text-white"><i className="fas fa-times"></i></button>
                                    </div>
                                    <textarea
                                        value={editedMainSQL}
                                        onChange={(e) => setEditedMainSQL(e.target.value)}
                                        className="w-full h-40 bg-slate-50 dark:bg-black border border-slate-200 dark:border-white/10 rounded-xl p-4 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                                        placeholder="Nhập SQL cho KPI..."
                                    />
                                    <button
                                        onClick={handleExecuteMainSQL}
                                        disabled={isExecuting}
                                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/30"
                                    >
                                        {isExecuting ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-play"></i>}
                                        {isExecuting ? 'Đang chạy truy vấn...' : 'Cập nhật toàn bộ KPI'}
                                    </button>
                                </div>
                            )}

                            {/* KPIs */}
                            {visualData.kpis && visualData.kpis.length > 0 && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                    {visualData.kpis.map((kpi, idx) => (
                                        <div key={idx} className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-100 dark:border-white/5 flex flex-col hover:border-indigo-500/30 transition-colors shadow-sm min-h-[140px] justify-center">
                                            <span className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 break-words line-clamp-2 h-8">
                                                {kpi.label}
                                            </span>

                                            {/* Dynamic Value Sizing */}
                                            <span
                                                className={`font-black mt-1 break-words leading-tight ${(() => {
                                                    const valStr = typeof kpi.value === 'number' ? kpi.value.toLocaleString() : String(kpi.value);
                                                    const len = valStr.length;
                                                    if (len > 25) return 'text-lg';
                                                    if (len > 20) return 'text-xl';
                                                    if (len > 15) return 'text-2xl';
                                                    if (len > 12) return 'text-3xl';
                                                    return 'text-4xl';
                                                })()
                                                    } text-slate-900 dark:text-white`}
                                            >
                                                {typeof kpi.value === 'number' ? kpi.value.toLocaleString() : kpi.value}
                                            </span>

                                            {kpi.status && (
                                                <div className={`text-xs font-bold mt-3 flex items-center gap-2 ${kpi.status === 'increase' ? 'text-emerald-600 dark:text-emerald-400' : kpi.status === 'decrease' ? 'text-red-600 dark:text-red-400' : 'text-slate-400'
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
                                <div className="grid grid-cols-1 gap-12">
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
                                        <h4 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-widest">Tổng hợp chiến lược</h4>
                                    </div>

                                    <div className="space-y-6">
                                        {visualData.insights.map((ins, idx) => (
                                            <div key={idx} className="relative pl-8 border-l-2 border-indigo-500/30">
                                                <h5 className="text-sm font-black text-indigo-600 dark:text-indigo-300 uppercase tracking-[0.1em] mb-2">{ins.title}</h5>
                                                <p className="text-sm text-slate-600 dark:text-slate-300 mb-3 font-medium leading-relaxed">{ins.analysis}</p>
                                                <div className="bg-slate-100 dark:bg-white/5 rounded-lg p-4 w-full">
                                                    <div className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-2">Khuyến nghị:</div>
                                                    <div className="text-sm text-slate-900 dark:text-white font-bold">
                                                        {ins.recommendation.match(/\d+\./) ? (
                                                            <ul className="list-none space-y-2 mt-1">
                                                                {ins.recommendation.split(/(?=\d+\.\s)/).map((item, i) => {
                                                                    const cleanItem = item.replace(/^\d+\.\s*/, '').trim();
                                                                    if (!cleanItem) return null;
                                                                    return (
                                                                        <li key={i} className="flex items-start gap-2">
                                                                            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5"></span>
                                                                            <span>{cleanItem}</span>
                                                                        </li>
                                                                    );
                                                                })}
                                                            </ul>
                                                        ) : (
                                                            ins.recommendation
                                                        )}
                                                    </div>
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
