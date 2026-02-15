import React, { useEffect, useRef, useState } from 'react';
import { User, UserRole } from '../types';
import { isCorporateDomain } from '../utils/domain';
import { useDashboardStore } from './bi/store/dashboardStore';
import { SharePermission } from './bi/types';
import { API_BASE } from '../services/api';
import { useLanguageStore } from '../store/languageStore';

interface UserManagementProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  currentUser: User;
}

type UserTableColumnKey =
  | 'memberIdentity'
  | 'accessToken'
  | 'group'
  | 'authority'
  | 'note'
  | 'tags'
  | 'status'
  | 'provisioned'
  | 'ops';

type UserTableVisibleColumns = Record<UserTableColumnKey, boolean>;

const USER_TABLE_VISIBLE_COLUMNS_STORAGE_KEY = 'users.table.visible_columns.v1';
const USER_TABLE_VISIBLE_COLUMNS_DEFAULTS: UserTableVisibleColumns = {
  memberIdentity: true,
  accessToken: true,
  group: true,
  authority: true,
  note: true,
  tags: true,
  status: true,
  provisioned: true,
  ops: true,
};

const sanitizeUserTableVisibleColumns = (rawValue: unknown): UserTableVisibleColumns => {
  const next: UserTableVisibleColumns = { ...USER_TABLE_VISIBLE_COLUMNS_DEFAULTS };
  if (rawValue && typeof rawValue === 'object') {
    (Object.keys(USER_TABLE_VISIBLE_COLUMNS_DEFAULTS) as UserTableColumnKey[]).forEach((key) => {
      const value = (rawValue as Record<string, unknown>)[key];
      if (typeof value === 'boolean') next[key] = value;
    });
  }
  if (Object.values(next).every((value) => !value)) {
    return { ...USER_TABLE_VISIBLE_COLUMNS_DEFAULTS };
  }
  return next;
};

