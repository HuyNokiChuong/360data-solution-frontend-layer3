
import React, { useState, useRef } from 'react';
import {
  Connection,
  WarehouseType,
  SyncedTable,
  PostgresConnectionConfig,
  PostgresSchemaObject,
  PostgresObjectColumns
} from '../types';
import { WAREHOUSE_OPTIONS, DISCOVERABLE_TABLES } from '../constants';
import { getGoogleToken, initGoogleAuth, getServiceAccountToken, getGoogleAuthCode } from '../services/googleAuth';
import { fetchProjects, fetchDatasets, fetchTables } from '../services/bigquery';
import { fetchExcelDatasets, uploadExcelForPreview } from '../services/excel';
import {
  connectGoogleSheetsOAuth,
  listGoogleSheetsFiles,
  resolveGoogleSheetsUrl,
  listGoogleSheetsTabs,
  preflightGoogleSheetsImport,
  GoogleSheetSelectionInput
} from '../services/googleSheets';
import {
  testPostgresConnection,
  createPostgresConnection,
  updatePostgresConnection,
  listPostgresSchemas,
  listPostgresObjects,
  fetchPostgresColumnsBatch,
  startPostgresImportJob,
  getPostgresImportJob
} from '../services/postgres';
import { useLanguageStore } from '../store/languageStore';

type SelectedGoogleSheet = {
  sheetId: number;
  sheetName: string;
  headerMode: 'first_row' | 'auto_columns';
};

type PostgresImportStage = 'idle' | 'connecting' | 'fetching_schema' | 'reading_table' | 'importing' | 'completed';

type PostgresImportTableState = {
  schemaName: string;
  tableName: string;
  objectType: 'table' | 'view';
  incrementalColumn?: string;
  incrementalKind?: 'timestamp' | 'id';
  upsert?: boolean;
  keyColumns?: string[];
};

interface ConnectionsProps {
  connections: Connection[];
  tables: SyncedTable[];
  onAddConnection: (conn: Connection, selectedTables: any[]) => void;
  onCreateExcelConnection: (conn: Connection, file: File, datasetName: string, sheetNames: string[]) => Promise<void>;
  onCreateGoogleSheetsConnection: (payload: {
    connectionId?: string;
    connectionName: string;
    authCode: string;
    fileId: string;
    fileName?: string;
    sheets: GoogleSheetSelectionInput[];
    allowEmptySheets?: boolean;
    confirmOverwrite?: boolean;
    syncMode?: 'manual' | 'interval';
    syncIntervalMinutes?: number;
  }) => Promise<void>;
  onRefreshData: () => Promise<void>;
  onUpdateConnection: (conn: Connection, selectedTables?: any[]) => void;
  onDeleteConnection: (id: string) => void;
  googleToken: string | null;
  setGoogleToken: (token: string | null) => void;
}

