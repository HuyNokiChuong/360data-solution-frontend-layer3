
export type WarehouseType = 'BigQuery' | 'Snowflake' | 'Redshift' | 'PostgreSQL' | 'Excel' | 'GoogleSheets';
export type UserRole = 'Admin' | 'Editor' | 'Viewer';

export interface PostgresConnectionConfig {
  host: string;
  port: number;
  databaseName: string;
  username: string;
  ssl: boolean;
  hasPassword?: boolean;
}

export interface PostgresSchemaObject {
  schemaName: string;
  tableName: string;
  objectType: 'table' | 'view';
}

export interface PostgresColumnInfo {
  name: string;
  type: string;
  ordinalPosition: number;
  isNullable: boolean;
}

export interface PostgresObjectColumns extends PostgresSchemaObject {
  columns: PostgresColumnInfo[];
  primaryKeyColumns: string[];
}

export type PostgresImportMode = 'full' | 'incremental';

export interface PostgresTableImportSelection extends PostgresSchemaObject {
  incrementalColumn?: string;
  incrementalKind?: 'timestamp' | 'id';
  upsert?: boolean;
  keyColumns?: string[];
}

export interface PostgresImportJob {
  id: string;
  connectionId: string;
  workspaceId?: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  stage: 'connecting' | 'fetching_schema' | 'reading_table' | 'importing' | 'completed';
  stageOrder: number;
  importMode: PostgresImportMode;
  payload: Record<string, any>;
  progress: {
    totalTables: number;
    completedTables: number;
    currentTable: string | null;
    importedRows: number;
    currentStage: string | null;
    percentage: number;
  };
  attemptCount: number;
  errorMessage?: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'Active' | 'Pending' | 'Disabled';
  joinedAt: string;
  jobTitle?: string;
  level?: string;
  department?: string;
  industry?: string;
  phoneNumber?: string;
  companySize?: string;
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
  config?: {
    postgres?: PostgresConnectionConfig;
    [key: string]: any;
  };
}

export interface SyncedTable {
  id: string;
  connectionId: string;
  tableName: string;
  datasetName: string;
  rowCount: number;
  columnCount?: number;
  status: 'Active' | 'Disabled';
  lastSync: string;
  schema: { name: string, type: string }[];
  fileName?: string;
  uploadTime?: string;
  sheetName?: string;
  sourceFileId?: string;
  sourceFileName?: string;
  sourceSheetId?: string;
  importTime?: string;
  lastSyncTime?: string;
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
