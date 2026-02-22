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
import { generateUUID } from '../utils/id';
import { registerReportsAssistantBridge } from './reports/reportsAssistantBridge';

interface PendingQuestion {
  id: string;
  text: string;
  model?: any;
  modelId?: string;
  sessionId: string;
  forcedTableIds?: string[];
  resumeFromExisting?: boolean;
}

interface ResolvedSourceScope {
  targetConnection: Connection | null;
  scopedTables: SyncedTable[];
}

interface ScopedTableResolution {
  canonical: string | null;
  ambiguous: boolean;
}

interface BigQueryScopeLookup {
  exact: Map<string, Set<string>>;
  relaxed: Map<string, Set<string>>;
}

const DEFAULT_REPORT_SESSION_TITLES = new Set([
  'new analysis',
  'phân tích mới',
  'data exploration hub',
  'untitled session',
  'phiên chưa đặt tên',
]);
const MAX_PARALLEL_AI_TASKS = 3;

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
  const pendingJobsStorageKey = `report_pending_jobs_${domain}`;
  const [isAuthRequired, setIsAuthRequired] = useState(false);
  const abortControllersRef = useRef<Set<AbortController>>(new Set());
  const inFlightCountRef = useRef(0);
  const [inFlightCount, setInFlightCount] = useState(0);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestion[]>([]);
  const pendingJobsRef = useRef<Map<string, PendingQuestion>>(new Map());
  const hasRestoredPendingJobsRef = useRef(false);
  const isPageReloadingRef = useRef(false);

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

  const persistPendingJobsToStorage = useCallback(() => {
    try {
      const serializable = Array.from(pendingJobsRef.current.values()).map((job) => ({
        id: job.id,
        text: String(job.text || ''),
        sessionId: String(job.sessionId || ''),
        forcedTableIds: Array.isArray(job.forcedTableIds) ? [...job.forcedTableIds] : undefined,
        resumeFromExisting: job.resumeFromExisting === true,
        modelId: String(job.modelId || ''),
      }));
      if (serializable.length === 0) {
        localStorage.removeItem(pendingJobsStorageKey);
      } else {
        localStorage.setItem(pendingJobsStorageKey, JSON.stringify(serializable));
      }
    } catch (err) {
      console.warn('Failed to persist pending report jobs:', err);
    }
  }, [pendingJobsStorageKey]);

  const upsertPendingJob = useCallback((job: PendingQuestion) => {
    const normalized: PendingQuestion = {
      id: String(job.id || '').trim(),
      text: String(job.text || ''),
      sessionId: String(job.sessionId || '').trim(),
      forcedTableIds: Array.isArray(job.forcedTableIds) ? [...job.forcedTableIds] : undefined,
      resumeFromExisting: job.resumeFromExisting === true,
      modelId: String(job.model?.id || job.modelId || '').trim() || undefined,
      model: undefined,
    };
    if (!normalized.id || !normalized.text || !normalized.sessionId) return;
    pendingJobsRef.current.set(normalized.id, normalized);
    persistPendingJobsToStorage();
  }, [persistPendingJobsToStorage]);

  const removePendingJob = useCallback((jobId: string) => {
    const id = String(jobId || '').trim();
    if (!id) return;
    if (pendingJobsRef.current.delete(id)) {
      persistPendingJobsToStorage();
    }
  }, [persistPendingJobsToStorage]);

  const clearPendingJobs = useCallback(() => {
    pendingJobsRef.current.clear();
    try {
      localStorage.removeItem(pendingJobsStorageKey);
    } catch {
      // noop
    }
  }, [pendingJobsStorageKey]);

  useEffect(() => {
    pendingJobsRef.current.clear();
    hasRestoredPendingJobsRef.current = false;
  }, [pendingJobsStorageKey]);

  useEffect(() => {
    const markPageReloading = () => {
      isPageReloadingRef.current = true;
    };

    window.addEventListener('beforeunload', markPageReloading);
    window.addEventListener('pagehide', markPageReloading);
    return () => {
      window.removeEventListener('beforeunload', markPageReloading);
      window.removeEventListener('pagehide', markPageReloading);
    };
  }, []);

  const beginAiTask = () => {
    inFlightCountRef.current += 1;
    setInFlightCount(inFlightCountRef.current);
    setLoading(true);
  };

  const endAiTask = () => {
    inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
    setInFlightCount(inFlightCountRef.current);
    if (inFlightCountRef.current === 0) {
      setLoading(false);
    }
  };

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

  useEffect(() => {
    if (hasRestoredPendingJobsRef.current) return;
    if (sessions.length === 0) return;
    hasRestoredPendingJobsRef.current = true;

    let parsed: any[] = [];
    try {
      const raw = localStorage.getItem(pendingJobsStorageKey);
      if (raw) {
        const data = JSON.parse(raw);
        parsed = Array.isArray(data) ? data : [];
      }
    } catch (err) {
      console.warn('Failed to restore pending report jobs:', err);
    }

    if (parsed.length === 0) {
      clearPendingJobs();
      return;
    }

    const resolveResumeMode = (session: ReportSession, jobText: string): 'resume' | 'requeue' | 'skip' => {
      const text = String(jobText || '').trim();
      if (!text) return 'skip';
      const list = Array.isArray(session.messages) ? session.messages : [];
      let matchedUserIndex = -1;

      for (let i = list.length - 1; i >= 0; i -= 1) {
        const item = list[i];
        if (item?.role !== 'user') continue;
        if (String(item.content || '').trim() !== text) continue;
        matchedUserIndex = i;
        break;
      }

      if (matchedUserIndex === -1) return 'requeue';
      const hasAssistantAfter = list.slice(matchedUserIndex + 1).some((msg) => msg?.role === 'assistant');
      return hasAssistantAfter ? 'skip' : 'resume';
    };

    const restoredJobs: PendingQuestion[] = parsed
      .map((item) => {
        const id = String(item?.id || '').trim();
        const text = String(item?.text || '');
        const sessionId = String(item?.sessionId || '').trim();
        const forcedTableIds = Array.isArray(item?.forcedTableIds) ? item.forcedTableIds.map((value: any) => String(value || '').trim()).filter(Boolean) : undefined;
        const modelId = String(item?.modelId || '').trim() || undefined;
        if (!id || !text || !sessionId) return null;

        const session = sessions.find((entry) => entry.id === sessionId);
        if (!session) return null;
        const resumeMode = resolveResumeMode(session, text);
        if (resumeMode === 'skip') return null;

        return {
          id,
          text,
          sessionId,
          forcedTableIds,
          modelId,
          model: undefined,
          resumeFromExisting: resumeMode === 'resume',
        } as PendingQuestion;
      })
      .filter(Boolean) as PendingQuestion[];

    pendingJobsRef.current = new Map(restoredJobs.map((job) => [job.id, job]));
    persistPendingJobsToStorage();

    if (restoredJobs.length === 0) return;
    setPendingQuestions((prev) => {
      const existing = new Set(prev.map((job) => job.id));
      const merged = [...prev];
      restoredJobs.forEach((job) => {
        if (existing.has(job.id)) return;
        merged.push(job);
      });
      return merged;
    });
  }, [sessions, pendingJobsStorageKey, clearPendingJobs, persistPendingJobsToStorage]);

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
      .replace(/`/g, '')
      .replace(/"/g, '')
      .replace(/\[/g, '')
      .replace(/\]/g, '')
      .trim()
      .toLowerCase();
  };

  const normalizeRelaxedIdentifier = (value: string): string => {
    return normalizeSqlIdentifier(value).replace(/[^a-z0-9]/g, '');
  };

  const detectPromptLanguage = (input: string): 'en' | 'vi' => {
    const raw = String(input || '').trim();
    if (!raw) return 'vi';

    // Reliable signal: Vietnamese diacritics.
    if (/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(raw)) {
      return 'vi';
    }

    const latin = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd');
    const words = latin.match(/[a-z]+/g) || [];
    if (words.length === 0) return 'vi';

    const viKeywords = new Set([
      'toi', 'tao', 'ban', 'giup', 'hay', 'vui', 'long', 'lam', 'cho', 'voi',
      'bao', 'nhieu', 'phan', 'tich', 'du', 'lieu', 'bang', 'doanh', 'thu', 'chi',
      'phi', 'loi', 'nhuan', 'tang', 'giam', 'theo', 'ngay', 'thang', 'nam',
      'nhu', 'nao', 'tai', 'sao', 'can', 'duoc', 'khong'
    ]);
    const enKeywords = new Set([
      'what', 'how', 'why', 'please', 'show', 'analyze', 'analysis', 'report',
      'dashboard', 'table', 'dataset', 'revenue', 'cost', 'profit', 'trend',
      'compare', 'between', 'from', 'with', 'for', 'daily', 'monthly', 'weekly'
    ]);

    let viScore = 0;
    let enScore = 0;
    words.forEach((word) => {
      if (viKeywords.has(word)) viScore += 1;
      if (enKeywords.has(word)) enScore += 1;
    });

    if (/\b(the|and|for|with|from|to|of|in)\b/.test(latin)) enScore += 1;
    if (/\b(bao|nhieu|phan|tich|doanh|thu|chi|phi|loi|nhuan|nhu|nao|tai|sao)\b/.test(latin)) viScore += 1;

    if (enScore > viScore) return 'en';
    return 'vi';
  };

  const splitInlineAliasInBacktickRef = (rawIdentifier: string): { tableIdentifier: string; inlineAlias: string } => {
    const identifier = String(rawIdentifier || '').trim();
    if (!identifier.startsWith('`') || !identifier.endsWith('`')) {
      return { tableIdentifier: identifier, inlineAlias: '' };
    }

    const unquoted = identifier.slice(1, -1).trim();
    if (!unquoted || !/\s/.test(unquoted)) {
      return { tableIdentifier: identifier, inlineAlias: '' };
    }

    const aliasMatch = unquoted.match(/^([^\s]+)\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (!aliasMatch) {
      return { tableIdentifier: identifier, inlineAlias: '' };
    }

    return {
      tableIdentifier: `\`${aliasMatch[1]}\``,
      inlineAlias: ` ${aliasMatch[2]}`,
    };
  };

  const collectReferenceCandidates = (identifier: string): string[] => {
    const cleaned = normalizeSqlIdentifier(identifier)
      .split(/\s+/)[0]
      .replace(/[),;]+$/g, '');
    if (!cleaned) return [];

    const candidates = new Set<string>([cleaned]);
    const segments = cleaned.split('.').map((part) => part.trim()).filter(Boolean);
    if (segments.length === 0) return Array.from(candidates);

    candidates.add(segments[segments.length - 1]);
    if (segments.length >= 2) {
      candidates.add(segments.slice(-2).join('.'));
    }
    if (segments.length >= 3) {
      candidates.add(segments.slice(0, 3).join('.'));
    }
    if (segments.length >= 4) {
      const prefixedTable = segments.slice(2).join('_');
      if (prefixedTable) {
        candidates.add(`${segments[0]}.${segments[1]}.${prefixedTable}`);
        candidates.add(`${segments[1]}.${prefixedTable}`);
        candidates.add(prefixedTable);
      }

      const tailTable = segments.slice(-2).join('_');
      if (tailTable) {
        candidates.add(`${segments[0]}.${segments[1]}.${tailTable}`);
        candidates.add(`${segments[1]}.${tailTable}`);
        candidates.add(tailTable);
      }
    }

    return Array.from(candidates).filter(Boolean);
  };

  const formatTableReferenceForUi = (reference: string): string => {
    const normalized = normalizeSqlIdentifier(reference);
    if (!normalized) return String(reference || '').trim();
    const segments = normalized.split('.').map((part) => part.trim()).filter(Boolean);
    if (segments.length >= 3) {
      return segments.slice(1).join('.');
    }
    return normalized;
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
  ): BigQueryScopeLookup => {
    const lookup: BigQueryScopeLookup = {
      exact: new Map<string, Set<string>>(),
      relaxed: new Map<string, Set<string>>(),
    };

    const add = (key: string, canonical: string) => {
      const normalized = normalizeSqlIdentifier(key);
      if (normalized) {
        const exactSet = lookup.exact.get(normalized) || new Set<string>();
        exactSet.add(canonical);
        lookup.exact.set(normalized, exactSet);
      }

      const relaxed = normalizeRelaxedIdentifier(key);
      if (relaxed) {
        const relaxedSet = lookup.relaxed.get(relaxed) || new Set<string>();
        relaxedSet.add(canonical);
        lookup.relaxed.set(relaxed, relaxedSet);
      }
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

      // Some models output a synthetic "schema.table" segment (e.g. dtm.sales -> dtm_sales).
      const underscoreTableName = tableName.replace(/\./g, '_');
      if (underscoreTableName !== tableName) {
        add(`${projectId}.${datasetName}.${underscoreTableName}`, canonical);
        add(`${datasetName}.${underscoreTableName}`, canonical);
        add(underscoreTableName, canonical);
      }
    });

    return lookup;
  };

  const resolveScopedTable = (
    identifier: string,
    lookup: BigQueryScopeLookup
  ): ScopedTableResolution => {
    const candidates = collectReferenceCandidates(identifier);

    const exactMatches = new Set<string>();
    candidates.forEach((candidate) => {
      const matchSet = lookup.exact.get(normalizeSqlIdentifier(candidate));
      if (!matchSet) return;
      matchSet.forEach((item) => exactMatches.add(item));
    });
    if (exactMatches.size === 1) {
      return { canonical: Array.from(exactMatches)[0], ambiguous: false };
    }
    if (exactMatches.size > 1) {
      return { canonical: null, ambiguous: true };
    }

    const relaxedMatches = new Set<string>();
    candidates.forEach((candidate) => {
      const matchSet = lookup.relaxed.get(normalizeRelaxedIdentifier(candidate));
      if (!matchSet) return;
      matchSet.forEach((item) => relaxedMatches.add(item));
    });
    if (relaxedMatches.size === 1) {
      return { canonical: Array.from(relaxedMatches)[0], ambiguous: false };
    }
    if (relaxedMatches.size > 1) {
      return { canonical: null, ambiguous: true };
    }

    return { canonical: null, ambiguous: false };
  };

  const enforceBigQueryRawScope = (
    rawSql: string,
    scopeTables: SyncedTable[],
    fallbackConnection: Connection | null,
    language: 'en' | 'vi' = 'vi'
  ): string => {
    const sql = String(rawSql || '');
    if (!sql.trim() || scopeTables.length === 0) return sql;

    const lookup = buildBigQueryScopeLookup(scopeTables, fallbackConnection);
    if (lookup.exact.size === 0) return sql;

    const cteNames = collectCteNames(sql);
    const blockedRefs = new Set<string>();
    const ambiguousRefs = new Set<string>();

    const tableRefRegex = /\b(FROM|JOIN|UPDATE|INTO|MERGE\s+INTO|DELETE\s+FROM)\s+((?:`[^`]+`(?:\s*\.\s*`[^`]+`)*)|[A-Za-z_][A-Za-z0-9_.-]*)/gi;
    const rewrittenSql = sql.replace(tableRefRegex, (full, keyword, identifier) => {
      const originalRef = String(identifier || '').trim();
      if (!originalRef || originalRef.startsWith('(')) return full;

      const { tableIdentifier, inlineAlias } = splitInlineAliasInBacktickRef(originalRef);
      const normalizedRef = normalizeSqlIdentifier(tableIdentifier);
      if (!normalizedRef || normalizedRef === 'unnest' || normalizedRef.startsWith('unnest(')) {
        return full;
      }
      if (cteNames.has(normalizedRef)) return full;

      const resolved = resolveScopedTable(tableIdentifier, lookup);
      if (resolved.ambiguous) {
        ambiguousRefs.add(tableIdentifier);
        return full;
      }
      if (!resolved.canonical) {
        blockedRefs.add(tableIdentifier);
        return full;
      }

      return `${keyword} \`${resolved.canonical}\`${inlineAlias}`;
    });

    if (ambiguousRefs.size > 0) {
      const refsForUi = Array.from(ambiguousRefs).map(formatTableReferenceForUi);
      throw new Error(
        language === 'en'
          ? `Ambiguous table reference: ${refsForUi.join(', ')}. Please use dataset.table or project.dataset.table.`
          : `Tham chiếu bảng bị mơ hồ: ${refsForUi.join(', ')}. Vui lòng dùng dataset.table hoặc project.dataset.table.`
      );
    }
    if (blockedRefs.size > 0) {
      const refsForUi = Array.from(blockedRefs).map(formatTableReferenceForUi);
      throw new Error(
        language === 'en'
          ? `Query blocked: only selected raw tables are allowed. Invalid reference(s): ${refsForUi.join(', ')}.`
          : `Query bị chặn: chỉ được dùng các bảng raw đã chọn. Tham chiếu không hợp lệ: ${refsForUi.join(', ')}.`
      );
    }

    return rewrittenSql;
  };

  const messages = sessions.find((session) => session.id === activeSessionId)?.messages || [];

  // Handle Send Message
  const handleSend = async (
    text: string,
    model?: any,
    isRetry = false,
    providedToken?: string,
    forcedSessionId?: string,
    forcedTableIds?: string[],
    requestId?: string
  ): Promise<{ sessionId: string; messageId?: string; visualData?: any } | void> => {
    if (!text.trim()) return;
    const requestLanguage = detectPromptLanguage(text);
    const isEnglishRequest = requestLanguage === 'en';
    const effectiveRequestId = String(requestId || `rq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).trim();
    if (!isRetry && inFlightCountRef.current >= MAX_PARALLEL_AI_TASKS) {
      const effectiveTableIds = Array.isArray(forcedTableIds) && forcedTableIds.length > 0
        ? [...forcedTableIds]
        : undefined;
      const targetQueueSessionId = forcedSessionId || activeSessionId;
      const queuedJob: PendingQuestion = {
        id: effectiveRequestId,
        text,
        model,
        modelId: String(model?.id || '').trim() || undefined,
        sessionId: targetQueueSessionId,
        forcedTableIds: effectiveTableIds,
        resumeFromExisting: false,
      };
      setPendingQuestions((prev) => {
        if (prev.some((item) => item.id === queuedJob.id)) return prev;
        return [...prev, queuedJob];
      });
      upsertPendingJob(queuedJob);
      return { sessionId: targetQueueSessionId };
    }

    const requestAbortController = new AbortController();
    abortControllersRef.current.add(requestAbortController);
    beginAiTask();

    const effectiveTableIds = Array.isArray(forcedTableIds) && forcedTableIds.length > 0
      ? forcedTableIds
      : selectedTableIds;
    let bqConn: Connection | null = null;
    let clientId = '';
    let targetSessionId = forcedSessionId || activeSessionId;

    upsertPendingJob({
      id: effectiveRequestId,
      text,
      model: undefined,
      modelId: String(model?.id || '').trim() || undefined,
      sessionId: targetSessionId,
      forcedTableIds: effectiveTableIds,
      resumeFromExisting: isRetry,
    });

    const deriveSessionTitle = (input: string): string => {
      const compact = String(input || '').replace(/\s+/g, ' ').trim();
      if (!compact) return 'Phân tích mới';
      const maxLength = 50;
      if (compact.length <= maxLength) return compact;
      return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
    };

    const shouldAutoSetTitle = (title: string | undefined): boolean => {
      const normalized = String(title || '').trim().toLowerCase();
      return !normalized || DEFAULT_REPORT_SESSION_TITLES.has(normalized);
    };

    try {
      const { targetConnection, scopedTables } = resolveSourceScopeForPrompt(text, effectiveTableIds);
      bqConn = (targetConnection && targetConnection.type === 'BigQuery' && targetConnection.projectId)
        ? targetConnection
        : (connections.find(c => c.type === 'BigQuery' && c.projectId) || null);
      const { getTokenForConnection, getGoogleToken, getGoogleClientId } = await import('../services/googleAuth');
      clientId = getGoogleClientId();

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

      const activeTables = scopedTables.length > 0 ? scopedTables : tables.filter(t => selectedTableIds.includes(t.id));
      const tableNames = (activeTables || []).map(t => t.tableName);

      let schemaStr = "";
      if (activeTables && activeTables.length > 0) {
        schemaStr = activeTables.map(t => {
          const cols = (t.schema || []).map(s => `${s.name}(${s.type})`).join(',');
          return `${t.datasetName}.${t.tableName}: [${cols}]`;
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
            throw new Error('Đã chặn truy vấn cross-source: các bảng được chọn phải cùng runtime engine.');
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
            : '- (Không có relationship trong phạm vi bảng hiện tại)';

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
        signal: requestAbortController.signal,
        semanticContext,
        language: requestLanguage,
      };
      if (semanticEngine === 'postgres') {
        options.semanticEngine = 'postgres';
        options.executeSql = async (sql: string) => {
          if (!semanticModelId || semanticTableScope.length === 0) {
            throw new Error('Thiếu semantic table scope cho truy vấn postgres.');
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
          const scopedSql = enforceBigQueryRawScope(sql, scopedBigQueryTables, bqConn, requestLanguage);
          return runQuery(token, bqConn.projectId!, scopedSql, requestAbortController.signal);
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
      return {
        sessionId: targetSessionId,
        messageId: aiMsg.id,
        visualData: aiMsg.visualData,
      };

    } catch (e: any) {
      console.error("Report Generation Error:", e);
      const lowerErrorMessage = String(e?.message || '').toLowerCase();
      const isAbortError =
        e?.name === 'AbortError'
        || lowerErrorMessage.includes('aborterror')
        || lowerErrorMessage.includes('aborted');
      if (isAbortError) {
        return {
          sessionId: targetSessionId,
        };
      }
      const isAuthError = e?.message?.toLowerCase().includes('authentication') || e?.message?.toLowerCase().includes('credentials') || e?.message?.toLowerCase().includes('unauthorized');

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
      const leakedMessage = isEnglishRequest
        ? `⚠️ SECURITY ERROR: Your Gemini API key has been flagged as leaked and disabled by Google.\n\nHOW TO FIX:\n1. Go to https://aistudio.google.com/\n2. Create a new API key.\n3. Update it in the 'AI Setting' tab.`
        : `⚠️ LỖI BẢO MẬT: API Key Gemini của bạn đã bị Google xác định là bị lộ (leaked) và đã bị khóa. \n\nCÁCH KHẮC PHỤC:\n1. Truy cập https://aistudio.google.com/ \n2. Tạo API Key mới.\n3. Cập nhật vào tab 'AI Setting'.`;
      const quotaMessage = isEnglishRequest
        ? `Your OpenAI API key is valid, but the API account has no remaining quota/credit.\n\nNote: ChatGPT Plus/Pro does not include API credit.\n\nHow to fix:\n1. Add credit at https://platform.openai.com/billing.\n2. Or switch model to Gemini/Claude in the top-right corner.`
        : `OpenAI API key hợp lệ nhưng tài khoản API đã hết quota/credit.\n\nLưu ý: gói ChatGPT Plus/Pro không bao gồm API credit.\n\nCách xử lý:\n1. Vào https://platform.openai.com/billing để nạp credit.\n2. Hoặc chuyển model sang Gemini/Claude ở góc phải trên.`;
      const genericMessage = isEnglishRequest
        ? `An error occurred: ${rawMsg}. ${isAuthError ? "Your session may have expired. Please retry to refresh the connection." : ""}`
        : `Đã có lỗi xảy ra: ${rawMsg}. ${isAuthError ? "Có vẻ phiên làm việc của bạn đã hết hạn. Hãy thử lại để làm mới kết nối." : ""}`;
      const errorMsg = {
        id: generateUUID(),
        role: 'assistant' as const,
        content: isLeaked
          ? leakedMessage
          : isOpenAIQuotaError
            ? quotaMessage
          : genericMessage
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
      abortControllersRef.current.delete(requestAbortController);
      endAiTask();
      if (!isPageReloadingRef.current) {
        removePendingJob(effectiveRequestId);
      }
    }
  };

  useEffect(() => {
    if (pendingQuestions.length === 0) return;
    const availableSlots = Math.max(0, MAX_PARALLEL_AI_TASKS - inFlightCount);
    if (availableSlots <= 0) return;

    const batch = pendingQuestions.slice(0, availableSlots);
    if (batch.length === 0) return;

    setPendingQuestions((prev) => prev.slice(batch.length));
    batch.forEach((item) => {
      void handleSend(
        item.text,
        item.model,
        item.resumeFromExisting === true,
        undefined,
        item.sessionId,
        item.forcedTableIds,
        item.id
      );
    });
  }, [pendingQuestions, inFlightCount]);

  const handleStop = () => {
    if (abortControllersRef.current.size > 0) {
      abortControllersRef.current.forEach((controller) => controller.abort());
      abortControllersRef.current.clear();
      inFlightCountRef.current = 0;
      setInFlightCount(0);
      setLoading(false);
    }
    setPendingQuestions([]);
    clearPendingJobs();
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
        title: 'Phân tích mới',
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
      title: title || 'Phân tích mới',
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
      alert("Đã làm mới liên kết BigQuery thành công!");
    } catch (e: any) {
      console.error("Re-auth failed:", e);
      alert("Xác thực lại thất bại. Vui lòng kiểm tra trình duyệt rồi thử lại.");
    }
  };

  useEffect(() => {
    const activeSession = sessions.find(s => s.id === activeSessionId);
    const latestChartMessage = [...(activeSession?.messages || [])]
      .reverse()
      .find(m => m.role === 'assistant' && Array.isArray(m.visualData?.charts) && m.visualData.charts.length > 0);

    const unregister = registerReportsAssistantBridge({
      newSession: (title?: string) => createNewSession(title),
      ask: async (
        text: string,
        options?: {
          sessionId?: string;
          useAllTables?: boolean;
          tableIds?: string[];
          forceNewSession?: boolean;
          sessionTitle?: string;
        }
      ) => {
        const scopedTableIds = Array.isArray(options?.tableIds) && options.tableIds.length > 0
          ? options.tableIds
          : undefined;
        const resolvedSessionId = options?.forceNewSession
          ? createNewSession(options?.sessionTitle || 'Phân tích mới').sessionId
          : (options?.sessionId || activeSessionId);
        const output = await handleSend(
          text,
          undefined,
          false,
          undefined,
          resolvedSessionId,
          scopedTableIds
        );
        return output || { sessionId: resolvedSessionId };
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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {isAuthRequired && (
        <div className="bg-indigo-600 px-10 py-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest animate-in slide-in-from-top duration-500 z-[60]">
          <div className="flex items-center gap-3 text-white">
            <i className="fas fa-lock animate-pulse"></i>
            <span>Kết nối BigQuery đã hết hạn hoặc không hợp lệ</span>
          </div>
          <button
            onClick={handleReauth}
            className="bg-white text-indigo-600 px-4 py-1 rounded-lg hover:bg-white/90 transition-all shadow-lg active:scale-95"
          >
            Liên kết lại tài khoản
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
            createNewSession('Phân tích mới');
          }}
        />

        <ChatInterface
          messages={messages}
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
