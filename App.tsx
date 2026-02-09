import React, { useState, useEffect, lazy, Suspense } from 'react';
const Sidebar = lazy(() => import('./components/Sidebar'));
const Connections = lazy(() => import('./components/Connections'));
const Tables = lazy(() => import('./components/Tables'));
const Reports = lazy(() => import('./components/Reports'));
const AISettings = lazy(() => import('./components/AISettings'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const BIMain = lazy(() => import('./components/bi/BIMain'));
const LogViewer = lazy(() => import('./components/LogViewer'));
const Onboarding = lazy(() => import('./components/Onboarding'));
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Connection, SyncedTable, ReportSession, User } from './types';
import { INITIAL_TABLES } from './constants';
import { initGoogleAuth } from './services/googleAuth';
import { PersistentStorage } from './services/storage';
import { useThemeStore } from './store/themeStore';
import { isCorporateDomain } from './utils/domain';

const App: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Derived state from URL
  const activeTab = location.pathname.substring(1) || 'connections';
  const setActiveTab = (tab: string) => navigate(`/${tab}`);

  useEffect(() => {
    initGoogleAuth(process.env.GOOGLE_CLIENT_ID || '').catch(console.error);
  }, []);

  const { theme } = useThemeStore();

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const [isRegistering, setIsRegistering] = useState(false);
  const [pendingUser, setPendingUser] = useState<{ name: string, email: string } | null>(null);

  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('auth_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isAuthenticated, setIsAuthenticated] = useState(!!currentUser);

  const domain = currentUser?.email.split('@')[1] || pendingUser?.email.split('@')[1] || '';

  // Core Data State - Scoped to domain
  const [connections, setConnections] = useState<Connection[]>(() => {
    const d = (currentUser?.email || pendingUser?.email)?.split('@')[1];
    if (d) {
      const saved = localStorage.getItem(`${d}_connections`);
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [tables, setTables] = useState<SyncedTable[]>(() => {
    const d = (currentUser?.email || pendingUser?.email)?.split('@')[1];
    if (d) {
      const saved = localStorage.getItem(`${d}_tables`);
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [googleToken, setGoogleToken] = useState<string | null>(() => {
    const d = (currentUser?.email || pendingUser?.email)?.split('@')[1];
    if (d) {
      return localStorage.getItem(`${d}_googleToken`);
    }
    return null;
  });

  // Proactive Background Token Refresh
  useEffect(() => {
    const refreshInterval = setInterval(async () => {
      const clientId = process.env.GOOGLE_CLIENT_ID || '';
      if (!clientId) return;

      const { getValidToken } = await import('./services/googleAuth');
      const validToken = await getValidToken(clientId);

      if (validToken && validToken !== googleToken) {
        console.log('🔄 App-level token updated in background');
        setGoogleToken(validToken);
      }
    }, 60000); // Check every minute

    return () => clearInterval(refreshInterval);
  }, [googleToken]);

  // Initialize token from storage on mount
  useEffect(() => {
    const initToken = async () => {
      const { getValidToken } = await import('./services/googleAuth');
      const token = await getValidToken(process.env.GOOGLE_CLIENT_ID || '');
      if (token) setGoogleToken(token);
    };
    initToken();
  }, []);

  const [reportSessions, setReportSessions] = useState<ReportSession[]>([]);
  const [activeReportSessionId, setActiveReportSessionId] = useState<string>('s-1');
  const [users, setUsers] = useState<User[]>(() => {
    const d = (currentUser?.email || pendingUser?.email)?.split('@')[1];
    if (d) {
      const saved = localStorage.getItem(`${d}_users`);
      if (saved) return JSON.parse(saved);
      if (currentUser) return [currentUser];
    }
    return [];
  });
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [isMainSidebarCollapsed, setIsMainSidebarCollapsed] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);

  // PERSISTENCE: Save auth user
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('auth_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('auth_user');
    }
  }, [currentUser]);

  // PERSISTENCE: Load scoped data when currentUser changes
  useEffect(() => {
    if (currentUser) {
      const d = currentUser.email.split('@')[1];
      const load = (key: string, def: any) => {
        try {
          const s = localStorage.getItem(`${d}_${key}`);
          return s ? JSON.parse(s) : def;
        } catch (e) {
          console.error(`Error loading ${key}:`, e);
          return def;
        }
      };

      setConnections(load('connections', []));
      setTables(load('tables', []));

      // Load Sessions from IndexedDB (PersistentStorage) as they can be large
      const loadSessions = async () => {
        try {
          const loadedSessions = await PersistentStorage.get(`${d}_reportSessions`);
          const loadedActiveId = await PersistentStorage.get(`${d}_activeReportSessionId`) || 's-1';

          if (loadedSessions && Array.isArray(loadedSessions) && loadedSessions.length > 0) {
            setReportSessions(loadedSessions);
            if (loadedSessions.some((s: ReportSession) => s.id === loadedActiveId)) {
              setActiveReportSessionId(loadedActiveId);
            } else {
              setActiveReportSessionId(loadedSessions[0].id);
            }
          } else {
            // Fallback: Try localStorage for backward compatibility or initial state
            const legacySessions = load('reportSessions', null);
            if (legacySessions) {
              setReportSessions(legacySessions);
              setActiveReportSessionId(localStorage.getItem(`${d}_activeReportSessionId`) || legacySessions[0]?.id || 's-1');
            } else {
              const newId = `s-${Date.now()}`;
              const defaultSession = { id: newId, title: 'Data Exploration Hub', timestamp: new Date().toISOString().split('T')[0], messages: [] };
              setReportSessions([defaultSession]);
              setActiveReportSessionId(newId);
            }
          }
        } catch (err) {
          console.error("Failed to load sessions from PersistentStorage:", err);
          setReportSessions([{ id: 's-1', title: 'Data Exploration Hub', timestamp: new Date().toISOString().split('T')[0], messages: [] }]);
          setActiveReportSessionId('s-1');
        } finally {
          setGoogleToken(localStorage.getItem(`${d}_googleToken`));
          setUsers(load('users', [currentUser]));
          setTimeout(() => setIsReady(true), 150);
        }
      };

      loadSessions();
    } else {
      setIsReady(true);
    }
  }, [currentUser?.email]); // Only re-load if user identity changes

  // PERSISTENCE: Save scoped data
  useEffect(() => {
    if (isReady && domain) {
      try {
        localStorage.setItem(`${domain}_connections`, JSON.stringify(connections));
        localStorage.setItem(`${domain}_tables`, JSON.stringify(tables));
        localStorage.setItem(`${domain}_users`, JSON.stringify(users));

        // Use PersistentStorage (IndexedDB) for sessions to handle large datasets
        PersistentStorage.set(`${domain}_reportSessions`, reportSessions);
        PersistentStorage.set(`${domain}_activeReportSessionId`, activeReportSessionId);
      } catch (e) {
        if (e instanceof Error && e.name === 'QuotaExceededError') {
          console.error('🛑 LocalStorage quota exceeded. Non-critical metadata might not be saved.');
        } else {
          console.error('Error saving state:', e);
        }
      }
    }
  }, [connections, tables, reportSessions, activeReportSessionId, users, domain, isReady]);

  const hasConnections = connections.length > 0;

  useEffect(() => {
    if (!hasConnections && activeTab !== 'connections' && activeTab !== 'ai-config' && activeTab !== 'users' && activeTab !== 'onboarding') {
      setActiveTab('connections');
    }
  }, [connections.length, activeTab, hasConnections]);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const name = formData.get('name') as string;
    const d = email.split('@')[1];

    if (email === 'admin@360data-solutions.ai') {
      const superAdmin: User = {
        id: 'super-admin-001',
        name: 'Super Admin',
        email: 'admin@360data-solutions.ai',
        role: 'Admin',
        status: 'Active',
        joinedAt: new Date().toISOString(),
        jobTitle: 'System Administrator',
        companySize: 'Enterprise',
        phoneNumber: '+1000000000'
      };
      setTimeout(() => {
        setLoading(false);
        setCurrentUser(superAdmin);
        setIsAuthenticated(true);
      }, 800);
      return;
    }

    if (!isCorporateDomain(email)) {
      setLoading(false);
      setAuthError('Access restricted: Please use your corporate email.');
      return;
    }

    setTimeout(() => {
      setLoading(false);
      const savedUsersJson = localStorage.getItem(`${d}_users`);
      let workspaceUsers: User[] = savedUsersJson ? JSON.parse(savedUsersJson) : [];

      if (isRegistering) {
        if (workspaceUsers.length > 0) {
          const firstAdmin = workspaceUsers.find(u => u.role === 'Admin');
          setAuthError(`Workspace for ${d} already exists.`);
          return;
        }

        // START ONBOARDING FLOW
        setPendingUser({ name, email });
        navigate('/onboarding');
      } else {
        const user = workspaceUsers.find(u => u.email === email);
        if (!user) {
          setAuthError('User not found.');
          return;
        }
        setCurrentUser(user);
        setIsAuthenticated(true);
      }
    }, 1200);
  };

  const handleOnboardingComplete = (finalUser: User) => {
    const d = finalUser.email.split('@')[1];
    // Save user
    const savedUsersJson = localStorage.getItem(`${d}_users`);
    let workspaceUsers: User[] = savedUsersJson ? JSON.parse(savedUsersJson) : [];

    // If updating existing user
    if (workspaceUsers.some(u => u.id === finalUser.id)) {
      workspaceUsers = workspaceUsers.map(u => u.id === finalUser.id ? finalUser : u);
    } else {
      workspaceUsers.push(finalUser);
    }

    localStorage.setItem(`${d}_users`, JSON.stringify(workspaceUsers));
    setCurrentUser(finalUser);
    setIsAuthenticated(true);
    setPendingUser(null);
    navigate('/connections');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    navigate('/');
  };

  const addConnection = (conn: Connection, selectedTables: SyncedTable[]) => {
    setConnections([...connections, conn]);
    // Filter duplicates just in case
    const currentTableIdentifiers = new Set(tables.map(t => `${t.connectionId}:${t.datasetName}.${t.tableName}`));
    const uniqueNewTables = selectedTables.filter(t => !currentTableIdentifiers.has(`${t.connectionId}:${t.datasetName}.${t.tableName}`));
    setTables([...tables, ...uniqueNewTables]);
  };

  const updateConnection = (conn: Connection, newTables?: SyncedTable[]) => {
    setConnections(prevConns => prevConns.map(c => c.id === conn.id ? conn : c));

    if (newTables) {
      setTables(prevTables => {
        // Remove old tables for this connection and add the new set
        const otherConnectionsTables = prevTables.filter(t => t.connectionId !== conn.id);

        // Ensure uniqueness within the new set
        const uniqueNewTablesMap = new Map();
        newTables.forEach(t => uniqueNewTablesMap.set(`${t.datasetName}.${t.tableName}`, t));
        const finalNewTables = Array.from(uniqueNewTablesMap.values());

        return [...otherConnectionsTables, ...finalNewTables];
      });
    }
  };

  const deleteConnection = (id: string) => {
    setConnections(connections.filter(c => c.id !== id));
    setTables(tables.filter(t => t.connectionId !== id));
  };

  const toggleTableStatus = (id: string) => {
    setTables(prev => prev.map(t =>
      t.id === id ? { ...t, status: t.status === 'Active' ? 'Disabled' : 'Active' } : t
    ));
  };

  const deleteTable = (id: string) => setTables(prev => prev.filter(t => t.id !== id));

  const deleteTables = (ids: string[]) => setTables(prev => prev.filter(t => !ids.includes(t.id)));

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#020617] flex flex-col items-center justify-center p-6 overflow-hidden relative transition-colors duration-300">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[150px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-600/10 blur-[150px] rounded-full"></div>

        <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in duration-500">
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white text-4xl mx-auto mb-6 shadow-2xl shadow-indigo-600/30 rotate-3 hover:rotate-0 transition-transform cursor-pointer">
              <i className="fas fa-bolt"></i>
            </div>
            <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-2">360data-solutions</h1>
            <p className="text-slate-500 font-medium tracking-wide">AI-Powered Data Intelligence</p>
          </div>

          <div className="bg-white/80 dark:bg-slate-900/60 backdrop-blur-3xl p-10 rounded-[3rem] border border-slate-200 dark:border-white/5 shadow-2xl shadow-black/5 dark:shadow-black/50">
            <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-8 tracking-tight">
              {isRegistering ? 'Create New Workspace' : 'System Access'}
            </h2>

            <form onSubmit={handleAuth} className="space-y-5">
              {isRegistering && (
                <div className="animate-in slide-in-from-top-4">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Full Name</label>
                  <input
                    type="text"
                    name="name"
                    required
                    className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700"
                    placeholder="Enter your name"
                  />
                </div>
              )}
              {authError && (
                <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
                  <p className="text-red-400 text-xs font-bold flex items-center gap-2">
                    <i className="fas fa-exclamation-triangle"></i> {authError}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Corporate Identity (Work Email)</label>
                <input
                  type="email"
                  name="email"
                  required
                  className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700"
                  placeholder="name@company.com"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Access Token (Password)</label>
                <input
                  type="password"
                  name="password"
                  required
                  className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-4 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700"
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
    <div className="h-screen bg-slate-50 dark:bg-[#020617] flex overflow-hidden transition-colors duration-300">
      <Suspense fallback={null}>
        {!isMainSidebarCollapsed ? (
          <Sidebar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onLogout={handleLogout}
            hasConnections={hasConnections}
            onToggleCollapse={() => setIsMainSidebarCollapsed(true)}
            currentUser={currentUser || { id: 'anon', name: 'Anonymous', email: '', role: 'Viewer', status: 'Active', joinedAt: '' }}
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
          />
        ) : (
          <button
            onClick={() => setIsMainSidebarCollapsed(false)}
            className="fixed left-4 bottom-6 w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-indigo-600/30 hover:scale-110 active:scale-95 transition-all z-[60]"
            title="Show Sidebar"
          >
            <i className="fas fa-angles-right"></i>
          </button>
        )}
      </Suspense>
      <main
        style={{ marginLeft: isMainSidebarCollapsed ? 0 : sidebarWidth }}
        className={`flex-1 h-screen bg-slate-50 dark:bg-[#020617] transition-[margin] duration-0 ease-linear overflow-hidden relative`}
      >
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-[#020617]">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        }>
          <Routes>
            <Route path="/" element={<Navigate to="/connections" replace />} />

            <Route path="/onboarding" element={
              pendingUser || (currentUser && !currentUser.jobTitle)
                ? <Onboarding
                  currentUser={currentUser || {
                    id: Date.now().toString(),
                    name: pendingUser!.name,
                    email: pendingUser!.email,
                    role: 'Admin',
                    status: 'Active',
                    joinedAt: new Date().toISOString().split('T')[0]
                  }}
                  onUpdateUser={handleOnboardingComplete}
                />
                : <Navigate to="/connections" replace />
            } />

            <Route path="/connections" element={
              <Connections
                connections={connections}
                tables={tables}
                onAddConnection={addConnection}
                onUpdateConnection={updateConnection}
                onDeleteConnection={deleteConnection}
                googleToken={googleToken}
                setGoogleToken={setGoogleToken}
              />
            } />
            <Route path="/tables" element={
              hasConnections ? (
                <Tables
                  tables={tables}
                  connections={connections}
                  onToggleStatus={toggleTableStatus}
                  onDeleteTable={deleteTable}
                  onDeleteTables={deleteTables}
                  googleToken={googleToken}
                  setGoogleToken={setGoogleToken}
                />
              ) : <Navigate to="/connections" replace />
            } />
            <Route path="/reports" element={
              hasConnections ? (
                <Reports
                  tables={tables}
                  connections={connections}
                  sessions={reportSessions}
                  setSessions={setReportSessions}
                  activeSessionId={activeReportSessionId}
                  setActiveSessionId={setActiveReportSessionId}
                  loading={isAIThinking}
                  setLoading={setIsAIThinking}
                  googleToken={googleToken}
                  setGoogleToken={setGoogleToken}
                  currentUser={currentUser || { id: 'anon', name: 'Anonymous', email: '', role: 'Viewer', status: 'Active', joinedAt: '' }}
                />
              ) : <Navigate to="/connections" replace />
            } />
            <Route path="/ai-config" element={<AISettings />} />
            <Route path="/logs" element={<LogViewer />} />
            <Route path="/bi" element={
              hasConnections ? (
                <BIMain
                  tables={tables}
                  connections={connections}
                  currentUser={currentUser || { id: 'current-user', name: 'User', role: 'Admin', email: '', status: 'Active', joinedAt: '' }}
                  googleToken={googleToken}
                  setGoogleToken={setGoogleToken}
                  domain={domain}
                  isMainSidebarCollapsed={isMainSidebarCollapsed}
                  onToggleMainSidebar={() => setIsMainSidebarCollapsed(!isMainSidebarCollapsed)}
                />
              ) : <Navigate to="/connections" replace />
            } />
            <Route path="/users" element={
              currentUser?.role === 'Admin' ? (
                <UserManagement users={users} setUsers={setUsers} />
              ) : <Navigate to="/connections" replace />
            } />
            <Route path="*" element={<Navigate to="/connections" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
};

export default App;
