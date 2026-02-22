import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useDashboardStore } from '../bi/store/dashboardStore';
import { useDataStore } from '../bi/store/dataStore';
import {
  confirmAssistantActions,
  createAssistantSession,
  getAssistantTimeline,
  listAssistantSessions,
  sendAssistantMessage,
  submitAssistantClientActionResult,
} from '../../services/assistantApi';
import { createClientActionRegistry } from './clientActionRegistry';
import { getReportsAssistantBridge } from '../reports/reportsAssistantBridge';
import type {
  AssistantAction,
  AssistantChannel,
  AssistantClientBindings,
  AssistantConfirmInput,
  AssistantMessage,
  AssistantPlanResponse,
  AssistantRuntimeContextValue,
  AssistantSendMessageInput,
  AssistantSession,
  AssistantUndoEntry,
} from './types';

interface AssistantRuntimeProviderProps {
  children: React.ReactNode;
  bindings: Omit<AssistantClientBindings, 'pushUndo' | 'popUndo'>;
}

const AssistantRuntimeContext = createContext<AssistantRuntimeContextValue | null>(null);

const emptyMessages = (): Record<AssistantChannel, AssistantMessage[]> => ({
  global: [],
  bi: [],
});

const emptySessions = (): Record<AssistantChannel, AssistantSession | null> => ({
  global: null,
  bi: null,
});

const emptyBusyCount = (): Record<AssistantChannel, number> => ({
  global: 0,
  bi: 0,
});

const upsertMessageList = (
  prev: Record<AssistantChannel, AssistantMessage[]>,
  channel: AssistantChannel,
  message: AssistantMessage
) => {
  const existing = prev[channel];
  const idx = existing.findIndex((item) => item.id === message.id);
  if (idx === -1) {
    return { ...prev, [channel]: [...existing, message] };
  }
  const next = [...existing];
  next[idx] = { ...next[idx], ...message };
  return { ...prev, [channel]: next };
};

const waitingConfirmList = (actionPlan: AssistantAction[]) =>
  actionPlan.filter((item) => item.status === 'waiting_confirm');

const resolveActionFocus = (action: AssistantAction): { tab: string; flow: string } | null => {
  const actionType = String(action?.actionType || '').trim().toLowerCase();
  if (!actionType) return null;

  if (actionType === 'nav.go_to_tab') {
    const rawTab = String(action?.args?.tab || action?.args?.target || action?.args?.route || '').trim().toLowerCase();
    if (!rawTab) return null;
    const normalizedTab = rawTab === 'data_modeling' ? 'data-modeling' : rawTab;
    return { tab: normalizedTab, flow: String(action?.args?.flow || '').trim() || 'nav' };
  }
  if (actionType.startsWith('bi.')) return { tab: 'bi', flow: actionType.replace(/\./g, '_') };
  if (actionType.startsWith('reports.')) return { tab: 'reports', flow: actionType.replace(/\./g, '_') };
  if (actionType.startsWith('connections.')) return { tab: 'connections', flow: actionType.replace(/\./g, '_') };
  if (actionType.startsWith('tables.')) return { tab: 'tables', flow: actionType.replace(/\./g, '_') };
  if (actionType.startsWith('users.')) return { tab: 'users', flow: actionType.replace(/\./g, '_') };
  if (actionType.startsWith('data_modeling.')) return { tab: 'data-modeling', flow: actionType.replace(/\./g, '_') };
  return null;
};

type PendingInputState = {
  messageId: string;
  missingInput: any;
  actionPlan: AssistantAction[];
};

const resolvePendingInputState = (messages: AssistantMessage[]): PendingInputState | null => {
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx];
    if (!String(message?.id || '').trim()) continue;

    const missingInputs = Array.isArray(message?.missingInputs) ? message.missingInputs : [];
    const actionPlan = Array.isArray(message?.actionPlan) ? message.actionPlan : [];
    if (missingInputs.length === 0 || actionPlan.length === 0) continue;

    const hasWaitingInputAction = actionPlan.some((action) => action.status === 'waiting_input');
    if (!hasWaitingInputAction && message.status !== 'waiting_input') continue;

    return {
      messageId: message.id,
      missingInput: missingInputs[0],
      actionPlan,
    };
  }
  return null;
};

