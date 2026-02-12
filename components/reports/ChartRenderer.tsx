import React, { useState } from 'react';
import {
    BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
    XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area,
    CartesianGrid, Legend, ReferenceLine, ReferenceDot, Label
} from 'recharts';
import { ChartConfig } from '../../types';
import { useThemeStore } from '../../store/themeStore';

const DARK_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#4f46e5'];
const LIGHT_COLORS = ['#1f4fd6', '#0f766e', '#0ea5e9', '#d97706', '#be123c', '#6d28d9', '#2563eb', '#059669'];

interface ChartRendererProps {
    chart: ChartConfig;
    index: number;
    onUpdateSQL?: (newSQL: string) => void;
}

const CustomTooltip = ({ active, payload, label, theme }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className={`
                p-4 rounded-xl shadow-2xl backdrop-blur-xl z-[200] border
                ${theme === 'dark'
                    ? 'bg-slate-950/90 border-indigo-500/50'
                    : 'bg-white/95 border-indigo-100'
                }
            `}>
                <p className={`
                    text-[10px] font-black uppercase tracking-widest mb-2 border-b pb-1
                    ${theme === 'dark' ? 'text-indigo-400 border-white/10' : 'text-indigo-600 border-slate-200'}
                `}>{label}</p>
                {payload.map((entry: any, index: number) => (
                    <div key={index} className="flex items-center justify-between gap-6 mb-1">
                        <span className={`text-[10px] font-bold capitalize ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                            {entry.name.replace('_', ' ')}:
                        </span>
                        <span className={`text-xs font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
                        </span>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

export const ChartRenderer: React.FC<ChartRendererProps> = ({ chart, index, onUpdateSQL }) => {
    const { type, data, dataKeys, xAxisKey, title, insight, sql } = chart;
    const [showSQL, setShowSQL] = useState(false);
    const [editedSQL, setEditedSQL] = useState(sql || '');
    const [isExecuting, setIsExecuting] = useState(false);
    const { theme } = useThemeStore();

    const COLORS = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
    const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    const textColor = theme === 'dark' ? '#94a3b8' : '#64748b';
    const axisColor = theme === 'dark' ? '#1e293b' : '#e2e8f0';

    const handleExecuteSQL = async () => {
        if (!onUpdateSQL) return;
        setIsExecuting(true);
        await onUpdateSQL(editedSQL);
        setIsExecuting(false);
        setShowSQL(false);
    };
    const xKey = xAxisKey || 'label';
    const keys = dataKeys && dataKeys.length > 0 ? dataKeys : (data && data.length > 0 ? Object.keys(data[0]).filter(k => typeof data[0][k] === 'number') : []);

    if (!data || data.length === 0) {
        return (
            <div className={`
                flex flex-col relative dashboard-card shadow-xl overflow-hidden group/card min-h-[750px] rounded-[2.5rem] border
                ${theme === 'dark'
                    ? 'bg-slate-900/60 border-white/5'
                    : 'bg-white border-slate-200'
                }
            `}>
                <div className="p-10 pb-6 flex justify-between items-start z-10">
                    <div>
                        <h4 className={`text-lg font-black uppercase tracking-[0.2em] mb-2 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{title}</h4>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-tight italic">Chart #{index + 1}</div>
                    </div>
                    {onUpdateSQL && (
                        <button
                            onClick={() => setShowSQL(!showSQL)}
                            className={`p-3 rounded-lg transition-all ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-slate-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                            title="Debug SQL"
                        >
                            <i className="fas fa-code text-sm"></i>
                        </button>
                    )}
                </div>

                <div className="flex-1 flex flex-col items-center justify-center px-12 text-center">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-8 border border-red-500/20">
                        <i className="fas fa-exclamation-triangle text-2xl text-red-500 animate-pulse"></i>
                    </div>
                    <h5 className={`text-sm font-black uppercase tracking-widest mb-3 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Query Execution Issue</h5>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed max-w-[300px]">
                        AI was unable to fetch data for this chart. This is often due to strict filters or schema mismatches.
                    </p>
                    <button
                        onClick={() => setShowSQL(true)}
                        className="mt-8 text-xs font-black text-indigo-400 uppercase tracking-[0.2em] hover:text-indigo-300 transition-colors border-b border-indigo-500/20 pb-1"
                    >
                        Adjust SQL Query <i className="fas fa-arrow-right ml-2 text-[8px]"></i>
                    </button>
                </div>

                {showSQL && (
                    <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-xl z-[50] p-8 flex flex-col gap-4">
                        <div className="flex justify-between items-center">
                            <h5 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                                <i className="fas fa-terminal text-indigo-500"></i>
                                SQL DEBUGGER
                            </h5>
                            <button onClick={() => setShowSQL(false)} className="text-slate-500 hover:text-white transition-colors p-2">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="flex-1 relative">
                            <textarea
                                value={editedSQL}
                                onChange={(e) => setEditedSQL(e.target.value)}
                                className="w-full h-full bg-black border border-white/5 rounded-2xl p-6 text-[11px] font-mono text-emerald-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-inner resize-none"
                                placeholder="-- Enter SQL Query..."
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowSQL(false)}
                                className="flex-1 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleExecuteSQL}
                                disabled={isExecuting}
                                className="flex-[2] bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 shadow-lg shadow-indigo-600/30 active:scale-95 disabled:opacity-50 transition-all"
                            >
                                {isExecuting ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-play"></i>}
                                Execute & Re-Analyze
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={`
            flex flex-col relative dashboard-card shadow-xl overflow-hidden group/card min-h-[750px] rounded-[2.5rem] border
            ${theme === 'dark'
                ? 'bg-slate-900/60 border-white/5'
                : 'bg-white border-slate-200'
            }
        `}>
            <div className="p-10 pb-6 flex justify-between items-start z-10">
                <div>
                    <h4 className={`text-lg font-black uppercase tracking-[0.2em] mb-2 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{title}</h4>
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-tight italic">Chart #{index + 1}</div>
                </div>
                {onUpdateSQL && (
                    <button
                        onClick={() => setShowSQL(!showSQL)}
                        className={`p-3 rounded-lg transition-all ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-slate-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                        title="Debug SQL"
                    >
                        <i className="fas fa-code text-sm"></i>
                    </button>
                )}
            </div>

            <div className="flex-1 w-full px-8 pb-8 min-h-[450px]">
                <ResponsiveContainer width="100%" height="100%">
                    {type === 'bar' ? (
                        <BarChart data={data} margin={{ left: 10, right: 10, top: 20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                            <XAxis dataKey={xKey} fontSize={11} tick={{ fill: textColor }} stroke={axisColor} axisLine={false} tickLine={false} dy={10} />
                            <YAxis fontSize={11} tick={{ fill: textColor }} stroke={axisColor} width={60} axisLine={false} tickLine={false} tickFormatter={(val) => typeof val === 'number' ? (val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toString()) : val} />
                            <Tooltip content={<CustomTooltip theme={theme} />} cursor={{ fill: theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }} />
                            <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 'bold', color: textColor }} />
                            {keys.map((k, i) => (
                                <Bar key={k} dataKey={k} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
                            ))}
                        </BarChart>
                    ) : type === 'area' || type === 'line' ? (
                        <AreaChart data={data} margin={{ left: 10, right: 10, top: 20, bottom: 0 }}>
                            <defs>
                                {keys.map((k, i) => (
                                    <linearGradient key={k} id={`g-${i}-${index}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.4} />
                                        <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                                    </linearGradient>
                                ))}
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                            <XAxis dataKey={xKey} fontSize={11} tick={{ fill: textColor }} stroke={axisColor} axisLine={false} tickLine={false} dy={10} />
                            <YAxis fontSize={11} tick={{ fill: textColor }} stroke={axisColor} width={60} axisLine={false} tickLine={false} tickFormatter={(val) => typeof val === 'number' ? (val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toString()) : val} />
                            <Tooltip content={<CustomTooltip theme={theme} />} />
                            <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 'bold', color: textColor }} />
                            {keys.map((k, i) => (
                                <Area key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]} fill={`url(#g-${i}-${index})`} strokeWidth={3} />
                            ))}
                        </AreaChart>
                    ) : (
                        <PieChart>
                            <Pie
                                data={data}
                                dataKey={keys[0]}
                                nameKey={xKey}
                                cx="50%"
                                cy="50%"
                                outerRadius={90}
                                innerRadius={65}
                                paddingAngle={5}
                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                labelLine={false}
                            >
                                {(data || []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                            <Tooltip content={<CustomTooltip theme={theme} />} />
                            <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', color: textColor }} />
                        </PieChart>
                    )}
                </ResponsiveContainer>
            </div>

            {showSQL && (
                <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-[50] p-8 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                        <h5 className="text-[10px] font-black text-white uppercase tracking-widest">SQL Editor</h5>
                        <button onClick={() => setShowSQL(false)} className="text-slate-500 hover:text-white"><i className="fas fa-times"></i></button>
                    </div>
                    <textarea
                        value={editedSQL}
                        onChange={(e) => setEditedSQL(e.target.value)}
                        className="flex-1 bg-black border border-white/10 rounded-xl p-4 text-[10px] font-mono text-emerald-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="Enter SQL Query..."
                    />
                    <button
                        onClick={handleExecuteSQL}
                        disabled={isExecuting}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                    >
                        {isExecuting ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-play"></i>}
                        Run Query
                    </button>
                </div>
            )}

            {/* Render Insights if available */}
            {insight && (
                <div className={`
                    p-8 mt-auto border-t
                    ${theme === 'dark'
                        ? 'bg-indigo-600/[0.05] border-white/5'
                        : 'bg-indigo-50 border-indigo-100'
                    }
                `}>
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,1)]"></div>
                        <span className="text-xs font-black uppercase text-indigo-400 tracking-widest">Analysis</span>
                    </div>
                    {typeof insight === 'string' ? (
                        <p className={`text-sm leading-relaxed font-medium ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>{insight}</p>
                    ) : (
                        <div className="space-y-4">
                            <p className={`text-sm font-bold leading-relaxed ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>{insight.analysis}</p>
                            <p className={`text-sm italic flex items-start gap-2 leading-relaxed ${theme === 'dark' ? 'text-indigo-200/70' : 'text-indigo-600/70'}`}>
                                <i className="fas fa-arrow-right mt-1.5 text-[9px]"></i>
                                {insight.trend}
                            </p>
                            <p className={`text-sm font-bold flex items-start gap-2 leading-relaxed ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>
                                <i className="fas fa-check mt-1.5 text-[9px]"></i>
                                Action: {insight.action}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
