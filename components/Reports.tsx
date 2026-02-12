import React, { useState, useEffect, useRef } from 'react';
import { SyncedTable, Connection, ReportSession } from '../types';
import { ReportSidebar } from './reports/ReportSidebar';
import { ChatInterface } from './reports/ChatInterface';
import { generateReportInsight } from '../services/ai';
import {
  executeSemanticRawSql,
  getDefaultDataModel,
  getModelTables,
  getRelationships,
} from '../services/dataModeling';
import { useLanguageStore } from '../store/languageStore';
import { generateUUID } from '../utils/id';

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
  const abortControllerRef = useRef<AbortController | null>(null);

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
      const { getTokenForConnection, getGoogleClientId } = await import('../services/googleAuth');
      const clientId = getGoogleClientId();
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
  const handleSend = async (text: string, model?: any, isRetry = false, providedToken?: string) => {
    if (!text.trim() || (loading && !isRetry)) return;

    const bqConn = connections.find(c => c.type === 'BigQuery' && c.projectId);
    const { getTokenForConnection, getGoogleToken, getGoogleClientId } = await import('../services/googleAuth');
    const clientId = getGoogleClientId();

    // Stop previous job if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    let targetSessionId = activeSessionId;

    // 1. Add User Message (only if not a retry)
    if (!isRetry) {
      const userMsg = { id: `u-${Date.now()}`, role: 'user' as const, content: text };

      setSessions((prev: ReportSession[]) => {
        // Find current session
        const sessionExists = prev.some(s => s.id === targetSessionId);

        if (!sessionExists) {
          console.warn('⚠️ Active session not found. Falling back to first or new session.');
          if (prev.length > 0) {
            targetSessionId = prev[0].id; // Update the tracking ID
            setActiveSessionId(targetSessionId);
          } else {
            // Create a new session if none exist
            const newId = generateUUID();
            targetSessionId = newId; // Update the tracking ID
            const newSession: ReportSession = {
              id: newId,
              title: text.substring(0, 50),
              timestamp: new Date().toLocaleDateString(),
              messages: [userMsg]
            };
            setActiveSessionId(newId);
            return [newSession];
          }
        }

        return prev.map(s =>
          s.id === targetSessionId
            ? {
              ...s,
              messages: [...s.messages, userMsg],
              title: (s.messages.length === 0 || s.title === 'New Analysis') ? text.substring(0, 50) : s.title
            }
            : s
        );
      });
      setLoading(true);
    }

    try {
      setLoading(true);
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

      let semanticModelId: string | undefined;
      let semanticTableScope: string[] = [];
      let semanticEngine: 'bigquery' | 'postgres' | undefined;
      let semanticContext = '';

      try {
        const [defaultModel, modelTables, modelRelationships] = await Promise.all([
          getDefaultDataModel(),
          getModelTables(),
          getRelationships(),
        ]);

        const activeModelTables = modelTables.filter((modelTable) =>
          activeTables.some((table) => table.id === modelTable.syncedTableId)
        );

        if (activeModelTables.length > 0) {
          semanticModelId = defaultModel.id;
          semanticTableScope = activeModelTables.map((table) => table.id);

          const engineSet = new Set(activeModelTables.map((table) => table.runtimeEngine));
          if (engineSet.size > 1) {
            throw new Error('Cross-source query is blocked: selected tables must belong to the same runtime engine.');
          }
          semanticEngine = Array.from(engineSet)[0] as any;

          const relScope = modelRelationships.filter((rel) =>
            activeModelTables.some((table) => table.id === rel.fromTableId)
            && activeModelTables.some((table) => table.id === rel.toTableId)
          );

          const tableContext = activeModelTables.map((table) => {
            const cols = (table.schema || []).map((field) => `${field.name}(${field.type})`).join(', ');
            return `- ${table.tableName}: [${cols}]`;
          }).join('\n');
          const relationshipContext = relScope.length > 0
            ? relScope.map((rel) =>
              `- ${rel.fromTable}.${rel.fromColumn} -> ${rel.toTable}.${rel.toColumn} (${rel.relationshipType}, ${rel.crossFilterDirection}, ${rel.validationStatus})`
            ).join('\n')
            : '- (No relationship in current table scope)';

          semanticContext = `Data Model: ${defaultModel.name}\nTables:\n${tableContext}\nRelationships:\n${relationshipContext}`;
          schemaStr = activeModelTables.map((table) => {
            const cols = (table.schema || []).map((field) => `${field.name}(${field.type})`).join(',');
            return `${table.datasetName}.${table.tableName}: [${cols}]`;
          }).join(' | ');
        }
      } catch (semanticErr: any) {
        if (String(semanticErr?.message || '').toLowerCase().includes('cross-source')) {
          throw semanticErr;
        }
        console.warn('Unable to load semantic context, fallback to schema-only mode:', semanticErr?.message || semanticErr);
      }

      let token = providedToken || googleToken;
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

      const options: any = {
        signal: abortControllerRef.current.signal,
        semanticContext,
      };
      if (semanticEngine === 'postgres') {
        options.semanticEngine = 'postgres';
        options.executeSql = async (sql: string) => {
          if (!semanticModelId || semanticTableScope.length === 0) {
            throw new Error('Missing semantic table scope for postgres execution');
          }
          const executed = await executeSemanticRawSql({
            dataModelId: semanticModelId,
            tableIds: semanticTableScope,
            rawSql: sql,
          });
          return executed.rows || [];
        };
      } else if (bqConn && token) {
        options.semanticEngine = 'bigquery';
        options.token = token;
        options.projectId = bqConn.projectId;
      }

      // 3. Call AI Service
      const result = await generateReportInsight(model, text, schemaStr, tableNames, options);

      // 3.5 DETECT AUTH ERRORS IN RESULTS
      const hasAuthError =
        result.dashboard.kpis.some(k => k.value?.toString().toLowerCase().includes('authentication') || k.value?.toString().toLowerCase().includes('expired') || k.value?.toString().toLowerCase().includes('unauthorized')) ||
        result.dashboard.charts.some(c => c.data.length === 0 && (c.insight?.toString().toLowerCase().includes('authentication') || c.insight?.toString().toLowerCase().includes('unauthorized')));

      if (hasAuthError && !isRetry && bqConn) {
        console.warn("Detected expired/invalid token. Attempting auto-reauth...");
        const newToken = await getGoogleToken(clientId);
        setGoogleToken(newToken);
        return await handleSend(text, model, true, newToken);
      }

      // 4. Add AI Response
      const aiMsg = {
        id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant' as const,
        content: result.dashboard.summary,
        visualData: result.dashboard,
        sqlTrace: result.sql,
        executionTime: result.executionTime
      };

      setSessions((prev: ReportSession[]) => {
        // Use the tracked targetSessionId
        const sessionToUpdate = prev.find(s => s.id === targetSessionId) || prev[0];
        if (!sessionToUpdate) return prev;

        return prev.map(s => {
          if (s.id !== sessionToUpdate.id) return s;
          if (s.messages.some(m => m.id === aiMsg.id)) return s;
          return { ...s, messages: [...s.messages, aiMsg] };
        });
      });
      abortControllerRef.current = null;

    } catch (e: any) {
      console.error("Report Generation Error:", e);
      const isAuthError = e.message?.toLowerCase().includes('authentication') || e.message?.toLowerCase().includes('credentials') || e.message?.toLowerCase().includes('unauthorized');

      if (isAuthError && !isRetry && bqConn) {
        try {
          const newToken = await getGoogleToken(clientId);
          setGoogleToken(newToken);
          return await handleSend(text, model, true, newToken);
        } catch (authErr) {
          console.error("Manual re-auth failed", authErr);
        }
      }

      const rawMsg = e.message || "Unknown error";
      const isLeaked = rawMsg.toLowerCase().includes('leaked');
      const errorMsg = {
        id: `err-${Date.now()}`,
        role: 'assistant' as const,
        content: isLeaked
          ? `⚠️ LỖI BẢO MẬT: API Key Gemini của bạn đã bị Google xác định là bị lộ (leaked) và đã bị khóa. \n\nCÁCH KHẮC PHỤC:\n1. Truy cập https://aistudio.google.com/ \n2. Tạo API Key mới.\n3. Cập nhật vào tab 'AI Setting'.`
          : `Đã có lỗi xảy ra: ${rawMsg}. ${isAuthError ? "Có vẻ phiên làm việc của bạn đã hết hạn. Hãy thử lại để làm mới kết nối." : ""}`
      };
      setSessions((prev: ReportSession[]) => {
        const sessionToUpdate = prev.find(s => s.id === targetSessionId) || prev[0];
        if (!sessionToUpdate) return prev;
        return prev.map(s => s.id === sessionToUpdate.id ? { ...s, messages: [...s.messages, errorMsg] } : s);
      });
    } finally {
      if (!isRetry) {
        setLoading(false);
        abortControllerRef.current = null;
      }
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const handleEditMessage = (messageId: string, newText: string) => {
    setSessions((prev: ReportSession[]) => {
      return prev.map(s => {
        if (s.id !== activeSessionId) return s;

        const msgIndex = s.messages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) return s;

        // Remove subsequent messages
        const updatedMessages = s.messages.slice(0, msgIndex);
        return { ...s, messages: updatedMessages };
      });
    });

    // Re-send with new text
    const session = sessions.find(s => s.id === activeSessionId);
    if (session) {
      handleSend(newText);
    }
  };

  const handleRenameSession = (id: string, newTitle: string) => {
    setSessions((prev: ReportSession[]) => prev.map(s => s.id === id ? { ...s, title: newTitle } : s));
  };

  const handleDeleteSession = (id: string) => {
    // 1. Calculate result based on current prop
    const remaining = sessions.filter(s => s.id !== id);

    if (remaining.length === 0) {
      // If deleting the last session, reset to a fresh state
      const newId = generateUUID();
      setSessions([{
        id: newId,
        title: 'New Analysis',
        timestamp: new Date().toLocaleDateString(),
        messages: []
      }]);
      setActiveSessionId(newId);
    } else {
      // Normal delete
      setSessions(remaining);

      // If we deleted the active session, switch to the first available one
      if (activeSessionId === id) {
        setActiveSessionId(remaining[0].id);
      }
    }
  };

  // Handle Update Chart SQL
  const handleUpdateChartSQL = async (messageId: string, chartIndex: number, newSQL: string, isRetry = false) => {
    if (loading) return;

    try {
      setLoading(true);
      const bqConn = connections.find(c => c.type === 'BigQuery' && c.projectId);
      let token = googleToken;
      const { getTokenForConnection, getGoogleToken, getGoogleClientId } = await import('../services/googleAuth');
      const clientId = getGoogleClientId();

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
      const { getTokenForConnection, getGoogleToken, getGoogleClientId } = await import('../services/googleAuth');
      const clientId = getGoogleClientId();

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
      const { getGoogleToken, getGoogleClientId } = await import('../services/googleAuth');
      const token = await getGoogleToken(getGoogleClientId());
      setGoogleToken(token);
      alert("BigQuery Link Refreshed Successfully!");
    } catch (e: any) {
      console.error("Re-auth failed:", e);
      alert("Re-authentication failed. Please check your browser settings and try again.");
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

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
      <div className="flex h-full bg-white dark:bg-[#020617] overflow-hidden">
        <ReportSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onRenameSession={handleRenameSession}
          onDeleteSession={handleDeleteSession}
          onNewSession={() => {
            const newId = generateUUID();
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
          onStop={handleStop}
          onEditMessage={handleEditMessage}
          isAdmin={currentUser.role === 'Admin'}
        />
      </div>
    </div>
  );
};

export default Reports;
