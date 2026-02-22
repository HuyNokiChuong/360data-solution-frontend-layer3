
import React from 'react';
import { useDataStore } from './bi/store/dataStore';
import { API_BASE } from '../services/api';

type AuditLogRow = {
    id: string;
    action: string;
    entity_type: string;
    entity_id?: string | null;
    details?: any;
    created_at: string;
    user_email?: string | null;
    user_name?: string | null;
};

const LogViewer: React.FC = () => {
    const { clearLogs } = useDataStore();
    const [logs, setLogs] = React.useState<AuditLogRow[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [searchQuery, setSearchQuery] = React.useState('');
    const [filterType, setFilterType] = React.useState<'all' | 'info' | 'error' | 'success'>('all');
    const [lastRefreshedAt, setLastRefreshedAt] = React.useState<string | null>(null);

    const getScopeQuery = () => {
        try {
            const raw = localStorage.getItem('auth_user');
            const user = raw ? JSON.parse(raw) : null;
            const email = String(user?.email || '').toLowerCase();
            const role = String(user?.role || '').toLowerCase();
            const isSuper = email === 'admin@360data-solutions.ai' || role.includes('super');
            return isSuper ? 'scope=all&includeSystem=true' : 'scope=workspace&includeSystem=false';
        } catch {
            return 'scope=workspace&includeSystem=false';
        }
    };

    const fetchAuditLogs = React.useCallback(async (withLoading = false, incremental = false) => {
        const token = localStorage.getItem('auth_token');
        if (!token) {
            setLogs([]);
            setError('Missing auth token. Please login again.');
            return;
        }

        if (withLoading) setLoading(true);
        try {
            const baseQuery = getScopeQuery();

            if (incremental) {
                const res = await fetch(`${API_BASE}/logs?limit=200&offset=0&${baseQuery}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) {
                    const detail = await res.text();
                    throw new Error(detail || `Failed to fetch logs (${res.status})`);
                }
                const data = await res.json();
                const latestRows: AuditLogRow[] = Array.isArray(data?.data) ? data.data : [];

                setLogs((prev) => {
                    const map = new Map<string, AuditLogRow>();
                    latestRows.forEach((item) => map.set(item.id, item));
                    prev.forEach((item) => {
                        if (!map.has(item.id)) map.set(item.id, item);
                    });
                    return Array.from(map.values())
                        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                        .slice(0, 20000);
                });
            } else {
                const pageSize = 1000;
                let offset = 0;
                let total = Number.POSITIVE_INFINITY;
                const allRows: AuditLogRow[] = [];

                while (offset < total) {
                    const res = await fetch(`${API_BASE}/logs?limit=${pageSize}&offset=${offset}&${baseQuery}`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });

                    if (!res.ok) {
                        const detail = await res.text();
                        throw new Error(detail || `Failed to fetch logs (${res.status})`);
                    }

                    const data = await res.json();
                    const rows: AuditLogRow[] = Array.isArray(data?.data) ? data.data : [];
                    const pageTotal = Number(data?.pagination?.total ?? rows.length);

                    allRows.push(...rows);
                    total = Number.isFinite(pageTotal) ? pageTotal : allRows.length;

                    if (rows.length < pageSize) break;
                    offset += rows.length;

                    // Guardrail for unusually large datasets
                    if (allRows.length >= 50000) break;
                }

                setLogs(allRows);
            }

            setError(null);
            setLastRefreshedAt(new Date().toISOString());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch logs');
        } finally {
            if (withLoading) setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        fetchAuditLogs(true, false);
    }, [fetchAuditLogs]);

    React.useEffect(() => {
        // Poll logs every ~12s for near real-time updates.
        const timer = setInterval(() => {
            fetchAuditLogs(false, true);
        }, 12000);

        return () => {
            clearInterval(timer);
        };
    }, [fetchAuditLogs]);

    const getLogType = (log: AuditLogRow): 'info' | 'success' | 'error' => {
        const success = log?.details?.success;
        if (success === true) return 'success';
        if (success === false) return 'error';
        return 'info';
    };

    const filteredLogs = React.useMemo(() => {
        return logs.filter(log => {
            const logType = getLogType(log);
            const matchesType = filterType === 'all' || logType === filterType;
            const target = `${log.entity_type || ''} ${log.entity_id || ''}`.trim();
            const message = `${log.action || ''} ${log.user_email || ''} ${log.user_name || ''}`.trim();
            const matchesSearch = message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                target.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesType && matchesSearch;
        });
    }, [logs, searchQuery, filterType]);

    return (
        <div className="flex-1 flex flex-col h-screen bg-[#020617] overflow-hidden">
            <div className="p-8 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 bg-slate-900/10">
                <div>
                    <h1 className="text-2xl font-black text-white tracking-tight mb-1">System Logs</h1>
                    <p className="text-slate-500 text-sm font-medium">Workspace-wide audit trail from backend services</p>
                    {lastRefreshedAt && (
                        <p className="text-slate-600 text-[11px] mt-1">Auto-refresh every 12s • Last sync: {new Date(lastRefreshedAt).toLocaleTimeString()}</p>
                    )}
                    <p className="text-slate-500 text-[11px] mt-1">Loaded logs: {logs.length}</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={clearLogs}
                        className="px-6 py-2 rounded-xl bg-red-500/10 text-red-400 text-xs font-black uppercase tracking-widest hover:bg-red-500/20 transition-all border border-red-500/20 active:scale-95"
                    >
                        Clear Local Cache
                    </button>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="px-8 py-4 flex flex-wrap items-center gap-4 bg-black/20 border-b border-white/5">
                <div className="relative flex-1 max-w-md">
                    <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"></i>
                    <input
                        type="text"
                        placeholder="Search logs..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-12 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                    />
                </div>
                <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                    {(['all', 'info', 'success', 'error'] as const).map((type) => (
                        <button
                            key={type}
                            onClick={() => setFilterType(type)}
                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${filterType === type
                                    ? 'bg-indigo-600 text-white shadow-lg'
                                    : 'text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            {type}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 pt-6 space-y-4 custom-scrollbar">
                {loading && (
                    <div className="max-w-5xl mx-auto text-slate-400 text-sm">Loading logs...</div>
                )}
                {error && (
                    <div className="max-w-5xl mx-auto text-red-300 text-sm bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                        {error}
                    </div>
                )}
                {filteredLogs.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50 py-20">
                        <div className="w-20 h-20 bg-slate-900 rounded-[2rem] flex items-center justify-center mb-6 border border-white/5">
                            <i className="fas fa-terminal text-3xl"></i>
                        </div>
                        <p className="text-lg font-bold italic">{logs.length === 0 ? "No system activity recorded yet" : "No logs match your filters"}</p>
                    </div>
                )}
                <div className="max-w-5xl mx-auto space-y-3">
                    {filteredLogs.map((log) => (
                        (() => {
                            const type = getLogType(log);
                            const target = `${log.entity_type || ''}${log.entity_id ? ` • ${log.entity_id}` : ''}`;
                            const message = `${log.action || ''}${log.user_email ? ` by ${log.user_email}` : ''}`;
                            return (
                        <div
                            key={log.id}
                            className="group relative pl-6 pr-4 py-4 border-l-4 transition-all hover:bg-white/[0.02] bg-slate-900/30 rounded-r-2xl border-white/5"
                            style={{ borderLeftColor: type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6' }}
                        >
                            {/* Glow effect for errors */}
                            {type === 'error' && (
                                <div className="absolute inset-y-0 left-0 w-1 bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.8)] opacity-50"></div>
                            )}

                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-3">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${type === 'error' ? 'bg-red-500/20 text-red-400' :
                                        type === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                                            'bg-blue-500/20 text-blue-400'
                                        }`}>
                                        {type}
                                    </span>
                                    {target && (
                                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/5 rounded text-[10px] text-slate-400 font-bold">
                                            <i className="fas fa-database text-[8px]"></i>
                                            <span className="uppercase tracking-tight">{target}</span>
                                        </div>
                                    )}
                                </div>
                                <span className="text-[10px] text-slate-500 font-mono font-bold tracking-tighter">
                                    {new Date(log.created_at).toLocaleString()}
                                </span>
                            </div>
                            <div className="text-sm text-slate-200 leading-relaxed font-mono break-words whitespace-pre-wrap">
                                {message}
                                {log?.details ? `\n${JSON.stringify(log.details)}` : ''}
                            </div>
                        </div>
                            );
                        })()
                    ))}
                </div>
            </div>
        </div>
    );
};

export default LogViewer;
