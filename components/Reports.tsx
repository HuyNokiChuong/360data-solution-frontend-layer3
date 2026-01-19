
import React, { useState, useRef, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid, Legend } from 'recharts';
import { AI_MODELS } from '../constants';
import { ChatMessage, ReportSession, SyncedTable, DashboardConfig, ChartConfig } from '../types';
import { generateReportInsight } from '../services/ai';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#4f46e5'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-950 border border-indigo-500/50 p-4 rounded-xl shadow-2xl backdrop-blur-xl z-[200]">
        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2 border-b border-white/10 pb-1">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-6 mb-1">
            <span className="text-[10px] font-bold text-slate-300 capitalize">{entry.name.replace('_', ' ')}:</span>
            <span className="text-xs font-black text-white">{entry.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

interface ChartEditorProps {
  chart: ChartConfig;
  onUpdate: (newChart: ChartConfig) => void;
  onClose: () => void;
}

const ChartEditor: React.FC<ChartEditorProps> = ({ chart, onUpdate, onClose }) => {
  const [edited, setEdited] = useState<ChartConfig>({...chart});
  const metrics = ['revenue', 'volume', 'spend', 'conversions', 'profit', 'growth', 'churn_rate', 'stock_on_hand', 'reorder_point', 'active_users'];

  const toggleKey = (key: string) => {
    const keys = edited.dataKeys.includes(key) 
      ? edited.dataKeys.filter((k: string) => k !== key)
      : [...edited.dataKeys, key];
    setEdited({...edited, dataKeys: keys});
  };

  return (
    <div className="absolute inset-0 bg-slate-950 z-[100] p-8 rounded-[2.5rem] flex flex-col border border-indigo-500/30 shadow-2xl animate-in zoom-in duration-200">
       <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center text-indigo-400">
              <i className="fas fa-sliders-h text-xs"></i>
            </div>
            <h5 className="text-[11px] font-black text-white uppercase tracking-widest">Cấu hình biểu đồ</h5>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 text-slate-500 hover:text-white transition-colors flex items-center justify-center">
            <i className="fas fa-times"></i>
          </button>
       </div>
       
       <div className="space-y-6 flex-1 overflow-y-auto custom-scrollbar pr-2">
          <div>
            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3">Kiểu hiển thị (Visualization)</label>
            <div className="grid grid-cols-4 gap-2">
               {['bar', 'line', 'area', 'pie'].map(t => (
                 <button 
                  key={t} 
                  onClick={() => setEdited({...edited, type: t as any})} 
                  className={`py-3 rounded-xl text-[9px] font-black uppercase transition-all border ${edited.type === t ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'bg-white/5 border-white/5 text-slate-500 hover:bg-white/10'}`}
                >
                  {t}
                </button>
               ))}
            </div>
          </div>

          <div>
            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3">Chỉ số dữ liệu (Metrics)</label>
            <div className="grid grid-cols-2 gap-2">
               {metrics.map(k => (
                 <button 
                    key={k} 
                    onClick={() => toggleKey(k)} 
                    className={`px-4 py-3 rounded-xl text-[9px] font-bold border transition-all flex items-center justify-between ${edited.dataKeys.includes(k) ? 'bg-indigo-600/10 border-indigo-500 text-indigo-400' : 'bg-transparent border-white/5 text-slate-600 hover:border-white/10'}`}
                  >
                    <span className="capitalize">{k.replace('_', ' ')}</span>
                    {edited.dataKeys.includes(k) && <i className="fas fa-check-circle text-[10px]"></i>}
                 </button>
               ))}
            </div>
          </div>

          <div>
            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Tiêu đề tùy chỉnh</label>
            <input 
              value={edited.title} 
              onChange={e => setEdited({...edited, title: e.target.value})} 
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-indigo-500 outline-none transition-all placeholder-slate-700" 
              placeholder="Nhập tiêu đề..."
            />
          </div>
       </div>

       <div className="mt-8 flex gap-3 pt-6 border-t border-white/5">
         <button onClick={onClose} className="flex-1 py-4 bg-white/5 text-slate-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:text-white transition-all">Hủy</button>
         <button 
          onClick={() => { onUpdate(edited); onClose(); }} 
          className="flex-[2] bg-indigo-600 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest text-white hover:bg-indigo-500 shadow-xl shadow-indigo-600/20 active:scale-95 transition-all"
         >
           Commit Changes
         </button>
       </div>
    </div>
  );
};

const Reports: React.FC<any> = ({ tables, sessions, setSessions, activeSessionId, setActiveSessionId, loading, setLoading }) => {
  const [input, setInput] = useState('');
  const [editingChartIdx, setEditingChartIdx] = useState<{msgId: string, idx: number} | null>(null);
  const [showingSqlIdx, setShowingSqlIdx] = useState<{msgId: string, idx: number} | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isPreparingPDF, setIsPreparingPDF] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const activeSession = (sessions || []).find((s: any) => s.id === activeSessionId) || sessions[0];
  const steps = ["Configuring Neural Mesh...", "Detecting Time Grain...", "Routing BigQuery Pipeline...", "Cross-checking Data Labels...", "Finalizing Strategic Analysis...", "Polishing UI Layer..."];

  useEffect(() => {
    let interval: any;
    if (loading) {
      setLoadingStep(0);
      interval = setInterval(() => setLoadingStep(prev => (prev < steps.length - 1 ? prev + 1 : prev)), 800);
    }
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [activeSession?.messages?.length, loading]);

  const updateChart = (msgId: string, chartIdx: number, newChart: any) => {
    setSessions((prev: any) => prev.map((s: any) => {
      if (s.id !== activeSessionId) return s;
      return {
        ...s,
        messages: s.messages.map((m: any) => {
          if (m.id !== msgId || !m.visualData) return m;
          const updatedCharts = [...m.visualData.charts];
          updatedCharts[chartIdx] = newChart;
          return { ...m, visualData: { ...m.visualData, charts: updatedCharts } };
        })
      };
    }));
  };

  const handleSend = async (customPrompt?: string) => {
    const text = customPrompt || input;
    if (!text.trim() || loading) return;
    const userMsg = { id: Date.now().toString(), role: 'user', content: text };
    setSessions((prev: any) => prev.map((s: any) => s.id === activeSessionId ? { ...s, messages: [...s.messages, userMsg] } : s));
    setInput(''); setLoading(true);

    try {
      const tableNames = (tables || []).map((t: any) => t.tableName);
      const schemaStr = (tables || []).map((t: any) => `${t.tableName}(${t.schema.join(',')})`).join('; ');
      const { dashboard, sql, executionTime } = await generateReportInsight(AI_MODELS[0], text, schemaStr, tableNames);
      const aiMsg = { id: (Date.now()+1).toString(), role: 'assistant', content: dashboard.summary, visualData: dashboard, sqlTrace: sql, executionTime };
      setSessions((prev: any) => prev.map((s: any) => s.id === activeSessionId ? { ...s, messages: [...s.messages, aiMsg], title: text.substring(0, 30) } : s));
    } catch (e: any) {
      const err = { id: Date.now().toString(), role: 'assistant', content: `Lỗi: ${e.message}` };
      setSessions((prev: any) => prev.map((s: any) => s.id === activeSessionId ? { ...s, messages: [...s.messages, err] } : s));
    } finally { setLoading(false); }
  };

  const handleDownloadPDF = () => {
    setIsExportMenuOpen(false);
    setIsPreparingPDF(true);
    setTimeout(() => {
      window.print();
      setIsPreparingPDF(false);
    }, 1000);
  };

  const handleShareEmail = () => {
    if (!shareEmail) return;
    alert(`Báo cáo đã gửi tới ${shareEmail}`);
    setShareEmail('');
    setIsShareModalOpen(false);
  };

  const renderChartBlock = (chart: ChartConfig, msgId: string, idx: number) => {
    const { type, data, dataKeys, xAxisKey, title, insight, sql } = chart;
    const isEditing = editingChartIdx?.msgId === msgId && editingChartIdx?.idx === idx;
    const isShowingSql = showingSqlIdx?.msgId === msgId && showingSqlIdx?.idx === idx;
    
    const xKey = xAxisKey || 'label';
    const keys = dataKeys || ['revenue'];

    return (
      <div className="flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500 group h-full">
        <div className="bg-slate-900/60 rounded-[2.5rem] border border-white/5 flex flex-col relative dashboard-card shadow-2xl overflow-hidden group/card flex-1 min-h-[550px]">
          {/* Lớp phủ Chỉnh sửa */}
          {isEditing && <ChartEditor chart={chart} onClose={() => setEditingChartIdx(null)} onUpdate={(c) => updateChart(msgId, idx, c)} />}
          
          <div className="p-8 pb-4 flex justify-between items-start no-print z-10">
            <div>
              <h4 className="text-[14px] font-black text-white uppercase tracking-[0.2em] mb-1">{title}</h4>
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-tight italic">Analytical Unit #{idx + 1}</div>
            </div>
            <div className="flex gap-2 opacity-0 group-hover/card:opacity-100 transition-all">
              <button onClick={() => setShowingSqlIdx(isShowingSql ? null : {msgId, idx})} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${isShowingSql ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-500 hover:text-indigo-400'}`}><i className="fas fa-code text-[10px]"></i></button>
              <button onClick={() => setEditingChartIdx({msgId, idx})} className="w-8 h-8 rounded-lg bg-white/5 text-slate-500 hover:text-indigo-400 hover:bg-indigo-600/10 flex items-center justify-center"><i className="fas fa-edit text-[10px]"></i></button>
            </div>
          </div>
          
          <div className="relative flex-1 flex flex-col justify-center min-h-[350px]">
            {/* Lớp phủ SQL Trace - Nâng cấp Z-index và BG */}
            {isShowingSql && (
              <div className="absolute inset-0 z-[100] bg-slate-950 p-8 flex flex-col animate-in fade-in duration-200 rounded-[2.5rem] border border-indigo-500/20">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <i className="fas fa-terminal text-xs"></i>
                    </div>
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Logic truy vấn (Standard SQL)</span>
                  </div>
                  <button onClick={() => setShowingSqlIdx(null)} className="w-8 h-8 rounded-full bg-white/5 text-slate-500 hover:text-white flex items-center justify-center transition-colors">
                    <i className="fas fa-times text-xs"></i>
                  </button>
                </div>
                <div className="flex-1 bg-black/60 rounded-2xl p-6 overflow-auto font-mono text-[11px] text-emerald-400/90 leading-relaxed custom-scrollbar border border-white/5">
                  <div className="mb-4 opacity-40 select-none italic">-- Automated Pipeline Generation Trace</div>
                  {sql || "-- SQL Trace unavailable."}
                </div>
                <div className="mt-6 flex justify-end">
                   <button onClick={() => setShowingSqlIdx(null)} className="px-6 py-3 bg-white/5 text-slate-400 rounded-xl text-[9px] font-black uppercase tracking-widest hover:text-white transition-all">Đóng trình xem mã</button>
                </div>
              </div>
            )}

            {/* QUAN TRỌNG: Ẩn chart khi đang edit HOẶC xem SQL để tránh z-index SVG xuyên thấu */}
            {!isEditing && !isShowingSql && (
              <div className="flex-1 w-full px-6 animate-in fade-in duration-500">
                <ResponsiveContainer width="100%" height="100%">
                  {type === 'bar' ? (
                    <BarChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                      <XAxis dataKey={xKey} fontSize={10} tick={{fill: '#94a3b8'}} stroke="#1e293b" />
                      <YAxis fontSize={10} tick={{fill: '#94a3b8'}} stroke="#1e293b" />
                      <Tooltip content={<CustomTooltip />} cursor={{fill: 'rgba(255,255,255,0.02)'}} />
                      <Legend iconType="circle" wrapperStyle={{paddingTop: '20px', fontSize: '11px', fontWeight: 'bold', color: '#cbd5e1'}} />
                      {keys.map((k: any, i: number) => (
                        <Bar key={k} dataKey={k} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
                      ))}
                    </BarChart>
                  ) : type === 'area' || type === 'line' ? (
                    <AreaChart data={data}>
                      <defs>
                        {keys.map((k: any, i: number) => (
                          <linearGradient key={k} id={`g-${i}-${msgId}-${idx}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.4}/>
                            <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0}/>
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.03)" />
                      <XAxis dataKey={xKey} fontSize={10} tick={{fill: '#94a3b8'}} stroke="#1e293b" />
                      <YAxis fontSize={10} tick={{fill: '#94a3b8'}} stroke="#1e293b" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend iconType="circle" wrapperStyle={{paddingTop: '20px', fontSize: '11px', fontWeight: 'bold', color: '#cbd5e1'}} />
                      {keys.map((k: any, i: number) => (
                        <Area key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]} fill={`url(#g-${i}-${msgId}-${idx})`} strokeWidth={3} />
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
                        outerRadius={95} 
                        innerRadius={70} 
                        paddingAngle={5}
                        label={({ name }) => name}
                      >
                        {(data || []).map((_:any, i:number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                      <Legend verticalAlign="bottom" height={36} wrapperStyle={{fontSize: '11px', fontWeight: 'bold', color: '#cbd5e1'}} />
                    </PieChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}
            
            {/* Hiển thị placeholder khi đang ở các chế độ layer khác */}
            {(isEditing || isShowingSql) && (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-800 animate-in fade-in duration-300">
                <i className={`${isShowingSql ? 'fas fa-code' : 'fas fa-chart-pie'} text-6xl opacity-5 mb-4`}></i>
                <span className="text-[10px] font-black uppercase tracking-widest opacity-10 italic">Interactive Pipeline Active...</span>
              </div>
            )}
          </div>

          {insight && (
            <div className="bg-indigo-600/[0.1] border-t border-white/10 p-10 mt-auto group-hover/card:bg-indigo-600/[0.15] transition-colors shadow-inner">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,1)]"></div>
                <span className="text-[11px] font-black uppercase text-indigo-400 tracking-[0.2em]">Phân tích chuyên sâu</span>
              </div>
              <p className="text-[17px] text-white leading-relaxed font-black italic drop-shadow-xl tracking-tight">
                "{insight}"
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full bg-[#020617] overflow-hidden">
      {isPreparingPDF && (
        <div className="fixed inset-0 z-[200] bg-slate-950/90 flex flex-col items-center justify-center no-print">
          <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-6"></div>
          <p className="text-xl font-black text-white uppercase tracking-[0.3em]">Preparing PDF Export...</p>
          <p className="text-slate-500 text-sm mt-2">Đang dàn trang và tối ưu hóa biểu đồ.</p>
        </div>
      )}

      <div className="w-80 border-r border-white/5 bg-[#020617] flex flex-col no-print">
        <div className="p-8">
          <button 
            onClick={() => { 
              const id = `s-${Date.now()}`; 
              setSessions((p:any) => [{ id, title: 'Báo cáo mới', timestamp: new Date().toISOString().split('T')[0], messages: [] }, ...p]); 
              setActiveSessionId(id); 
            }} 
            className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-500 shadow-xl transition-all active:scale-95"
          >
            + NEW PIPELINE HUB
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 space-y-2 custom-scrollbar">
          {(sessions || []).map((s:any) => (
            <button key={s.id} onClick={() => setActiveSessionId(s.id)} className={`w-full text-left p-5 rounded-[1.5rem] border transition-all ${activeSessionId === s.id ? 'bg-indigo-600/10 border-indigo-500/30 text-white' : 'text-slate-500 border-transparent hover:bg-white/5 hover:text-slate-300'}`}>
              <div className="font-bold text-sm truncate uppercase tracking-tight">{s.title}</div>
              <div className="text-[9px] font-black opacity-30 mt-1 uppercase">{s.timestamp}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col relative">
        <header className="h-20 border-b border-white/5 flex items-center justify-between px-10 no-print">
          <div className="flex items-center gap-4">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]"></div>
            <h2 className="text-sm font-black text-white uppercase tracking-[0.4em]">360DATA PRECISION COMPUTE v6.5</h2>
          </div>
          {activeSession?.messages.length > 0 && (
             <div className="flex gap-4 relative">
                <button onClick={() => setIsExportMenuOpen(!isExportMenuOpen)} className="px-6 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-slate-400 hover:text-white hover:bg-indigo-600 transition-all flex items-center gap-2"><i className="fas fa-download"></i> EXPORT REPORT</button>
                {isExportMenuOpen && (
                  <div className="absolute top-full right-0 mt-2 w-48 bg-slate-900 border border-white/10 rounded-xl shadow-2xl z-[100] overflow-hidden animate-in slide-in-from-top-2">
                    <button onClick={handleDownloadPDF} className="w-full text-left px-5 py-3 text-[10px] font-black uppercase text-slate-400 hover:bg-white/5 hover:text-white flex items-center gap-3">
                      <i className="fas fa-file-pdf text-indigo-400"></i> Download PDF
                    </button>
                  </div>
                )}
                <button onClick={() => setIsShareModalOpen(true)} className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500 transition-all flex items-center gap-2 shadow-lg shadow-indigo-600/20"><i className="fas fa-share-nodes"></i> SHARE INSIGHT</button>
             </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-10 space-y-24 custom-scrollbar report-container">
          {activeSession?.messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto text-center">
              <div className="w-20 h-20 bg-white/5 rounded-[2rem] flex items-center justify-center text-indigo-500 mb-10 border border-white/10 shadow-3xl"><i className="fas fa-chart-network text-2xl"></i></div>
              <h3 className="text-4xl font-black text-white mb-6 tracking-tighter italic italic">Neural Analysis Engine</h3>
              <p className="text-slate-500 text-[12px] font-medium leading-relaxed mb-10">Hệ thống phân tích BigQuery chuẩn xác. Tự động liên kết xu hướng thời gian và các chiều phân loại để đưa ra báo cáo trực quan tức thì.</p>
              <div className="grid grid-cols-1 gap-4 w-full no-print">
                {["Phân tích xu hướng doanh thu theo tháng và churn rate", "Báo cáo tồn kho SKU và reorder points", "Cơ cấu sản lượng FMCG theo khu vực địa lý"].map((t, i) => (
                  <button key={i} onClick={() => handleSend(t)} className="p-8 bg-slate-900/40 border border-white/5 rounded-[2.5rem] text-left hover:border-indigo-500/50 transition-all flex items-center gap-8 group">
                    <div className="w-12 h-12 bg-indigo-600/10 rounded-2xl flex items-center justify-center text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-inner"><i className="fas fa-bolt text-sm"></i></div>
                    <span className="text-sm font-bold text-slate-200 tracking-tight">{t}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            activeSession?.messages.map((msg: any) => (
              <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} gap-10`}>
                {msg.role === 'user' ? (
                  <div className="bg-indigo-600/10 border border-indigo-600/30 text-indigo-400 rounded-2xl px-10 py-5 text-[11px] font-black uppercase tracking-widest shadow-2xl">{msg.content}</div>
                ) : (
                  <div className="w-full space-y-24 animate-in slide-in-from-bottom-10 duration-700">
                    <div className="max-w-[95%] bg-slate-900/60 border border-white/5 rounded-[3.5rem] p-12 relative dashboard-card shadow-2xl overflow-hidden">
                      <div className="flex flex-col mb-12 relative z-10">
                        <h2 className="text-4xl font-black text-white tracking-tighter italic mb-6">{msg.visualData?.title}</h2>
                        <p className="text-xl text-slate-100 leading-relaxed font-black italic border-l-8 border-indigo-600 pl-8 drop-shadow-2xl">"{msg.content}"</p>
                      </div>
                      {msg.visualData?.kpis && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 relative z-10">
                          {msg.visualData.kpis.map((k:any, i:number) => (
                            <div key={i} className="bg-black/40 p-8 rounded-[2.5rem] border border-white/5 hover:border-white/10 transition-all">
                              <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">{k.label}</div>
                              <div className="text-3xl font-black text-white tracking-tighter">{k.value}</div>
                              <div className={`text-[11px] font-black mt-2 ${k.trend.includes('+') ? 'text-emerald-500' : 'text-red-500'}`}>{k.trend}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-20">
                      <div className="flex items-center gap-6 pl-6 no-print">
                        <div className="h-px flex-1 bg-white/5"></div>
                        <span className="text-[11px] font-black text-indigo-500 uppercase tracking-[1em]">Lớp trực quan hóa chuẩn xác</span>
                        <div className="h-px flex-1 bg-white/5"></div>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
                        {(msg.visualData.charts || []).map((c: any, i: number) => (
                          <div key={i}>{renderChartBlock(c, msg.id, i)}</div>
                        ))}
                      </div>

                      {msg.visualData.insights && (
                        <div className="bg-indigo-600/5 border border-indigo-500/10 rounded-[4.5rem] p-16 dashboard-card mt-24 relative overflow-hidden group">
                           <div className="flex items-center gap-8 mb-16 relative z-10">
                             <div className="w-16 h-16 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white shadow-3xl"><i className="fas fa-sparkles text-2xl"></i></div>
                             <div>
                               <h3 className="text-3xl font-black text-white italic tracking-tighter">Đề xuất hạ tầng dữ liệu & Chiến lược</h3>
                               <p className="text-[11px] text-slate-500 font-black uppercase tracking-widest mt-1">Global Strategic Diagnostic Summary</p>
                             </div>
                           </div>
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-12 relative z-10">
                             {msg.visualData.insights.map((insight: string, idx: number) => (
                               <div key={idx} className="flex gap-8 items-start group/insight">
                                 <div className="mt-1 w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black text-[11px] shadow-2xl">{idx+1}</div>
                                 <p className="text-[18px] text-slate-100 leading-relaxed font-black tracking-tight">{insight}</p>
                               </div>
                             ))}
                           </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
          {loading && (
            <div className="flex items-center gap-10 p-12 bg-slate-900/90 rounded-[4rem] border border-indigo-500/40 animate-pulse max-w-xl shadow-3xl mx-auto lg:mx-0">
              <div className="w-12 h-12 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
              <div>
                <div className="text-[12px] font-black text-indigo-400 uppercase tracking-[0.5em] mb-2">{steps[loadingStep]}</div>
                <div className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] italic">360data Precision Neural Link...</div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} className="h-32" />
        </div>

        <div className="p-10 bg-[#020617] border-t border-white/5 no-print">
          <div className="max-w-4xl mx-auto flex items-end gap-8 bg-slate-900/95 p-8 rounded-[3.5rem] border border-white/10 shadow-3xl focus-within:border-indigo-500/50 transition-all">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="Yêu cầu phân tích dữ liệu chuyên sâu tại đây..." className="flex-1 bg-transparent border-none py-2 text-white text-md font-bold focus:ring-0 resize-none outline-none placeholder-slate-700 custom-scrollbar" rows={1} />
            <button onClick={() => handleSend()} disabled={loading || !input.trim()} className="w-16 h-16 rounded-[2rem] bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-500 shadow-3xl active:scale-95 disabled:opacity-50 transition-all group">
              <i className="fas fa-paper-plane text-xl group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reports;
