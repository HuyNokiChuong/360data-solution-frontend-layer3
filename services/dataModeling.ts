import { API_BASE } from './api';
import type {
  DataModel,
  ModelTable,
  ModelRelationship,
  RelationshipSuggestion,
  SemanticQuerySpec,
} from '../types';

const getAuthHeaders = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const parseJsonResponse = async (response: Response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.success) {
    const err: any = new Error(data?.message || 'Data modeling request failed');
    err.status = response.status;
    err.code = data?.code;
    throw err;
  }
  return data;
};

export const getDefaultDataModel = async (): Promise<DataModel> => {
  const response = await fetch(`${API_BASE}/data-modeling/default-model`, {
    headers: { ...getAuthHeaders() },
  });
  const json = await parseJsonResponse(response);
  return json.data as DataModel;
};

export const getModelTables = async (dataModelId?: string): Promise<ModelTable[]> => {
  const url = new URL(`${API_BASE}/data-modeling/tables`);
  if (dataModelId) url.searchParams.set('dataModelId', dataModelId);

  const response = await fetch(url.toString(), {
    headers: { ...getAuthHeaders() },
  });
  const json = await parseJsonResponse(response);
  return (json.data || []) as ModelTable[];
};

export const getRelationships = async (dataModelId?: string): Promise<ModelRelationship[]> => {
  const url = new URL(`${API_BASE}/data-modeling/relationships`);
  if (dataModelId) url.searchParams.set('dataModelId', dataModelId);

  const response = await fetch(url.toString(), {
    headers: { ...getAuthHeaders() },
  });
  const json = await parseJsonResponse(response);
  return (json.data || []) as ModelRelationship[];
};

export const createRelationship = async (payload: {
  dataModelId?: string;
  fromTableId: string;
  fromColumn: string;
  toTableId: string;
  toColumn: string;
  relationshipType: '1-1' | '1-n' | 'n-1' | 'n-n';
  crossFilterDirection: 'single' | 'both';
}): Promise<ModelRelationship> => {
  const response = await fetch(`${API_BASE}/data-modeling/relationships`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });

  const json = await parseJsonResponse(response);
  return json.data as ModelRelationship;
};

export const deleteRelationship = async (relationshipId: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/data-modeling/relationships/${relationshipId}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  });
  await parseJsonResponse(response);
};

export const autoDetectRelationships = async (payload: {
  dataModelId?: string;
  tableIds?: string[];
}): Promise<RelationshipSuggestion[]> => {
  const response = await fetch(`${API_BASE}/data-modeling/relationships/auto-detect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(payload || {}),
  });

  const json = await parseJsonResponse(response);
  return (json.data || []) as RelationshipSuggestion[];
};

export interface SemanticQueryPlanResponse {
  dataModelId: string;
  dataModelName: string;
  engine: 'bigquery' | 'postgres';
  sql: string;
  params: any[];
  rootTable: {
    id: string;
    tableName: string;
    datasetName?: string;
  };
  selectedTables: Array<{
    id: string;
    tableName: string;
    datasetName?: string;
    sourceType: string;
    runtimeEngine: 'bigquery' | 'postgres';
    runtimeRef?: string;
  }>;
  relationshipsUsed: Array<{
    id: string;
    fromTableId: string;
    fromTable: string;
    fromColumn: string;
    toTableId: string;
    toTable: string;
    toColumn: string;
    relationshipType: '1-1' | '1-n' | 'n-1' | 'n-n';
    crossFilterDirection: 'single' | 'both';
  }>;
}

export const planSemanticQuery = async (request: SemanticQuerySpec): Promise<SemanticQueryPlanResponse> => {
  const response = await fetch(`${API_BASE}/data-modeling/query/plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(request),
  });

  const json = await parseJsonResponse(response);
  return json.data as SemanticQueryPlanResponse;
};

export const executeSemanticQuery = async (request: SemanticQuerySpec): Promise<{
  rows: any[];
  rowCount: number;
  plan: SemanticQueryPlanResponse;
}> => {
  const response = await fetch(`${API_BASE}/data-modeling/query/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(request),
  });

  const json = await parseJsonResponse(response);
  return json.data;
};

export const executeSemanticRawSql = async (payload: {
  dataModelId?: string;
  tableIds: string[];
  rawSql: string;
}): Promise<{
  rows: any[];
  rowCount: number;
  plan: SemanticQueryPlanResponse;
}> => {
  const response = await fetch(`${API_BASE}/data-modeling/query/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });

  const json = await parseJsonResponse(response);
  return json.data;
};