const Connections: React.FC<ConnectionsProps> = ({
  connections,
  tables,
  onAddConnection,
  onCreateExcelConnection,
  onCreateGoogleSheetsConnection,
  onRefreshData,
  onUpdateConnection,
  onDeleteConnection,
  googleToken,
  setGoogleToken
}) => {
  const { t } = useLanguageStore();
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingConnId, setEditingConnId] = useState<string | null>(null);
  const [step, setStep] = useState(1); // 1: Type/Name, 2: Auth, 3: Context (Project/DB), 4: Tables
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelSheets, setExcelSheets] = useState<{ sheetName: string; rowCount: number; columnCount: number; isEmpty: boolean; warnings?: string[] }[]>([]);
  const [selectedExcelSheets, setSelectedExcelSheets] = useState<string[]>([]);
  const [excelDatasets, setExcelDatasets] = useState<string[]>([]);
  const [selectedExcelDataset, setSelectedExcelDataset] = useState('');
  const [importStage, setImportStage] = useState<'idle' | 'uploading' | 'parsing' | 'importing' | 'completed'>('idle');
  const [googleSheetsConnectionId, setGoogleSheetsConnectionId] = useState<string>('');
  const [googleSheetsAuthCode, setGoogleSheetsAuthCode] = useState<string>('');
  const [googleFiles, setGoogleFiles] = useState<{ id: string; name: string; modifiedTime?: string }[]>([]);
  const [googleFileSearch, setGoogleFileSearch] = useState('');
  const [googleFileUrl, setGoogleFileUrl] = useState('');
  const [selectedGoogleFile, setSelectedGoogleFile] = useState<{ id: string; name: string } | null>(null);
  const [googleTabs, setGoogleTabs] = useState<{ sheetId: number; title: string; index: number; gridProperties?: { rowCount?: number; columnCount?: number } }[]>([]);
  const [selectedGoogleSheets, setSelectedGoogleSheets] = useState<SelectedGoogleSheet[]>([]);
  const [googleSyncMode, setGoogleSyncMode] = useState<'manual' | 'interval'>('manual');
  const [googleSyncIntervalMinutes, setGoogleSyncIntervalMinutes] = useState<number>(15);
  const [googleFlowStage, setGoogleFlowStage] = useState<'idle' | 'connecting' | 'fetching_files' | 'reading_sheet' | 'importing' | 'completed'>('idle');
  const [sheetUrl, setSheetUrl] = useState('');
  const [bqProjects, setBqProjects] = useState<any[]>([]);
  const [bqDatasets, setBqDatasets] = useState<any[]>([]);
  const [bqTables, setBqTables] = useState<any[]>([]);
  const [selectedContext, setSelectedContext] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [datasetSearchTerm, setDatasetSearchTerm] = useState('');
  const [projectSearchTerm, setProjectSearchTerm] = useState('');
  const [connSearchTerm, setConnSearchTerm] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [postgresConnectionId, setPostgresConnectionId] = useState<string>('');
  const [postgresConfig, setPostgresConfig] = useState<PostgresConnectionConfig & { password?: string }>({
    host: '',
    port: 5432,
    databaseName: '',
    username: '',
    password: '',
    ssl: false,
    hasPassword: false,
  });
  const [postgresSchemas, setPostgresSchemas] = useState<string[]>([]);
  const [selectedPostgresSchemas, setSelectedPostgresSchemas] = useState<string[]>([]);
  const [postgresObjects, setPostgresObjects] = useState<PostgresSchemaObject[]>([]);
  const [selectedPostgresObjectKeys, setSelectedPostgresObjectKeys] = useState<string[]>([]);
  const [includePostgresViews, setIncludePostgresViews] = useState(false);
  const [postgresSchemaSearch, setPostgresSchemaSearch] = useState('');
  const [postgresObjectSearch, setPostgresObjectSearch] = useState('');
  const [postgresObjectColumns, setPostgresObjectColumns] = useState<Record<string, PostgresObjectColumns>>({});
  const [postgresImportMode, setPostgresImportMode] = useState<'full' | 'incremental'>('full');
  const [postgresUpsertEnabled, setPostgresUpsertEnabled] = useState(true);
  const [postgresIncrementalColumnMap, setPostgresIncrementalColumnMap] = useState<Record<string, string>>({});
  const [postgresKeyColumnsMap, setPostgresKeyColumnsMap] = useState<Record<string, string[]>>({});
  const [postgresImportStage, setPostgresImportStage] = useState<PostgresImportStage>('idle');
  const [postgresImportJobId, setPostgresImportJobId] = useState<string>('');
  const [postgresImportError, setPostgresImportError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const excelFileInputRef = useRef<HTMLInputElement>(null);

  const [tempConn, setTempConn] = useState<Partial<Connection>>({
    name: '',
    type: 'BigQuery',
    authType: 'ServiceAccount',
  });

  const MOCK_CONTEXTS: Record<WarehouseType, string[]> = {
    BigQuery: [], // Dynamic
    Snowflake: ['ANALYTICS_WH (DB: RAW)', 'COMPUTE_WH (DB: PROD)', 'REPORTING_WH (DB: ARCHIVE)'],
    Redshift: ['cluster-primary (dev)', 'cluster-readonly (prod)', 'serverless-namespace-01'],
    PostgreSQL: ['postgres_master', 'replica_01_readonly', 'customer_data_partition'],
    Excel: ['Upload File'],
    GoogleSheets: ['Select Sheet']
  };

  // Add useEffect to init Google Auth
  React.useEffect(() => {
    initGoogleAuth(process.env.GOOGLE_CLIENT_ID || '').catch(console.error);
  }, []);

  // Excel flow skips stage 3 (dataset screen) and jumps directly to stage 4.
  React.useEffect(() => {
    if (isWizardOpen && tempConn.type === 'Excel' && step === 3) {
      setStep(4);
    }
  }, [isWizardOpen, tempConn.type, step]);

  const displayedTables = (tempConn.type === 'BigQuery' && bqTables.length > 0)
    ? bqTables
    : DISCOVERABLE_TABLES;

  const filteredTables = displayedTables.filter(table =>
    table.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (table.dataset && table.dataset.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const postgresObjectKey = (schemaName: string, tableName: string) => `${schemaName}.${tableName}`;

  const selectedPostgresObjects = postgresObjects.filter((obj) =>
    selectedPostgresObjectKeys.includes(postgresObjectKey(obj.schemaName, obj.tableName))
  );

  const filteredPostgresSchemas = postgresSchemas.filter((schemaName) =>
    schemaName.toLowerCase().includes(postgresSchemaSearch.toLowerCase())
  );

  const filteredPostgresObjects = postgresObjects.filter((obj) => {
    const key = postgresObjectKey(obj.schemaName, obj.tableName);
    const keyword = `${obj.schemaName}.${obj.tableName}`.toLowerCase();
    return keyword.includes(postgresObjectSearch.toLowerCase())
      && (selectedPostgresSchemas.length === 0 || selectedPostgresSchemas.includes(obj.schemaName))
      && (includePostgresViews || obj.objectType !== 'view')
      && (key.length > 0);
  });

  const allFilteredPostgresObjectsSelected = filteredPostgresObjects.length > 0
    && filteredPostgresObjects.every((obj) =>
      selectedPostgresObjectKeys.includes(postgresObjectKey(obj.schemaName, obj.tableName))
    );

  const postgresStages: { key: PostgresImportStage; label: string }[] = [
    { key: 'connecting', label: 'Connecting' },
    { key: 'fetching_schema', label: 'Fetching schema' },
    { key: 'reading_table', label: 'Reading table' },
    { key: 'importing', label: 'Importing' },
    { key: 'completed', label: 'Completed' },
  ];

  const getIncrementalKindFromType = (typeName: string): 'timestamp' | 'id' | null => {
    const lowered = String(typeName || '').toLowerCase();
    if (lowered.includes('timestamp') || lowered.includes('date') || lowered.includes('time')) return 'timestamp';
    if (lowered.includes('int') || lowered.includes('numeric') || lowered.includes('decimal') || lowered.includes('serial')) return 'id';
    return null;
  };

  const getIncrementalCandidates = (columns: { name: string; type: string }[] = []) =>
    columns.filter((column) => getIncrementalKindFromType(column.type) !== null);

  const isPostgresIncrementalSelectionValid = selectedPostgresObjects.every((object) => {
    const key = postgresObjectKey(object.schemaName, object.tableName);
    const selectedIncrementalColumn = postgresIncrementalColumnMap[key];
    if (!selectedIncrementalColumn) return false;

    if (!postgresUpsertEnabled) return true;
    const metadata = postgresObjectColumns[key];
    const primaryKeyColumns = metadata?.primaryKeyColumns || [];
    const fallbackKeyColumns = postgresKeyColumnsMap[key] || [];
    return primaryKeyColumns.length > 0 || fallbackKeyColumns.length > 0;
  });

  const toggleTable = (tableName: string) => {
    setSelectedTables(prev =>
      prev.includes(tableName)
        ? prev.filter(t => t !== tableName)
        : [...prev, tableName]
    );
  };

  const handleSelectAll = () => {
    const allFilteredNames = filteredTables.map(t => t.name);
    const areAllSelected = allFilteredNames.every(name => selectedTables.includes(name));

    if (areAllSelected) {
      // Deselect all that are currently visible
      setSelectedTables(prev => prev.filter(name => !allFilteredNames.includes(name)));
    } else {
      // Select all that are currently visible (avoid duplicates)
      setSelectedTables(prev => {
        const newSet = new Set([...prev, ...allFilteredNames]);
        return Array.from(newSet);
      });
    }
  };

  const handleSelectAllPostgresObjects = () => {
    const filteredKeys = filteredPostgresObjects.map((obj) => postgresObjectKey(obj.schemaName, obj.tableName));
    const areAllSelected = filteredKeys.length > 0 && filteredKeys.every((key) => selectedPostgresObjectKeys.includes(key));

    if (areAllSelected) {
      setSelectedPostgresObjectKeys((prev) => prev.filter((key) => !filteredKeys.includes(key)));
      return;
    }

    setSelectedPostgresObjectKeys((prev) => Array.from(new Set([...prev, ...filteredKeys])));
  };

  const handleOpenWizard = (conn?: Connection) => {
    if (conn) {
      setEditingConnId(conn.id);
      setTempConn(conn);
      setStep(1);
      setAuthSuccess(conn.type !== 'PostgreSQL');
      setSelectedContext(conn.type === 'BigQuery' ? (MOCK_CONTEXTS[conn.type][0] || '') : '');
      setExcelFile(null);
      setExcelSheets([]);
      setSelectedExcelSheets([]);
      setSelectedExcelDataset('');
      setImportStage('idle');
      setGoogleSheetsConnectionId(conn.type === 'GoogleSheets' ? conn.id : '');
      setGoogleSheetsAuthCode('');
      setGoogleFiles([]);
      setGoogleFileSearch('');
      setGoogleFileUrl('');
      setSelectedGoogleFile(null);
      setGoogleTabs([]);
      setSelectedGoogleSheets([]);
      setGoogleSyncMode('manual');
      setGoogleSyncIntervalMinutes(15);
      setGoogleFlowStage('idle');
      const pgConfig = conn.type === 'PostgreSQL' ? (conn.config?.postgres || null) : null;
      setPostgresConnectionId(conn.type === 'PostgreSQL' ? conn.id : '');
      setPostgresConfig({
        host: pgConfig?.host || '',
        port: pgConfig?.port || 5432,
        databaseName: pgConfig?.databaseName || '',
        username: pgConfig?.username || '',
        password: '',
        ssl: pgConfig?.ssl === true,
        hasPassword: pgConfig?.hasPassword || false,
      });
      setPostgresSchemas([]);
      setSelectedPostgresSchemas([]);
      setPostgresObjects([]);
      setSelectedPostgresObjectKeys([]);
      setIncludePostgresViews(false);
      setPostgresSchemaSearch('');
      setPostgresObjectSearch('');
      setPostgresObjectColumns({});
      setPostgresImportMode('full');
      setPostgresUpsertEnabled(true);
      setPostgresIncrementalColumnMap({});
      setPostgresKeyColumnsMap({});
      setPostgresImportStage('idle');
      setPostgresImportJobId('');
      setPostgresImportError('');
    } else {
      setEditingConnId(null);
      setTempConn({ name: '', type: 'BigQuery', authType: 'ServiceAccount' });
      setStep(1);
      setAuthSuccess(false);
      setSelectedTables([]);
      setUploadedFile(null);
      setSheetUrl('');
      setSelectedContext('');
      setBqProjects([]);
      setBqDatasets([]);
      setBqTables([]);
      setProjectSearchTerm('');
      setConnSearchTerm('');
      setSelectedDatasetId(null);
      setExcelFile(null);
      setExcelSheets([]);
      setSelectedExcelSheets([]);
      setExcelDatasets([]);
      setSelectedExcelDataset('');
      setImportStage('idle');
      setGoogleSheetsConnectionId('');
      setGoogleSheetsAuthCode('');
      setGoogleFiles([]);
      setGoogleFileSearch('');
      setGoogleFileUrl('');
      setSelectedGoogleFile(null);
      setGoogleTabs([]);
      setSelectedGoogleSheets([]);
      setGoogleSyncMode('manual');
      setGoogleSyncIntervalMinutes(15);
      setGoogleFlowStage('idle');
      setPostgresConnectionId('');
      setPostgresConfig({
        host: '',
        port: 5432,
        databaseName: '',
        username: '',
        password: '',
        ssl: false,
        hasPassword: false,
      });
      setPostgresSchemas([]);
      setSelectedPostgresSchemas([]);
      setPostgresObjects([]);
      setSelectedPostgresObjectKeys([]);
      setIncludePostgresViews(false);
      setPostgresSchemaSearch('');
      setPostgresObjectSearch('');
      setPostgresObjectColumns({});
      setPostgresImportMode('full');
      setPostgresUpsertEnabled(true);
      setPostgresIncrementalColumnMap({});
      setPostgresKeyColumnsMap({});
      setPostgresImportStage('idle');
      setPostgresImportJobId('');
      setPostgresImportError('');
    }
    setSearchTerm('');
    setIsWizardOpen(true);
  };

  const handleGoogleLogin = async () => {
    setIsAuthenticating(true);
    try {
      // In a real app, use the Client ID from env
      const clientId = process.env.GOOGLE_CLIENT_ID || '';
      const token = await getGoogleToken(clientId);
      setGoogleToken(token);
      setAuthSuccess(true);

      // Fetch Projects immediately to populate context
      const projects = await fetchProjects(token);
      setBqProjects(projects);

      setStep(3);
    } catch (error) {
      console.error("Login failed", error);
      alert("Google Login Failed. Please check console.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const simulateAuth = () => {
    setIsAuthenticating(true);
    setTimeout(() => {
      setIsAuthenticating(false);
      setAuthSuccess(true);
      setStep(3);
    }, 1500);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (file.type === 'application/json' || file.name.endsWith('.json'))) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = JSON.parse(event.target?.result as string);
          if (!content.project_id || !content.client_email || !content.private_key) {
            throw new Error("Invalid Service Account JSON. Missing required fields.");
          }
          setTempConn(prev => ({
            ...prev,
            projectId: content.project_id,
            serviceAccountKey: event.target?.result as string, // Store the full JSON
            email: content.client_email
          }));
          setUploadedFile(file);
        } catch (err: any) {
          alert("Error parsing JSON: " + err.message);
        }
      };
      reader.readAsText(file);
    } else {
      alert("Please upload a valid JSON credential file.");
    }
  };

  const loadExcelDatasetOptions = async () => {
    try {
      const datasets = await fetchExcelDatasets();
      setExcelDatasets(datasets);
      if (datasets.length > 0) {
        setSelectedExcelDataset(datasets[0]);
        return datasets[0];
      }
      setSelectedExcelDataset('excel_default');
      return 'excel_default';
    } catch (error: any) {
      setSelectedExcelDataset('excel_default');
      return 'excel_default';
    }
  };

  const handleExcelFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!(file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls'))) {
      alert('Please upload a valid Excel file (.xlsx or .xls).');
      return;
    }

    setExcelFile(file);
    setSelectedExcelSheets([]);
    setImportStage('uploading');

    try {
      setImportStage('parsing');
      const preview = await uploadExcelForPreview(file);
      setExcelSheets(preview.sheets || []);
      setAuthSuccess(true);
      await loadExcelDatasetOptions();
    } catch (error: any) {
      setAuthSuccess(false);
      setExcelSheets([]);
      alert(error.message || 'Failed to parse Excel file');
    } finally {
      setImportStage('idle');
    }
  };

  const toggleExcelSheet = (sheetName: string) => {
    setSelectedExcelSheets(prev =>
      prev.includes(sheetName)
        ? prev.filter(name => name !== sheetName)
        : [...prev, sheetName]
    );
  };

  const loadGoogleFiles = async (search = '', connectionIdOverride?: string) => {
    const connectionId = connectionIdOverride || googleSheetsConnectionId;
    if (!connectionId) return;
    setGoogleFlowStage('fetching_files');
    try {
      const result = await listGoogleSheetsFiles(connectionId, {
        search: search.trim(),
        pageSize: 50
      });
      setGoogleFiles((result.files || []).map(f => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime
      })));
    } catch (error: any) {
      alert(error.message || 'Failed to fetch Google Sheets files');
    } finally {
      setGoogleFlowStage('idle');
    }
  };

  const loadGoogleTabs = async (fileId: string, fileName: string) => {
    if (!googleSheetsConnectionId) return;
    setGoogleFlowStage('reading_sheet');
    try {
      const response = await listGoogleSheetsTabs(googleSheetsConnectionId, fileId);
      const tabs = response.sheets || [];
      setSelectedGoogleFile({ id: fileId, name: fileName });
      setGoogleTabs(tabs.map(s => ({
        sheetId: Number(s.sheetId),
        title: s.title,
        index: s.index,
        gridProperties: s.gridProperties
      })));
      setSelectedGoogleSheets([]);
    } catch (error: any) {
      alert(error.message || 'Failed to read Google Sheets tabs');
    } finally {
      setGoogleFlowStage('idle');
    }
  };

  const toggleGoogleSheet = (sheet: { sheetId: number; title: string }) => {
    setSelectedGoogleSheets(prev => {
      const exists = prev.some(item => item.sheetId === sheet.sheetId);
      if (exists) {
        return prev.filter(item => item.sheetId !== sheet.sheetId);
      }
      return [...prev, { sheetId: sheet.sheetId, sheetName: sheet.title, headerMode: 'first_row' }];
    });
  };

  const updateGoogleSheetHeaderMode = (sheetId: number, headerMode: 'first_row' | 'auto_columns') => {
    setSelectedGoogleSheets(prev => prev.map(item => item.sheetId === sheetId ? { ...item, headerMode } : item));
  };

  const handleGoogleSheetsConnect = async () => {
    try {
      setIsAuthenticating(true);
      setGoogleFlowStage('connecting');
      const clientId = process.env.GOOGLE_CLIENT_ID || '';
      const authCode = await getGoogleAuthCode(clientId);
      setGoogleSheetsAuthCode(authCode);

      const connected = await connectGoogleSheetsOAuth({
        authCode,
        connectionId: tempConn.type === 'GoogleSheets' && editingConnId ? editingConnId : undefined,
        connectionName: tempConn.name || 'Google Sheets Connection'
      });

      setGoogleSheetsConnectionId(connected.id);
      setAuthSuccess(true);
      setStep(3);
      await loadGoogleFiles('', connected.id);
    } catch (error: any) {
      console.error('Google Sheets OAuth connect failed', error);
      alert(error.message || 'Failed to connect Google Sheets account');
      setAuthSuccess(false);
    } finally {
      setIsAuthenticating(false);
      setGoogleFlowStage('idle');
    }
  };

  const handleResolveGoogleFileUrl = async () => {
    if (!googleSheetsConnectionId) {
      alert('Connect Google account first.');
      return;
    }
    const raw = googleFileUrl.trim();
    if (!raw) return;
    try {
      setGoogleFlowStage('fetching_files');
      const file = await resolveGoogleSheetsUrl(googleSheetsConnectionId, raw);
      await loadGoogleTabs(file.id, file.name);
    } catch (error: any) {
      alert(error.message || 'Invalid Google Sheets URL');
    } finally {
      setGoogleFlowStage('idle');
    }
  };

  const updatePostgresConfigField = (field: keyof (PostgresConnectionConfig & { password?: string }), value: string | number | boolean) => {
    setPostgresConfig((prev) => ({
      ...prev,
      [field]: value
    }));
    setAuthSuccess(false);
    if (postgresImportStage === 'completed') {
      setPostgresImportStage('idle');
    }
  };

  const togglePostgresSchema = (schemaName: string) => {
    setSelectedPostgresSchemas((prev) =>
      prev.includes(schemaName)
        ? prev.filter((item) => item !== schemaName)
        : [...prev, schemaName]
    );
  };

  const togglePostgresObject = (schemaName: string, tableName: string) => {
    const key = postgresObjectKey(schemaName, tableName);
    setSelectedPostgresObjectKeys((prev) =>
      prev.includes(key)
        ? prev.filter((item) => item !== key)
        : [...prev, key]
    );
  };

  const togglePostgresKeyColumn = (objectKey: string, columnName: string) => {
    setPostgresKeyColumnsMap((prev) => {
      const current = prev[objectKey] || [];
      const next = current.includes(columnName)
        ? current.filter((item) => item !== columnName)
        : [...current, columnName];
      return {
        ...prev,
        [objectKey]: next
      };
    });
  };

  const loadPostgresObjectsForSchemas = async (connectionId: string, schemaNames: string[], includeViews: boolean) => {
    if (!connectionId || schemaNames.length === 0) {
      setPostgresObjects([]);
      setSelectedPostgresObjectKeys([]);
      return;
    }

    const objects = await listPostgresObjects(connectionId, schemaNames, includeViews);
    setPostgresObjects(objects);
    setSelectedPostgresObjectKeys((prev) =>
      prev.filter((key) => objects.some((obj) => postgresObjectKey(obj.schemaName, obj.tableName) === key))
    );
  };

  const handleTestPostgres = async () => {
    try {
      setIsAuthenticating(true);
      setPostgresImportStage('connecting');
      setPostgresImportError('');

      const connectionId = postgresConnectionId || editingConnId || undefined;
      await testPostgresConnection({
        connectionId,
        config: {
          host: postgresConfig.host,
          port: Number(postgresConfig.port || 5432),
          databaseName: postgresConfig.databaseName,
          username: postgresConfig.username,
          password: postgresConfig.password || '',
          ssl: postgresConfig.ssl === true
        }
      });
      setAuthSuccess(true);
      setPostgresImportStage('completed');
    } catch (error: any) {
      setAuthSuccess(false);
      setPostgresImportStage('idle');
      setPostgresImportError(error.message || 'Failed to test PostgreSQL connection');
      alert(error.message || 'Failed to test PostgreSQL connection');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handlePostgresSaveAndContinue = async () => {
    try {
      if (!authSuccess) {
        alert('Please test the PostgreSQL connection first.');
        return;
      }

      setIsAuthenticating(true);
      setPostgresImportStage('fetching_schema');
      setPostgresImportError('');

      const payload = {
        name: tempConn.name || 'PostgreSQL Connection',
        config: {
          host: postgresConfig.host,
          port: Number(postgresConfig.port || 5432),
          databaseName: postgresConfig.databaseName,
          username: postgresConfig.username,
          password: postgresConfig.password || '',
          ssl: postgresConfig.ssl === true
        }
      };

      const savedConnection = (editingConnId || postgresConnectionId)
        ? await updatePostgresConnection(editingConnId || postgresConnectionId, payload)
        : await createPostgresConnection(payload);

      setPostgresConnectionId(savedConnection.id);
      setTempConn((prev) => ({
        ...prev,
        id: savedConnection.id,
        type: 'PostgreSQL',
        authType: 'Password',
        status: 'Connected',
      }));

      const schemas = await listPostgresSchemas(savedConnection.id);
      setPostgresSchemas(schemas);
      const defaultSchemas = schemas.length > 0 ? [schemas[0]] : [];
      setSelectedPostgresSchemas(defaultSchemas);
      await loadPostgresObjectsForSchemas(savedConnection.id, defaultSchemas, includePostgresViews);
      setStep(3);
      setPostgresImportStage('idle');
    } catch (error: any) {
      setPostgresImportError(error.message || 'Failed to save PostgreSQL connection');
      alert(error.message || 'Failed to save PostgreSQL connection');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handlePreparePostgresImport = async () => {
    if (!postgresConnectionId) {
      throw new Error('PostgreSQL connection is not initialized');
    }
    if (selectedPostgresObjects.length === 0) {
      throw new Error('Please select at least one schema.table');
    }

    const metadata = await fetchPostgresColumnsBatch(postgresConnectionId, selectedPostgresObjects);
    const metadataMap: Record<string, PostgresObjectColumns> = {};
    const defaultIncrementalMap: Record<string, string> = {};
    const defaultKeyMap: Record<string, string[]> = {};

    metadata.forEach((item) => {
      const key = postgresObjectKey(item.schemaName, item.tableName);
      metadataMap[key] = item;
      const candidates = getIncrementalCandidates((item.columns || []).map((column) => ({ name: column.name, type: column.type })));
      const preferred = candidates.find((column) => ['updated_at', 'modified_at', 'id'].includes(column.name.toLowerCase()))
        || candidates[0];
      if (preferred) {
        defaultIncrementalMap[key] = preferred.name;
      }
      if ((item.primaryKeyColumns || []).length > 0) {
        defaultKeyMap[key] = item.primaryKeyColumns;
      }
    });

    setPostgresObjectColumns(metadataMap);
    setPostgresIncrementalColumnMap((prev) => ({ ...defaultIncrementalMap, ...prev }));
    setPostgresKeyColumnsMap((prev) => ({ ...defaultKeyMap, ...prev }));
  };

  React.useEffect(() => {
    let disposed = false;
    const shouldLoad = step === 3 && tempConn.type === 'PostgreSQL' && !!postgresConnectionId;
    if (!shouldLoad) return () => { disposed = true; };

    const schemaNames = selectedPostgresSchemas;
    if (schemaNames.length === 0) {
      setPostgresObjects([]);
      setSelectedPostgresObjectKeys([]);
      return () => { disposed = true; };
    }

    const run = async () => {
      try {
        setIsAuthenticating(true);
        setPostgresImportStage('fetching_schema');
        const objects = await listPostgresObjects(postgresConnectionId, schemaNames, includePostgresViews);
        if (disposed) return;
        setPostgresObjects(objects);
        setSelectedPostgresObjectKeys((prev) =>
          prev.filter((key) => objects.some((obj) => postgresObjectKey(obj.schemaName, obj.tableName) === key))
        );
      } catch (error: any) {
        if (disposed) return;
        setPostgresImportError(error.message || 'Failed to fetch PostgreSQL objects');
      } finally {
        if (!disposed) {
          setIsAuthenticating(false);
          setPostgresImportStage('idle');
        }
      }
    };

    run();
    return () => {
      disposed = true;
    };
  }, [step, tempConn.type, postgresConnectionId, selectedPostgresSchemas, includePostgresViews]);

  const handleSave = async () => {
    if (tempConn.type === 'Excel') {
      if (!excelFile) {
        alert('Please upload an Excel file first.');
        return;
      }
      if (selectedExcelSheets.length === 0) {
        alert('Please select at least one sheet to import.');
        return;
      }
    }
    if (tempConn.type === 'GoogleSheets') {
      if (!googleSheetsConnectionId) {
        alert('Please connect Google account first.');
        return;
      }
      if (!selectedGoogleFile) {
        alert('Please select a Google Sheets file.');
        return;
      }
      if (selectedGoogleSheets.length === 0) {
        alert('Please select at least one sheet.');
        return;
      }
    }

    if (tempConn.type === 'PostgreSQL') {
      if (!postgresConnectionId) {
        alert('Please save PostgreSQL connection details first.');
        return;
      }
      if (selectedPostgresObjects.length === 0) {
        alert('Please select at least one table/view to import.');
        return;
      }

      if (postgresImportMode === 'incremental') {
        for (const object of selectedPostgresObjects) {
          const key = postgresObjectKey(object.schemaName, object.tableName);
          const selectedIncrementalColumn = postgresIncrementalColumnMap[key];
          if (!selectedIncrementalColumn) {
            alert(`Incremental column is required for ${object.schemaName}.${object.tableName}`);
            return;
          }

          if (postgresUpsertEnabled) {
            const metadata = postgresObjectColumns[key];
            const pkColumns = metadata?.primaryKeyColumns || [];
            const userKeyColumns = postgresKeyColumnsMap[key] || [];
            if (pkColumns.length === 0 && userKeyColumns.length === 0) {
              alert(`Please choose key columns for upsert on ${object.schemaName}.${object.tableName}`);
              return;
            }
          }
        }
      }
    }

    const connId =
      (tempConn.type === 'GoogleSheets' ? googleSheetsConnectionId : tempConn.type === 'PostgreSQL' ? postgresConnectionId : null) ||
      editingConnId ||
      `conn-${Date.now()}`;

    // Prepare tables to sync
    const tablesToSync = displayedTables
      .filter(t => selectedTables.includes(t.name))
      .map(t => ({
        id: `tbl-${Math.random().toString(36).substr(2, 9)}`,
        connectionId: connId,
        tableName: t.name,
        datasetName: t.dataset,
        rowCount: t.rows,
        status: 'Active' as const,
        lastSync: new Date().toISOString().replace('T', ' ').substr(0, 16),
        schema: t.schema || []
      }));

    const finalConn: Connection = {
      ...tempConn as Connection,
      id: connId,
      status: 'Connected',
      createdAt: editingConnId
        ? connections.find(c => c.id === editingConnId)?.createdAt || new Date().toISOString()
        : new Date().toISOString().split('T')[0],
      tableCount:
        tempConn.type === 'Excel'
          ? selectedExcelSheets.length
          : tempConn.type === 'GoogleSheets'
            ? selectedGoogleSheets.length
            : selectedTables.length,
      projectId: tempConn.type === 'BigQuery' ? (selectedContext || tempConn.projectId) : undefined,
      serviceAccountKey: tempConn.serviceAccountKey // Pass through
    };

    try {
      if (tempConn.type === 'PostgreSQL') {
        setIsAuthenticating(true);
        setPostgresImportStage('connecting');
        setPostgresImportError('');

        const tablesPayload: PostgresImportTableState[] = selectedPostgresObjects.map((object) => {
          const key = postgresObjectKey(object.schemaName, object.tableName);
          const metadata = postgresObjectColumns[key];
          const selectedColumnName = postgresIncrementalColumnMap[key];
          const selectedColumn = (metadata?.columns || []).find((column) => column.name === selectedColumnName);
          const inferredKind = selectedColumn ? getIncrementalKindFromType(selectedColumn.type) : null;
          const pkColumns = metadata?.primaryKeyColumns || [];
          const fallbackKeyColumns = postgresKeyColumnsMap[key] || [];

          return {
            schemaName: object.schemaName,
            tableName: object.tableName,
            objectType: object.objectType,
            incrementalColumn: postgresImportMode === 'incremental' ? selectedColumnName : undefined,
            incrementalKind: postgresImportMode === 'incremental' ? (inferredKind || 'id') : undefined,
            upsert: postgresImportMode === 'incremental' ? postgresUpsertEnabled : false,
            keyColumns: postgresImportMode === 'incremental'
              ? (pkColumns.length > 0 ? pkColumns : fallbackKeyColumns)
              : undefined
          };
        });

        const job = await startPostgresImportJob(postgresConnectionId, {
          importMode: postgresImportMode,
          batchSize: 500,
          tables: tablesPayload
        });
        setPostgresImportJobId(job.id);
        setPostgresImportStage(job.stage as PostgresImportStage);

        let latestJob = job;
        const startedAt = Date.now();
        const timeoutMs = 30 * 60 * 1000;

        while (latestJob.status === 'queued' || latestJob.status === 'running') {
          if (Date.now() - startedAt > timeoutMs) {
            throw new Error('PostgreSQL import job timed out while waiting for completion');
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
          latestJob = await getPostgresImportJob(postgresConnectionId, job.id);
          setPostgresImportStage(latestJob.stage as PostgresImportStage);
          setPostgresImportError(latestJob.errorMessage || '');
        }

        if (latestJob.status !== 'success') {
          throw new Error(latestJob.errorMessage || 'PostgreSQL import failed');
        }

        setPostgresImportStage('completed');
        await onRefreshData();
        await new Promise((resolve) => setTimeout(resolve, 350));
      } else if (tempConn.type === 'Excel') {
        setIsAuthenticating(true);
        setImportStage('importing');
        await onCreateExcelConnection(
          finalConn,
          excelFile as File,
          selectedExcelDataset || 'excel_default',
          selectedExcelSheets
        );
        setImportStage('completed');
        await new Promise(resolve => setTimeout(resolve, 400));
      } else if (tempConn.type === 'GoogleSheets') {
        setIsAuthenticating(true);
        setGoogleFlowStage('reading_sheet');
        let finalSelections: SelectedGoogleSheet[] = [...selectedGoogleSheets];

        const preflight = await preflightGoogleSheetsImport(googleSheetsConnectionId, {
          fileId: selectedGoogleFile?.id || '',
          sheets: finalSelections.map((item) => ({
            sheetId: item.sheetId,
            sheetName: item.sheetName,
            headerMode: item.headerMode
          }))
        });

        const requiresHeaderDecision = (preflight?.sheets || []).filter((sheet: any) => {
          const selected = finalSelections.find(item => item.sheetId === Number(sheet.sheetId));
          return sheet.requiresHeaderDecision && selected?.headerMode !== 'auto_columns';
        });

        if (requiresHeaderDecision.length > 0) {
          const ok = window.confirm(
            `${requiresHeaderDecision.length} sheet(s) do not have valid header. Switch them to auto Column_1..N and continue?`
          );
          if (!ok) return;
          finalSelections = finalSelections.map((sheet) =>
            requiresHeaderDecision.some((r: any) => Number(r.sheetId) === sheet.sheetId)
              ? { ...sheet, headerMode: 'auto_columns' }
              : sheet
          );
          setSelectedGoogleSheets(finalSelections);
        }

        const emptySheets = (preflight?.sheets || []).filter((sheet: any) => sheet.isEmpty);
        if (emptySheets.length > 0) {
          const ok = window.confirm(`${emptySheets.length} selected sheet(s) are empty. Continue importing anyway?`);
          if (!ok) return;
        }

        const overwriteConfirmed = window.confirm(
          'Import may overwrite existing synced tables for the selected sheets. Continue?'
        );
        if (!overwriteConfirmed) return;

        setGoogleFlowStage('importing');
        await onCreateGoogleSheetsConnection({
          connectionId: googleSheetsConnectionId,
          connectionName: finalConn.name,
          authCode: '',
          fileId: selectedGoogleFile?.id || '',
          fileName: selectedGoogleFile?.name,
          sheets: finalSelections.map((sheet) => ({
            sheetId: sheet.sheetId,
            sheetName: sheet.sheetName,
            headerMode: sheet.headerMode
          })),
          allowEmptySheets: emptySheets.length > 0,
          confirmOverwrite: true,
          syncMode: googleSyncMode,
          syncIntervalMinutes: googleSyncIntervalMinutes
        });
        setGoogleFlowStage('completed');
        await new Promise(resolve => setTimeout(resolve, 400));
      } else if (editingConnId) {
        onUpdateConnection(finalConn, tablesToSync);
      } else {
        // @ts-ignore
        onAddConnection(finalConn, tablesToSync);
      }

      closeWizard();
    } catch (error: any) {
      alert(error.message || 'Failed to save connection');
    } finally {
      setIsAuthenticating(false);
      setImportStage('idle');
      setGoogleFlowStage('idle');
      if (tempConn.type !== 'PostgreSQL') {
        setPostgresImportStage('idle');
      }
    }
  };

  const closeWizard = () => {
    setIsWizardOpen(false);
    setEditingConnId(null);
    setStep(1);
    setAuthSuccess(false);
    setExcelFile(null);
    setExcelSheets([]);
    setSelectedExcelSheets([]);
    setSelectedExcelDataset('');
    setImportStage('idle');
    setGoogleSheetsConnectionId('');
    setGoogleSheetsAuthCode('');
    setGoogleFiles([]);
    setGoogleFileSearch('');
    setGoogleFileUrl('');
    setSelectedGoogleFile(null);
    setGoogleTabs([]);
    setSelectedGoogleSheets([]);
    setGoogleSyncMode('manual');
    setGoogleSyncIntervalMinutes(15);
    setGoogleFlowStage('idle');
    setPostgresConnectionId('');
    setPostgresConfig({
      host: '',
      port: 5432,
      databaseName: '',
      username: '',
      password: '',
      ssl: false,
      hasPassword: false,
    });
    setPostgresSchemas([]);
    setSelectedPostgresSchemas([]);
    setPostgresObjects([]);
    setSelectedPostgresObjectKeys([]);
    setIncludePostgresViews(false);
    setPostgresSchemaSearch('');
    setPostgresObjectSearch('');
    setPostgresObjectColumns({});
    setPostgresImportMode('full');
    setPostgresUpsertEnabled(true);
    setPostgresIncrementalColumnMap({});
    setPostgresKeyColumnsMap({});
    setPostgresImportStage('idle');
    setPostgresImportJobId('');
    setPostgresImportError('');
    if (excelFileInputRef.current) {
      excelFileInputRef.current.value = '';
    }
  };

  const renderConnectionForm = () => {
    const inputClass = "w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700 text-sm";
    const labelClass = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1";
    const hasStoredBigQueryServiceKey = !!editingConnId && tempConn.authType === 'ServiceAccount' && !!tempConn.serviceAccountKey && !uploadedFile;

    const renderBigQueryForm = () => (
      <div className="space-y-6 animate-in fade-in">
        <div className="flex gap-4 p-1 bg-slate-100 dark:bg-black/30 rounded-2xl border border-slate-200 dark:border-white/5">
          {['ServiceAccount', 'GoogleMail'].map(mode => (
            <button
              key={mode}
              onClick={() => { setTempConn({ ...tempConn, authType: mode as any }); setAuthSuccess(false); setUploadedFile(null); }}
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tempConn.authType === mode ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
                }`}
            >
              {mode === 'GoogleMail' ? 'OAuth Login' : 'Service Key'}
            </button>
          ))}
        </div>

        {tempConn.authType === 'GoogleMail' ? (
          <div className="space-y-6">
            <div className="p-6 bg-amber-500/5 border border-amber-500/10 rounded-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <i className="fas fa-info-circle text-4xl text-amber-500"></i>
              </div>
              <h4 className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                <i className="fas fa-key"></i> Connection Security Note
              </h4>
              <div className="space-y-3">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  <strong>OAuth Login:</strong> Best for personal use. Token expires every 60 minutes.
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  <strong>Service Account:</strong> Best for production. Stable, persistent connection with no manual login required.
                </p>
              </div>
            </div>

            <button onClick={handleGoogleLogin} disabled={isAuthenticating} className="w-full py-5 bg-white border border-slate-200 dark:border-transparent text-black rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl hover:bg-slate-50 transition-all active:scale-[0.98]">
              {isAuthenticating ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fab fa-google text-lg text-blue-500"></i>}
              {authSuccess ? 'Authenticated Successfully' : 'Sign in with Google Account'}
            </button>

            {!authSuccess && (
              <div className="p-4 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-white/5">
                <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                  <i className="fas fa-shield-alt mr-1"></i> Developer Mode: Click <strong className="text-slate-700 dark:text-slate-300">Advanced</strong> then <strong className="text-slate-700 dark:text-slate-300">Go to ... (unsafe)</strong> if prompted.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-5 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl mb-4 space-y-3">
              <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                <i className="fas fa-shield-alt"></i> Service Account Authentication
              </h4>
              <ul className="text-[10px] text-slate-500 space-y-2 list-disc pl-4 leading-relaxed">
                <li>Best for <strong>Automation & Stability</strong>: No expiry, no re-login required.</li>
                <li>Requires <strong>BigQuery Data Viewer</strong> and <strong>BigQuery Job User</strong> roles.</li>
                <li>Data is fetched using the service account's identity.</li>
              </ul>
            </div>

            <div className="mb-6 bg-slate-50 dark:bg-white/[0.02] rounded-2xl border border-slate-100 dark:border-white/5 overflow-hidden transition-all hover:border-indigo-500/20">
              <div className="px-5 py-3 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-100/50 dark:bg-white/[0.02]">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <i className="fas fa-info-circle text-indigo-500"></i> Quick Setup Guide
                </div>
                <a
                  href="https://console.cloud.google.com/iam-admin/serviceaccounts"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-black text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 uppercase tracking-widest flex items-center gap-1 transition-colors"
                >
                  Create Key <i className="fas fa-external-link-alt text-[9px]"></i>
                </a>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <span className="text-indigo-500 font-bold">1.</span>
                    <span>Go to <strong>Google Cloud Console (IAM)</strong>.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-indigo-500 font-bold">2.</span>
                    <span>Create <strong>Service Account</strong>.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-indigo-500 font-bold">3.</span>
                    <span>Roles: <strong>BigQuery Data Viewer</strong> & <strong>Job User</strong>.</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <span className="text-indigo-500 font-bold">4.</span>
                    <span>Select account &rarr; <strong>Keys</strong> tab.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-indigo-500 font-bold">5.</span>
                    <span>Add Key &rarr; Create new key &rarr; <strong>JSON</strong>.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-indigo-500 font-bold">6.</span>
                    <span>Upload the downloaded file below.</span>
                  </div>
                </div>
              </div>
            </div>

            <label className={labelClass}>Google Service Account Key (JSON)</label>
            <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed rounded-[2rem] p-10 text-center cursor-pointer border-white/10 hover:border-indigo-500/50 bg-white/[0.02]">
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".json" />
              {uploadedFile ? (
                <div className="text-emerald-500 font-bold">{uploadedFile.name}</div>
              ) : (
                <div className="text-slate-500 text-sm">
                  {editingConnId && tempConn.serviceAccountKey ? 'Account Key Uploaded (Click to change)' : 'Upload JSON Key File'}
                </div>
              )}
            </div>
            {tempConn.serviceAccountKey && (
              <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl animate-in slide-in-from-top-2">
                <p className="text-[10px] font-bold text-emerald-400">
                  <i className="fas fa-check-circle mr-2"></i> Project: {tempConn.projectId}
                </p>
                <p className="text-[10px] text-slate-500 mt-1 truncate px-1">Email: {tempConn.email}</p>
              </div>
            )}
            {hasStoredBigQueryServiceKey && (
              <div className="p-4 bg-sky-500/5 border border-sky-500/20 rounded-xl">
                <p className="text-[10px] font-bold text-sky-400">
                  <i className="fas fa-lock mr-2"></i> Saved credentials are active.
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  No re-verification needed. Use <strong>Update Credentials</strong> only when you want to replace the key.
                </p>
              </div>
            )}
            {hasStoredBigQueryServiceKey && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-white/10 transition-all"
              >
                Update Credentials
              </button>
            )}
            <button
              onClick={async () => {
                if (hasStoredBigQueryServiceKey) {
                  setAuthSuccess(true);
                  if (tempConn.projectId) {
                    setSelectedContext(tempConn.projectId);
                    try {
                      setIsAuthenticating(true);
                      const saToken = await getServiceAccountToken(tempConn.serviceAccountKey || '');
                      if (saToken) {
                        const datasets = await fetchDatasets(saToken, tempConn.projectId);
                        setBqDatasets(datasets);
                      }
                    } catch (err) {
                      console.warn('Continue with saved credentials: dataset preload failed', err);
                    } finally {
                      setIsAuthenticating(false);
                    }
                  }
                  setStep(3);
                  return;
                }

                if (!tempConn.serviceAccountKey && !editingConnId) return;
                setIsAuthenticating(true);

                try {
                  const saToken = await getServiceAccountToken(tempConn.serviceAccountKey || '');

                  if (saToken) {
                    setAuthSuccess(true);
                    if (tempConn.projectId) {
                      setSelectedContext(tempConn.projectId);
                      setStep(3);
                      // Fetch datasets using the SA token
                      const datasets = await fetchDatasets(saToken, tempConn.projectId);
                      setBqDatasets(datasets);
                    } else {
                      alert("Project ID not found in JSON.");
                    }
                  } else {
                    alert("Failed to verify Service Account. Please check the JSON key and permissions.");
                  }
                } catch (err: any) {
                  alert("Verification Error: " + err.message);
                } finally {
                  setIsAuthenticating(false);
                }
              }}
              disabled={(!tempConn.serviceAccountKey && !editingConnId) || isAuthenticating}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/20 active:scale-95"
            >
              {isAuthenticating
                ? <i className="fas fa-circle-notch animate-spin"></i>
                : hasStoredBigQueryServiceKey
                  ? 'Continue with Saved Credentials'
                  : (editingConnId ? 'Update & Verify' : 'Verify Credentials')}
            </button>
          </div>
        )}
      </div>
    );

    const renderSnowflakeForm = () => (
      <div className="space-y-6 animate-in fade-in">
        <div className="flex gap-4 p-1 bg-black/30 rounded-2xl border border-white/5">
          {['GoogleMail', 'Password'].map(mode => (
            <button
              key={mode}
              onClick={() => { setTempConn({ ...tempConn, authType: mode as any }); setAuthSuccess(false); }}
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tempConn.authType === mode ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              {mode === 'GoogleMail' ? 'SSO (SAML)' : 'User / Pass'}
            </button>
          ))}
        </div>

        {tempConn.authType === 'GoogleMail' ? (
          <div className="space-y-6">
            <div className="p-6 bg-amber-500/5 border border-amber-500/10 rounded-2xl">
              <div className="flex items-center gap-3 mb-3 text-amber-500">
                <i className="fas fa-shield-exclamation text-xl"></i>
                <span className="text-[10px] font-black uppercase tracking-widest">Snowflake SSO</span>
              </div>
              <p className="text-[11px] text-slate-400 mb-4">Click to re-verify your Snowflake session.</p>
            </div>
            <button onClick={simulateAuth} disabled={isAuthenticating} className="w-full py-5 bg-cyan-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl">
              {isAuthenticating ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-snowflake text-lg"></i>}
              {editingConnId ? 'Refresh SSO Token' : 'Connect via Snowflake SSO'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Snowflake Account URL</label>
              <input className={inputClass} placeholder="xy12345.us-east-1.snowflakecomputing.com" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Username</label>
                <input className={inputClass} placeholder="BI_APP_USER" />
              </div>
              <div>
                <label className={labelClass}>Password</label>
                <input type="password" className={inputClass} placeholder="••••••••" />
              </div>
            </div>
            <button onClick={simulateAuth} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500">
              {editingConnId ? 'Update Credentials' : 'Initialize Session'}
            </button>
          </div>
        )}
      </div>
    );

    const renderPostgresForm = () => (
      <div className="space-y-6 animate-in fade-in">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {postgresStages.map((stage) => {
            const isActive = postgresImportStage === stage.key;
            return (
              <div
                key={stage.key}
                className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest text-center ${isActive
                  ? 'border-indigo-600 text-indigo-500 bg-indigo-50 dark:bg-indigo-600/10'
                  : 'border-slate-200 dark:border-white/10 text-slate-400'
                  }`}
              >
                {stage.label}
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-3">
            <label className={labelClass}>Host</label>
            <input
              className={inputClass}
              value={postgresConfig.host}
              onChange={(e) => updatePostgresConfigField('host', e.target.value)}
              placeholder="db.example.com"
            />
          </div>
          <div className="col-span-1">
            <label className={labelClass}>Port</label>
            <input
              className={inputClass}
              value={postgresConfig.port}
              onChange={(e) => updatePostgresConfigField('port', Number(e.target.value || 5432))}
              placeholder="5432"
              type="number"
              min={1}
              max={65535}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Database Name</label>
            <input
              className={inputClass}
              value={postgresConfig.databaseName}
              onChange={(e) => updatePostgresConfigField('databaseName', e.target.value)}
              placeholder="analytics_db"
            />
          </div>
          <div>
            <label className={labelClass}>Username</label>
            <input
              className={inputClass}
              value={postgresConfig.username}
              onChange={(e) => updatePostgresConfigField('username', e.target.value)}
              placeholder="readonly_user"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              Password {postgresConfig.hasPassword ? '(leave blank to keep existing)' : ''}
            </label>
            <input
              type="password"
              className={inputClass}
              value={postgresConfig.password || ''}
              onChange={(e) => updatePostgresConfigField('password', e.target.value)}
              placeholder={postgresConfig.hasPassword ? '•••••••• (saved)' : '••••••••'}
            />
          </div>
          <div className="flex items-end">
            <label className="w-full flex items-center justify-between px-4 py-4 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30">
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Use SSL</span>
              <input
                type="checkbox"
                checked={postgresConfig.ssl === true}
                onChange={(e) => updatePostgresConfigField('ssl', e.target.checked)}
                className="w-4 h-4"
              />
            </label>
          </div>
        </div>

        {postgresImportError && (
          <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-2xl">
            <p className="text-[11px] text-red-500">{postgresImportError}</p>
          </div>
        )}

        {authSuccess && (
          <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
            <p className="text-[11px] text-emerald-500 font-bold">Connection test passed. You can now Save & Continue.</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={handleTestPostgres}
            disabled={isAuthenticating}
            className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-black rounded-2xl font-black text-xs uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-40"
          >
            {isAuthenticating ? <i className="fas fa-circle-notch animate-spin"></i> : 'Test Connection'}
          </button>
          <button
            onClick={handlePostgresSaveAndContinue}
            disabled={!authSuccess || isAuthenticating}
            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all disabled:opacity-40"
          >
            Save & Continue
          </button>
        </div>
      </div>
    );

    const renderSQLForm = () => (
      <div className="space-y-6 animate-in fade-in">
        <div className="flex gap-4 p-1 bg-black/30 rounded-2xl border border-white/5">
          {['GoogleMail', 'Password'].map(mode => (
            <button
              key={mode}
              onClick={() => { setTempConn({ ...tempConn, authType: mode as any }); setAuthSuccess(false); }}
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tempConn.authType === mode ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              {mode === 'GoogleMail' ? 'IAM / Managed' : 'Direct SQL'}
            </button>
          ))}
        </div>

        {tempConn.authType === 'GoogleMail' ? (
          <div className="space-y-6">
            <div className="p-6 bg-amber-500/5 border border-amber-500/10 rounded-2xl">
              <div className="flex items-center gap-3 mb-3 text-amber-500">
                <i className="fas fa-shield-exclamation text-xl"></i>
                <span className="text-[10px] font-black uppercase tracking-widest">IAM Access</span>
              </div>
              <p className="text-[11px] text-slate-400 mb-4">Verification required to update the managed link.</p>
            </div>
            <button onClick={simulateAuth} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3">
              {isAuthenticating ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-cloud text-lg"></i>}
              Authorize Managed Link
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-3">
                <label className={labelClass}>Host</label>
                <input className={inputClass} placeholder="db-instance.rds.amazonaws.com" />
              </div>
              <div className="col-span-1">
                <label className={labelClass}>Port</label>
                <input className={inputClass} placeholder={tempConn.type === 'PostgreSQL' ? '5432' : '5439'} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Username</label>
                <input className={inputClass} placeholder="bi_readonly" />
              </div>
              <div>
                <label className={labelClass}>Password</label>
                <input type="password" className={inputClass} placeholder="••••••••" />
              </div>
            </div>
            <button onClick={simulateAuth} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500">
              {editingConnId ? 'Update & Test' : 'Test Connection'}
            </button>
          </div>
        )}
      </div>
    );

    const renderExcelForm = () => (
      <div className="space-y-6 animate-in fade-in">
        <label className={labelClass}>Upload Excel File (.xlsx, .xls)</label>
        <div onClick={() => excelFileInputRef.current?.click()} className="border-2 border-dashed rounded-[2rem] p-10 text-center cursor-pointer border-white/10 hover:border-green-500/50 bg-white/[0.02]">
          <input type="file" ref={excelFileInputRef} onChange={handleExcelFileUpload} className="hidden" accept=".xlsx,.xls" />
          {excelFile ? <div className="text-emerald-500 font-bold">{excelFile.name}</div> : <div className="text-slate-500 text-sm">Click to Upload</div>}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { key: 'uploading', label: 'Uploading' },
            { key: 'parsing', label: 'Parsing' },
            { key: 'importing', label: 'Importing' },
            { key: 'completed', label: 'Completed' }
          ].map((stage, index) => {
            const stageOrder = ['uploading', 'parsing', 'importing', 'completed'];
            const currentIndex = stageOrder.indexOf(importStage);
            const stageIndex = stageOrder.indexOf(stage.key);
            const isActive = importStage === stage.key;
            const isDone = currentIndex > stageIndex;
            return (
              <div key={stage.key} className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest text-center ${isActive ? 'border-indigo-600 text-indigo-500 bg-indigo-50 dark:bg-indigo-600/10' : isDone ? 'border-emerald-500 text-emerald-500 bg-emerald-500/5' : 'border-slate-200 dark:border-white/10 text-slate-400'}`}>
                {stage.label}
              </div>
            );
          })}
        </div>

        {excelSheets.length > 0 && (
          <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-1">
              {excelSheets.length} sheets parsed successfully
            </div>
            <p className="text-[11px] text-slate-500">Click OK to continue sheet selection.</p>
          </div>
        )}

        <button
          onClick={() => {
            if (!excelFile || excelSheets.length === 0) return;
            setStep(4);
          }}
          disabled={!excelFile || excelSheets.length === 0}
          className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          OK
        </button>
      </div>
    );

    const renderSheetsForm = () => (
      <div className="space-y-6 animate-in fade-in">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { key: 'connecting', label: 'Connecting' },
            { key: 'fetching_files', label: 'Fetching files' },
            { key: 'reading_sheet', label: 'Reading sheet' },
            { key: 'importing', label: 'Importing' },
            { key: 'completed', label: 'Completed' }
          ].map((stage) => (
            <div
              key={stage.key}
              className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest text-center ${googleFlowStage === stage.key
                ? 'border-indigo-600 text-indigo-500 bg-indigo-50 dark:bg-indigo-600/10'
                : 'border-slate-200 dark:border-white/10 text-slate-400'
                }`}
            >
              {stage.label}
            </div>
          ))}
        </div>

        <div className="p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
          <h4 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-2">Google Sheets OAuth</h4>
          <p className="text-[11px] text-slate-500 mb-4">
            This connection requests read-only access to Google Sheets and Drive metadata.
          </p>
          <button
            onClick={handleGoogleSheetsConnect}
            disabled={isAuthenticating}
            className="w-full py-4 bg-white text-black rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-100 transition-all border border-slate-200"
          >
            {isAuthenticating ? <i className="fas fa-circle-notch animate-spin mr-2"></i> : <i className="fab fa-google mr-2 text-blue-500"></i>}
            {authSuccess ? 'Google Account Connected' : 'Connect Google Account'}
          </button>
        </div>

        {authSuccess && googleSheetsConnectionId && (
          <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl text-[11px] text-slate-500">
            Connection ID: <span className="font-mono">{googleSheetsConnectionId}</span>
          </div>
        )}

        <button
          onClick={() => {
            if (!authSuccess) return;
            setStep(3);
          }}
          disabled={!authSuccess}
          className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue to File Selection
        </button>
      </div>
    );

    switch (tempConn.type) {
      case 'BigQuery': return renderBigQueryForm();
      case 'Snowflake': return renderSnowflakeForm();
      case 'PostgreSQL': return renderPostgresForm();
      case 'Excel': return renderExcelForm();
      case 'GoogleSheets': return renderSheetsForm();
      default: return renderSQLForm();
    }
  };

  const isAllFilteredSelected = filteredTables.length > 0 && filteredTables.every(t => selectedTables.includes(t.name));

  return (
    <div className="p-10 max-w-[1600px] mx-auto relative h-full overflow-y-auto custom-scrollbar no-print">
      {/* Background Decorations */}
      <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-[500px] h-[500px] bg-indigo-600/10 blur-[120px] rounded-full -z-10 pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-blue-600/5 blur-[100px] rounded-full -z-10 pointer-events-none"></div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
        <div>
          <h2 className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter mb-3 bg-gradient-to-r from-slate-900 dark:from-white to-slate-500 bg-clip-text text-transparent">{t('conn.title')}</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium tracking-tight text-lg">{t('conn.subtitle')}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm"></i>
            <input
              type="text"
              value={connSearchTerm}
              onChange={(e) => setConnSearchTerm(e.target.value)}
              placeholder={t('conn.search_placeholder')}
              className="w-full bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl py-3.5 pl-11 pr-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-600 text-sm shadow-sm dark:backdrop-blur-md"
            />
          </div>
          <button
            onClick={() => handleOpenWizard()}
            className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black tracking-tight hover:bg-indigo-500 transition-all flex items-center gap-3 shadow-2xl shadow-indigo-600/40 active:scale-95"
          >
            <i className="fas fa-plus"></i> {t('conn.new_pipeline')}
          </button>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
        {[
          { label: t('conn.stat.total_connections'), value: connections.length, icon: 'fa-project-diagram', color: 'text-indigo-600 dark:text-indigo-400' },
          { label: t('conn.stat.active_syncs'), value: connections.length, icon: 'fa-sync-alt', color: 'text-emerald-600 dark:text-emerald-400', pulse: true },
          {
            label: t('conn.stat.total_tables'),
            // Filter duplicates by tableName and datasetName to be safe
            value: new Set(tables.map(t => `${t.datasetName}.${t.tableName}`)).size,
            icon: 'fa-th-list',
            color: 'text-blue-600 dark:text-blue-400'
          },
          { label: t('conn.stat.system_health'), value: '100%', icon: 'fa-heartbeat', color: 'text-rose-600 dark:text-rose-400' }
        ].map((stat, i) => (
          <div key={i} className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 p-6 rounded-3xl shadow-sm dark:backdrop-blur-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{stat.label}</span>
              <i className={`fas ${stat.icon} ${stat.color} text-sm ${stat.pulse ? 'animate-pulse' : ''}`}></i>
            </div>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {connections.length === 0 ? (
          <div className="col-span-full py-32 text-center animate-in fade-in zoom-in duration-700">
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-[2.5rem] bg-indigo-50 dark:bg-indigo-600/10 border border-indigo-100 dark:border-indigo-500/20 mb-8 relative">
              <i className="fas fa-project-diagram text-3xl text-indigo-500"></i>
              <div className="absolute inset-0 bg-indigo-500/20 blur-2xl rounded-full"></div>
            </div>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-3">{t('conn.empty_title')}</h3>
            <p className="text-slate-500 dark:text-slate-500 max-w-md mx-auto mb-10 leading-relaxed font-medium">
              {t('conn.empty_subtitle')}
            </p>
            <button
              onClick={() => handleOpenWizard()}
              className="bg-slate-900 dark:bg-white text-white dark:text-black px-10 py-4 rounded-2xl font-black tracking-tight hover:scale-105 transition-all shadow-2xl active:scale-95"
            >
              {t('conn.empty_button')}
            </button>
          </div>
        ) : (
          connections
            .filter(c => c.name.toLowerCase().includes(connSearchTerm.toLowerCase()) ||
              c.type.toLowerCase().includes(connSearchTerm.toLowerCase()))
            .map(conn => (
              <div key={conn.id} className="bg-white dark:bg-slate-900/40 backdrop-blur-md p-8 rounded-[2rem] border border-slate-200 dark:border-white/5 shadow-xl dark:shadow-2xl hover:border-indigo-500/30 transition-all group relative overflow-hidden">
                <div className="flex justify-between items-start mb-10">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${conn.type === 'BigQuery' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                    conn.type === 'Snowflake' ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' :
                      'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                    }`}>
                    {WAREHOUSE_OPTIONS.find(o => o.id === conn.type)?.icon || <i className="fas fa-database"></i>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleOpenWizard(conn)} className="w-10 h-10 bg-slate-50 dark:bg-white/5 rounded-xl text-slate-400 dark:text-slate-500 hover:bg-indigo-50 dark:hover:bg-white/10 hover:text-indigo-600 dark:hover:text-white transition-all flex items-center justify-center"><i className="fas fa-cog"></i></button>
                    <button onClick={() => onDeleteConnection(conn.id)} className="w-10 h-10 bg-slate-50 dark:bg-white/5 rounded-xl text-slate-400 dark:text-slate-500 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 transition-all flex items-center justify-center"><i className="fas fa-trash-alt"></i></button>
                  </div>
                </div>
                <h3 className="font-black text-slate-900 dark:text-white text-xl mb-2 tracking-tight">{conn.name}</h3>
                <div className="flex items-center gap-2 mb-8 text-[10px] font-black uppercase text-slate-400 dark:text-slate-600 tracking-widest">
                  <span>{conn.type}</span>
                  <div className="w-1 h-1 rounded-full bg-slate-200 dark:bg-slate-700"></div>
                  <span className="text-indigo-600 dark:text-indigo-400">{conn.authType}</span>
                </div>
                <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-100 dark:border-white/5">
                  <div>
                    <div className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{t('conn.card.health')}</div>
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                      {t('conn.card.optimal')}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{t('conn.stat.total_tables')}</div>
                    <div className="text-sm font-black text-slate-900 dark:text-white">{tables.filter(t => t.connectionId === conn.id).length} {t('conn.card.objects')}</div>
                  </div>
                </div>
                <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-indigo-600/5 blur-3xl rounded-full group-hover:bg-indigo-600/20 transition-all duration-700"></div>
              </div>
            ))
        )}
      </div>

      {isWizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/60 dark:bg-black/95 backdrop-blur-xl">
          <div className="w-full max-w-7xl bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
            <div className="bg-slate-50 dark:bg-white/[0.02] px-10 py-8 border-b border-slate-100 dark:border-white/5 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  {step === 1 ? t('conn.wizard.step1') : step === 2 ? t('conn.wizard.step2') : step === 3 ? t('conn.wizard.step3') : t('conn.wizard.step4')}
                </h2>
                <p className="text-slate-400 dark:text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Stage {step} of 4 • {editingConnId ? 'Reconfiguring' : 'Neural Link'}</p>
              </div>
              <button onClick={closeWizard} className="w-10 h-10 bg-slate-100 dark:bg-white/5 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all flex items-center justify-center"><i className="fas fa-times"></i></button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {step === 1 && (
                <div className="p-10 space-y-8 animate-in fade-in slide-in-from-left-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-1">Pipeline Name</label>
                    <div className="relative">
                      <input
                        value={tempConn.name}
                        onChange={e => setTempConn({ ...tempConn, name: e.target.value })}
                        placeholder={`e.g. ${tempConn.type} Core Analytics`}
                        className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-6 py-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700"
                      />
                      {editingConnId && (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-3 py-1 rounded-full uppercase tracking-widest">
                          Editing
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-1">Warehouse Engine</label>
                    <div className="grid grid-cols-2 gap-4">
                      {WAREHOUSE_OPTIONS.map(opt => (
                        <button
                          key={opt.id}
                          disabled={!!editingConnId}
                          onClick={() => setTempConn({
                            ...tempConn,
                            type: opt.id as WarehouseType,
                            authType: opt.id === 'BigQuery'
                              ? 'ServiceAccount'
                              : (opt.id === 'Excel' || opt.id === 'PostgreSQL' ? 'Password' : 'GoogleMail')
                          })}
                          className={`flex flex-col items-center gap-4 p-6 rounded-[2rem] border-2 transition-all group ${tempConn.type === opt.id ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/5' : 'border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] hover:border-slate-200 dark:hover:border-white/10'
                            } ${editingConnId && tempConn.type !== opt.id ? 'opacity-20 cursor-not-allowed' : ''}`}
                        >
                          <div className={`text-3xl transition-transform group-hover:scale-110 ${tempConn.type === opt.id ? 'opacity-100' : 'opacity-30'}`}>
                            {opt.icon}
                          </div>
                          <span className={`font-black text-[10px] uppercase tracking-widest ${tempConn.type === opt.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`}>
                            {opt.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="p-10">
                  {renderConnectionForm()}
                </div>
              )}

              {step === 3 && (
                <div className="p-10 space-y-6 animate-in fade-in">
                  {tempConn.type === 'Excel' ? (
                    <div className="space-y-6 animate-in slide-in-from-right-4">
                      <div className="p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
                        <h4 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-2">
                          Select Dataset
                        </h4>
                        <p className="text-[11px] text-slate-500 mb-4">Choose an existing workspace dataset for imported sheets.</p>
                        <select
                          value={selectedExcelDataset}
                          onChange={(e) => setSelectedExcelDataset(e.target.value)}
                          className="w-full bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl py-4 px-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all text-sm"
                        >
                          {excelDatasets.map(dataset => (
                            <option key={dataset} value={dataset}>
                              {dataset}
                            </option>
                          ))}
                        </select>
                      </div>

                      {excelSheets.some(sheet => sheet.isEmpty) && (
                        <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                          <h4 className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-2">Warning</h4>
                          <p className="text-[11px] text-slate-500">
                            One or more sheets are empty. You can still continue to import.
                          </p>
                        </div>
                      )}
                    </div>
                  ) : tempConn.type === 'GoogleSheets' ? (
                    <div className="space-y-5 animate-in slide-in-from-right-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="relative">
                          <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                          <input
                            type="text"
                            value={googleFileSearch}
                            onChange={(e) => setGoogleFileSearch(e.target.value)}
                            placeholder="Search Google Sheets file..."
                            className="w-full bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl py-4 pl-11 pr-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all text-sm"
                          />
                        </div>
                        <button
                          onClick={() => loadGoogleFiles(googleFileSearch)}
                          disabled={!googleSheetsConnectionId || isAuthenticating}
                          className="py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all disabled:opacity-40"
                        >
                          <i className="fas fa-rotate mr-2"></i>
                          Fetch Files
                        </button>
                      </div>

                      <div className="flex gap-3">
                        <input
                          type="text"
                          value={googleFileUrl}
                          onChange={(e) => setGoogleFileUrl(e.target.value)}
                          placeholder="Paste Google Sheets URL..."
                          className="flex-1 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl py-4 px-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all text-sm"
                        />
                        <button
                          onClick={handleResolveGoogleFileUrl}
                          disabled={!googleSheetsConnectionId || !googleFileUrl.trim()}
                          className="px-6 py-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-40"
                        >
                          Resolve URL
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-3 max-h-[430px] overflow-y-auto pr-1 custom-scrollbar">
                        {googleFiles.length === 0 ? (
                          <div className="text-center py-16 border-2 border-dashed border-slate-100 dark:border-white/5 rounded-2xl">
                            <i className="fas fa-file-spreadsheet text-slate-300 dark:text-slate-700 text-3xl mb-4"></i>
                            <p className="text-slate-400 dark:text-slate-500 text-sm">No files loaded yet</p>
                          </div>
                        ) : (
                          googleFiles.map((file) => (
                            <button
                              key={file.id}
                              onClick={() => loadGoogleTabs(file.id, file.name)}
                              className={`w-full text-left p-4 rounded-2xl border transition-all ${selectedGoogleFile?.id === file.id
                                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/10'
                                : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-indigo-400'
                                }`}
                            >
                              <div className="font-bold text-sm text-slate-800 dark:text-slate-100">{file.name}</div>
                              <div className="text-[10px] font-mono text-slate-400 mt-1">{file.id}</div>
                            </button>
                          ))
                        )}
                      </div>

                      {selectedGoogleFile && (
                        <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl text-[11px] text-slate-500">
                          Selected file: <span className="font-bold text-slate-700 dark:text-slate-200">{selectedGoogleFile.name}</span>
                          <br />
                          Tabs loaded: <span className="font-bold">{googleTabs.length}</span>
                        </div>
                      )}
                    </div>
                  ) : tempConn.type === 'PostgreSQL' ? (
                    <div className="space-y-6 animate-in slide-in-from-right-4">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        {postgresStages.map((stage) => (
                          <div
                            key={stage.key}
                            className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest text-center ${postgresImportStage === stage.key
                              ? 'border-indigo-600 text-indigo-500 bg-indigo-50 dark:bg-indigo-600/10'
                              : 'border-slate-200 dark:border-white/10 text-slate-400'
                              }`}
                          >
                            {stage.label}
                          </div>
                        ))}
                      </div>

                      {postgresImportError && (
                        <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-2xl">
                          <p className="text-[11px] text-red-500">{postgresImportError}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="p-5 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 space-y-4">
                          <div className="flex items-center justify-between">
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Schemas</h4>
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              {selectedPostgresSchemas.length} selected
                            </span>
                          </div>

                          <div className="relative">
                            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                            <input
                              type="text"
                              value={postgresSchemaSearch}
                              onChange={(e) => setPostgresSchemaSearch(e.target.value)}
                              placeholder="Filter schemas..."
                              className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl py-3 pl-11 pr-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all text-sm"
                            />
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={() => setSelectedPostgresSchemas([...postgresSchemas])}
                              disabled={postgresSchemas.length === 0}
                              className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
                            >
                              Select All
                            </button>
                            <button
                              onClick={() => setSelectedPostgresSchemas([])}
                              disabled={selectedPostgresSchemas.length === 0}
                              className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
                            >
                              Clear
                            </button>
                          </div>

                          <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                            {filteredPostgresSchemas.length === 0 ? (
                              <div className="text-center py-10 border border-dashed border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 text-sm">
                                No schemas found
                              </div>
                            ) : (
                              filteredPostgresSchemas.map((schemaName) => {
                                const selected = selectedPostgresSchemas.includes(schemaName);
                                return (
                                  <button
                                    key={schemaName}
                                    onClick={() => togglePostgresSchema(schemaName)}
                                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${selected
                                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/10'
                                      : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-indigo-400'
                                      }`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className={`font-bold text-sm ${selected ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                                        {schemaName}
                                      </span>
                                      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 dark:border-white/20'}`}>
                                        {selected && <i className="fas fa-check text-[9px] text-white"></i>}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>

                        <div className="p-5 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 space-y-4">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Tables & Views</h4>
                            <button
                              onClick={async () => {
                                if (!postgresConnectionId || selectedPostgresSchemas.length === 0) return;
                                try {
                                  setIsAuthenticating(true);
                                  setPostgresImportStage('fetching_schema');
                                  setPostgresImportError('');
                                  await loadPostgresObjectsForSchemas(postgresConnectionId, selectedPostgresSchemas, includePostgresViews);
                                } catch (error: any) {
                                  setPostgresImportError(error.message || 'Failed to refresh PostgreSQL objects');
                                } finally {
                                  setIsAuthenticating(false);
                                  setPostgresImportStage('idle');
                                }
                              }}
                              disabled={!postgresConnectionId || selectedPostgresSchemas.length === 0 || isAuthenticating}
                              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
                            >
                              <i className={`fas ${isAuthenticating ? 'fa-circle-notch animate-spin' : 'fa-rotate'} mr-2`}></i>
                              Refresh
                            </button>
                          </div>

                          <label className="flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/30">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Include Views</span>
                            <input
                              type="checkbox"
                              checked={includePostgresViews}
                              onChange={(e) => setIncludePostgresViews(e.target.checked)}
                              className="w-4 h-4"
                            />
                          </label>

                          <div className="relative">
                            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                            <input
                              type="text"
                              value={postgresObjectSearch}
                              onChange={(e) => setPostgresObjectSearch(e.target.value)}
                              placeholder="Filter schema.table..."
                              className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl py-3 pl-11 pr-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all text-sm"
                            />
                          </div>

                          <div className="flex items-center justify-between">
                            <button
                              onClick={handleSelectAllPostgresObjects}
                              disabled={filteredPostgresObjects.length === 0}
                              className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-40"
                            >
                              {allFilteredPostgresObjectsSelected ? 'Deselect Filtered' : 'Select Filtered'}
                            </button>
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">
                              {selectedPostgresObjectKeys.length} selected
                            </span>
                          </div>

                          <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                            {selectedPostgresSchemas.length === 0 ? (
                              <div className="text-center py-10 border border-dashed border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 text-sm">
                                Select at least one schema
                              </div>
                            ) : filteredPostgresObjects.length === 0 ? (
                              <div className="text-center py-10 border border-dashed border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 text-sm">
                                No objects found
                              </div>
                            ) : (
                              filteredPostgresObjects.map((object) => {
                                const key = postgresObjectKey(object.schemaName, object.tableName);
                                const selected = selectedPostgresObjectKeys.includes(key);
                                return (
                                  <button
                                    key={key}
                                    onClick={() => togglePostgresObject(object.schemaName, object.tableName)}
                                    className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${selected
                                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/10'
                                      : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-indigo-400'
                                      }`}
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <div>
                                        <div className={`font-bold text-sm ${selected ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                                          {object.schemaName}.{object.tableName}
                                        </div>
                                        <div className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">
                                          {object.objectType}
                                        </div>
                                      </div>
                                      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 dark:border-white/20'}`}>
                                        {selected && <i className="fas fa-check text-[9px] text-white"></i>}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-xs mb-4">
                        <span className={`font-black uppercase tracking-widest ${!selectedContext ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>
                          Select Project
                        </span>
                        <i className="fas fa-chevron-right text-slate-200 dark:text-slate-700"></i>
                        <span className={`font-black uppercase tracking-widest ${selectedContext ? 'text-slate-900 dark:text-white' : 'text-slate-200 dark:text-slate-700'}`}>
                          Select Dataset
                        </span>
                      </div>

                      {!selectedContext ? (
                        <div className="space-y-3 animate-in slide-in-from-left-4">
                          <div className="p-4 bg-indigo-50 dark:bg-indigo-600/10 border border-indigo-100 dark:border-indigo-500/20 rounded-2xl mb-4">
                            <h4 className="text-indigo-600 dark:text-indigo-400 font-black uppercase text-[10px] tracking-widest mb-1">
                              <i className="fab fa-google-cloud mr-2"></i> Connected to Google Cloud
                            </h4>
                            <p className="text-[11px] text-indigo-400/70 dark:text-indigo-300/70">Select a project to explore its datasets.</p>
                          </div>

                          <div className="relative mb-4">
                            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm"></i>
                            <input
                              type="text"
                              value={projectSearchTerm}
                              onChange={(e) => setProjectSearchTerm(e.target.value)}
                              placeholder="Search Projects..."
                              className="w-full bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl py-4 pl-11 pr-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700 text-sm"
                            />
                          </div>

                          <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {tempConn.type === 'BigQuery' && bqProjects
                              .filter(proj => proj.name.toLowerCase().includes(projectSearchTerm.toLowerCase()) || proj.id.toLowerCase().includes(projectSearchTerm.toLowerCase()))
                              .map(proj => (
                                <button
                                  key={proj.id}
                                  onClick={async () => {
                                    setSelectedContext(proj.id);
                                    setBqDatasets([]);
                                    setBqTables([]);
                                    if (googleToken || tempConn.serviceAccountKey) {
                                      let tokenToUse = googleToken;
                                      if (tempConn.serviceAccountKey) {
                                        tokenToUse = await getServiceAccountToken(tempConn.serviceAccountKey);
                                      }
                                      if (tokenToUse) {
                                        fetchDatasets(tokenToUse, proj.id).then(setBqDatasets);
                                      }
                                    }
                                  }}
                                  className="w-full p-5 rounded-2xl border border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 hover:border-blue-500/30 transition-all text-left flex items-center justify-between group"
                                >
                                  <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                      <i className="fas fa-cloud text-sm"></i>
                                    </div>
                                    <div>
                                      <div className="font-bold text-sm text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white">{proj.name}</div>
                                      <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">{proj.id}</div>
                                    </div>
                                  </div>
                                  <i className="fas fa-chevron-right text-slate-300 dark:text-slate-600 group-hover:text-slate-900 dark:group-hover:text-white group-hover:translate-x-1 transition-all"></i>
                                </button>
                              ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4 animate-in slide-in-from-right-4">
                          <div className="flex justify-between items-center">
                            <button
                              onClick={() => { setSelectedContext(''); setBqDatasets([]); setDatasetSearchTerm(''); }}
                              className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center gap-2"
                            >
                              <i className="fas fa-arrow-left"></i> Back to Projects
                            </button>
                          </div>

                          <div className="relative mb-4">
                            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm"></i>
                            <input
                              type="text"
                              value={datasetSearchTerm}
                              onChange={(e) => setDatasetSearchTerm(e.target.value)}
                              placeholder="Search Datasets..."
                              className="w-full bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl py-4 pl-11 pr-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700 text-sm"
                            />
                          </div>

                          <div className="mt-4">
                            {bqDatasets.length === 0 ? (
                              <div className="text-center py-12 border-2 border-dashed border-slate-100 dark:border-white/5 rounded-2xl">
                                <i className="fas fa-circle-notch fa-spin text-slate-300 dark:text-slate-600 text-2xl mb-3"></i>
                                <p className="text-xs text-slate-400 dark:text-slate-500">Fetching Datasets...</p>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-h-[450px] overflow-y-auto pr-2 custom-scrollbar">
                                {bqDatasets
                                  .filter(ds => ds.name.toLowerCase().includes(datasetSearchTerm.toLowerCase()))
                                  .map(ds => (
                                    <button
                                      key={ds.id}
                                      onClick={() => setSelectedDatasetId(ds.id)}
                                      className={`p-5 rounded-2xl border-2 transition-all text-left flex items-start gap-4 ${selectedDatasetId === ds.id
                                        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/10'
                                        : 'border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 hover:border-slate-200 dark:hover:border-white/20'
                                        }`}
                                    >
                                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${selectedDatasetId === ds.id ? 'bg-indigo-600 text-white' : 'bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                                        }`}>
                                        <i className="fas fa-database text-sm"></i>
                                      </div>
                                      <div className={`font-bold text-sm break-words line-clamp-2 mt-2 ${selectedDatasetId === ds.id ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200'
                                        }`}>{ds.name}</div>
                                    </button>
                                  ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {step === 4 && (
                <div className="animate-in slide-in-from-right-4 px-10 pb-10 flex flex-col h-full overflow-hidden">
                  {tempConn.type === 'Excel' ? (
                    <>
                      <div className="flex flex-col gap-6 mb-8 sticky top-0 bg-white dark:bg-[#0f172a] z-10 pt-4">
                        <div className="relative">
                          <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm"></i>
                          <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Filter sheets by name..."
                            className="w-full bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl py-4 pl-11 pr-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700 text-sm"
                          />
                        </div>
                        <div className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-4 py-1.5 rounded-full border border-indigo-100 dark:border-indigo-500/20 w-fit">
                          {selectedExcelSheets.length} Sheets Selected
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 custom-scrollbar pb-10">
                        {excelSheets.filter(sheet => sheet.sheetName.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 ? (
                          <div className="text-center py-20 border-2 border-dashed border-slate-100 dark:border-white/5 rounded-[2rem]">
                            <i className="fas fa-search text-slate-200 dark:text-slate-700 text-3xl mb-4"></i>
                            <p className="text-slate-400 dark:text-slate-500 text-sm">No sheets match your filter</p>
                          </div>
                        ) : (
                          excelSheets
                            .filter(sheet => sheet.sheetName.toLowerCase().includes(searchTerm.toLowerCase()))
                            .map(sheet => (
                              <div
                                key={sheet.sheetName}
                                onClick={() => toggleExcelSheet(sheet.sheetName)}
                                className={`flex items-center justify-between p-5 rounded-[2rem] border-2 cursor-pointer transition-all group ${selectedExcelSheets.includes(sheet.sheetName)
                                  ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/5'
                                  : 'border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 hover:border-slate-200 dark:hover:border-white/10'
                                  }`}
                              >
                                <div className="flex items-center gap-4">
                                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${selectedExcelSheets.includes(sheet.sheetName) ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 group-hover:text-slate-900 dark:group-hover:text-slate-300'
                                    }`}>
                                    <i className="fas fa-table text-lg"></i>
                                  </div>
                                  <div>
                                    <div className={`font-bold text-sm transition-colors ${selectedExcelSheets.includes(sheet.sheetName) ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                                      {sheet.sheetName}
                                    </div>
                                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                                      {sheet.rowCount.toLocaleString()} rows • {sheet.columnCount} columns
                                    </div>
                                    {sheet.isEmpty && (
                                      <div className="text-[10px] text-amber-500 font-black uppercase tracking-wider mt-1">
                                        Empty sheet
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${selectedExcelSheets.includes(sheet.sheetName) ? 'bg-emerald-500 border-emerald-500' : 'border-slate-200 dark:border-white/10'
                                  }`}>
                                  {selectedExcelSheets.includes(sheet.sheetName) && <i className="fas fa-check text-[10px] text-white"></i>}
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    </>
                  ) : tempConn.type === 'GoogleSheets' ? (
                    <>
                      <div className="flex flex-col gap-6 mb-8 sticky top-0 bg-white dark:bg-[#0f172a] z-10 pt-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-4 py-1.5 rounded-full border border-indigo-100 dark:border-indigo-500/20">
                            {selectedGoogleSheets.length} Sheets Selected
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sync</label>
                            <select
                              value={googleSyncMode}
                              onChange={(e) => setGoogleSyncMode(e.target.value as 'manual' | 'interval')}
                              className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-xl py-2 px-3 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200"
                            >
                              <option value="manual">Import Once / Manual</option>
                              <option value="interval">Auto Sync</option>
                            </select>
                            {googleSyncMode === 'interval' && (
                              <input
                                type="number"
                                min={5}
                                max={1440}
                                value={googleSyncIntervalMinutes}
                                onChange={(e) => setGoogleSyncIntervalMinutes(Math.min(1440, Math.max(5, Number(e.target.value || 15))))}
                                className="w-24 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-xl py-2 px-3 text-[10px] font-black text-slate-700 dark:text-slate-200"
                              />
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 custom-scrollbar pb-10">
                        {googleTabs.length === 0 ? (
                          <div className="text-center py-20 border-2 border-dashed border-slate-100 dark:border-white/5 rounded-[2rem]">
                            <i className="fas fa-table text-slate-200 dark:text-slate-700 text-3xl mb-4"></i>
                            <p className="text-slate-400 dark:text-slate-500 text-sm">No sheets loaded for selected file</p>
                          </div>
                        ) : (
                          googleTabs.map((sheet) => {
                            const selected = selectedGoogleSheets.some(item => item.sheetId === Number(sheet.sheetId));
                            const selectedConfig = selectedGoogleSheets.find(item => item.sheetId === Number(sheet.sheetId));
                            return (
                              <div
                                key={sheet.sheetId}
                                onClick={() => toggleGoogleSheet({ sheetId: Number(sheet.sheetId), title: sheet.title })}
                                className={`p-5 rounded-[2rem] border-2 cursor-pointer transition-all group ${selected
                                  ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/5'
                                  : 'border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 hover:border-slate-200 dark:hover:border-white/10'
                                  }`}
                              >
                                <div className="flex items-center justify-between gap-4">
                                  <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${selected ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                                      }`}>
                                      <i className="fas fa-table text-lg"></i>
                                    </div>
                                    <div>
                                      <div className={`font-bold text-sm transition-colors ${selected ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                                        {sheet.title}
                                      </div>
                                      <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                                        sheetId: {sheet.sheetId} • {sheet.gridProperties?.rowCount || 0} rows • {sheet.gridProperties?.columnCount || 0} columns
                                      </div>
                                    </div>
                                  </div>

                                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${selected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-200 dark:border-white/10'
                                    }`}>
                                    {selected && <i className="fas fa-check text-[10px] text-white"></i>}
                                  </div>
                                </div>

                                {selected && (
                                  <div className="mt-4">
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                      Header Mode
                                    </label>
                                    <select
                                      value={selectedConfig?.headerMode || 'first_row'}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => updateGoogleSheetHeaderMode(Number(sheet.sheetId), e.target.value as 'first_row' | 'auto_columns')}
                                      className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-xl py-3 px-3 text-[10px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200"
                                    >
                                      <option value="first_row">Use First Row as Header</option>
                                      <option value="auto_columns">Auto Column_1..N</option>
                                    </select>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </>
                  ) : tempConn.type === 'PostgreSQL' ? (
                    <>
                      <div className="space-y-5 mb-8 sticky top-0 bg-white dark:bg-[#0f172a] z-10 pt-4">
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                          {postgresStages.map((stage) => (
                            <div
                              key={stage.key}
                              className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest text-center ${postgresImportStage === stage.key
                                ? 'border-indigo-600 text-indigo-500 bg-indigo-50 dark:bg-indigo-600/10'
                                : 'border-slate-200 dark:border-white/10 text-slate-400'
                                }`}
                            >
                              {stage.label}
                            </div>
                          ))}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <button
                            onClick={() => setPostgresImportMode('full')}
                            className={`px-4 py-3 rounded-2xl border-2 text-left transition-all ${postgresImportMode === 'full'
                              ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/10'
                              : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30'
                              }`}
                          >
                            <div className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-1">Full Import</div>
                            <p className="text-[11px] text-slate-500">Snapshot toàn bộ table tại thời điểm import.</p>
                          </button>
                          <button
                            onClick={() => setPostgresImportMode('incremental')}
                            className={`px-4 py-3 rounded-2xl border-2 text-left transition-all ${postgresImportMode === 'incremental'
                              ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/10'
                              : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30'
                              }`}
                          >
                            <div className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-1">Incremental Import</div>
                            <p className="text-[11px] text-slate-500">Sync theo watermark cột timestamp hoặc ID.</p>
                          </button>
                        </div>

                        {postgresImportMode === 'incremental' && (
                          <label className="flex items-center justify-between px-4 py-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Enable Upsert</span>
                            <input
                              type="checkbox"
                              checked={postgresUpsertEnabled}
                              onChange={(e) => setPostgresUpsertEnabled(e.target.checked)}
                              className="w-4 h-4"
                            />
                          </label>
                        )}

                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-4 py-1.5 rounded-full border border-indigo-100 dark:border-indigo-500/20">
                            {selectedPostgresObjects.length} Tables Selected
                          </div>
                          {postgresImportJobId && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              Job: {postgresImportJobId}
                            </div>
                          )}
                        </div>

                        {postgresImportError && (
                          <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-2xl">
                            <p className="text-[11px] text-red-500">{postgresImportError}</p>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 custom-scrollbar pb-10">
                        {selectedPostgresObjects.length === 0 ? (
                          <div className="text-center py-20 border-2 border-dashed border-slate-100 dark:border-white/5 rounded-[2rem]">
                            <i className="fas fa-table text-slate-200 dark:text-slate-700 text-3xl mb-4"></i>
                            <p className="text-slate-400 dark:text-slate-500 text-sm">No PostgreSQL tables selected</p>
                          </div>
                        ) : (
                          selectedPostgresObjects.map((object) => {
                            const key = postgresObjectKey(object.schemaName, object.tableName);
                            const metadata = postgresObjectColumns[key];
                            const columns = metadata?.columns || [];
                            const primaryKeyColumns = metadata?.primaryKeyColumns || [];
                            const keyColumns = postgresKeyColumnsMap[key] || [];
                            const incrementalCandidates = getIncrementalCandidates(
                              columns.map((column) => ({ name: column.name, type: column.type }))
                            );
                            const selectedIncrementalColumn = postgresIncrementalColumnMap[key] || '';
                            const selectedIncrementalMeta = columns.find((column) => column.name === selectedIncrementalColumn);
                            const selectedIncrementalKind = selectedIncrementalMeta
                              ? getIncrementalKindFromType(selectedIncrementalMeta.type)
                              : null;
                            const requiresManualKeys = postgresImportMode === 'incremental'
                              && postgresUpsertEnabled
                              && primaryKeyColumns.length === 0;

                            return (
                              <div
                                key={key}
                                className="p-5 rounded-[2rem] border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 space-y-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="font-black text-sm text-slate-900 dark:text-white">{object.schemaName}.{object.tableName}</div>
                                    <div className="text-[10px] uppercase tracking-widest text-slate-400 mt-1">
                                      {object.objectType} • {columns.length} columns
                                    </div>
                                  </div>
                                  {primaryKeyColumns.length > 0 && (
                                    <div className="text-[10px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
                                      PK: {primaryKeyColumns.join(', ')}
                                    </div>
                                  )}
                                </div>

                                {postgresImportMode === 'incremental' && (
                                  <div className="space-y-4">
                                    <div>
                                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                        Incremental Column
                                      </label>
                                      <select
                                        value={selectedIncrementalColumn}
                                        onChange={(e) => {
                                          const value = e.target.value;
                                          setPostgresIncrementalColumnMap((prev) => ({
                                            ...prev,
                                            [key]: value
                                          }));
                                        }}
                                        className="w-full bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-xl py-3 px-3 text-[11px] text-slate-700 dark:text-slate-200"
                                      >
                                        <option value="">Select incremental column</option>
                                        {incrementalCandidates.map((column) => (
                                          <option key={column.name} value={column.name}>
                                            {column.name} ({column.type})
                                          </option>
                                        ))}
                                      </select>
                                      {selectedIncrementalKind && (
                                        <div className="text-[10px] text-slate-400 mt-2 uppercase tracking-widest">
                                          Incremental kind: {selectedIncrementalKind}
                                        </div>
                                      )}
                                      {incrementalCandidates.length === 0 && (
                                        <div className="text-[10px] text-amber-500 mt-2 uppercase tracking-widest">
                                          No timestamp/ID candidate found for this table
                                        </div>
                                      )}
                                    </div>

                                    {postgresUpsertEnabled && (
                                      <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                          Upsert Keys
                                        </label>
                                        {primaryKeyColumns.length > 0 ? (
                                          <div className="text-[11px] text-emerald-500">
                                            Using source primary key: <strong>{primaryKeyColumns.join(', ')}</strong>
                                          </div>
                                        ) : (
                                          <div className="space-y-2">
                                            <p className="text-[11px] text-slate-500">
                                              No source primary key. Select key columns for upsert fallback.
                                            </p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                              {columns.map((column) => {
                                                const selected = keyColumns.includes(column.name);
                                                return (
                                                  <button
                                                    key={`${key}-${column.name}`}
                                                    onClick={() => togglePostgresKeyColumn(key, column.name)}
                                                    className={`text-left px-3 py-2 rounded-xl border text-[11px] transition-all ${selected
                                                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/10 text-slate-900 dark:text-white'
                                                      : 'border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-500'
                                                      }`}
                                                  >
                                                    {column.name}
                                                  </button>
                                                );
                                              })}
                                            </div>
                                            {requiresManualKeys && keyColumns.length === 0 && (
                                              <p className="text-[10px] uppercase tracking-widest text-rose-500">
                                                Select at least one key column for upsert.
                                              </p>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-col gap-6 mb-8 sticky top-0 bg-white dark:bg-[#0f172a] z-10 pt-4">
                        <div className="relative">
                          <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-sm"></i>
                          <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Filter tables by name..."
                            className="w-full bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl py-4 pl-11 pr-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700 text-sm"
                          />
                        </div>

                        <div className="flex justify-between items-center px-2">
                          <button
                            onClick={handleSelectAll}
                            className="flex items-center gap-3 group"
                          >
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${filteredTables.length > 0 && filteredTables.every(t => selectedTables.includes(t.name))
                              ? 'bg-indigo-600 border-indigo-600'
                              : 'border-slate-200 dark:border-white/10 group-hover:border-slate-300 dark:group-hover:border-white/30'
                              }`}>
                              {(filteredTables.length > 0 && filteredTables.every(t => selectedTables.includes(t.name))) && <i className="fas fa-check text-[10px] text-white"></i>}
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                              {filteredTables.length > 0 && filteredTables.every(t => selectedTables.includes(t.name)) ? 'Deselect All Filtered' : 'Select All Filtered'}
                            </span>
                          </button>

                          <div className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-4 py-1.5 rounded-full border border-indigo-100 dark:border-indigo-500/20">
                            {selectedTables.length} Objects Selected
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 custom-scrollbar pb-10">
                        {filteredTables.length === 0 ? (
                          <div className="text-center py-20 border-2 border-dashed border-slate-100 dark:border-white/5 rounded-[2rem]">
                            <i className="fas fa-search text-slate-200 dark:text-slate-700 text-3xl mb-4"></i>
                            <p className="text-slate-400 dark:text-slate-500 text-sm">No tables match your filter</p>
                          </div>
                        ) : (
                          filteredTables.map(table => (
                            <div
                              key={table.name}
                              onClick={() => toggleTable(table.name)}
                              className={`flex items-center justify-between p-5 rounded-[2rem] border-2 cursor-pointer transition-all group ${selectedTables.includes(table.name)
                                ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-600/5'
                                : 'border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5 hover:border-slate-200 dark:hover:border-white/10'
                                }`}
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${selectedTables.includes(table.name) ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 group-hover:text-slate-900 dark:group-hover:text-slate-300'
                                  }`}>
                                  <i className="fas fa-table text-lg"></i>
                                </div>
                                <div>
                                  <div className={`font-bold text-sm transition-colors ${selectedTables.includes(table.name) ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                                    {table.name}
                                  </div>
                                  {table.dataset && (
                                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">{table.dataset}</div>
                                  )}
                                </div>
                              </div>

                              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${selectedTables.includes(table.name) ? 'bg-emerald-500 border-emerald-500' : 'border-slate-200 dark:border-white/10'
                                }`}>
                                {selectedTables.includes(table.name) && <i className="fas fa-check text-[10px] text-white"></i>}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="px-10 py-8 border-t border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/[0.01]">
              <button
                onClick={() => {
                  if (tempConn.type === 'Excel' && step === 4) {
                    setStep(2);
                    return;
                  }
                  setStep(prev => prev - 1);
                }}
                className={`font-black text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors ${step === 1 ? 'invisible' : ''}`}
              >
                Back
              </button>
              <button
                onClick={async () => {
                  if (step === 3 && tempConn.type === 'Excel') {
                    setStep(4);
                  } else if (step === 3 && tempConn.type === 'GoogleSheets') {
                    if (!selectedGoogleFile) {
                      alert('Please select a Google Sheets file first.');
                      return;
                    }
                    setStep(4);
                  } else if (step === 3 && tempConn.type === 'PostgreSQL') {
                    if (!postgresConnectionId) {
                      alert('Please save PostgreSQL connection first.');
                      return;
                    }
                    if (selectedPostgresSchemas.length === 0) {
                      alert('Please select at least one schema.');
                      return;
                    }
                    if (selectedPostgresObjects.length === 0) {
                      alert('Please select at least one table/view.');
                      return;
                    }
                    setIsAuthenticating(true);
                    setPostgresImportStage('fetching_schema');
                    setPostgresImportError('');
                    try {
                      await handlePreparePostgresImport();
                      setStep(4);
                    } catch (error: any) {
                      const message = error.message || 'Failed to prepare PostgreSQL metadata';
                      setPostgresImportError(message);
                      alert(message);
                    } finally {
                      setIsAuthenticating(false);
                      setPostgresImportStage('idle');
                    }
                  } else if (step === 3 && selectedDatasetId) {
                    setIsAuthenticating(true);
                    try {
                      let tokenToUse = googleToken;
                      if (tempConn.serviceAccountKey) {
                        tokenToUse = await getServiceAccountToken(tempConn.serviceAccountKey || '');
                      }
                      if (tokenToUse && selectedContext) {
                        const tables = await fetchTables(tokenToUse, selectedContext, selectedDatasetId);
                        setBqTables(tables);
                        setStep(4);
                      }
                    } finally {
                      setIsAuthenticating(false);
                    }
                  } else if (step === 4) {
                    await handleSave();
                  } else {
                    setStep(prev => prev + 1);
                  }
                }}
                disabled={
                  !tempConn.name ||
                  (step === 2 && !authSuccess) ||
                  (step === 3 && tempConn.type === 'BigQuery' && !selectedDatasetId) ||
                  (step === 3 && tempConn.type === 'GoogleSheets' && !selectedGoogleFile) ||
                  (step === 3 && tempConn.type === 'PostgreSQL' && (!postgresConnectionId || selectedPostgresSchemas.length === 0 || selectedPostgresObjectKeys.length === 0)) ||
                  (step === 4 && tempConn.type === 'Excel' && (!excelFile || selectedExcelSheets.length === 0)) ||
                  (step === 4 && tempConn.type === 'GoogleSheets' && selectedGoogleSheets.length === 0) ||
                  (step === 4 && tempConn.type === 'PostgreSQL' && selectedPostgresObjects.length === 0) ||
                  (step === 4 && tempConn.type === 'PostgreSQL' && postgresImportMode === 'incremental' && !isPostgresIncrementalSelectionValid) ||
                  isAuthenticating
                }
                className={`px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 transition-all ${step === 2 ? 'opacity-0 pointer-events-none scale-95' : 'opacity-100'
                  }`}
              >
                {isAuthenticating && <i className="fas fa-circle-notch animate-spin"></i>}
                {step === 4
                  ? (isAuthenticating && tempConn.type === 'PostgreSQL' ? 'Importing...' : 'Finish')
                  : (isAuthenticating ? 'Fetching Tables...' : 'Next')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Connections;
