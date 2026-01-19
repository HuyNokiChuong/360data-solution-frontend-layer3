
export type WarehouseType = 'BigQuery' | 'Snowflake' | 'Redshift' | 'PostgreSQL';
export type UserRole = 'Admin' | 'Editor' | 'Viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'Active' | 'Pending' | 'Disabled';
  joinedAt: string;
}

export interface Connection {
  id: string;
  name: string;
  type: WarehouseType;
  authType: 'GoogleMail' | 'ServiceAccount' | 'Password';
  email?: string;
  status: 'Connected' | 'Error' | 'Syncing';
  createdAt: string;
  tableCount: number;
}

export interface SyncedTable {
  id: string;
  connectionId: string;
  tableName: string;
  datasetName: string;
  rowCount: number;
  status: 'Active' | 'Disabled';
  lastSync: string;
  schema: string[];
}

export interface ReportSession {
  id: string;
  title: string;
  timestamp: string;
  messages: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  visualData?: DashboardConfig;
  sqlTrace?: string;
  executionTime?: number;
}

export interface KPIConfig {
  label: string;
  value: string;
  trend: string;
}

export interface DashboardConfig {
  title: string;
  summary: string;
  charts: ChartConfig[];
  insights?: string[];
  actions?: ActionItem[];
  kpis?: KPIConfig[];
  suggestions?: string[];
}

export interface ActionItem {
  task: string;
  priority: 'High' | 'Medium' | 'Low';
  impact: string;
}

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'area' | 'metric';
  title: string;
  data: any[];
  dataKeys: string[];
  xAxisKey: string;
  insight?: string;
  sql?: string;
  mockLabels?: string[]; // Thêm trường này để nhận diện nhãn dữ liệu từ AI
}