const UserManagement: React.FC<UserManagementProps> = ({ users, setUsers, currentUser }) => {
  const { t } = useLanguageStore();
  const { dashboards, shareDashboard } = useDashboardStore();
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'invite' | 'edit'>('invite');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [showToast, setShowToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Viewer' as UserRole, groupName: '', note: '', tags: [] as string[] });
  const [tagInput, setTagInput] = useState('');
  const [granularRoles, setGranularRoles] = useState<Record<string, SharePermission['permission'] | 'none'>>({});
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<UserTableVisibleColumns>(() => {
    if (typeof window === 'undefined') return { ...USER_TABLE_VISIBLE_COLUMNS_DEFAULTS };
    try {
      const raw = window.localStorage.getItem(USER_TABLE_VISIBLE_COLUMNS_STORAGE_KEY);
      if (!raw) return { ...USER_TABLE_VISIBLE_COLUMNS_DEFAULTS };
      return sanitizeUserTableVisibleColumns(JSON.parse(raw));
    } catch {
      return { ...USER_TABLE_VISIBLE_COLUMNS_DEFAULTS };
    }
  });
  const columnPickerRef = useRef<HTMLDivElement | null>(null);

  const workspaceDomain = currentUser.email.split('@')[1]?.toLowerCase();
  const formatProvisionedAt = (value: string) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value.length > 16 ? `${value.slice(0, 16)}...` : value;
    }
    const date = parsed.toLocaleDateString('en-CA');
    const time = parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date} ${time}`;
  };

  const deleteUser = (id: string) => {
    const token = localStorage.getItem('auth_token');
    setUsers(users.filter(u => u.id !== id));
    if (token) {
      fetch(`${API_BASE}/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(console.error);
    }
  };

  const toggleStatus = (id: string) => {
    setUsers(users.map(u => u.id === id ? { ...u, status: u.status === 'Active' ? 'Disabled' : 'Active' } : u));
    const token = localStorage.getItem('auth_token');
    if (token) {
      fetch(`${API_BASE}/users/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      }).catch(console.error);
    }
  };

  const triggerToast = (message: string, type: 'success' | 'error' = 'success') => {
    setShowToast({ message, type });
    setTimeout(() => setShowToast(null), 3000);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(USER_TABLE_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch {
      // Ignore localStorage persistence issues (private mode, etc.).
    }
  }, [visibleColumns]);

  useEffect(() => {
    if (!isColumnPickerOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (columnPickerRef.current && !columnPickerRef.current.contains(event.target as Node)) {
        setIsColumnPickerOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsColumnPickerOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isColumnPickerOpen]);

  const toggleColumnVisibility = (columnKey: UserTableColumnKey) => {
    setVisibleColumns((previous) => {
      const visibleCount = Object.values(previous).filter(Boolean).length;
      if (visibleCount === 1 && previous[columnKey]) {
        triggerToast(t('users.min_one_column'), 'error');
        return previous;
      }
      return { ...previous, [columnKey]: !previous[columnKey] };
    });
  };

  const resetVisibleColumns = () => {
    setVisibleColumns({ ...USER_TABLE_VISIBLE_COLUMNS_DEFAULTS });
  };

  const addTag = (rawTag: string) => {
    const normalized = rawTag.trim().replace(/\s+/g, ' ');
    if (!normalized) return;
    if (newUser.tags.some((tag) => tag.toLowerCase() === normalized.toLowerCase())) return;
    if (newUser.tags.length >= 20) {
      triggerToast(t('users.max_tags'), 'error');
      return;
    }
    setNewUser((prev) => ({ ...prev, tags: [...prev.tags, normalized] }));
  };

  const removeTag = (tag: string) => {
    setNewUser((prev) => ({
      ...prev,
      tags: prev.tags.filter((item) => item !== tag),
    }));
  };

  const openInvite = () => {
    setModalMode('invite');
    setEditingUserId(null);
    setNewUser({ name: '', email: '', role: 'Viewer', groupName: '', note: '', tags: [] });
    setTagInput('');
    setGranularRoles({});
    setIsInviteModalOpen(true);
  };

  const openEdit = (user: User) => {
    setModalMode('edit');
    setEditingUserId(user.id);
    setNewUser({
      name: user.name || '',
      email: user.email || '',
      role: (user.role || 'Viewer') as UserRole,
      groupName: user.groupName || '',
      note: user.note || '',
      tags: Array.isArray(user.tags) ? user.tags : [],
    });
    setTagInput('');

    // Pre-fill dashboard permissions from current dashboard store state.
    const nextGranular: Record<string, SharePermission['permission'] | 'none'> = {};
    dashboards.forEach((d) => {
      const perm = (d.sharedWith || []).find((p: SharePermission) => p.userId === user.email)?.permission;
      nextGranular[d.id] = (perm || 'none') as any;
    });
    setGranularRoles(nextGranular);
    setIsInviteModalOpen(true);
  };

  const applyGranularDashboardPermissions = (email: string) => {
    Object.entries(granularRoles).forEach(([dashboardId, role]) => {
      const dashboard = dashboards.find(d => d.id === dashboardId);
      if (!dashboard) return;

      const existing = (dashboard.sharedWith || []).filter((p: SharePermission) => p.userId !== email);
      if (role === 'none') {
        shareDashboard(dashboardId, existing);
        return;
      }

      const nextPerm: SharePermission = {
        userId: email,
        permission: role as SharePermission['permission'],
        sharedAt: new Date().toISOString(),
      };
      shareDashboard(dashboardId, [...existing, nextPerm]);
    });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUserId) return;

    setIsSending(true);
    const token = localStorage.getItem('auth_token');

    // Optimistic update in UI
    setUsers(users.map(u => u.id === editingUserId ? {
      ...u,
      name: newUser.name,
      role: newUser.role,
      groupName: newUser.groupName || undefined,
      note: newUser.note || undefined,
      tags: newUser.tags || [],
    } : u));

    try {
      if (token) {
        const res = await fetch(`${API_BASE}/users/${editingUserId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            name: newUser.name,
            role: newUser.role,
            groupName: newUser.groupName,
            note: newUser.note,
            tags: newUser.tags
          })
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok || !data.success) {
          throw new Error(data.message || 'Failed to update user');
        }

        // Sync authoritative backend user back into state
        setUsers(prev => prev.map(u => u.id === editingUserId ? { ...u, ...data.data } : u));
      }

      applyGranularDashboardPermissions(newUser.email);

      setIsInviteModalOpen(false);
      triggerToast(t('users.updated_permissions', { email: newUser.email }), 'success');
    } catch (err: any) {
      console.error('Update user error:', err);
      triggerToast(err.message || t('users.failed_update'), 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();

    const emailDomain = newUser.email.split('@')[1]?.toLowerCase();

    if (!isCorporateDomain(newUser.email)) {
      triggerToast(t('users.err_corporate_only'), 'error');
      return;
    }

    if (emailDomain !== workspaceDomain) {
      triggerToast(t('users.err_domain_mismatch', { domain: workspaceDomain || '' }), 'error');
      return;
    }

    const existingUser = users.find(u => u.email.toLowerCase() === newUser.email.toLowerCase());
    if (existingUser) {
      triggerToast(t('users.err_exists', { email: newUser.email }), 'error');
      return;
    }

    setIsSending(true);

    const user: User = {
      id: Date.now().toString(),
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      status: 'Active',
      joinedAt: new Date().toISOString().split('T')[0],
      groupName: newUser.groupName || undefined,
      note: newUser.note || undefined,
      tags: newUser.tags || [],
    };

    // 1. Sync to Backend
    const token = localStorage.getItem('auth_token');
    if (token) {
      fetch(`${API_BASE}/users/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          groupName: newUser.groupName,
          note: newUser.note,
          tags: newUser.tags,
        })
      })
        .then(r => r.json())
        .then(resData => {
          if (resData.success && resData.data) {
            // Use backend-assigned ID and data
            const backendUser = { ...user, ...resData.data };
            setUsers([...users, backendUser]);
          } else {
            // Fallback: still add locally
            setUsers([...users, user]);
          }

          // 2. Propagate Granular Dashboard Permissions
          applyGranularDashboardPermissions(user.email);

          setIsSending(false);
          setIsInviteModalOpen(false);
          setNewUser({ name: '', email: '', role: 'Viewer', groupName: '', note: '', tags: [] });
          setTagInput('');
          triggerToast(t('users.invite_sent', { email: user.email }), 'success');
        })
        .catch(err => {
          console.error('Invite error:', err);
          // Fallback: still add locally
          setUsers([...users, user]);
          setIsSending(false);
          setIsInviteModalOpen(false);
          setNewUser({ name: '', email: '', role: 'Viewer', groupName: '', note: '', tags: [] });
          setTagInput('');
          triggerToast(t('users.invite_offline', { email: user.email }), 'success');
        });
    } else {
      // No token: legacy local-only behavior
      setTimeout(() => {
        setUsers([...users, user]);

        applyGranularDashboardPermissions(user.email);

        setIsSending(false);
        setIsInviteModalOpen(false);
        setNewUser({ name: '', email: '', role: 'Viewer', groupName: '', note: '', tags: [] });
        setTagInput('');
        triggerToast(t('users.invite_sent', { email: user.email }), 'success');
      }, 1500);
    }
  };

  const columnOptions: Array<{ key: UserTableColumnKey; label: string }> = [
    { key: 'memberIdentity', label: t('users.member_identity') },
    { key: 'accessToken', label: t('users.access_token') },
    { key: 'group', label: t('users.group') },
    { key: 'authority', label: t('users.authority') },
    { key: 'note', label: t('users.note') },
    { key: 'tags', label: t('users.tags') },
    { key: 'status', label: t('users.status') },
    { key: 'provisioned', label: t('users.provisioned') },
    { key: 'ops', label: t('users.ops') },
  ];

  return (
    <div className="p-6 md:p-8 max-w-[1600px] mx-auto relative h-full overflow-y-auto custom-scrollbar">
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-10 right-10 z-[120] animate-in slide-in-from-right-20 fade-in-0 duration-500">
          <div className={`${showToast.type === 'error' ? 'bg-rose-500/90' : 'bg-indigo-600/90'} backdrop-blur-xl text-white px-8 py-5 rounded-[2rem] shadow-3xl flex items-center gap-5 border border-white/20`}>
            <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md">
              <i className={`fas ${showToast.type === 'error' ? 'fa-shield-virus' : 'fa-check-double'} text-sm`}></i>
            </div>
            <div>
              <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-60 mb-0.5">{t('users.alert')}</div>
              <span className="text-xs font-black uppercase tracking-widest">{showToast.message}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
        <div>
          <h2 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white tracking-tighter mb-1">{t('users.title')}</h2>
          <p className="text-slate-500 font-medium text-sm md:text-base italic opacity-80 px-1">{t('users.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 relative">
          <div className="relative" ref={columnPickerRef}>
            <button
              type="button"
              onClick={() => setIsColumnPickerOpen((prev) => !prev)}
              className="w-12 h-12 rounded-2xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 hover:text-indigo-500 transition-all flex items-center justify-center shadow-sm"
              title={t('users.column_visibility')}
            >
              <i className="fas fa-columns text-sm"></i>
            </button>

            {isColumnPickerOpen && (
              <div className="absolute right-0 top-[calc(100%+10px)] w-[320px] bg-white dark:bg-[#0b1120] border border-slate-200 dark:border-white/10 rounded-2xl shadow-3xl z-20 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{t('users.column_visibility')}</div>
                </div>
                <div className="p-3 grid grid-cols-2 gap-2">
                  {columnOptions.map((column) => (
                    <label key={column.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleColumns[column.key]}
                        onChange={() => toggleColumnVisibility(column.key)}
                        className="w-3.5 h-3.5 accent-indigo-600"
                      />
                      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">{column.label}</span>
                    </label>
                  ))}
                </div>
                <div className="px-3 pb-3 flex justify-end">
                  <button
                    type="button"
                    onClick={resetVisibleColumns}
                    className="text-[10px] font-black uppercase tracking-[0.14em] px-3 py-1.5 rounded-lg border border-slate-300 dark:border-white/15 text-slate-500 hover:text-indigo-500 hover:border-indigo-500/40 transition-colors"
                  >
                    {t('users.reset_columns')}
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={openInvite}
            className="bg-indigo-600 text-white px-6 py-3.5 rounded-[1.5rem] font-black tracking-tight hover:bg-indigo-500 transition-all flex items-center gap-3 shadow-2xl shadow-indigo-600/40 active:scale-95 group"
          >
            <i className="fas fa-plus-circle group-hover:rotate-90 transition-transform duration-300"></i>
            <span>{t('users.invite')}</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900/40 backdrop-blur-3xl rounded-[2rem] md:rounded-[2.5rem] border border-slate-200 dark:border-white/10 shadow-3xl overflow-hidden mb-6 transition-all duration-500">
        <div className="overflow-hidden">
          <table className="w-full text-left border-collapse table-fixed">
            <thead>
              <tr className="border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.03]">
                {visibleColumns.memberIdentity && (
                  <th className="w-[21%] px-4 md:px-5 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{t('users.member_identity')}</th>
                )}
                {visibleColumns.accessToken && (
                  <th className="w-[11%] px-4 md:px-5 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{t('users.access_token')}</th>
                )}
                {visibleColumns.group && (
                  <th className="w-[10%] px-4 md:px-5 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{t('users.group')}</th>
                )}
                {visibleColumns.authority && (
                  <th className="w-[10%] px-4 md:px-5 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{t('users.authority')}</th>
                )}
                {visibleColumns.note && (
                  <th className="w-[15%] px-4 md:px-5 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{t('users.note')}</th>
                )}
                {visibleColumns.tags && (
                  <th className="w-[14%] px-4 md:px-5 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{t('users.tags')}</th>
                )}
                {visibleColumns.status && (
                  <th className="w-[8%] px-4 md:px-5 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{t('users.status')}</th>
                )}
                {visibleColumns.provisioned && (
                  <th className="w-[11%] px-4 md:px-5 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] text-center">{t('users.provisioned')}</th>
                )}
                {visibleColumns.ops && (
                  <th className="w-[6%] px-4 md:px-5 py-5 text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] text-right">{t('users.ops')}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {users.map(user => (
                <tr key={user.id} className="group hover:bg-white/[0.02] transition-colors relative">
                  {visibleColumns.memberIdentity && (
                    <td className="px-4 md:px-5 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-sm shadow-xl shadow-indigo-600/20 group-hover:scale-110 transition-transform duration-300">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-slate-900 dark:text-white font-black text-sm md:text-base tracking-tight leading-none mb-1 truncate">{user.name}</div>
                          <div className="text-[10px] font-black text-slate-400 dark:text-indigo-400/60 uppercase tracking-wide flex items-center gap-2 min-w-0">
                            <i className="fas fa-at text-[8px]"></i>
                            <span className="truncate">{user.email}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                  )}
                  {visibleColumns.accessToken && (
                    <td className="px-4 md:px-5 py-5">
                      <div className="flex flex-col gap-1.5">
                        <span className={`w-fit px-3 py-1 rounded-xl text-[9px] font-black uppercase tracking-wide border shadow-sm ${user.role === 'Admin' ? 'bg-indigo-600 text-white border-indigo-400/30' :
                          user.role === 'Editor' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                            'bg-slate-800 text-slate-400 border-slate-700'
                          }`}>
                          {user.role}
                        </span>
                        {user.department && (
                          <span className="text-[9px] font-black text-slate-500 uppercase tracking-tight opacity-50 pl-1 truncate">
                            {user.department} {t('users.unit')}
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                  {visibleColumns.group && (
                    <td className="px-4 md:px-5 py-5">
                      {user.groupName ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-[0.12em] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                          {user.groupName}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-xs italic">-</span>
                      )}
                    </td>
                  )}
                  {visibleColumns.authority && (
                    <td className="px-4 md:px-5 py-5">
                      <span className="text-sm font-black text-slate-900 dark:text-slate-300 tracking-tight block truncate">
                        {user.level || t('users.standard')}
                      </span>
                      {user.companySize && (
                        <div className="text-[9px] font-black text-slate-500 uppercase tracking-wide mt-1 opacity-60 truncate">
                          {t('users.scale')}: {user.companySize}
                        </div>
                      )}
                    </td>
                  )}
                  {visibleColumns.note && (
                    <td className="px-4 md:px-5 py-5">
                      <div
                        className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed truncate"
                        title={user.note || '-'}
                      >
                        {user.note || <span className="text-slate-500 italic">-</span>}
                      </div>
                    </td>
                  )}
                  {visibleColumns.tags && (
                    <td className="px-4 md:px-5 py-5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(user.tags || []).length === 0 && (
                          <span className="text-slate-500 text-xs italic">-</span>
                        )}
                        {(user.tags || []).slice(0, 2).map((tag) => (
                          <span
                            key={`${user.id}-${tag}`}
                            className="px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wide bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 truncate max-w-full"
                            title={tag}
                          >
                            {tag}
                          </span>
                        ))}
                        {(user.tags || []).length > 2 && (
                          <span className="text-[9px] font-black text-slate-500">
                            +{(user.tags || []).length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                  {visibleColumns.status && (
                    <td className="px-4 md:px-5 py-5">
                      <div className="flex items-center gap-2 bg-slate-100 dark:bg-white/5 w-fit px-3 py-1.5 rounded-2xl border border-white/5">
                        <div className={`w-2.5 h-2.5 rounded-full ${user.status === 'Active' ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]' :
                          user.status === 'Pending' ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'
                          }`}></div>
                        <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{user.status}</span>
                      </div>
                    </td>
                  )}
                  {visibleColumns.provisioned && (
                    <td className="px-4 md:px-5 py-5 text-center">
                      <div className="text-slate-900 dark:text-white font-black text-xs tracking-tight mb-0.5 whitespace-nowrap">{formatProvisionedAt(user.joinedAt)}</div>
                      <div className="text-[8px] font-black text-slate-500 uppercase tracking-[0.12em] opacity-40">{t('users.utc')}</div>
                    </td>
                  )}
                  {visibleColumns.ops && (
                    <td className="px-4 md:px-5 py-5 text-right">
                      <div className="flex justify-end gap-2 transition-all duration-300">
                        <button
                          onClick={() => toggleStatus(user.id)}
                          className={`w-9 h-9 rounded-xl transition-all flex items-center justify-center border ${user.status === 'Active' ? 'bg-amber-500/5 text-amber-500 border-amber-500/20 hover:bg-amber-500 hover:text-white' : 'bg-emerald-500/5 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500 hover:text-white'}`}
                          title={user.status === 'Active' ? t('users.restrict_access') : t('users.grant_access')}
                        >
                          <i className={`fas ${user.status === 'Active' ? 'fa-lock' : 'fa-lock-open'} text-xs`}></i>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(user)}
                          className="w-9 h-9 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-slate-400 hover:text-indigo-500 transition-all flex items-center justify-center shadow-sm"
                          title={t('users.edit_member')}
                        >
                          <i className="fas fa-sliders-h text-xs"></i>
                        </button>
                        <button
                          onClick={() => deleteUser(user.id)}
                          className="w-9 h-9 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl hover:bg-red-500 hover:text-white transition-all flex items-center justify-center shadow-lg shadow-red-500/10"
                        >
                          <i className="fas fa-trash-alt text-xs"></i>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isInviteModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-5 bg-slate-900/90 dark:bg-black/95 backdrop-blur-3xl animate-in fade-in duration-500">
          <form onSubmit={modalMode === 'edit' ? handleEdit : handleInvite} className="w-full max-w-[1240px] bg-white dark:bg-[#0b1120] border border-white/10 rounded-[2.5rem] shadow-4xl overflow-hidden p-8 md:p-10 relative animate-in zoom-in-95 duration-500 grid grid-cols-2 gap-6 md:gap-8">
            {isSending && (
              <div className="absolute inset-0 z-[120] bg-[#0b1120]/90 backdrop-blur-md flex flex-col items-center justify-center">
                <div className="w-24 h-24 border-8 border-indigo-600/10 border-t-indigo-600 rounded-full animate-spin mb-8"></div>
                <p className="text-sm font-black text-indigo-400 uppercase tracking-[0.5em] animate-pulse">{t('users.provisioning_loading')}</p>
              </div>
            )}

            <div className="col-span-2 flex justify-between items-start mb-1">
              <div>
                <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight mb-1">{t('users.provisioning_title')}</h2>
                <div className="flex items-center gap-3">
                  <div className="h-0.5 w-8 bg-indigo-600 rounded-full"></div>
                  <p className="text-[9px] font-black text-slate-500 dark:text-indigo-400/60 uppercase tracking-[0.22em]">{t('users.provisioning_subtitle')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="w-11 h-11 bg-slate-100 dark:bg-white/5 rounded-2xl text-slate-500 hover:text-white transition-all flex items-center justify-center border border-white/5 active:scale-90"
              >
                <i className="fas fa-times text-base"></i>
              </button>
            </div>

            {/* Left Column: Basic Info */}
            <div className="grid grid-cols-2 gap-4 content-start">
              <div className="space-y-2">
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-[0.18em] px-1">{t('users.name_identity')}</label>
                <input
                  required
                  value={newUser.name}
                  onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-3 text-sm md:text-base text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-800 shadow-inner"
                  placeholder="e.g. Hoàng Anh"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-[0.18em] px-1">{t('users.email_endpoint')}</label>
                <input
                  type="email"
                  required
                  value={newUser.email}
                  onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                  disabled={modalMode === 'edit'}
                  className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-3 text-sm md:text-base text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-800 shadow-inner"
                  placeholder="anh.h@company.ai"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-[0.18em] px-1">{t('users.authorization_node')}</label>
                <div className="relative">
                  <select
                    value={newUser.role}
                    onChange={e => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                    className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-3 text-sm md:text-base text-slate-900 dark:text-white font-black appearance-none cursor-pointer focus:ring-2 focus:ring-indigo-600/20 outline-none shadow-inner"
                  >
                    <option value="Viewer">{t('users.viewer_readonly')}</option>
                    <option value="Editor">{t('users.editor_build')}</option>
                    <option value="Admin">{t('users.admin_full')}</option>
                  </select>
                  <i className="fas fa-chevron-down absolute right-5 top-1/2 -translate-y-1/2 text-sm text-indigo-500 pointer-events-none"></i>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-[0.18em] px-1">{t('users.group')}</label>
                <input
                  value={newUser.groupName}
                  onChange={(e) => setNewUser({ ...newUser, groupName: e.target.value.slice(0, 120) })}
                  className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-3 text-sm md:text-base text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-800 shadow-inner"
                  placeholder="e.g. Sales, Finance, Marketing"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-[0.18em] px-1">{t('users.note')}</label>
                <textarea
                  value={newUser.note}
                  onChange={(e) => setNewUser({ ...newUser, note: e.target.value.slice(0, 500) })}
                  rows={2}
                  className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-3 text-xs md:text-sm text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-800 shadow-inner resize-none"
                  placeholder={t('users.note_placeholder')}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-[0.18em] px-1">{t('users.tags')}</label>
                <div className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-4 py-3 shadow-inner">
                  <div className="flex flex-wrap gap-2 mb-2 min-h-[22px]">
                    {newUser.tags.length === 0 && (
                      <span className="text-[10px] text-slate-500 italic px-1.5 py-0.5">{t('users.tags_hint')}</span>
                    )}
                    {newUser.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-2 px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-wide bg-indigo-500/10 text-indigo-500 border border-indigo-500/20"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="text-indigo-400 hover:text-indigo-600 transition-colors"
                          title="Remove tag"
                        >
                          <i className="fas fa-times text-[9px]"></i>
                        </button>
                      </span>
                    ))}
                  </div>
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addTag(tagInput);
                        setTagInput('');
                      } else if (e.key === 'Backspace' && !tagInput && newUser.tags.length > 0) {
                        removeTag(newUser.tags[newUser.tags.length - 1]);
                      }
                    }}
                    onBlur={() => {
                      if (tagInput.trim()) {
                        addTag(tagInput);
                        setTagInput('');
                      }
                    }}
                    className="w-full bg-transparent text-xs md:text-sm text-slate-900 dark:text-white font-medium outline-none placeholder-slate-400 dark:placeholder-slate-700"
                    placeholder={t('users.tags_placeholder')}
                  />
                </div>
              </div>
            </div>

            {/* Right Column: Dashboard Permissions (Granular) */}
            <div className="flex flex-col">
              <label className="block text-[9px] font-black text-slate-500 uppercase tracking-[0.18em] mb-3 px-1 flex items-center justify-between">
                <span>{t('users.dashboard_access')}</span>
                <span className="text-indigo-400">{t('users.assets_found', { count: dashboards.length })}</span>
              </label>

              <div className="flex-1 min-h-0 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-[2rem] overflow-hidden flex flex-col shadow-2xl">
                <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-white/5">
                  {dashboards.length === 0 ? (
                    <div className="p-10 text-center text-slate-500 text-xs italic">{t('users.no_dashboards')}</div>
                  ) : (
                    dashboards.map(d => (
                      <div key={d.id} className="p-3.5 md:p-4 flex items-center justify-between gap-4 group hover:bg-white/[0.02] transition-all">
                        <div>
                          <div className="text-xs md:text-sm font-black text-slate-900 dark:text-white tracking-tight group-hover:text-indigo-400 transition-colors uppercase">{d.title}</div>
                          <div className="text-[9px] font-bold text-slate-500 opacity-60">{t('users.provision_role')}</div>
                        </div>
                        <select
                          value={granularRoles[d.id] || 'none'}
                          onChange={e => setGranularRoles({ ...granularRoles, [d.id]: e.target.value as any })}
                          className={`text-[9px] font-black uppercase tracking-[0.12em] bg-white dark:bg-slate-900 border rounded-lg px-3 py-1.5 outline-none cursor-pointer transition-all ${granularRoles[d.id] === 'none' ? 'border-slate-300 dark:border-white/10 text-slate-400' : 'border-indigo-600 text-indigo-600 dark:text-white'
                            }`}
                        >
                          <option value="none">{t('users.dont_share')}</option>
                          <option value="view">Viewer</option>
                          <option value="edit">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-4 bg-indigo-600/5 border-t border-white/5">
                  <div className="flex items-center gap-2 text-indigo-400 mb-2">
                    <i className="fas fa-fingerprint text-xs"></i>
                    <span className="text-[9px] font-black uppercase tracking-[0.16em]">{t('users.security_protocol')}</span>
                  </div>
                  <p className="text-[9px] text-slate-500 font-bold leading-relaxed px-1">
                    {t('users.security_note')}
                  </p>
                </div>
              </div>
            </div>

            <div className="col-span-2 h-px bg-white/5 mt-1"></div>

            <div className="col-span-2 flex gap-4 md:gap-5 items-center">
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="flex-1 py-3 text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 hover:text-white transition-all"
              >
                {t('users.abort_protocol')}
              </button>
              <button className="flex-[2] bg-indigo-600 text-white py-4 rounded-[1.25rem] font-black text-xs md:text-sm uppercase tracking-[0.2em] hover:bg-indigo-500 shadow-3xl shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-3">
                <span>{modalMode === 'edit' ? t('users.update_identity') : t('users.dispatch_identity')}</span>
                <i className="fas fa-paper-plane text-xs opacity-50"></i>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
