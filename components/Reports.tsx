import React, { useState, useEffect } from 'react';
import { SyncedTable, Connection, ReportSession } from '../types';
import { ReportSidebar } from './reports/ReportSidebar';
import { ChatInterface } from './reports/ChatInterface';
import { generateReportInsight } from '../services/ai';
import { useLanguageStore } from '../store/languageStore';

interface ReportsProps {
  tables: SyncedTable[];
  connections: Connection[];
  sessions: ReportSession[];
  setSessions: (sessions: any) => void;
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  googleToken: string | null;
  setGoogleToken: (token: string | null) => void;
  currentUser: import('../types').User;
}

const Reports: React.FC<ReportsProps> = ({
  tables,
  connections,
  sessions,
  setSessions,
  activeSessionId,
  setActiveSessionId,
  loading,
  setLoading,
  googleToken,
  setGoogleToken,
  currentUser
}) => {
  const domain = currentUser.email.split('@')[1] || 'default';
  const [isAuthRequired, setIsAuthRequired] = useState(false);

  const [selectedTableIds, setSelectedTableIds] = useState<string[]>(() => {
    const saved = localStorage.getItem(`report_selection_${domain}`);
    return saved ? JSON.parse(saved) : [];
  });
  const { messages } = sessions.find(s => s.id === activeSessionId) || { messages: [] };

  // Persist selectedTableIds
  useEffect(() => {
    localStorage.setItem(`report_selection_${domain}`, JSON.stringify(selectedTableIds));
  }, [selectedTableIds, domain]);

  // Initialize selectedTableIds with all tables ONLY IF it's the first time for this domain
  useEffect(() => {
    const saved = localStorage.getItem(`report_selection_${domain}`);
    if ((!saved || JSON.parse(saved).length === 0) && tables.length > 0) {
      setSelectedTableIds(tables.map(t => t.id));
    }
  }, [tables, domain]);

  // Proactively check token validity once on mount or when googleToken changes
  useEffect(() => {
    const checkAuth = async () => {
      const clientId = process.env.GOOGLE_CLIENT_ID || '';
      const { getTokenForConnection } = await import('../services/googleAuth');
      const bqConn = connections.find(c => c.type === 'BigQuery' && c.projectId);

      if (!bqConn) {
        setIsAuthRequired(false);
        return;
      }

      const token = await getTokenForConnection(bqConn, clientId);
      if (token) {
        // Only update global token if it's NOT a Service Account to avoid unnecessary re-renders
        // Service Account tokens are now cached in googleAuth.ts
        if (bqConn.authType === 'GoogleMail' && token !== googleToken) {
          setGoogleToken(token);
        }

        try {
          const testResponse = await fetch(
            `https://bigquery.googleapis.com/bigquery/v2/projects/${bqConn.projectId}/datasets?maxResults=1`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          setIsAuthRequired(!testResponse.ok && bqConn.authType === 'GoogleMail');
        } catch (e) {
          setIsAuthRequired(bqConn.authType === 'GoogleMail');
        }
      } else {
        setIsAuthRequired(bqConn.authType === 'GoogleMail');
      }
    };
    checkAuth();
  }, [googleToken, connections]);

  // Handle Send Message
  const handleSend = async (text: string, isRetry = false, providedToken?: string, model?: any) => {
    if (!text.trim() || loading) return;

    // 1. Add User Message (only if not a retry)
    const userMsg = { id: Date.now().toString(), role: 'user' as const, content: text };
    if (!isRetry) {
      setSessions((prev: ReportSession[]) => prev.map(s =>
        s.id === activeSessionId
          ? { ...s, messages: [...s.messages, userMsg], title: s.messages.length === 0 ? text.substring(0, 30) : s.title }
          : s
      ));
    }

    setLoading(true);
    const bqConn = connections.find(c => c.type === 'BigQuery' && c.projectId);

    try {
      // 2. Prepare Context for AI - FILTERED by selectedTableIds
      const activeTables = tables.filter(t => selectedTableIds.includes(t.id));
      const tableNames = (activeTables || []).map(t => t.tableName);

      let schemaStr = "";
      if (activeTables && activeTables.length > 0) {
        schemaStr = activeTables.map(t => {
          const cols = (t.schema || []).map(s => `${s.name}(${s.type})`).join(',');
          const prefix = bqConn?.projectId ? `${bqConn.projectId}.` : "";
          return `${prefix}${t.datasetName}.${t.tableName}: [${cols}]`;
        }).join(' | ');
      }

      // Token logic - Try to use providedToken, or get valid token (incl. silent refresh)
      let token = providedToken || googleToken;
      const clientId = process.env.GOOGLE_CLIENT_ID || '';
      const { getTokenForConnection, getGoogleToken } = await import('../services/googleAuth');

      if (bqConn) {
        const validToken = await getTokenForConnection(bqConn, clientId);
        if (validToken) {
          token = validToken;
          if (token !== googleToken) setGoogleToken(token);
        } else if (!token && bqConn.authType === 'GoogleMail') {
          try {
            token = await getGoogleToken(clientId);
            setGoogleToken(token);
          } catch (e) {
            console.warn("Auto-auth failed", e);
          }
        }
      }

      const options = (bqConn && token) ? { token, projectId: bqConn.projectId } : undefined;

      // 3. Call AI Service - Pass selected model
      const result = await generateReportInsight(
        model,
        text,
        schemaStr,
        tableNames,
        options
      );

      // 3.5 DETECT AUTH ERRORS IN RESULTS (Specific to BQ error messages)
      const hasAuthError =
        result.dashboard.kpis.some(k => k.value?.toString().toLowerCase().includes('invalid authentication') || k.value?.toString().toLowerCase().includes('expired') || k.value?.toString().toLowerCase().includes('unauthorized')) ||
        result.dashboard.charts.some(c => c.data.length === 0 && (c.insight?.toString().toLowerCase().includes('authentication') || c.insight?.toString().toLowerCase().includes('unauthorized')));

      if (hasAuthError && !isRetry && bqConn) {
        console.warn("Detected expired/invalid token in BigQuery results. Attempting auto-reauth...");
        const newToken = await getGoogleToken(clientId);
        setGoogleToken(newToken);
        // Recursively retry once with new token PASSING IT EXPLICITLY
        return handleSend(text, true, newToken);
      }

      // 4. Add AI Response
      const aiMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant' as const,
        content: result.dashboard.summary,
        visualData: result.dashboard,
        sqlTrace: result.sql,
        executionTime: result.executionTime
      };

      setSessions((prev: ReportSession[]) => prev.map(s =>
        s.id === activeSessionId ? { ...s, messages: [...s.messages, aiMsg] } : s
      ));

    } catch (e: any) {
      console.error("Report Generation Error:", e);

      const isAuthError = e.message?.toLowerCase().includes('authentication') || e.message?.toLowerCase().includes('credentials') || e.message?.toLowerCase().includes('unauthorized');

      // If the top-level call failed with auth error, also try to re-auth
      if (isAuthError && !isRetry && bqConn) {
        try {
          console.warn("Top-level auth error detected. Retrying with fresh token...");
          const { getGoogleToken } = await import('../services/googleAuth');
          const newToken = await getGoogleToken(process.env.GOOGLE_CLIENT_ID || '');
          setGoogleToken(newToken);
          return handleSend(text, true, newToken);
        } catch (authErr) {
          console.error("Manual re-auth failed after BQ error", authErr);
        }
      }

      const errorMsg = {
        id: Date.now().toString(),
        role: 'assistant' as const,
        content: `I encountered an error: ${e.message || "Unknown error"}. 
        ${isAuthError ? "It looks like your session expired. Please try again to refresh your connection." : ""}`
      };
      setSessions((prev: ReportSession[]) => prev.map(s =>
        s.id === activeSessionId ? { ...s, messages: [...s.messages, errorMsg] } : s
      ));
    } finally {
      if (!isRetry) setLoading(false);
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const handleRenameSession = (id: string, newTitle: string) => {
    setSessions((prev: ReportSession[]) => prev.map(s => s.id === id ? { ...s, title: newTitle } : s));
  };

  const handleDeleteSession = (id: string) => {
    setSessions((prev: ReportSession[]) => {
      const remaining = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        if (remaining.length > 0) setActiveSessionId(remaining[0].id);
        else {
          // If no sessions left, create a new one automatically or handle empty state
          // For now, let's just clear selection? Or create new.
          // Creating new inside setState callback is tricky, let's do it outside or just wait for sidebar logic
          // Actually, sidebar has a button for new session.
          // But we should probably select something or null.
          // If we select nothing, the chat interface might show empty.
          // Let's create a partial new session if really needed, but here just updating state.
        }
      }
      return remaining;
    });

    // Safety check for active session if we deleted it
    if (activeSessionId === id && sessions.length > 1) {
      // This logic is slightly complex inside setState updater for 'remaining'.
      // Let's rely on the useEffect or just simpler logic.
      const remaining = sessions.filter(s => s.id !== id);
      if (remaining.length > 0) setActiveSessionId(remaining[0].id);
      else {
        // Create default
        const newId = `s-${Date.now()}`;
        setSessions([{ id: newId, title: 'New Analysis', timestamp: new Date().toLocaleDateString(), messages: [] }]);
        setActiveSessionId(newId);
      }
    } else if (sessions.length === 1 && sessions[0].id === id) {
      const newId = `s-${Date.now()}`;
      setSessions([{ id: newId, title: 'New Analysis', timestamp: new Date().toLocaleDateString(), messages: [] }]);
      setActiveSessionId(newId);
    }
  };

  // Handle Update Chart SQL
  const handleUpdateChartSQL = async (messageId: string, chartIndex: number, newSQL: string, isRetry = false) => {
    if (loading) return;

    try {
      setLoading(true);
      const bqConn = connections.find(c => c.type === 'BigQuery' && c.projectId);
      let token = googleToken;
      const clientId = process.env.GOOGLE_CLIENT_ID || '';
      const { getTokenForConnection, getGoogleToken } = await import('../services/googleAuth');

      if (bqConn) {
        token = await getTokenForConnection(bqConn, clientId);
        if (token && token !== googleToken) {
          setGoogleToken(token);
        } else if (!token && bqConn.authType === 'GoogleMail') {
          token = await getGoogleToken(clientId);
          setGoogleToken(token);
        }
      }

      // Execute the new SQL
      const { runQuery } = await import('../services/bigquery');
      let newData = [];

      if (token && bqConn?.projectId && newSQL) {
        try {
          newData = await runQuery(token, bqConn.projectId, newSQL);
        } catch (err: any) {
          console.error("SQL Execution failed:", err);

          // Auto-reauth for SQL debugger too
          if (err.message?.toLowerCase().includes('authentication') && !isRetry) {
            const newToken = await getGoogleToken(clientId);
            setGoogleToken(newToken);
            return handleUpdateChartSQL(messageId, chartIndex, newSQL, true);
          }

          alert(`Query Failed: ${err.message}`);
          setLoading(false);
          return;
        }
      }

      // Update the session state
      setSessions((prev: ReportSession[]) => prev.map(s => {
        if (s.id !== activeSessionId) return s;
        return {
          ...s,
          messages: s.messages.map(m => {
            if (m.id !== messageId || !m.visualData) return m;

            const updatedCharts = [...m.visualData.charts];
            updatedCharts[chartIndex] = {
              ...updatedCharts[chartIndex],
              sql: newSQL,
              data: newData.length > 0 ? newData : updatedCharts[chartIndex].data
            };

            return {
              ...m,
              visualData: {
                ...m.visualData,
                charts: updatedCharts
              }
            };
          })
        };
      }));

    } catch (e: any) {
      console.error("Failed to update chart SQL:", e);
    } finally {
      setLoading(false);
    }
  };

  // Handle Update Main SQL (for KPIs)
  const handleUpdateMainSQL = async (messageId: string, newSQL: string, isRetry = false) => {
    if (loading) return;

    try {
      setLoading(true);
      const bqConn = connections.find(c => c.type === 'BigQuery' && c.projectId);
      let token = googleToken;
      const clientId = process.env.GOOGLE_CLIENT_ID || '';
      const { getTokenForConnection, getGoogleToken } = await import('../services/googleAuth');

      if (bqConn) {
        token = await getTokenForConnection(bqConn, clientId);
        if (token && token !== googleToken) {
          setGoogleToken(token);
        } else if (!token && bqConn.authType === 'GoogleMail') {
          token = await getGoogleToken(clientId);
          setGoogleToken(token);
        }
      }

      // Execute the new SQL
      const { runQuery } = await import('../services/bigquery');
      let newData: any[] = [];

      if (token && bqConn?.projectId && newSQL) {
        try {
          newData = await runQuery(token, bqConn.projectId, newSQL);
        } catch (err: any) {
          console.error("Main SQL Execution failed:", err);

          // Auto-reauth for Main SQL debugger too
          if (err.message?.toLowerCase().includes('authentication') && !isRetry) {
            const newToken = await getGoogleToken(clientId);
            setGoogleToken(newToken);
            return handleUpdateMainSQL(messageId, newSQL, true);
          }

          alert(`Query Failed: ${err.message}`);
          setLoading(false);
          return;
        }
      }

      // Update the session state
      setSessions((prev: ReportSession[]) => prev.map(s => {
        if (s.id !== activeSessionId) return s;
        return {
          ...s,
          messages: s.messages.map(m => {
            if (m.id !== messageId || !m.visualData) return m;

            // Map results to KPIs
            const firstRow = newData[0] || {};
            const normalizeStr = (str: string) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s/g, '_');

            const updatedKpis = (m.visualData.kpis || []).map((k: any) => {
              const normalizedLabel = normalizeStr(k.label);
              const matchingKey = Object.keys(firstRow).find(key => {
                const normalizedKey = normalizeStr(key);
                return normalizedKey === normalizedLabel || normalizedKey.replace(/_/g, '') === normalizedLabel.replace(/_/g, '');
              });

              return {
                ...k,
                value: matchingKey ? firstRow[matchingKey] : (newData.length > 0 ? "Not Found" : k.value)
              };
            });

            return {
              ...m,
              sqlTrace: newSQL,
              visualData: {
                ...m.visualData,
                kpis: updatedKpis
              }
            };
          })
        };
      }));

    } catch (e: any) {
      console.error("Failed to update main SQL:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleReauth = async () => {
    try {
      const { getGoogleToken } = await import('../services/googleAuth');
      const token = await getGoogleToken(process.env.GOOGLE_CLIENT_ID || '');
      setGoogleToken(token);
      alert("BigQuery Link Refreshed Successfully!");
    } catch (e: any) {
      console.error("Re-auth failed:", e);
      alert("Re-authentication failed. Please check your browser settings and try again.");
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {isAuthRequired && (
        <div className="bg-indigo-600 px-10 py-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest animate-in slide-in-from-top duration-500 z-[60]">
          <div className="flex items-center gap-3 text-white">
            <i className="fas fa-lock animate-pulse"></i>
            <span>BigQuery Connection Expired or Invalid</span>
          </div>
          <button
            onClick={handleReauth}
            className="bg-white text-indigo-600 px-4 py-1 rounded-lg hover:bg-white/90 transition-all shadow-lg active:scale-95"
          >
            Re-Link Account
          </button>
        </div>
      )}
      <div className="flex h-full bg-[#020617] overflow-hidden">
        <ReportSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
          onNewSession={() => {
            const newId = `s-${Date.now()}`;
            const newSession: ReportSession = {
              id: newId,
              title: 'New Analysis',
              timestamp: new Date().toLocaleDateString(),
              messages: []
            };
            setSessions([newSession, ...sessions]);
            setActiveSessionId(newId);
          }}
        />

        <ChatInterface
          messages={activeSession ? activeSession.messages : []}
          isLoading={loading}
          onSend={handleSend}
          onUpdateChartSQL={handleUpdateChartSQL}
          onUpdateMainSQL={handleUpdateMainSQL}
          availableTables={tables}
          selectedTableIds={selectedTableIds}
          onToggleTable={(id) => {
            setSelectedTableIds(prev =>
              prev.includes(id) ? prev.filter(tid => tid !== id) : [...prev, id]
            );
          }}
          onSelectAllTables={() => setSelectedTableIds(tables.map(t => t.id))}
          onDeselectAllTables={() => setSelectedTableIds([])}
          onReauth={connections.find(c => c.type === 'BigQuery' && c.projectId)?.authType === 'GoogleMail' ? handleReauth : undefined}
          isAdmin={currentUser.role === 'Admin'}
        />
      </div>
    </div>
  );
};

export default Reports;
