
import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Connections from './components/Connections';
import Tables from './components/Tables';
import Reports from './components/Reports';
import AISettings from './components/AISettings';
import UserManagement from './components/UserManagement';
import { Connection, SyncedTable, ReportSession } from './types';
import { INITIAL_TABLES } from './constants';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState('connections');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);

  // Core Data State
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tables, setTables] = useState<SyncedTable[]>([]);

  // PERSISTENCE: Report Builder State lifted to parent
  const [reportSessions, setReportSessions] = useState<ReportSession[]>([
    { id: 's-1', title: 'Data Exploration Hub', timestamp: new Date().toISOString().split('T')[0], messages: [] }
  ]);
  const [activeReportSessionId, setActiveReportSessionId] = useState('s-1');
  const [isAIThinking, setIsAIThinking] = useState(false);

  const hasConnections = connections.length > 0;

  useEffect(() => {
    if (!hasConnections && activeTab !== 'connections' && activeTab !== 'ai-config') {
      setActiveTab('connections');
    }
  }, [connections.length, activeTab, hasConnections]);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setIsAuthenticated(true);
    }, 1500);
  };

  const handleGoogleLogin = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setIsAuthenticated(true);
    }, 1200);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
  };

  const addConnection = (conn: Connection, selectedTables: SyncedTable[]) => {
    setConnections([...connections, conn]);
    setTables([...tables, ...selectedTables]);
  };

  const updateConnection = (conn: Connection) => setConnections(connections.map(c => c.id === conn.id ? conn : c));
  
  const deleteConnection = (id: string) => {
    setConnections(connections.filter(c => c.id !== id));
    setTables(tables.filter(t => t.connectionId !== id));
  };
  
  const toggleTableStatus = (id: string) => {
    setTables(tables.map(t => 
      t.id === id ? { ...t, status: t.status === 'Active' ? 'Disabled' : 'Active' } : t
    ));
  };
  
  const deleteTable = (id: string) => setTables(tables.filter(t => t.id !== id));

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#020617] flex flex-col items-center justify-center p-6 overflow-hidden relative">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[150px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-600/10 blur-[150px] rounded-full"></div>

        <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in duration-500">
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white text-4xl mx-auto mb-6 shadow-2xl shadow-indigo-600/30 rotate-3 hover:rotate-0 transition-transform cursor-pointer">
              <i className="fas fa-bolt"></i>
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight mb-2">360data-solutions</h1>
            <p className="text-slate-500 font-medium tracking-wide">AI-Powered Data Intelligence</p>
          </div>

          <div className="bg-slate-900/60 backdrop-blur-3xl p-10 rounded-[3rem] border border-white/5 shadow-2xl shadow-black/50">
            <h2 className="text-2xl font-black text-white mb-8 tracking-tight">
              {isRegistering ? 'Create New Workspace' : 'System Access'}
            </h2>
            
            <form onSubmit={handleAuth} className="space-y-5">
              {isRegistering && (
                <div className="animate-in slide-in-from-top-4">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Full Name</label>
                  <input 
                    type="text" 
                    required
                    className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all placeholder-slate-700" 
                    placeholder="Enter your name"
                  />
                </div>
              )}
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Identity Endpoint (Email)</label>
                <input 
                  type="email" 
                  required
                  className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all placeholder-slate-700" 
                  placeholder="name@360data-solutions.ai"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Access Token (Password)</label>
                <input 
                  type="password" 
                  required
                  className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all placeholder-slate-700" 
                  placeholder="••••••••"
                />
              </div>
              <button 
                disabled={loading}
                className="w-full bg-indigo-600 text-white py-5 rounded-[1.5rem] font-black text-lg tracking-tight hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-600/20 active:scale-95 mt-4 disabled:opacity-50"
              >
                {loading ? <i className="fas fa-circle-notch animate-spin"></i> : (isRegistering ? 'Initialize Hub' : 'Enter Workspace')}
              </button>
            </form>

            <div className="my-8 flex items-center gap-4">
              <div className="flex-1 h-px bg-white/5"></div>
              <span className="text-[10px] text-slate-600 font-black uppercase tracking-[0.2em]">OR</span>
              <div className="flex-1 h-px bg-white/5"></div>
            </div>

            <button 
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full bg-white/5 border border-white/10 text-slate-300 py-4 rounded-[1.5rem] font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-3 active:scale-95 shadow-lg shadow-black/20"
            >
              <i className="fab fa-google text-blue-400"></i>
              Continue with Google
            </button>

            <div className="mt-8 text-center text-sm">
              <span className="text-slate-500">{isRegistering ? 'Already have a hub?' : "Need a new deployment?"}</span>{' '}
              <button 
                onClick={() => setIsRegistering(!isRegistering)}
                className="text-indigo-400 font-black hover:text-indigo-300 transition-colors ml-1"
              >
                {isRegistering ? 'Sign In' : 'Create Account'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] flex">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onLogout={handleLogout} 
        hasConnections={hasConnections}
      />
      <main className="flex-1 ml-64 min-h-screen bg-[#020617]">
        {activeTab === 'connections' && (
          <Connections 
            connections={connections} 
            onAddConnection={addConnection}
            onUpdateConnection={updateConnection}
            onDeleteConnection={deleteConnection}
          />
        )}
        {activeTab === 'tables' && hasConnections && (
          <Tables 
            tables={tables} 
            connections={connections}
            onToggleStatus={toggleTableStatus}
            onDeleteTable={deleteTable}
          />
        )}
        {activeTab === 'reports' && hasConnections && (
          <Reports 
            tables={tables} 
            sessions={reportSessions}
            setSessions={setReportSessions}
            activeSessionId={activeReportSessionId}
            setActiveSessionId={setActiveReportSessionId}
            loading={isAIThinking}
            setLoading={setIsAIThinking}
          />
        )}
        {activeTab === 'ai-config' && <AISettings />}
        {activeTab === 'users' && hasConnections && <UserManagement />}
      </main>
    </div>
  );
};

export default App;
