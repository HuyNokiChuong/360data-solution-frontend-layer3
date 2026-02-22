import { API_BASE } from './api';
import type {
  AssistantAction,
  AssistantPlanResponse,
  AssistantSession,
  AssistantTimelineResponse,
  AssistantChannel,
} from '../components/assistant/types';

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const requestJson = async (path: string, init?: RequestInit): Promise<any> => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || `Assistant API error (${response.status})`);
  }
  return payload?.data;
};

export const createAssistantSession = async (payload: {
  channel: AssistantChannel;
  title?: string;
}): Promise<{ sessionId: string; channel?: AssistantChannel; title?: string }> => {
  const data = await requestJson('/assistant/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return {
    sessionId: String(data?.sessionId || ''),
    channel: data?.channel,
    title: data?.title,
  };
};

export const listAssistantSessions = async (channel?: AssistantChannel): Promise<AssistantSession[]> => {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : '';
  const data = await requestJson(`/assistant/sessions${query}`, {
    method: 'GET',
  });
  return Array.isArray(data) ? data : [];
};

export const sendAssistantMessage = async (payload: {
  sessionId: string;
  text: string;
  context?: Record<string, any>;
  autoExecute?: boolean;
}): Promise<AssistantPlanResponse> => {
  const data = await requestJson('/assistant/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    messageId: String(data?.messageId || ''),
    assistantText: String(data?.assistantText || ''),
    status: data?.status || 'planned',
    missingInputs: Array.isArray(data?.missingInputs) ? data.missingInputs : [],
    pendingConfirmations: Array.isArray(data?.pendingConfirmations) ? data.pendingConfirmations : [],
    actionPlan: Array.isArray(data?.actionPlan) ? data.actionPlan : [],
  } as AssistantPlanResponse;
};

export const confirmAssistantActions = async (
  messageId: string,
  payload: { approve: boolean; actionIds?: string[] }
): Promise<AssistantPlanResponse> => {
  const data = await requestJson(`/assistant/messages/${messageId}/confirm`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return {
    messageId: String(data?.messageId || messageId),
    assistantText: '',
    status: data?.status || 'planned',
    missingInputs: [],
    pendingConfirmations: Array.isArray(data?.pendingConfirmations) ? data.pendingConfirmations : [],
    actionPlan: Array.isArray(data?.actionPlan) ? data.actionPlan : [],
  } as AssistantPlanResponse;
};

export const submitAssistantClientActionResult = async (
  actionId: string,
  payload: { success: boolean; result?: Record<string, any>; error?: string }
): Promise<{ action: AssistantAction | null; messageStatus: string; actionPlan: AssistantAction[] }> => {
  const data = await requestJson(`/assistant/actions/${actionId}/client-result`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return {
    action: data?.action || null,
    messageStatus: String(data?.messageStatus || ''),
    actionPlan: Array.isArray(data?.actionPlan) ? data.actionPlan : [],
  };
};

export const getAssistantTimeline = async (sessionId: string): Promise<AssistantTimelineResponse> => {
  const data = await requestJson(`/assistant/sessions/${sessionId}/timeline`, {
    method: 'GET',
  });
  return {
    session: data?.session,
    messages: Array.isArray(data?.messages) ? data.messages : [],
  } as AssistantTimelineResponse;
};
