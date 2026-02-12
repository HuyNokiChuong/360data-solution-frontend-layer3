import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Connection, SyncedTable, ReportSession, User } from './types';
import { INITIAL_TABLES } from './constants';
import { initGoogleAuth } from './services/googleAuth';
import { PersistentStorage } from './services/storage';
import { importExcelSheets } from './services/excel';
import { connectGoogleSheetsOAuth, importGoogleSheetsData, updateGoogleSheetsSyncSettings, GoogleSheetSelectionInput } from './services/googleSheets';
import { useThemeStore } from './store/themeStore';
import { isCorporateDomain } from './utils/domain';
import { ConfirmationModal } from './components/ConfirmationModal';
import { normalizeSchema } from './utils/schema';

const Sidebar = lazy(() => import('./components/Sidebar'));
const Connections = lazy(() => import('./components/Connections'));
const Tables = lazy(() => import('./components/Tables'));
const Reports = lazy(() => import('./components/Reports'));
const AISettings = lazy(() => import('./components/AISettings'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const BIMain = lazy(() => import('./components/bi/BIMain'));
const LogViewer = lazy(() => import('./components/LogViewer'));
const Onboarding = lazy(() => import('./components/Onboarding'));

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
  const [pendingUser, setPendingUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('pending_user');
    return saved ? JSON.parse(saved) : null;
  });

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
      if (!saved) return [];
      try {
        const parsed = JSON.parse(saved) as SyncedTable[];
        return parsed.map((table) => ({
          ...table,
          schema: normalizeSchema(table?.schema || []),
        }));
      } catch (err) {
        return [];
      }
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



  // 1. Verify Session with Backend on mount
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      fetch('http://localhost:3001/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(resData => {
          if (resData.success) {
            setCurrentUser(resData.data);
            setIsAuthenticated(true);
          } else {
            // Token invalid or expired
            handleLogout();
          }
        })
        .catch((err) => {
          console.error("Session verification failed:", err);
          // If backend is unreachable, we stick with local currentUser for offline-ish mode
        });
    }
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
  const API_BASE = 'http://localhost:3001/api';

  const normalizeSyncedTable = (table: SyncedTable): SyncedTable => ({
    ...table,
    schema: normalizeSchema(table?.schema || []),
  });

  const syncConnectionsAndTables = async (tokenOverride?: string) => {
    const token = tokenOverride || localStorage.getItem('auth_token');
    if (!token) return;

    const connRes = await fetch(`${API_BASE}/connections`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (connRes.status === 401) {
      handleLogout();
      throw new Error('Invalid token');
    }
    const connData = await connRes.json();
    if (!connData.success) {
      throw new Error(connData.message || 'Failed to sync connections');
    }

    const syncedConnections: Connection[] = connData.data || [];
    setConnections(syncedConnections);

    if (syncedConnections.length === 0) {
      setTables([]);
      return;
    }

    const tablePromises = syncedConnections.map((conn: Connection) =>
      fetch(`${API_BASE}/connections/${conn.id}/tables`, {
        headers: { 'Authorization': `Bearer ${token}` }
      }).then(r => r.json()).then(d => d.success ? d.data : [])
    );

    const allTablesArrays = await Promise.all(tablePromises);
    const allTables = allTablesArrays.flat().map((table: SyncedTable) => normalizeSyncedTable(table));
    setTables(allTables);
  };

  const createConnectionOnly = async (conn: Connection, tokenOverride?: string): Promise<Connection> => {
    const token = tokenOverride || localStorage.getItem('auth_token');
    if (!token) throw new Error('Missing auth token');

    const connRes = await fetch(`${API_BASE}/connections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(conn)
    });
    const connData = await connRes.json();
    if (!connRes.ok || !connData.success) {
      throw new Error(connData.message || 'Failed to create connection');
    }
    return connData.data as Connection;
  };

  // PERSISTENCE: Save auth user
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('auth_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('auth_user');
    }
  }, [currentUser]);

  // PERSISTENCE: Save pending user
  useEffect(() => {
    if (pendingUser) {
      localStorage.setItem('pending_user', JSON.stringify(pendingUser));
    } else {
      localStorage.removeItem('pending_user');
    }
  }, [pendingUser]);

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
      setTables((load('tables', []) as SyncedTable[]).map((table) => normalizeSyncedTable(table)));

      // NEW: Sync from Backend
      const token = localStorage.getItem('auth_token');
      if (token) {
        syncConnectionsAndTables(token).catch((err) => {
          console.error('Failed to sync connections/tables:', err);
        });

        // Sync users from backend
        fetch('http://localhost:3001/api/users', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
          .then(async res => {
            if (res.status === 401) {
              handleLogout();
              throw new Error('Invalid token');
            }
            return res.json();
          })
          .then(resData => { if (resData.success && resData.data.length > 0) setUsers(resData.data); })
          .catch(console.error);

        // Sync Dashboards & Folders (handled mainly in BIMain store, but keeping here for consistency if needed)
        // Actually, reportSessions are managed in App.tsx state.
        fetch('http://localhost:3001/api/sessions', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
          .then(async res => {
            if (res.status === 401) {
              handleLogout();
              throw new Error('Invalid token');
            }
            return res.json();
          })
          .then(resData => {
            if (resData.success && resData.data.length > 0) {
              setReportSessions(resData.data);
            }
          })
          .catch(console.error);
      }

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

  // PERSISTENCE: Sync sessions to backend when they change
  const prevSessionsRef = React.useRef<ReportSession[]>([]);
  useEffect(() => {
    if (!isReady || !isAuthenticated || !currentUser) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;

    const prevSessions = prevSessionsRef.current;
    const prevIds = new Set(prevSessions.map(s => s.id));

    for (const session of reportSessions) {
      if (!prevIds.has(session.id)) {
        // New session → create on backend
        fetch('http://localhost:3001/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ id: session.id, title: session.title })
        })
          .then(async r => {
            if (r.status === 401) {
              handleLogout();
              throw new Error('Invalid token');
            }
            return r.json();
          })
          .then(resData => {
            if (resData.success && resData.data?.id !== session.id) {
              // Update local ID with backend UUID
              setReportSessions(prev => prev.map(s => s.id === session.id ? { ...s, id: resData.data.id } : s));
            }
          })
          .catch(console.error);
      } else {
        // Existing session — check if title changed
        const prev = prevSessions.find(s => s.id === session.id);
        if (prev && prev.title !== session.title) {
          fetch(`http://localhost:3001/api/sessions/${session.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ title: session.title })
          }).then((r) => {
            if (r.status === 401) {
              handleLogout();
            }
          }).catch(console.error);
        }
      }
    }

    // Detect deleted sessions
    const currentIds = new Set(reportSessions.map(s => s.id));
    for (const prev of prevSessions) {
      if (!currentIds.has(prev.id)) {
        fetch(`http://localhost:3001/api/sessions/${prev.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }).then((r) => {
          if (r.status === 401) {
            handleLogout();
          }
        }).catch(console.error);
      }
    }

    prevSessionsRef.current = reportSessions;
  }, [reportSessions, isReady, isAuthenticated, currentUser]);

  useEffect(() => {
    if (!hasConnections && activeTab !== 'connections' && activeTab !== 'ai-config' && activeTab !== 'users' && activeTab !== 'onboarding') {
      setActiveTab('connections');
    }
  }, [connections.length, activeTab, hasConnections]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    const name = formData.get('name') as string;
    const d = email.split('@')[1];

    // Helper: register or login on backend, returns { user, token }
    const backendAuth = async (authEmail: string, authPassword: string, authName: string): Promise<{ user: any; token: string } | null> => {
      try {
        // Try login first to avoid noisy 409 conflict when account already exists.
        const loginRes = await fetch('http://localhost:3001/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authEmail, password: authPassword })
        });
        const loginData = await loginRes.json();
        if (loginData.success && loginData.data?.token) {
          return { user: loginData.data.user, token: loginData.data.token };
        }

        // Not found yet (or first use) -> register then use returned token.
        const regRes = await fetch('http://localhost:3001/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authEmail, password: authPassword, name: authName })
        });
        const regData = await regRes.json();
        if (regData.success && regData.data?.token) {
          return { user: regData.data.user, token: regData.data.token };
        }
        throw new Error(regData.message || loginData.message || 'Auth failed');
      } catch (err) {
        console.error('Backend auth error:', err);
        return null;
      }
    };

    // Super Admin — same backend flow, just pre-filled defaults
    if (email === 'admin@360data-solutions.ai') {
      const adminName = name || 'Super Admin';
      const adminPass = password || 'admin123';

      const result = await backendAuth(email, adminPass, adminName);
      if (result) {
        localStorage.setItem('auth_token', result.token);
        const superAdmin: User = {
          ...result.user,
          jobTitle: 'System Administrator',
          companySize: 'Enterprise',
          phoneNumber: '+1000000000'
        };
        setCurrentUser(superAdmin);
        setIsAuthenticated(true);
        localStorage.setItem(`${d}_users`, JSON.stringify([superAdmin]));
      } else {
        setAuthError('Cannot connect to backend. Please ensure the server is running.');
      }
      setLoading(false);
      return;
    }

    if (!isCorporateDomain(email)) {
      setLoading(false);
      setAuthError('Access restricted: Please use your corporate email.');
      return;
    }

    if (isRegistering) {
      const phoneNumber = formData.get('phoneNumber') as string;
      const level = formData.get('level') as string;
      const department = formData.get('department') as string;
      const industry = formData.get('industry') as string;
      const companySize = formData.get('companySize') as string;

      // Call Backend Register API
      fetch('http://localhost:3001/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          name,
          phoneNumber,
          level,
          department,
          industry,
          companySize
        })
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Registration failed');

          // Save token from backend for subsequent authenticated calls
          const token = data.data?.token;
          if (token) localStorage.setItem('auth_token', token);

          const backendUser = data.data?.user;
          setPendingUser({
            id: backendUser?.id || Date.now().toString(),
            name: backendUser?.name || name,
            email: backendUser?.email || email,
            phoneNumber: backendUser?.phoneNumber || phoneNumber,
            level: backendUser?.level || level,
            department: backendUser?.department || department,
            industry: backendUser?.industry || industry,
            companySize: backendUser?.companySize || companySize,
            role: backendUser?.role || 'Admin',
            status: 'Pending',
            joinedAt: backendUser?.joinedAt || new Date().toISOString()
          });
          navigate('/onboarding');
        })
        .catch(err => {
          // Fallback: still allow local registration when backend is unreachable
          console.error('Register API error:', err);
          setPendingUser({
            id: Date.now().toString(),
            name, email, phoneNumber, level, department,
            industry, companySize,
            role: 'Admin',
            status: 'Pending',
            joinedAt: new Date().toISOString()
          });
          navigate('/onboarding');
        })
        .finally(() => setLoading(false));

    } else {
      // Call Backend Login API
      fetch('http://localhost:3001/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Login failed');

          const user = data.data.user;
          const token = data.data.token;
          if (token) localStorage.setItem('auth_token', token);

          setCurrentUser(user);
          setIsAuthenticated(true);

          // Sync optional local storage if needed, but backend is source of truth now
          localStorage.setItem(`${d}_users`, JSON.stringify([user]));
        })
        .catch(err => {
          setAuthError(err.message);
        })
        .finally(() => setLoading(false));
    }
  };

  const handleOnboardingComplete = (finalUser: User) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      fetch('http://localhost:3001/api/users/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(finalUser)
      })
        .then(res => res.json())
        .then(resData => {
          if (resData.success) {
            setCurrentUser(resData.data);
          }
        })
        .catch(console.error);
    }

    const userToSave: User = { ...finalUser, status: 'Active' };
    setCurrentUser(userToSave);
    setIsAuthenticated(true);
    setPendingUser(null);
    navigate('/connections');
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setIsAuthenticated(false);
    setCurrentUser(null);
    navigate('/');
  };

  const addConnection = async (conn: Connection, selectedTables: SyncedTable[]) => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      // Fallback if not logged in or token missing
      setConnections([...connections, conn]);
      setTables([...tables, ...selectedTables]);
      return;
    }

    try {
      // 1. Create Connection
      const savedConn = await createConnectionOnly(conn, token);

      let savedTables = selectedTables;

      // 2. Save Tables linked to this connection
      if (selectedTables.length > 0) {
        const tablesRes = await fetch(`${API_BASE}/connections/${savedConn.id}/tables`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ tables: selectedTables })
        });
        const tablesData = await tablesRes.json();
        if (tablesData.success) {
          savedTables = tablesData.data;
        }
      }

      setConnections([...connections, { ...savedConn, tableCount: savedTables.length }]);
      setTables([...tables, ...savedTables]);
    } catch (err) {
      console.error('Failed to persist connection:', err);
      // Still update local state so UI works, but it won't be in DB
      setConnections([...connections, conn]);
      setTables([...tables, ...selectedTables]);
    }
  };

  const createExcelConnection = async (
    conn: Connection,
    file: File,
    datasetName: string,
    sheetNames: string[]
  ) => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      throw new Error('Bạn cần đăng nhập để import Excel');
    }

    const existingConn = connections.find(existing => existing.id === conn.id);
    let targetConnection = existingConn;

    if (!targetConnection) {
      targetConnection = await createConnectionOnly(conn, token);
    } else {
      await fetch(`${API_BASE}/connections/${targetConnection.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(conn)
      });
    }

    await importExcelSheets(targetConnection.id, file, datasetName, sheetNames);
    await syncConnectionsAndTables(token);
  };

  const createGoogleSheetsConnection = async (payload: {
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
  }) => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      throw new Error('Bạn cần đăng nhập để import Google Sheets');
    }

    const connected = (payload.connectionId && !payload.authCode)
      ? { id: payload.connectionId }
      : await connectGoogleSheetsOAuth({
        authCode: payload.authCode,
        connectionId: payload.connectionId,
        connectionName: payload.connectionName,
      });

    await importGoogleSheetsData(connected.id, {
      fileId: payload.fileId,
      fileName: payload.fileName,
      sheets: payload.sheets,
      allowEmptySheets: payload.allowEmptySheets === true,
      confirmOverwrite: payload.confirmOverwrite === true,
      syncMode: payload.syncMode || 'manual',
      syncIntervalMinutes: payload.syncIntervalMinutes || 15,
    });

    await updateGoogleSheetsSyncSettings(connected.id, {
      mode: payload.syncMode || 'manual',
      intervalMinutes: payload.syncIntervalMinutes || 15,
    });

    await syncConnectionsAndTables(token);
  };

  const updateConnection = (conn: Connection, newTables?: SyncedTable[]) => {
    setConnections(prevConns => prevConns.map(c => c.id === conn.id ? conn : c));

    // Sync to Backend
    const token = localStorage.getItem('auth_token');
    if (token) {
      fetch(`http://localhost:3001/api/connections/${conn.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(conn)
      }).catch(console.error);

      if (newTables && newTables.length > 0) {
        fetch(`http://localhost:3001/api/connections/${conn.id}/tables`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ tables: newTables })
        }).catch(console.error);
      }
    }

    if (newTables) {
      setTables(prevTables => {
        const otherConnectionsTables = prevTables.filter(t => t.connectionId !== conn.id);
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

    // Sync to Backend
    const token = localStorage.getItem('auth_token');
    if (token) {
      fetch(`http://localhost:3001/api/connections/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(console.error);
    }
  };

  const toggleTableStatus = (id: string) => {
    setTables(prev => prev.map(t =>
      t.id === id ? { ...t, status: t.status === 'Active' ? 'Disabled' : 'Active' } : t
    ));
  };

  // Confirmation State
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => { } });

  const executeDeleteTable = async (id: string) => {
    setTables(prev => prev.filter(t => t.id !== id));

    // Sync to Backend
    const token = localStorage.getItem('auth_token');
    if (token) {
      fetch(`http://localhost:3001/api/connections/tables/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(console.error);
    }
  };

  const executeDeleteTables = async (ids: string[]) => {
    setTables(prev => prev.filter(t => !ids.includes(t.id)));

    // Sync to Backend
    const token = localStorage.getItem('auth_token');
    if (token) {
      Promise.all(ids.map(id =>
        fetch(`http://localhost:3001/api/connections/tables/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        })
      )).catch(console.error);
    }
  };

  const deleteTable = (id: string) => {
    setDeleteConfirmation({
      isOpen: true,
      title: 'Delete Data Asset',
      message: 'Are you sure you want to delete this table? This will remove it from the registry but not from the source.',
      onConfirm: () => executeDeleteTable(id)
    });
  };

  const deleteTables = (ids: string[]) => {
    setDeleteConfirmation({
      isOpen: true,
      title: 'Bulk Delete Assets',
      message: `Are you sure you want to delete ${ids.length} tables? This action cannot be undone.`,
      onConfirm: () => executeDeleteTables(ids)
    });
  };


  if (!isAuthenticated) {
    if (location.pathname === '/onboarding' && pendingUser) {
      return (
        <Suspense fallback={null}>
          <Onboarding
            currentUser={pendingUser}
            onUpdateUser={handleOnboardingComplete}
          />
        </Suspense>
      );
    }

    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#020617] flex flex-col items-center justify-center p-6 overflow-hidden relative transition-colors duration-300">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[150px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-600/10 blur-[150px] rounded-full"></div>

        <div className={`w-full ${isRegistering ? 'max-w-4xl' : 'max-w-xl'} relative z-10 animate-in fade-in zoom-in duration-500 transition-all duration-500`}>
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white text-4xl mx-auto mb-6 shadow-2xl shadow-indigo-600/30 rotate-3 hover:rotate-0 transition-transform cursor-pointer">
              <i className="fas fa-bolt"></i>
            </div>
            <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-2">360data-solutions</h1>
            <p className="text-slate-500 font-medium tracking-wide">AI-Powered Data Intelligence</p>
          </div>

          <div className="bg-white/80 dark:bg-slate-900/60 backdrop-blur-3xl p-10 md:p-16 rounded-[3rem] border border-slate-200 dark:border-white/5 shadow-2xl shadow-black/5 dark:shadow-black/50">
            <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-8 tracking-tight">
              {isRegistering ? 'Create New Workspace' : 'System Access'}
            </h2>

            <form onSubmit={handleAuth} className="space-y-5">
              {isRegistering && (
                <div className="space-y-4 animate-in slide-in-from-top-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Full Name</label>
                      <input
                        type="text"
                        name="name"
                        required
                        className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700 text-sm"
                        placeholder="Huy Nguyen"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Phone Number</label>
                      <input
                        type="tel"
                        name="phoneNumber"
                        required
                        className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all placeholder-slate-400 dark:placeholder-slate-700 text-sm"
                        placeholder="+84 90..."
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Current Level</label>
                      <select
                        name="level"
                        required
                        className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all text-sm appearance-none"
                      >
                        <option value="" disabled selected>Select Level</option>
                        <option value="Intern">Intern</option>
                        <option value="Junior">Junior</option>
                        <option value="Senior">Senior</option>
                        <option value="Lead">Lead</option>
                        <option value="Manager">Manager</option>
                        <option value="Director">Director</option>
                        <option value="C-Suite">C-Suite / Founder</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Department</label>
                      <select
                        name="department"
                        required
                        className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all text-sm appearance-none"
                      >
                        <option value="" disabled selected>Select Dept</option>
                        <option value="Engineering">Engineering</option>
                        <option value="Data">Data & Analytics</option>
                        <option value="Product">Product</option>
                        <option value="Sales">Sales</option>
                        <option value="Marketing">Marketing</option>
                        <option value="Operations">Operations</option>
                        <option value="Finance">Finance</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Industry</label>
                      <select
                        name="industry"
                        required
                        className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all text-sm appearance-none"
                      >
                        <option value="" disabled selected>Select Industry</option>
                        <option value="Technology">Technology</option>
                        <option value="Finance">Finance</option>
                        <option value="Healthcare">Healthcare</option>
                        <option value="E-commerce">E-commerce</option>
                        <option value="Education">Education</option>
                        <option value="Manufacturing">Manufacturing</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Company Size</label>
                      <select
                        name="companySize"
                        required
                        className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-600/50 focus:border-indigo-600 focus:outline-none transition-all text-sm appearance-none"
                      >
                        <option value="" disabled selected>Select Size</option>
                        <option value="1-10">1-10 employees</option>
                        <option value="11-50">11-50 employees</option>
                        <option value="51-200">51-200 employees</option>
                        <option value="201-500">201-500 employees</option>
                        <option value="500+">500+ employees</option>
                      </select>
                    </div>
                  </div>
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
                {loading ? <i className="fas fa-circle-notch animate-spin"></i> : (isRegistering ? 'Submit Registration' : 'Enter Workspace')}
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
    <>
      <ConfirmationModal
        isOpen={deleteConfirmation.isOpen}
        onClose={() => setDeleteConfirmation(prev => ({ ...prev, isOpen: false }))}
        onConfirm={deleteConfirmation.onConfirm}
        title={deleteConfirmation.title}
        message={deleteConfirmation.message}
        confirmText="Yes, delete it"
        type="danger"
      />
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
                    currentUser={pendingUser || currentUser!}
                    onUpdateUser={handleOnboardingComplete}
                  />
                  : <Navigate to="/connections" replace />
              } />

              <Route path="/connections" element={
                <Connections
                  connections={connections}
                  tables={tables}
                  onAddConnection={addConnection}
                  onCreateExcelConnection={createExcelConnection}
                  onCreateGoogleSheetsConnection={createGoogleSheetsConnection}
                  onRefreshData={syncConnectionsAndTables}
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
                  <UserManagement users={users} setUsers={setUsers} currentUser={currentUser} />
                ) : <Navigate to="/connections" replace />
              } />
              <Route path="*" element={<Navigate to="/connections" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </>
  );
};

export default App;
