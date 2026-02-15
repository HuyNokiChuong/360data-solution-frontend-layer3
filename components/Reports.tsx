import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { registerReportsAssistantBridge } from './reports/reportsAssistantBridge';

interface PendingQuestion {
  id: string;
  text: string;
  model?: any;
  sessionId: string;
  forcedTableIds?: string[];
}

interface ResolvedSourceScope {
  targetConnection: Connection | null;
  scopedTables: SyncedTable[];
}

interface ScopedTableResolution {
  canonical: string | null;
  ambiguous: boolean;
}

const DEFAULT_REPORT_SESSION_TITLES = new Set([
  'new analysis',
  'data exploration hub',
  'untitled session',
]);

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
  const selectionStorageKey = `report_selection_${domain}`;
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>([]);

  const [selectedTableIds, setSelectedTableIds] = useState<string[]>(() => {
    const saved = localStorage.getItem(selectionStorageKey);
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const { messages } = sessions.find(s => s.id === activeSessionId) || { messages: [] };

  // Persist selectedTableIds
  useEffect(() => {
    localStorage.setItem(selectionStorageKey, JSON.stringify(selectedTableIds));
  }, [selectedTableIds, selectionStorageKey]);

  // Initialize selectedTableIds with all tables ONLY IF it's the first time for this domain
  useEffect(() => {
    const saved = localStorage.getItem(selectionStorageKey);
    // Only auto-select all when key does not exist yet.
    // If key exists (including []), keep user's explicit choice.
    if (saved === null && tables.length > 0) {
      setSelectedTableIds(tables.map(t => t.id));
    }
  }, [tables, selectionStorageKey]);

  // Remove stale selections when available tables change (e.g. table disabled in Data Assets)
  useEffect(() => {
    // Keep current selection while table list is still loading.
    if (tables.length === 0) return;

    const availableTableIds = new Set(tables.map((table) => table.id));
    setSelectedTableIds((prev) => {
      const next = prev.filter((id) => availableTableIds.has(id));
      if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
        return prev;
      }
      return next;
    });
  }, [tables]);

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

  const resolveSourceScopeForPrompt = (prompt: string, scopedSelectedTableIds?: string[]): ResolvedSourceScope => {
    const effectiveSelectedTableIds = Array.isArray(scopedSelectedTableIds) && scopedSelectedTableIds.length > 0
      ? scopedSelectedTableIds
      : selectedTableIds;
    const selectedTables = tables.filter((table) => effectiveSelectedTableIds.includes(table.id));
    if (selectedTables.length === 0) {
      return {
        targetConnection: connections.find((connection) => connection.type === 'BigQuery' && !!connection.projectId) || null,
        scopedTables: []
      };
    }

    const byConnection = new Map<string, SyncedTable[]>();
    selectedTables.forEach((table) => {
      if (!table.connectionId) return;
      const list = byConnection.get(table.connectionId) || [];
      list.push(table);
      byConnection.set(table.connectionId, list);
    });

    if (byConnection.size === 0) {
      return {
        targetConnection: connections.find((connection) => connection.type === 'BigQuery' && !!connection.projectId) || null,
        scopedTables: selectedTables
      };
    }

    if (byConnection.size === 1) {
      const [connectionId, scopedTables] = Array.from(byConnection.entries())[0];
      return {
        targetConnection: connections.find((connection) => connection.id === connectionId) || null,
        scopedTables
      };
    }

    const normalizedPrompt = String(prompt || '').toLowerCase();
    let bestConnectionId = Array.from(byConnection.keys())[0];
    let bestScore = -1;
    let bestFirstSelectedIndex = Number.MAX_SAFE_INTEGER;

    byConnection.forEach((connectionTables, connectionId) => {
      const conn = connections.find((connection) => connection.id === connectionId);
      const connectionName = String(conn?.name || '').toLowerCase();
      let score = 0;

      if (connectionName && normalizedPrompt.includes(connectionName)) score += 5;

      connectionTables.forEach((table) => {
        const tableName = String(table.tableName || '').toLowerCase();
        const datasetName = String(table.datasetName || '').toLowerCase();
        if (tableName && normalizedPrompt.includes(tableName)) score += 9;
        if (datasetName && normalizedPrompt.includes(datasetName)) score += 4;
      });

      const firstSelectedIndex = Math.min(
        ...connectionTables.map((table) => selectedTableIds.indexOf(table.id)).filter((index) => index >= 0)
      );

      const shouldReplace =
        score > bestScore
        || (score === bestScore && firstSelectedIndex < bestFirstSelectedIndex);

      if (shouldReplace) {
        bestScore = score;
        bestConnectionId = connectionId;
        bestFirstSelectedIndex = Number.isFinite(firstSelectedIndex) ? firstSelectedIndex : Number.MAX_SAFE_INTEGER;
      }
    });

    const scopedTables = byConnection.get(bestConnectionId) || selectedTables;
    return {
      targetConnection: connections.find((connection) => connection.id === bestConnectionId) || null,
      scopedTables
    };
  };

  const normalizeSqlIdentifier = (value: string): string => {
    return String(value || '')
      .trim()
      .replace(/^`|`$/g, '')
      .replace(/^"|"$/g, '')
      .replace(/^\[|\]$/g, '')
      .trim()
      .toLowerCase();
  };

  const collectCteNames = (sql: string): Set<string> => {
    const names = new Set<string>();
    const cteRegex = /(?:\bWITH\b|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi;
    let match: RegExpExecArray | null;
    while ((match = cteRegex.exec(sql)) !== null) {
      names.add(normalizeSqlIdentifier(match[1]));
    }
    return names;
  };

  const buildBigQueryScopeLookup = (
    scopeTables: SyncedTable[],
    fallbackConnection: Connection | null
  ): Map<string, Set<string>> => {
    const lookup = new Map<string, Set<string>>();

    const add = (key: string, canonical: string) => {
      const normalized = normalizeSqlIdentifier(key);
      if (!normalized) return;
      const set = lookup.get(normalized) || new Set<string>();
      set.add(canonical);
      lookup.set(normalized, set);
    };

    scopeTables.forEach((table) => {
      const tableConnection = connections.find((connection) => connection.id === table.connectionId) || fallbackConnection;
      const projectId = String(tableConnection?.projectId || '').trim();
      const datasetName = String(table.datasetName || '').trim();
      const tableName = String(table.tableName || '').trim();
      if (!projectId || !datasetName || !tableName) return;

      const canonical = `${projectId}.${datasetName}.${tableName}`;
      add(canonical, canonical);
      add(`${datasetName}.${tableName}`, canonical);
      add(tableName, canonical);
    });

    return lookup;
  };

  const resolveScopedTable = (
    identifier: string,
    lookup: Map<string, Set<string>>
  ): ScopedTableResolution => {
    const normalized = normalizeSqlIdentifier(identifier);
    const candidates = lookup.get(normalized);
    if (!candidates || candidates.size === 0) {
      return { canonical: null, ambiguous: false };
    }
    if (candidates.size > 1) {
      return { canonical: null, ambiguous: true };
    }
    return { canonical: Array.from(candidates)[0], ambiguous: false };
  };

  const enforceBigQueryRawScope = (
    rawSql: string,
    scopeTables: SyncedTable[],
    fallbackConnection: Connection | null
  ): string => {
    const sql = String(rawSql || '');
    if (!sql.trim() || scopeTables.length === 0) return sql;

    const lookup = buildBigQueryScopeLookup(scopeTables, fallbackConnection);
    if (lookup.size === 0) return sql;

    const cteNames = collectCteNames(sql);
    const blockedRefs = new Set<string>();
    const ambiguousRefs = new Set<string>();

    const tableRefRegex = /\b(FROM|JOIN|UPDATE|INTO|MERGE\s+INTO|DELETE\s+FROM)\s+(`[^`]+`|[A-Za-z_][A-Za-z0-9_.-]*)/gi;
    const rewrittenSql = sql.replace(tableRefRegex, (full, keyword, identifier) => {
      const originalRef = String(identifier || '').trim();
      if (!originalRef || originalRef.startsWith('(')) return full;

      const normalizedRef = normalizeSqlIdentifier(originalRef);
      if (!normalizedRef || normalizedRef === 'unnest' || normalizedRef.startsWith('unnest(')) {
        return full;
      }
      if (cteNames.has(normalizedRef)) return full;

      const resolved = resolveScopedTable(originalRef, lookup);
      if (resolved.ambiguous) {
        ambiguousRefs.add(originalRef);
        return full;
      }
      if (!resolved.canonical) {
        blockedRefs.add(originalRef);
        return full;
      }

      return `${keyword} \`${resolved.canonical}\``;
    });

    if (ambiguousRefs.size > 0) {
      throw new Error(
        `Ambiguous table reference: ${Array.from(ambiguousRefs).join(', ')}. Please use dataset.table or project.dataset.table.`
      );
    }
    if (blockedRefs.size > 0) {
      throw new Error(
        `Query blocked: only selected raw tables are allowed. Invalid reference(s): ${Array.from(blockedRefs).join(', ')}.`
      );
    }

    return rewrittenSql;
  };

  // Handle Send Message
  const handleSend = async (
    text: string,
    model?: any,
    isRetry = false,
    providedToken?: string,
    forcedSessionId?: string,
    forcedTableIds?: string[]
  ): Promise<{ sessionId: string; messageId?: string; visualData?: any } | void> => {
    if (!text.trim()) return;
    const effectiveTableIds = Array.isArray(forcedTableIds) && forcedTableIds.length > 0
      ? forcedTableIds
      : selectedTableIds;
    if (loading && !isRetry) {
      setPendingQuestions((prev) => [
        ...prev,
        {
          id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text,
          model,
          sessionId: activeSessionId,
          forcedTableIds: effectiveTableIds,
        }
      ]);
      return;
    }

    if (!isRetry) {
      setLoading(true);
    }

    const { targetConnection, scopedTables } = resolveSourceScopeForPrompt(text, effectiveTableIds);
    const bqConn = (targetConnection && targetConnection.type === 'BigQuery' && targetConnection.projectId)
      ? targetConnection
      : (connections.find(c => c.type === 'BigQuery' && c.projectId) || null);
    const { getTokenForConnection, getGoogleToken, getGoogleClientId } = await import('../services/googleAuth');
    const clientId = getGoogleClientId();

    abortControllerRef.current = new AbortController();

    let targetSessionId = forcedSessionId || activeSessionId;

    const deriveSessionTitle = (input: string): string => {
      const compact = String(input || '').replace(/\s+/g, ' ').trim();
      if (!compact) return 'New Analysis';
      const maxLength = 50;
      if (compact.length <= maxLength) return compact;
      return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
    };

    const shouldAutoSetTitle = (title: string | undefined): boolean => {
      const normalized = String(title || '').trim().toLowerCase();
      return !normalized || DEFAULT_REPORT_SESSION_TITLES.has(normalized);
    };

    // 1. Add User Message (only if not a retry)
    if (!isRetry) {
      const userMsg = { id: generateUUID(), role: 'user' as const, content: text };
      const nextTitle = deriveSessionTitle(text);
      const nextTimestamp = new Date().toISOString();

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
              title: nextTitle,
              timestamp: nextTimestamp,
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
              timestamp: nextTimestamp,
              title: shouldAutoSetTitle(s.title) ? nextTitle : s.title
            }
            : s
        );
      });
    }

    try {
      const activeTables = scopedTables.length > 0 ? scopedTables : tables.filter(t => selectedTableIds.includes(t.id));
      const tableNames = (activeTables || []).map(t => t.tableName);

      let schemaStr = "";
      if (activeTables && activeTables.length > 0) {
        schemaStr = activeTables.map(t => {
          const cols = (t.schema || []).map(s => `${s.name}(${s.type})`).join(',');
          const tableConn = connections.find((connection) => connection.id === t.connectionId);
          const prefix = tableConn?.projectId ? `${tableConn.projectId}.` : "";
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
        const scopedBigQueryTables = activeTables.filter((table) => {
          const tableConnection = connections.find((connection) => connection.id === table.connectionId);
          return tableConnection?.type === 'BigQuery' && !!tableConnection.projectId;
        });
        options.semanticEngine = 'bigquery';
        options.token = token;
        options.projectId = bqConn.projectId;
        options.executeSql = async (sql: string) => {
          const { runQuery } = await import('../services/bigquery');
          const scopedSql = enforceBigQueryRawScope(sql, scopedBigQueryTables, bqConn);
          return runQuery(token, bqConn.projectId!, scopedSql, abortControllerRef.current?.signal);
        };
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
        return await handleSend(text, model, true, newToken, targetSessionId, effectiveTableIds);
      }

      // 4. Add AI Response
      const aiMsg = {
        id: generateUUID(),
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
          return {
            ...s,
            timestamp: new Date().toISOString(),
            messages: [...s.messages, aiMsg]
          };
        });
      });
      abortControllerRef.current = null;
      return {
        sessionId: targetSessionId,
        messageId: aiMsg.id,
        visualData: result.dashboard,
      };

    } catch (e: any) {
      console.error("Report Generation Error:", e);
      const isAuthError = e.message?.toLowerCase().includes('authentication') || e.message?.toLowerCase().includes('credentials') || e.message?.toLowerCase().includes('unauthorized');

      if (isAuthError && !isRetry && bqConn) {
        try {
          const newToken = await getGoogleToken(clientId);
          setGoogleToken(newToken);
          return await handleSend(text, model, true, newToken, targetSessionId, effectiveTableIds);
        } catch (authErr) {
          console.error("Manual re-auth failed", authErr);
        }
      }

      const rawMsg = e.message || "Unknown error";
      const isLeaked = rawMsg.toLowerCase().includes('leaked');
      const lowerRawMsg = rawMsg.toLowerCase();
      const isOpenAIQuotaError =
        lowerRawMsg.includes('insufficient_quota') ||
        lowerRawMsg.includes('exceeded your current quota') ||
        lowerRawMsg.includes('billing_hard_limit_reached');
      const errorMsg = {
        id: generateUUID(),
        role: 'assistant' as const,
        content: isLeaked
          ? `⚠️ LỖI BẢO MẬT: API Key Gemini của bạn đã bị Google xác định là bị lộ (leaked) và đã bị khóa. \n\nCÁCH KHẮC PHỤC:\n1. Truy cập https://aistudio.google.com/ \n2. Tạo API Key mới.\n3. Cập nhật vào tab 'AI Setting'.`
          : isOpenAIQuotaError
            ? `OpenAI API key hợp lệ nhưng tài khoản API đã hết quota/credit.\n\nLưu ý: gói ChatGPT Plus/Pro không bao gồm API credit.\n\nCách xử lý:\n1. Vào https://platform.openai.com/billing để nạp credit.\n2. Hoặc chuyển model sang Gemini/Claude ở góc phải trên.`
          : `Đã có lỗi xảy ra: ${rawMsg}. ${isAuthError ? "Có vẻ phiên làm việc của bạn đã hết hạn. Hãy thử lại để làm mới kết nối." : ""}`
      };
      setSessions((prev: ReportSession[]) => {
        const sessionToUpdate = prev.find(s => s.id === targetSessionId) || prev[0];
        if (!sessionToUpdate) return prev;
        return prev.map(s => s.id === sessionToUpdate.id ? { ...s, timestamp: new Date().toISOString(), messages: [...s.messages, errorMsg] } : s);
      });
      return {
        sessionId: targetSessionId,
      };
    } finally {
      if (!isRetry) {
        setLoading(false);
        abortControllerRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (loading) return;
    if (pendingQuestions.length === 0) return;

    const [next, ...rest] = pendingQuestions;
    setPendingQuestions(rest);
    void handleSend(next.text, next.model, false, undefined, next.sessionId, next.forcedTableIds);
  }, [loading, pendingQuestions]);

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

  const createNewSession = useCallback((title?: string) => {
    const newId = generateUUID();
    const newSession: ReportSession = {
      id: newId,
      title: title || 'New Analysis',
      timestamp: new Date().toLocaleDateString(),
      messages: []
    };
    setSessions((prev: ReportSession[]) => [newSession, ...prev]);
    setActiveSessionId(newId);
    return { sessionId: newId };
  }, [setSessions, setActiveSessionId]);

  // Handle Update Chart SQL
  const handleUpdateChartSQL = async (messageId: string, chartIndex: number, newSQL?: string, isRetry = false) => {
    if (loading) return;

    try {
      setLoading(true);
      const resolvedChartIndex = Number.isFinite(Number(chartIndex)) ? Math.max(0, Number(chartIndex)) : 0;
      const activeSession = sessions.find(s => s.id === activeSessionId);
      const latestChartMessage = [...(activeSession?.messages || [])]
        .reverse()
        .find(m => m.role === 'assistant' && Array.isArray(m.visualData?.charts) && m.visualData.charts.length > resolvedChartIndex);
      const targetMessageId = messageId === 'latest' ? (latestChartMessage?.id || '') : messageId;

      const targetMessage = (activeSession?.messages || []).find(m => m.id === targetMessageId);
      const currentChartSql = String(targetMessage?.visualData?.charts?.[resolvedChartIndex]?.sql || '').trim();
      const sqlToRun = String(newSQL || '').trim() || currentChartSql;

      if (!targetMessageId || !sqlToRun) {
        throw new Error('Không tìm thấy chart hoặc SQL để chạy lại.');
      }

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

      if (token && bqConn?.projectId && sqlToRun) {
        try {
          newData = await runQuery(token, bqConn.projectId, sqlToRun);
        } catch (err: any) {
          console.error("SQL Execution failed:", err);

          // Auto-reauth for SQL debugger too
          if (err.message?.toLowerCase().includes('authentication') && !isRetry) {
            const newToken = await getGoogleToken(clientId);
            setGoogleToken(newToken);
            return handleUpdateChartSQL(targetMessageId, resolvedChartIndex, sqlToRun, true);
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
            if (m.id !== targetMessageId || !m.visualData) return m;

            const updatedCharts = [...m.visualData.charts];
            updatedCharts[resolvedChartIndex] = {
              ...updatedCharts[resolvedChartIndex],
              sql: sqlToRun,
              data: newData.length > 0 ? newData : updatedCharts[resolvedChartIndex].data
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

  useEffect(() => {
    const activeSession = sessions.find(s => s.id === activeSessionId);
    const latestChartMessage = [...(activeSession?.messages || [])]
      .reverse()
      .find(m => m.role === 'assistant' && Array.isArray(m.visualData?.charts) && m.visualData.charts.length > 0);

    const unregister = registerReportsAssistantBridge({
      newSession: (title?: string) => createNewSession(title),
      ask: async (text: string, options?: { sessionId?: string; useAllTables?: boolean; tableIds?: string[] }) => {
        const scopedTableIds = Array.isArray(options?.tableIds) && options.tableIds.length > 0
          ? options.tableIds
          : undefined;
        const output = await handleSend(
          text,
          undefined,
          false,
          undefined,
          options?.sessionId || activeSessionId,
          scopedTableIds
        );
        return output || { sessionId: options?.sessionId || activeSessionId };
      },
      rerunChartSql: async (messageId: string, chartIndex: number, newSQL?: string) => {
        await handleUpdateChartSQL(messageId, chartIndex, newSQL);
        return { messageId, chartIndex };
      },
      getContext: () => ({
        activeSessionId,
        sessionCount: sessions.length,
        selectedTableCount: selectedTableIds.length,
        latestChartMessageId: latestChartMessage?.id || null,
        defaultChartIndex: 0,
      }),
    });
    return unregister;
  }, [
    activeSessionId,
    createNewSession,
    handleSend,
    handleUpdateChartSQL,
    tables,
    selectedTableIds.length,
    sessions,
  ]);

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
            createNewSession('New Analysis');
          }}
        />

        <ChatInterface
          messages={activeSession ? activeSession.messages : []}
          isLoading={loading}
          queuedCount={pendingQuestions.length}
          onSend={handleSend}
          onUpdateChartSQL={handleUpdateChartSQL}
          onUpdateMainSQL={handleUpdateMainSQL}
          availableTables={tables}
          availableConnections={connections}
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
