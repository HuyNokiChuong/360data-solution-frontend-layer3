
export type WarehouseType = 'BigQuery' | 'Snowflake' | 'Redshift' | 'PostgreSQL' | 'Excel' | 'GoogleSheets';
export type UserRole = 'Admin' | 'Editor' | 'Viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'Active' | 'Pending' | 'Disabled';
  joinedAt: string;
  registrationType?: string;
  currentLevel?: string;
  department?: string;
  industry?: string;
  companySize?: string;
  phoneNumber?: string;
  jobTitle?: string; // Kept for backward compatibility
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
  projectId?: string;
  serviceAccountKey?: string;
}

export interface SyncedTable {
  id: string;
  connectionId: string;
  tableName: string;
  datasetName: string;
  rowCount: number;
  status: 'Active' | 'Disabled';
  lastSync: string;
  schema: { name: string, type: string }[];
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
  value: string | number;
  trend: string;
  comparisonContext?: string; // e.g., "vs Last Month"
  status?: 'increase' | 'decrease' | 'neutral';
}


export interface StrategicInsight {
  title: string;
  analysis: string; // Detailed explanation of what the data says
  recommendation: string; // Strategic advice
  priority?: 'High' | 'Medium' | 'Low';
}

export interface ActionItem {
  task: string;
  priority: 'High' | 'Medium' | 'Low';
  impact: string;
}


export interface ChartInsight {
  analysis: string; // What happened?
  trend: string; // Why it happened? (Key Drivers)
  action: string; // What to do next?
  highlight?: {
    index?: number; // Index of the data point to highlight
    value?: string | number; // Specific value to highlight
    label: string; // Annotation text
    type?: 'positive' | 'negative' | 'neutral' | 'critical'; // Sentiment type for styling
  }[];
}

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'area' | 'metric';
  title: string;
  data: any[];
  dataKeys: string[];
  xAxisKey: string;
  insight?: string | ChartInsight; // Updated to support structured insight
  sql?: string;
  limit?: number; // User preference for Top N items
  mockLabels?: string[];
}


export interface DashboardConfig {
  title: string;
  summary: string;
  charts: ChartConfig[];
  insights?: StrategicInsight[]; // Changed from string[] to StrategicInsight[]
  actions?: ActionItem[];
  kpis?: KPIConfig[];
  suggestions?: string[];
}
