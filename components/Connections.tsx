
import React, { useState, useRef } from 'react';
import { Connection, WarehouseType, SyncedTable } from '../types';
import { WAREHOUSE_OPTIONS, DISCOVERABLE_TABLES } from '../constants';
import { getGoogleToken, initGoogleAuth, getServiceAccountToken } from '../services/googleAuth';
import { fetchProjects, fetchDatasets, fetchTables } from '../services/bigquery';
import { useLanguageStore } from '../store/languageStore';

interface ConnectionsProps {
  connections: Connection[];
  tables: SyncedTable[];
  onAddConnection: (conn: Connection, selectedTables: any[]) => void;
  onUpdateConnection: (conn: Connection, selectedTables?: any[]) => void;
  onDeleteConnection: (id: string) => void;
  googleToken: string | null;
  setGoogleToken: (token: string | null) => void;
}

const Connections: React.FC<ConnectionsProps> = ({
  connections,
  tables,
  onAddConnection,
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const displayedTables = (tempConn.type === 'BigQuery' && bqTables.length > 0)
    ? bqTables
    : DISCOVERABLE_TABLES;

  const filteredTables = displayedTables.filter(table =>
    table.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (table.dataset && table.dataset.toLowerCase().includes(searchTerm.toLowerCase()))
  );

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

  const handleOpenWizard = (conn?: Connection) => {
    if (conn) {
      setEditingConnId(conn.id);
      setTempConn(conn);
      setStep(1);
      setAuthSuccess(true);
      setSelectedContext(MOCK_CONTEXTS[conn.type][0]);
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

  const handleSave = () => {
    const connId = editingConnId || `conn-${Date.now()}`;

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
      tableCount: selectedTables.length,
      projectId: tempConn.type === 'BigQuery' ? (selectedContext || tempConn.projectId) : undefined,
      serviceAccountKey: tempConn.serviceAccountKey // Pass through
    };

    if (editingConnId) {
      onUpdateConnection(finalConn, tablesToSync);
    } else {
      // @ts-ignore
      onAddConnection(finalConn, tablesToSync);
    }
    closeWizard();
  };

  const closeWizard = () => {
    setIsWizardOpen(false);
    setEditingConnId(null);
    setStep(1);
    setAuthSuccess(false);
  };

  const renderConnectionForm = () => {
    const inputClass = "w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-700 text-sm";
    const labelClass = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1";

    const renderBigQueryForm = () => (
      <div className="space-y-6 animate-in fade-in">
        <div className="flex gap-4 p-1 bg-black/30 rounded-2xl border border-white/5">
          {['ServiceAccount', 'GoogleMail'].map(mode => (
            <button
              key={mode}
              onClick={() => { setTempConn({ ...tempConn, authType: mode as any }); setAuthSuccess(false); setUploadedFile(null); }}
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tempConn.authType === mode ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
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
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <strong>OAuth Login:</strong> Best for personal use. Token expires every 60 minutes.
                </p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <strong>Service Account:</strong> Best for production. Stable, persistent connection with no manual login required.
                </p>
              </div>
            </div>

            <button onClick={handleGoogleLogin} disabled={isAuthenticating} className="w-full py-5 bg-white text-black rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl hover:bg-slate-100 transition-all active:scale-[0.98]">
              {isAuthenticating ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fab fa-google text-lg text-blue-500"></i>}
              {authSuccess ? 'Authenticated Successfully' : 'Sign in with Google Account'}
            </button>

            {!authSuccess && (
              <div className="p-4 bg-slate-800/50 rounded-xl border border-white/5">
                <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                  <i className="fas fa-shield-alt mr-1"></i> Developer Mode: Click <strong className="text-slate-300">Advanced</strong> then <strong className="text-slate-300">Go to ... (unsafe)</strong> if prompted.
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
            <label className={labelClass}>GCP Service Account JSON</label>
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
            <button
              onClick={async () => {
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
              {isAuthenticating ? <i className="fas fa-circle-notch animate-spin"></i> : (editingConnId ? 'Verify & Continue' : 'Verify Credentials')}
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
        <label className={labelClass}>Upload Excel File (.xlsx, .csv)</label>
        <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed rounded-[2rem] p-10 text-center cursor-pointer border-white/10 hover:border-green-500/50 bg-white/[0.02]">
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx,.xls,.csv" />
          {uploadedFile ? <div className="text-emerald-500 font-bold">{uploadedFile.name}</div> : <div className="text-slate-500 text-sm">Click to Upload</div>}
        </div>
      </div>
    );

    const renderSheetsForm = () => (
      <div className="space-y-6 animate-in fade-in">
        <label className={labelClass}>Google Sheets URL</label>
        <input
          className={inputClass}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          value={sheetUrl}
          onChange={(e) => { setSheetUrl(e.target.value); setAuthSuccess(true); }} // Auto-verify for now
        />
        <button onClick={handleGoogleLogin} className="w-full py-4 bg-white text-black rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200">
          <i className="fab fa-google mr-2 text-blue-500"></i> Browse Sheets
        </button>
      </div>
    );

    switch (tempConn.type) {
      case 'BigQuery': return renderBigQueryForm();
      case 'Snowflake': return renderSnowflakeForm();
      case 'Excel': return renderExcelForm();
      case 'GoogleSheets': return renderSheetsForm();
      default: return renderSQLForm();
    }
  };

  const isAllFilteredSelected = filteredTables.length > 0 && filteredTables.every(t => selectedTables.includes(t.name));

  return (
    <div className="p-10 max-w-7xl mx-auto relative h-full overflow-y-auto custom-scrollbar">
      {/* Background Decorations */}
      <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-[500px] h-[500px] bg-indigo-600/10 blur-[120px] rounded-full -z-10 pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-blue-600/5 blur-[100px] rounded-full -z-10 pointer-events-none"></div>

      <div className="flex justify-between items-end mb-12">
        <div>
          <h2 className="text-5xl font-black text-white tracking-tighter mb-3 bg-gradient-to-r from-white to-slate-500 bg-clip-text text-transparent">{t('conn.title')}</h2>
          <p className="text-slate-400 font-medium tracking-tight text-lg">{t('conn.subtitle')}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative w-64">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
            <input
              type="text"
              value={connSearchTerm}
              onChange={(e) => setConnSearchTerm(e.target.value)}
              placeholder={t('conn.search_placeholder')}
              className="w-full bg-slate-900/40 border border-white/5 rounded-2xl py-3.5 pl-11 pr-4 text-white focus:ring-2 focus:ring-indigo-600/50 outline-none transition-all placeholder-slate-600 text-sm backdrop-blur-md"
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
          { label: t('conn.stat.total_connections'), value: connections.filter(c => c.type !== 'Excel').length, icon: 'fa-project-diagram', color: 'text-indigo-400' },
          { label: t('conn.stat.active_syncs'), value: connections.length, icon: 'fa-sync-alt', color: 'text-emerald-400', pulse: true },
          {
            label: t('conn.stat.total_tables'),
            // Filter duplicates by tableName and datasetName to be safe
            value: new Set(tables.map(t => `${t.datasetName}.${t.tableName}`)).size,
            icon: 'fa-th-list',
            color: 'text-blue-400'
          },
          { label: t('conn.stat.system_health'), value: '100%', icon: 'fa-heartbeat', color: 'text-rose-400' }
        ].map((stat, i) => (
          <div key={i} className="bg-white/[0.03] border border-white/5 p-6 rounded-3xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{stat.label}</span>
              <i className={`fas ${stat.icon} ${stat.color} text-sm ${stat.pulse ? 'animate-pulse' : ''}`}></i>
            </div>
            <div className="text-2xl font-black text-white">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {connections.length === 0 ? (
          <div className="col-span-full py-32 text-center animate-in fade-in zoom-in duration-700">
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-[2.5rem] bg-indigo-600/10 border border-indigo-500/20 mb-8 relative">
              <i className="fas fa-project-diagram text-3xl text-indigo-500"></i>
              <div className="absolute inset-0 bg-indigo-500/20 blur-2xl rounded-full"></div>
            </div>
            <h3 className="text-2xl font-black text-white mb-3">{t('conn.empty_title')}</h3>
            <p className="text-slate-500 max-w-md mx-auto mb-10 leading-relaxed font-medium">
              {t('conn.empty_subtitle')}
            </p>
            <button
              onClick={() => handleOpenWizard()}
              className="bg-white text-black px-10 py-4 rounded-2xl font-black tracking-tight hover:bg-slate-200 transition-all shadow-2xl active:scale-95"
            >
              {t('conn.empty_button')}
            </button>
          </div>
        ) : (
          connections
            .filter(c => c.name.toLowerCase().includes(connSearchTerm.toLowerCase()) ||
              c.type.toLowerCase().includes(connSearchTerm.toLowerCase()))
            .map(conn => (
              <div key={conn.id} className="bg-slate-900/40 backdrop-blur-md p-8 rounded-[2rem] border border-white/5 shadow-2xl hover:border-indigo-500/30 transition-all group relative overflow-hidden">
                <div className="flex justify-between items-start mb-10">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${conn.type === 'BigQuery' ? 'bg-blue-600/10 text-blue-400' :
                    conn.type === 'Snowflake' ? 'bg-cyan-600/10 text-cyan-400' :
                      'bg-slate-800 text-slate-400'
                    }`}>
                    {WAREHOUSE_OPTIONS.find(o => o.id === conn.type)?.icon || <i className="fas fa-database"></i>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleOpenWizard(conn)} className="w-10 h-10 bg-white/5 rounded-xl text-slate-500 hover:text-white transition-all flex items-center justify-center"><i className="fas fa-cog"></i></button>
                    <button onClick={() => onDeleteConnection(conn.id)} className="w-10 h-10 bg-white/5 rounded-xl text-slate-500 hover:text-red-400 transition-all flex items-center justify-center"><i className="fas fa-trash-alt"></i></button>
                  </div>
                </div>
                <h3 className="font-black text-white text-xl mb-2 tracking-tight">{conn.name}</h3>
                <div className="flex items-center gap-2 mb-8 text-[10px] font-black uppercase text-slate-600 tracking-widest">
                  <span>{conn.type}</span>
                  <div className="w-1 h-1 rounded-full bg-slate-700"></div>
                  <span className="text-indigo-400">{conn.authType}</span>
                </div>
                <div className="grid grid-cols-2 gap-6 pt-6 border-t border-white/5">
                  <div>
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{t('conn.card.health')}</div>
                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                      {t('conn.card.optimal')}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{t('conn.stat.total_tables')}</div>
                    <div className="text-sm font-black text-white">{tables.filter(t => t.connectionId === conn.id).length} {t('conn.card.objects')}</div>
                  </div>
                </div>
                <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-indigo-600/5 blur-3xl rounded-full group-hover:bg-indigo-600/20 transition-all duration-700"></div>
              </div>
            ))
        )}
      </div>

      {isWizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/95 backdrop-blur-xl">
          <div className="w-full max-w-6xl bg-[#0f172a] border border-white/10 rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
            <div className="bg-white/[0.02] px-10 py-8 border-b border-white/5 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-black text-white tracking-tight">
                  {step === 1 ? t('conn.wizard.step1') : step === 2 ? t('conn.wizard.step2') : step === 3 ? t('conn.wizard.step3') : t('conn.wizard.step4')}
                </h2>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Stage {step} of 4 • {editingConnId ? 'Reconfiguring' : 'Neural Link'}</p>
              </div>
              <button onClick={closeWizard} className="w-10 h-10 bg-white/5 rounded-full text-slate-500 hover:text-white transition-all"><i className="fas fa-times"></i></button>
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
                        className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-700"
                      />
                      {editingConnId && (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full uppercase tracking-widest">
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
                          onClick={() => setTempConn({ ...tempConn, type: opt.id as WarehouseType })}
                          className={`flex flex-col items-center gap-4 p-6 rounded-[2rem] border-2 transition-all group ${tempConn.type === opt.id ? 'border-indigo-600 bg-indigo-600/5' : 'border-white/5 bg-white/[0.02] hover:border-white/10'
                            } ${editingConnId && tempConn.type !== opt.id ? 'opacity-20 cursor-not-allowed' : ''}`}
                        >
                          <div className={`text-3xl transition-transform group-hover:scale-110 ${tempConn.type === opt.id ? 'opacity-100' : 'opacity-40'}`}>
                            {opt.icon}
                          </div>
                          <span className={`font-black text-[10px] uppercase tracking-widest ${tempConn.type === opt.id ? 'text-indigo-400' : 'text-slate-500'}`}>
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
                  <div className="flex items-center gap-2 text-xs mb-4">
                    <span className={`font-black uppercase tracking-widest ${!selectedContext ? 'text-white' : 'text-slate-500'}`}>
                      Select Project
                    </span>
                    <i className="fas fa-chevron-right text-slate-700"></i>
                    <span className={`font-black uppercase tracking-widest ${selectedContext ? 'text-white' : 'text-slate-700'}`}>
                      Select Dataset
                    </span>
                  </div>

                  {!selectedContext ? (
                    <div className="space-y-3 animate-in slide-in-from-left-4">
                      <div className="p-4 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl mb-4">
                        <h4 className="text-indigo-400 font-black uppercase text-[10px] tracking-widest mb-1">
                          <i className="fab fa-google-cloud mr-2"></i> Connected to Google Cloud
                        </h4>
                        <p className="text-[11px] text-indigo-300/70">Select a project to explore its datasets.</p>
                      </div>

                      <div className="relative mb-4">
                        <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
                        <input
                          type="text"
                          value={projectSearchTerm}
                          onChange={(e) => setProjectSearchTerm(e.target.value)}
                          placeholder="Search Projects..."
                          className="w-full bg-black/30 border border-white/10 rounded-2xl py-4 pl-11 pr-4 text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-700 text-sm"
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
                              className="w-full p-5 rounded-2xl border border-white/5 bg-white/5 hover:bg-white/10 hover:border-blue-500/30 transition-all text-left flex items-center justify-between group"
                            >
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-blue-900/20 text-blue-400 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                  <i className="fas fa-cloud text-sm"></i>
                                </div>
                                <div>
                                  <div className="font-bold text-sm text-slate-200 group-hover:text-white">{proj.name}</div>
                                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">{proj.id}</div>
                                </div>
                              </div>
                              <i className="fas fa-chevron-right text-slate-600 group-hover:text-white group-hover:translate-x-1 transition-all"></i>
                            </button>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 animate-in slide-in-from-right-4">
                      <div className="flex justify-between items-center">
                        <button
                          onClick={() => { setSelectedContext(''); setBqDatasets([]); setDatasetSearchTerm(''); }}
                          className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white flex items-center gap-2"
                        >
                          <i className="fas fa-arrow-left"></i> Back to Projects
                        </button>
                      </div>

                      <div className="relative mb-4">
                        <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
                        <input
                          type="text"
                          value={datasetSearchTerm}
                          onChange={(e) => setDatasetSearchTerm(e.target.value)}
                          placeholder="Search Datasets..."
                          className="w-full bg-black/30 border border-white/10 rounded-2xl py-4 pl-11 pr-4 text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-700 text-sm"
                        />
                      </div>

                      <div className="mt-4">
                        {bqDatasets.length === 0 ? (
                          <div className="text-center py-12 border-2 border-dashed border-white/5 rounded-2xl">
                            <i className="fas fa-circle-notch fa-spin text-slate-600 text-2xl mb-3"></i>
                            <p className="text-xs text-slate-500">Fetching Datasets...</p>
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
                                    ? 'border-indigo-600 bg-indigo-600/10'
                                    : 'border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/20'
                                    }`}
                                >
                                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${selectedDatasetId === ds.id ? 'bg-indigo-600 text-white' : 'bg-indigo-500/10 text-indigo-400'
                                    }`}>
                                    <i className="fas fa-database text-sm"></i>
                                  </div>
                                  <div className={`font-bold text-sm break-words line-clamp-2 mt-2 ${selectedDatasetId === ds.id ? 'text-white' : 'text-slate-200'
                                    }`}>{ds.name}</div>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === 4 && (
                <div className="animate-in slide-in-from-right-4 px-10 pb-10 flex flex-col h-full overflow-hidden">
                  <div className="flex flex-col gap-6 mb-8 sticky top-0 bg-[#0f172a] z-10 pt-4">
                    <div className="relative">
                      <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Filter tables by name..."
                        className="w-full bg-black/30 border border-white/10 rounded-2xl py-4 pl-11 pr-4 text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-700 text-sm"
                      />
                    </div>

                    <div className="flex justify-between items-center px-2">
                      <button
                        onClick={handleSelectAll}
                        className="flex items-center gap-3 group"
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${filteredTables.length > 0 && filteredTables.every(t => selectedTables.includes(t.name))
                          ? 'bg-indigo-600 border-indigo-600'
                          : 'border-white/10 group-hover:border-white/30'
                          }`}>
                          {(filteredTables.length > 0 && filteredTables.every(t => selectedTables.includes(t.name))) && <i className="fas fa-check text-[10px] text-white"></i>}
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-white transition-colors">
                          {filteredTables.length > 0 && filteredTables.every(t => selectedTables.includes(t.name)) ? 'Deselect All Filtered' : 'Select All Filtered'}
                        </span>
                      </button>

                      <div className="text-[10px] font-black uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-4 py-1.5 rounded-full border border-indigo-500/20">
                        {selectedTables.length} Objects Selected
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 custom-scrollbar pb-10">
                    {filteredTables.length === 0 ? (
                      <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-[2rem]">
                        <i className="fas fa-search text-slate-700 text-3xl mb-4"></i>
                        <p className="text-slate-500 text-sm">No tables match your filter</p>
                      </div>
                    ) : (
                      filteredTables.map(table => (
                        <div
                          key={table.name}
                          onClick={() => toggleTable(table.name)}
                          className={`flex items-center justify-between p-5 rounded-[2rem] border-2 cursor-pointer transition-all group ${selectedTables.includes(table.name)
                            ? 'border-indigo-600 bg-indigo-600/5'
                            : 'border-white/5 bg-white/5 hover:border-white/10'
                            }`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${selectedTables.includes(table.name) ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-800 text-slate-500 group-hover:text-slate-300'
                              }`}>
                              <i className="fas fa-table text-lg"></i>
                            </div>
                            <div>
                              <div className={`font-bold text-sm transition-colors ${selectedTables.includes(table.name) ? 'text-white' : 'text-slate-300'}`}>
                                {table.name}
                              </div>
                              {table.dataset && (
                                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{table.dataset}</div>
                              )}
                            </div>
                          </div>

                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${selectedTables.includes(table.name) ? 'bg-emerald-500 border-emerald-500' : 'border-white/10'
                            }`}>
                            {selectedTables.includes(table.name) && <i className="fas fa-check text-[10px] text-white"></i>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="px-10 py-8 border-t border-white/5 flex justify-between items-center">
              <button onClick={() => setStep(prev => prev - 1)} className={`font-black text-[10px] uppercase tracking-widest text-slate-500 ${step === 1 ? 'invisible' : ''}`}>Back</button>
              <button
                onClick={async () => {
                  if (step === 3 && selectedDatasetId) {
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
                    handleSave();
                  } else {
                    setStep(prev => prev + 1);
                  }
                }}
                disabled={
                  !tempConn.name ||
                  (step === 2 && !authSuccess) ||
                  (step === 3 && !selectedDatasetId) ||
                  isAuthenticating
                }
                className={`px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 transition-all ${step === 2 ? 'opacity-0 pointer-events-none scale-95' : 'opacity-100'
                  }`}
              >
                {isAuthenticating && <i className="fas fa-circle-notch animate-spin"></i>}
                {step === 4 ? 'Finish' : (isAuthenticating ? 'Fetching Tables...' : 'Next')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Connections;