export const AssistantRuntimeProvider: React.FC<AssistantRuntimeProviderProps> = ({
  children,
  bindings,
}) => {
  const location = useLocation();
  const [messagesByChannel, setMessagesByChannel] = useState<Record<AssistantChannel, AssistantMessage[]>>(emptyMessages);
  const [sessionsByChannel, setSessionsByChannel] = useState<Record<AssistantChannel, AssistantSession | null>>(emptySessions);
  const [busyCountByChannel, setBusyCountByChannel] = useState<Record<AssistantChannel, number>>(emptyBusyCount);
  const sessionsRef = useRef<Record<AssistantChannel, AssistantSession | null>>(emptySessions());
  const sessionLoadRef = useRef<Record<AssistantChannel, Promise<string> | null>>({
    global: null,
    bi: null,
  });
  const undoStackRef = useRef<AssistantUndoEntry[]>([]);
  const undoCandidateMapRef = useRef<Set<string>>(new Set());
  const pendingInputRef = useRef<Record<AssistantChannel, PendingInputState | null>>({
    global: null,
    bi: null,
  });

  useEffect(() => {
    sessionsRef.current = sessionsByChannel;
  }, [sessionsByChannel]);

  const pushUndo = useCallback((entry: AssistantUndoEntry) => {
    undoStackRef.current.push(entry);
    if (undoStackRef.current.length > 60) {
      undoStackRef.current.shift();
    }
  }, []);

  const popUndo = useCallback(() => undoStackRef.current.pop(), []);

  const mergedBindings = useMemo<AssistantClientBindings>(() => ({
    ...bindings,
    pushUndo,
    popUndo,
  }), [bindings, pushUndo, popUndo]);

  const actionRegistry = useMemo(
    () => createClientActionRegistry(mergedBindings),
    [mergedBindings]
  );

  const registerUndoCandidates = useCallback((actionPlan: AssistantAction[]) => {
    if (!Array.isArray(actionPlan)) return;
    actionPlan.forEach((action) => {
      if (!action?.id) return;
      if (undoCandidateMapRef.current.has(action.id)) return;
      if (action.target !== 'server') return;
      if (action.status !== 'done') return;

      if (action.actionType === 'tables.toggle_status') {
        const tableId = String(action.args?.tableId || '').trim();
        if (!tableId) return;

        pushUndo({
          id: `undo-server-${action.id}`,
          actionType: action.actionType,
          undo: () => mergedBindings.toggleTableStatus(tableId),
        });
        undoCandidateMapRef.current.add(action.id);
      }
    });
  }, [mergedBindings, pushUndo]);

  const markBusy = useCallback((channel: AssistantChannel, busy: boolean) => {
    setBusyCountByChannel((prev) => {
      const current = Number(prev[channel] || 0);
      const nextValue = busy ? (current + 1) : Math.max(0, current - 1);
      if (nextValue === current) return prev;
      return { ...prev, [channel]: nextValue };
    });
  }, []);

  const appendLocalMessage = useCallback((channel: AssistantChannel, message: AssistantMessage) => {
    setMessagesByChannel((prev) => ({ ...prev, [channel]: [...prev[channel], message] }));
  }, []);

  const focusActionPlan = useCallback((actionPlan: AssistantAction[]) => {
    if (!Array.isArray(actionPlan) || actionPlan.length === 0) return;
    const firstAction = [...actionPlan]
      .filter((action) => !!action?.actionType)
      .sort((a, b) => Number(a.stepIndex || 0) - Number(b.stepIndex || 0))[0];
    if (!firstAction) return;

    const focus = resolveActionFocus(firstAction);
    if (!focus?.tab) return;

    bindings.setActiveTab(focus.tab);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('assistant:open-flow', {
        detail: {
          tab: focus.tab,
          flow: focus.flow,
          args: firstAction.args || {},
          actionType: firstAction.actionType,
        },
      }));
    }
  }, [bindings]);

  const ensureSession = useCallback(async (channel: AssistantChannel) => {
    const inState = sessionsRef.current[channel];
    if (inState?.id) return inState.id;

    if (sessionLoadRef.current[channel]) {
      return sessionLoadRef.current[channel] as Promise<string>;
    }

    const sessionLoader = (async () => {
      const listed = await listAssistantSessions(channel);
      const latest = listed[0];
      if (latest?.id) {
        sessionsRef.current = { ...sessionsRef.current, [channel]: latest };
        setSessionsByChannel((prev) => ({ ...prev, [channel]: latest }));
        return latest.id;
      }

      const created = await createAssistantSession({
        channel,
        title: channel === 'global' ? 'Global Assistant' : 'BI Assistant',
      });
      const session: AssistantSession = {
        id: created.sessionId,
        channel,
        title: created.title || (channel === 'global' ? 'Global Assistant' : 'BI Assistant'),
      };
      sessionsRef.current = { ...sessionsRef.current, [channel]: session };
      setSessionsByChannel((prev) => ({ ...prev, [channel]: session }));
      return created.sessionId;
    })();

    sessionLoadRef.current[channel] = sessionLoader;
    try {
      return await sessionLoader;
    } finally {
      if (sessionLoadRef.current[channel] === sessionLoader) {
        sessionLoadRef.current[channel] = null;
      }
    }
  }, []);

  const buildPlannerContext = useCallback((channel: AssistantChannel, inputContext?: Record<string, any>) => {
    const dashboardStore = useDashboardStore.getState();
    const dataStore = useDataStore.getState();
    const activeDashboard = dashboardStore.getActiveDashboard?.();
    const reportsBridge = getReportsAssistantBridge();

    return {
      channel,
      path: location.pathname,
      activeTab: bindings.activeTab,
      activeDashboardId: dashboardStore.activeDashboardId,
      editingWidgetId: dashboardStore.editingWidgetId,
      dashboards: (dashboardStore.dashboards || []).map((dashboard) => ({
        id: dashboard.id,
        title: dashboard.title,
      })),
      activeDataSourceId: activeDashboard?.dataSourceId || dataStore.selectedDataSourceId || undefined,
      activeDataModelId: dataStore.dataSources.find((source) => source.type === 'semantic_model')?.dataModelId,
      connectionCount: bindings.connections.length,
      tableCount: bindings.tables.length,
      tables: (bindings.tables || []).map((table) => ({
        id: table.id,
        tableName: table.tableName,
        datasetName: table.datasetName,
        connectionId: table.connectionId,
        status: table.status,
        rowCount: table.rowCount,
      })),
      userCount: bindings.users.length,
      reportsContext: reportsBridge?.getContext ? reportsBridge.getContext() : undefined,
      pendingMissingInput: pendingInputRef.current[channel]?.missingInput || undefined,
      pendingActionPlan: pendingInputRef.current[channel]?.actionPlan || undefined,
      ...inputContext,
    };
  }, [bindings.activeTab, bindings.connections.length, bindings.tables.length, bindings.users.length, location.pathname]);

  const patchAssistantMessage = useCallback((
    channel: AssistantChannel,
    messageId: string,
    updates: Partial<AssistantMessage>
  ) => {
    setMessagesByChannel((prev) => {
      const current = prev[channel];
      const idx = current.findIndex((item) => item.id === messageId);
      if (idx < 0) return prev;
      const next = [...current];
      next[idx] = { ...next[idx], ...updates };
      return { ...prev, [channel]: next };
    });
  }, []);

  const executeClientActions = useCallback(async ({
    channel,
    messageId,
    actionPlan,
  }: {
    channel: AssistantChannel;
    messageId: string;
    actionPlan: AssistantAction[];
  }) => {
    const queued = [...(actionPlan || [])]
      .filter((item) => item.target === 'client' && (item.status === 'planned' || item.status === 'approved'))
      .sort((a, b) => a.stepIndex - b.stepIndex);

    for (const action of queued) {
      patchAssistantMessage(channel, messageId, {
        actionPlan: (actionPlan || []).map((item) => (
          item.id === action.id ? { ...item, status: 'running' } : item
        )),
      });

      try {
        const result = await actionRegistry.execute(
          { ...action, status: 'running' },
          { channel, messageId }
        );
        const callback = await submitAssistantClientActionResult(action.id, {
          success: true,
          result: result || {},
        });

        patchAssistantMessage(channel, messageId, {
          status: (callback.messageStatus as any) || 'running',
          actionPlan: callback.actionPlan,
          pendingConfirmations: waitingConfirmList(callback.actionPlan),
        });
      } catch (err: any) {
        const callback = await submitAssistantClientActionResult(action.id, {
          success: false,
          error: err?.message || 'Client action failed',
        });
        patchAssistantMessage(channel, messageId, {
          status: (callback.messageStatus as any) || 'failed',
          actionPlan: callback.actionPlan,
          pendingConfirmations: waitingConfirmList(callback.actionPlan),
        });
      }
    }
  }, [actionRegistry, patchAssistantMessage]);

  const sendMessageHandler = useCallback(async (input: AssistantSendMessageInput): Promise<AssistantPlanResponse> => {
    const channel = input.channel;
    const text = String(input.text || '').trim();
    if (!text) {
      throw new Error('Nội dung tin nhắn trống.');
    }

    const userLocalMessage: AssistantMessage = {
      id: `local-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: 'user',
      content: text,
      status: 'done',
      missingInputs: [],
      actionPlan: [],
      pendingConfirmations: [],
    };
    appendLocalMessage(channel, userLocalMessage);

    markBusy(channel, true);
    try {
      const sessionId = await ensureSession(channel);
      const result = await sendAssistantMessage({
        sessionId,
        text,
        context: buildPlannerContext(channel, input.context),
        autoExecute: input.autoExecute !== false,
      });

      const assistantMessage: AssistantMessage = {
        id: result.messageId,
        role: 'assistant',
        content: result.assistantText,
        status: result.status,
        missingInputs: result.missingInputs || [],
        actionPlan: result.actionPlan || [],
        pendingConfirmations: result.pendingConfirmations || [],
      };

      setMessagesByChannel((prev) => upsertMessageList(prev, channel, assistantMessage));
      registerUndoCandidates(result.actionPlan || []);
      focusActionPlan(result.actionPlan || []);
      if (Array.isArray(result.missingInputs) && result.missingInputs.length > 0 && Array.isArray(result.actionPlan) && result.actionPlan.length > 0) {
        pendingInputRef.current[channel] = {
          messageId: result.messageId,
          missingInput: result.missingInputs[0],
          actionPlan: result.actionPlan,
        };
      } else {
        pendingInputRef.current[channel] = null;
      }

      if ((input.autoExecute !== false) && Array.isArray(result.actionPlan) && result.actionPlan.length > 0) {
        await executeClientActions({
          channel,
          messageId: result.messageId,
          actionPlan: result.actionPlan,
        });
      }

      return result;
    } catch (err: any) {
      appendLocalMessage(channel, {
        id: `local-assistant-error-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'assistant',
        content: `Không thể xử lý yêu cầu: ${err?.message || 'Lỗi không xác định.'}`,
        status: 'failed',
        missingInputs: [],
        actionPlan: [],
        pendingConfirmations: [],
      });
      throw err;
    } finally {
      markBusy(channel, false);
    }
  }, [appendLocalMessage, buildPlannerContext, ensureSession, executeClientActions, focusActionPlan, markBusy, registerUndoCandidates]);

  const confirmActionsHandler = useCallback(async (input: AssistantConfirmInput): Promise<AssistantPlanResponse> => {
    markBusy(input.channel, true);
    try {
      const result = await confirmAssistantActions(input.messageId, {
        approve: input.approve,
        actionIds: input.actionIds || [],
      });

      patchAssistantMessage(input.channel, input.messageId, {
        status: result.status,
        actionPlan: result.actionPlan || [],
        pendingConfirmations: result.pendingConfirmations || [],
      });
      registerUndoCandidates(result.actionPlan || []);
      focusActionPlan(result.actionPlan || []);
      if (Array.isArray(result.pendingConfirmations) && result.pendingConfirmations.length === 0) {
        pendingInputRef.current[input.channel] = null;
      }

      if (input.approve && Array.isArray(result.actionPlan) && result.actionPlan.length > 0) {
        await executeClientActions({
          channel: input.channel,
          messageId: input.messageId,
          actionPlan: result.actionPlan,
        });
      }

      return result;
    } finally {
      markBusy(input.channel, false);
    }
  }, [executeClientActions, focusActionPlan, markBusy, patchAssistantMessage, registerUndoCandidates]);

  const refreshTimeline = useCallback(async (channel: AssistantChannel) => {
    const sessionId = await ensureSession(channel);
    const timeline = await getAssistantTimeline(sessionId);
    const serverMessages = Array.isArray(timeline.messages) ? timeline.messages : [];
    sessionsRef.current = { ...sessionsRef.current, [channel]: timeline.session };
    setSessionsByChannel((prev) => ({
      ...prev,
      [channel]: timeline.session,
    }));
    setMessagesByChannel((prev) => {
      const localMessages = prev[channel].filter((message) => {
        if (!String(message.id || '').startsWith('local-')) return false;
        return !serverMessages.some((serverMessage) => (
          serverMessage.role === message.role &&
          serverMessage.content === message.content
        ));
      });
      return {
        ...prev,
        [channel]: [...serverMessages, ...localMessages],
      };
    });
    const pendingFromServer = resolvePendingInputState(serverMessages);
    const currentPending = pendingInputRef.current[channel];
    if (pendingFromServer) {
      pendingInputRef.current[channel] = pendingFromServer;
    } else if (!currentPending) {
      pendingInputRef.current[channel] = null;
    } else {
      const pendingMessageExistsOnServer = serverMessages.some((message) => message.id === currentPending.messageId);
      if (pendingMessageExistsOnServer) {
        pendingInputRef.current[channel] = null;
      }
    }
    return serverMessages;
  }, [ensureSession]);

  const startNewSession = useCallback(async (channel: AssistantChannel, title?: string) => {
    const created = await createAssistantSession({
      channel,
      title: title || (channel === 'global' ? 'Global Assistant' : 'BI Assistant'),
    });
    const createdSession = {
      id: created.sessionId,
      channel,
      title: created.title || title || (channel === 'global' ? 'Global Assistant' : 'BI Assistant'),
    };
    sessionsRef.current = { ...sessionsRef.current, [channel]: createdSession };
    setSessionsByChannel((prev) => ({
      ...prev,
      [channel]: createdSession,
    }));
    setMessagesByChannel((prev) => ({ ...prev, [channel]: [] }));
    pendingInputRef.current[channel] = null;
    return created.sessionId;
  }, []);

  const value = useMemo<AssistantRuntimeContextValue>(() => ({
    globalMessages: messagesByChannel.global,
    biMessages: messagesByChannel.bi,
    isBusyGlobal: (busyCountByChannel.global || 0) > 0,
    isBusyBi: (busyCountByChannel.bi || 0) > 0,
    sendMessage: sendMessageHandler,
    confirmActions: confirmActionsHandler,
    refreshTimeline,
    startNewSession,
  }), [
    busyCountByChannel.bi,
    busyCountByChannel.global,
    confirmActionsHandler,
    messagesByChannel.bi,
    messagesByChannel.global,
    refreshTimeline,
    sendMessageHandler,
    startNewSession,
  ]);

  return (
    <AssistantRuntimeContext.Provider value={value}>
      {children}
    </AssistantRuntimeContext.Provider>
  );
};

export const useAssistantRuntime = (): AssistantRuntimeContextValue => {
  const context = useContext(AssistantRuntimeContext);
  if (!context) {
    throw new Error('useAssistantRuntime must be used inside AssistantRuntimeProvider');
  }
  return context;
};
