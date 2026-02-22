import type { Dispatch, SetStateAction } from 'react';
import type { Connection, SyncedTable, User } from '../../types';

export type AssistantChannel = 'global' | 'bi';
export type AssistantRole = 'user' | 'assistant';
export type AssistantRiskLevel = 'low' | 'medium' | 'high';
export type AssistantMessageStatus = 'planned' | 'running' | 'waiting_input' | 'waiting_confirm' | 'done' | 'failed';
export type AssistantActionStatus =
  | 'planned'
  | 'waiting_input'
  | 'waiting_confirm'
  | 'running'
  | 'approved'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'undone';

export interface AssistantSession {
  id: string;
  channel: AssistantChannel;
  title: string;
  messageCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AssistantMissingInput {
  key: string;
  question: string;
  expectedType: string;
}

export interface AssistantAction {
  id: string;
  stepIndex: number;
  target: 'server' | 'client';
  actionType: string;
  riskLevel: AssistantRiskLevel;
  requiresConfirmation: boolean;
  args: Record<string, any>;
  status: AssistantActionStatus;
  result?: Record<string, any> | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AssistantMessage {
  id: string;
  role: AssistantRole;
  content: string;
  status: AssistantMessageStatus;
  modelProvider?: string | null;
  modelId?: string | null;
  missingInputs: AssistantMissingInput[];
  actionPlan: AssistantAction[];
  pendingConfirmations: AssistantAction[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AssistantPlanResponse {
  messageId: string;
  assistantText: string;
  status: AssistantMessageStatus;
  missingInputs: AssistantMissingInput[];
  pendingConfirmations: AssistantAction[];
  actionPlan: AssistantAction[];
}

export interface AssistantTimelineResponse {
  session: AssistantSession;
  messages: AssistantMessage[];
}

export interface AssistantSendMessageInput {
  channel: AssistantChannel;
  text: string;
  context?: Record<string, any>;
  autoExecute?: boolean;
}

export interface AssistantConfirmInput {
  channel: AssistantChannel;
  messageId: string;
  approve: boolean;
  actionIds?: string[];
}

export interface AssistantUndoEntry {
  id: string;
  actionType: string;
  undo: () => Promise<any> | any;
}

export interface AssistantClientBindings {
  activeTab: string;
  currentUser: User | null;
  connections: Connection[];
  tables: SyncedTable[];
  users: User[];
  setUsers: Dispatch<SetStateAction<User[]>>;
  setActiveTab: (tab: string) => void;
  deleteConnection: (id: string) => void;
  toggleTableStatus: (id: string) => Promise<void> | void;
  deleteTable: (id: string) => Promise<void> | void;
  pushUndo: (entry: AssistantUndoEntry) => void;
  popUndo: () => AssistantUndoEntry | undefined;
}

export interface AssistantRuntimeContextValue {
  globalMessages: AssistantMessage[];
  biMessages: AssistantMessage[];
  isBusyGlobal: boolean;
  isBusyBi: boolean;
  sendMessage: (input: AssistantSendMessageInput) => Promise<AssistantPlanResponse>;
  confirmActions: (input: AssistantConfirmInput) => Promise<AssistantPlanResponse>;
  refreshTimeline: (channel: AssistantChannel) => Promise<AssistantMessage[]>;
  startNewSession: (channel: AssistantChannel, title?: string) => Promise<string>;
}
