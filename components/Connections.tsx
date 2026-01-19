
import React, { useState, useRef } from 'react';
import { Connection, WarehouseType, SyncedTable } from '../types';
import { WAREHOUSE_OPTIONS, DISCOVERABLE_TABLES } from '../constants';

interface ConnectionsProps {
  connections: Connection[];
  onAddConnection: (conn: Connection, selectedTables: any[]) => void;
  onUpdateConnection: (conn: Connection) => void;
  onDeleteConnection: (id: string) => void;
}

const Connections: React.FC<ConnectionsProps> = ({ 
  connections, 
  onAddConnection, 
  onUpdateConnection, 
  onDeleteConnection 
}) => {
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [editingConnId, setEditingConnId] = useState<string | null>(null);
  const [step, setStep] = useState(1); // 1: Type/Name, 2: Auth, 3: Context (Project/DB), 4: Tables
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [selectedContext, setSelectedContext] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [tempConn, setTempConn] = useState<Partial<Connection>>({
    name: '',
    type: 'BigQuery',
    authType: 'GoogleMail',
  });

  const MOCK_CONTEXTS: Record<WarehouseType, string[]> = {
    BigQuery: ['production-data-360', 'staging-analytics', 'marketing-bi-warehouse'],
    Snowflake: ['ANALYTICS_WH (DB: RAW)', 'COMPUTE_WH (DB: PROD)', 'REPORTING_WH (DB: ARCHIVE)'],
    Redshift: ['cluster-primary (dev)', 'cluster-readonly (prod)', 'serverless-namespace-01'],
    PostgreSQL: ['postgres_master', 'replica_01_readonly', 'customer_data_partition']
  };

  const filteredTables = DISCOVERABLE_TABLES.filter(table => 
    table.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    table.dataset.toLowerCase().includes(searchTerm.toLowerCase())
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
      setTempConn({ name: '', type: 'BigQuery', authType: 'GoogleMail' });
      setStep(1);
      setAuthSuccess(false);
      setSelectedTables([]);
      setUploadedFile(null);
      setSelectedContext('');
    }
    setSearchTerm('');
    setIsWizardOpen(true);
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
    if (file && (file.type === 'application/json' || file.name.endsWith('.p8') || file.name.endsWith('.pem'))) {
      setUploadedFile(file);
      setAuthSuccess(false);
    } else {
      alert("Please upload a valid credential file.");
    }
  };

  const handleSave = () => {
    const connId = editingConnId || `conn-${Date.now()}`;
    const finalConn: Connection = {
      ...tempConn as Connection,
      id: connId,
      status: 'Connected',
      createdAt: editingConnId 
        ? connections.find(c => c.id === editingConnId)?.createdAt || new Date().toISOString()
        : new Date().toISOString().split('T')[0],
      tableCount: editingConnId 
        ? connections.find(c => c.id === editingConnId)?.tableCount || 0
        : selectedTables.length
    };

    if (editingConnId) {
      onUpdateConnection(finalConn);
    } else {
      const tablesToSync = DISCOVERABLE_TABLES
        .filter(t => selectedTables.includes(t.name))
        .map(t => ({
          id: `tbl-${Math.random().toString(36).substr(2, 9)}`,
          connectionId: connId,
          tableName: t.name,
          datasetName: t.dataset,
          rowCount: t.rows,
          status: 'Active' as const,
          lastSync: new Date().toISOString().replace('T', ' ').substr(0, 16),
          schema: t.schema
        }));
      
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
          {['GoogleMail', 'ServiceAccount'].map(mode => (
            <button 
              key={mode}
              onClick={() => { setTempConn({...tempConn, authType: mode as any}); setAuthSuccess(false); setUploadedFile(null); }}
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                tempConn.authType === mode ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {mode === 'GoogleMail' ? 'OAuth Login' : 'Service Key'}
            </button>
          ))}
        </div>

        {tempConn.authType === 'GoogleMail' ? (
          <div className="space-y-6">
            <div className="p-6 bg-amber-500/5 border border-amber-500/10 rounded-2xl">
              <div className="flex items-center gap-3 mb-3 text-amber-500">
                <i className="fas fa-shield-exclamation text-xl"></i>
                <span className="text-[10px] font-black uppercase tracking-widest">Update Authorization</span>
              </div>
              <p className="text-[11px] text-slate-400 mb-4">Click below to re-authenticate or verify access for this pipeline.</p>
              <div className="grid grid-cols-1 gap-2">
                {['BigQuery Data Viewer', 'BigQuery Job User', 'BigQuery Metadata Viewer'].map(perm => (
                  <div key={perm} className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                    <i className="fas fa-check-circle text-emerald-500"></i> {perm}
                  </div>
                ))}
              </div>
            </div>
            <button onClick={simulateAuth} disabled={isAuthenticating} className="w-full py-5 bg-white text-black rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl">
              {isAuthenticating ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fab fa-google text-lg"></i>}
              {authSuccess && editingConnId ? 'Re-verify with Google' : 'Connect Google Account'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <label className={labelClass}>GCP Service Account JSON</label>
            <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed rounded-[2rem] p-10 text-center cursor-pointer border-white/10 hover:border-indigo-500/50 bg-white/[0.02]">
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".json" />
              {uploadedFile ? <div className="text-emerald-500 font-bold">{uploadedFile.name}</div> : <div className="text-slate-500 text-sm">{editingConnId ? 'Upload new Key to update' : 'Upload JSON Key File'}</div>}
            </div>
            <button onClick={simulateAuth} disabled={(!uploadedFile && !editingConnId) || isAuthenticating} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500">
               {editingConnId ? 'Update & Verify Credentials' : 'Verify Credentials'}
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
              onClick={() => { setTempConn({...tempConn, authType: mode as any}); setAuthSuccess(false); }}
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                tempConn.authType === mode ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
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
              onClick={() => { setTempConn({...tempConn, authType: mode as any}); setAuthSuccess(false); }}
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                tempConn.authType === mode ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
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

    switch(tempConn.type) {
      case 'BigQuery': return renderBigQueryForm();
      case 'Snowflake': return renderSnowflakeForm();
      default: return renderSQLForm();
    }
  };

  const isAllFilteredSelected = filteredTables.length > 0 && filteredTables.every(t => selectedTables.includes(t.name));

  return (
    <div className="p-10 max-w-7xl mx-auto">
      <div className="flex justify-between items-start mb-12">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tighter mb-2">Data Gateways</h2>
          <p className="text-slate-500 font-medium tracking-tight">Provision secure pipelines to your enterprise data warehouses</p>
        </div>
        <button 
          onClick={() => handleOpenWizard()}
          className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black tracking-tight hover:bg-indigo-500 transition-all flex items-center gap-3 shadow-xl shadow-indigo-600/20"
        >
          <i className="fas fa-plus"></i> New Pipeline
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {connections.map(conn => (
          <div key={conn.id} className="bg-slate-900/40 backdrop-blur-md p-8 rounded-[2rem] border border-white/5 shadow-2xl hover:border-indigo-500/30 transition-all group relative overflow-hidden">
            <div className="flex justify-between items-start mb-10">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${
                conn.type === 'BigQuery' ? 'bg-blue-600/10 text-blue-400' : 
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
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Health</div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                   <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                   Optimal
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Index</div>
                <div className="text-sm font-black text-white">{conn.tableCount} Objects</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {isWizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/95 backdrop-blur-xl">
          <div className="w-full max-w-2xl bg-[#0f172a] border border-white/10 rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
            <div className="bg-white/[0.02] px-10 py-8 border-b border-white/5 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-black text-white tracking-tight">
                   {step === 1 ? 'Configure Gateway' : step === 2 ? `Identity Verification` : step === 3 ? 'Target Environment' : 'Object Selection'}
                </h2>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Stage {step} of 4 • {editingConnId ? 'Reconfiguring' : 'Neural Link'}</p>
              </div>
              <button onClick={closeWizard} className="w-10 h-10 bg-white/5 rounded-full text-slate-500 hover:text-white transition-all"><i className="fas fa-times"></i></button>
            </div>

            <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
              {step === 1 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-left-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-1">Pipeline Name</label>
                    <div className="relative">
                      <input 
                        value={tempConn.name}
                        onChange={e => setTempConn({...tempConn, name: e.target.value})}
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
                          onClick={() => setTempConn({...tempConn, type: opt.id as WarehouseType})}
                          className={`flex flex-col items-center gap-4 p-6 rounded-[2rem] border-2 transition-all group ${
                            tempConn.type === opt.id ? 'border-indigo-600 bg-indigo-600/5' : 'border-white/5 bg-white/[0.02] hover:border-white/10'
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

              {step === 2 && renderConnectionForm()}

              {step === 3 && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="p-6 bg-indigo-600/5 border border-indigo-500/10 rounded-2xl mb-8">
                    <div className="flex items-center gap-3 text-indigo-400 mb-2">
                      <i className="fas fa-check-circle"></i>
                      <span className="text-[10px] font-black uppercase tracking-widest">Authentication Verified</span>
                    </div>
                    <p className="text-xs text-slate-500">Targeting reachable {tempConn.type} endpoints. Select a workspace context.</p>
                  </div>
                  
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-1">
                    {tempConn.type === 'BigQuery' ? 'Cloud Project ID' : 'Database / Cluster Selection'}
                  </label>
                  <div className="grid grid-cols-1 gap-3">
                    {(MOCK_CONTEXTS[tempConn.type as WarehouseType] || []).map(ctx => (
                      <button 
                        key={ctx}
                        onClick={() => setSelectedContext(ctx)}
                        className={`w-full p-5 rounded-2xl border transition-all text-left flex items-center justify-between ${
                          selectedContext === ctx ? 'border-indigo-600 bg-indigo-600/5 text-white' : 'border-white/5 bg-white/5 text-slate-400 hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <i className="fas fa-database text-sm opacity-50"></i>
                          <span className="font-bold text-sm">{ctx}</span>
                        </div>
                        {selectedContext === ctx && <i className="fas fa-check text-indigo-500"></i>}
                      </button>
                    ))}
                  </div>

                  <button 
                    disabled={!selectedContext}
                    onClick={() => setStep(4)}
                    className="w-full mt-6 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500 disabled:opacity-50 transition-all"
                  >
                    Fetch Schema Objects
                  </button>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-6 animate-in slide-in-from-right-4">
                   <div className="sticky top-0 bg-[#0f172a] z-10 pb-4">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-white font-black uppercase text-xs tracking-widest">Available Tables</h3>
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={handleSelectAll}
                            className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all border ${
                              isAllFilteredSelected 
                                ? 'bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20' 
                                : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:bg-indigo-500/20'
                            }`}
                          >
                            {isAllFilteredSelected ? 'Deselect All' : 'Select All Filtered'}
                          </button>
                          <span className="text-[10px] font-black uppercase bg-indigo-600 text-white px-4 py-1.5 rounded-full shadow-lg shadow-indigo-600/20">
                            {selectedTables.length} Selected
                          </span>
                        </div>
                      </div>
                      <div className="relative">
                        <i className="fas fa-search absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
                        <input 
                          type="text"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Search tables or datasets..."
                          className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 pl-12 pr-6 text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-700 text-sm"
                        />
                      </div>
                   </div>
                   
                   <div className="grid grid-cols-1 gap-3">
                      {filteredTables.map(table => (
                        <div 
                          key={table.name}
                          onClick={() => toggleTable(table.name)}
                          className={`flex items-center justify-between p-5 rounded-[2rem] border-2 cursor-pointer transition-all ${
                            selectedTables.includes(table.name) ? 'border-indigo-600 bg-indigo-600/5' : 'border-white/5 bg-white/5 hover:bg-white/[0.08]'
                          }`}
                        >
                          <div className="flex items-center gap-4">
                             <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${selectedTables.includes(table.name) ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-slate-800 text-slate-500'}`}>
                                <i className="fas fa-table text-lg"></i>
                             </div>
                             <div>
                                <div className="text-white font-bold text-sm">{table.name}</div>
                                <div className="text-[10px] text-slate-600 font-black uppercase tracking-widest mt-0.5">{table.dataset}</div>
                             </div>
                          </div>
                          <div className="text-right">
                             <div className="text-xs font-black text-slate-400">{(table.rows / 1000000).toFixed(1)}M Rows</div>
                             <div className="text-[8px] text-indigo-500 font-black uppercase tracking-widest mt-1">Found Attributes</div>
                          </div>
                        </div>
                      ))}
                   </div>
                </div>
              )}
            </div>

            <div className="px-10 py-8 bg-white/[0.02] border-t border-white/5 flex justify-between items-center">
               <button 
                  onClick={() => setStep(prev => prev - 1)}
                  className={`font-black text-[10px] uppercase tracking-widest text-slate-500 hover:text-white transition-all ${step === 1 ? 'invisible' : ''}`}
               >
                 <i className="fas fa-arrow-left mr-2"></i> Prev Stage
               </button>
               <div className="flex gap-4">
                 {editingConnId && step === 1 && (
                    <button 
                      onClick={handleSave} 
                      className="px-6 py-3 font-black text-[10px] uppercase tracking-widest text-emerald-500 hover:bg-emerald-500/10 rounded-xl transition-all"
                    >
                      Quick Save Name
                    </button>
                 )}
                 <button onClick={closeWizard} className="px-6 py-3 font-black text-[10px] uppercase tracking-widest text-slate-500 hover:text-white transition-all">Abort</button>
                 <button 
                    onClick={step === 4 ? handleSave : () => setStep(prev => prev + 1)}
                    disabled={(step === 2 && !authSuccess) || (step === 3 && !selectedContext) || !tempConn.name}
                    className="px-10 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-500 shadow-xl shadow-indigo-600/20 disabled:opacity-50 transition-all active:scale-95"
                 >
                   {step === 4 ? (editingConnId ? 'Update & Sync' : 'Sync Objects') : 'Next Stage'}
                   <i className="fas fa-arrow-right ml-2"></i>
                 </button>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Connections;
