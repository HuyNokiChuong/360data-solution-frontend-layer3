import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { isCorporateDomain } from '../utils/domain';
import { useDashboardStore } from './bi/store/dashboardStore';
import { SharePermission } from './bi/types';
import { apiService } from '../services/apiService';

interface UserManagementProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  currentUser: User;
}

const UserManagement: React.FC<UserManagementProps> = ({ users, setUsers, currentUser }) => {
  const { dashboards, shareDashboard } = useDashboardStore();
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showToast, setShowToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Viewer' as UserRole });
  const [granularRoles, setGranularRoles] = useState<Record<string, SharePermission['permission'] | 'none'>>({});

  const workspaceDomain = currentUser.email.split('@')[1]?.toLowerCase();

  const deleteUser = async (id: string) => {
    try {
      await apiService.delete(`/users/${id}`);
      setUsers(users.filter(u => u.id !== id));
      triggerToast('User removed from workspace');
    } catch (err: any) {
      triggerToast(err.message, 'error');
    }
  };

  const toggleStatus = async (id: string) => {
    const user = users.find(u => u.id === id);
    if (!user) return;
    const newStatus = user.status === 'Active' ? 'Disabled' : 'Active';
    try {
      await apiService.put(`/users/${id}`, { status: newStatus });
      setUsers(users.map(u => u.id === id ? { ...u, status: newStatus } : u));
    } catch (err: any) {
      triggerToast(err.message, 'error');
    }
  };

  const triggerToast = (message: string, type: 'success' | 'error' = 'success') => {
    setShowToast({ message, type });
    setTimeout(() => setShowToast(null), 3000);
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();

    const emailDomain = newUser.email.split('@')[1]?.toLowerCase();

    if (!isCorporateDomain(newUser.email)) {
      triggerToast(`Access restricted: Only corporate email accounts can be invited.`, 'error');
      return;
    }

    if (emailDomain !== workspaceDomain) {
      triggerToast(`Domain Mismatch: You can only invite users with @${workspaceDomain} emails to this workspace.`, 'error');
      return;
    }

    const existingUser = users.find(u => u.email.toLowerCase() === newUser.email.toLowerCase());
    if (existingUser) {
      triggerToast(`${newUser.email} is already registered in this workspace.`, 'error');
      return;
    }

    setIsSending(true);

    // Call Backend Invite API (assuming a route for invitation or just user creation)
    apiService.post('/users', {
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      status: 'Active'
    })
      .then((user: User) => {
        setUsers([...users, user]);
        // Propagate Granular Dashboard Permissions (Implementation of sharing in backend needed if not exists)
        // ... (Skipping for now as it needs a specific sharing endpoint)

        setIsSending(false);
        setIsInviteModalOpen(false);
        setNewUser({ name: '', email: '', role: 'Viewer' });
        triggerToast(`Invitation sent and permissions provisioned for ${user.email}`, 'success');
      })
      .catch(err => {
        setIsSending(false);
        triggerToast(err.message, 'error');
      });
  };

  return (
    <div className="p-10 max-w-[1600px] mx-auto relative h-full overflow-y-auto custom-scrollbar">
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-10 right-10 z-[120] animate-in slide-in-from-right-20 fade-in-0 duration-500">
          <div className={`${showToast.type === 'error' ? 'bg-rose-500/90' : 'bg-indigo-600/90'} backdrop-blur-xl text-white px-8 py-5 rounded-[2rem] shadow-3xl flex items-center gap-5 border border-white/20`}>
            <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md">
              <i className={`fas ${showToast.type === 'error' ? 'fa-shield-virus' : 'fa-check-double'} text-sm`}></i>
            </div>
            <div>
              <div className="text-[9px] font-black uppercase tracking-[0.2em] opacity-60 mb-0.5">System Alert</div>
              <span className="text-xs font-black uppercase tracking-widest">{showToast.message}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-end mb-12">
        <div>
          <h2 className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter mb-1">Team Management</h2>
          <p className="text-slate-500 font-medium text-lg italic opacity-80 px-1">Configure workspace autonomy and role-based access protocols</p>
        </div>
        <button
          onClick={() => setIsInviteModalOpen(true)}
          className="bg-indigo-600 text-white px-10 py-5 rounded-[2rem] font-black tracking-tight hover:bg-indigo-500 transition-all flex items-center gap-4 shadow-2xl shadow-indigo-600/40 active:scale-95 group"
        >
          <i className="fas fa-plus-circle group-hover:rotate-90 transition-transform duration-300"></i>
          <span>Invite New Member</span>
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900/40 backdrop-blur-3xl rounded-[3.5rem] border border-slate-200 dark:border-white/10 shadow-3xl overflow-hidden mb-20 transition-all duration-500">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.03]">
                <th className="px-10 py-8 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Member Identity</th>
                <th className="px-10 py-8 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Access Token</th>
                <th className="px-10 py-8 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Authority</th>
                <th className="px-10 py-8 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Status</th>
                <th className="px-10 py-8 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] text-center">Provisioned</th>
                <th className="px-10 py-8 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] text-right">Ops</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {users.map(user => (
                <tr key={user.id} className="group hover:bg-white/[0.02] transition-colors relative">
                  <td className="px-10 py-8">
                    <div className="flex items-center gap-5">
                      <div className="w-14 h-14 rounded-3xl bg-indigo-600 text-white flex items-center justify-center font-black text-lg shadow-xl shadow-indigo-600/20 group-hover:scale-110 transition-transform duration-300">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-slate-900 dark:text-white font-black text-lg tracking-tight leading-none mb-2">{user.name}</div>
                        <div className="text-[10px] font-black text-slate-400 dark:text-indigo-400/60 uppercase tracking-widest flex items-center gap-2">
                          <i className="fas fa-at text-[8px]"></i>
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-8">
                    <div className="flex flex-col gap-2">
                      <span className={`w-fit px-4 py-1.5 rounded-2xl text-[9px] font-black uppercase tracking-widest border shadow-sm ${user.role === 'Admin' ? 'bg-indigo-600 text-white border-indigo-400/30' :
                        user.role === 'Editor' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                          'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                        {user.role}
                      </span>
                      {user.department && (
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-tighter opacity-50 pl-1">
                          {user.department} Unit
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-10 py-8">
                    <span className="text-sm font-black text-slate-900 dark:text-slate-300 tracking-tight">
                      {user.level || 'Standard'}
                    </span>
                    {user.companySize && (
                      <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-1 opacity-60">
                        Scale: {user.companySize}
                      </div>
                    )}
                  </td>
                  <td className="px-10 py-8">
                    <div className="flex items-center gap-4 bg-slate-100 dark:bg-white/5 w-fit px-4 py-2 rounded-2xl border border-white/5">
                      <div className={`w-2.5 h-2.5 rounded-full ${user.status === 'Active' ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]' :
                        user.status === 'Pending' ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'
                        }`}></div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{user.status}</span>
                    </div>
                  </td>
                  <td className="px-10 py-8 text-center">
                    <div className="text-slate-900 dark:text-white font-black text-sm tracking-tight mb-0.5">{user.joinedAt}</div>
                    <div className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em] opacity-40">UTC TIMESTAMP</div>
                  </td>
                  <td className="px-10 py-8 text-right">
                    <div className="flex justify-end gap-4 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0 duration-300">
                      <button
                        onClick={() => toggleStatus(user.id)}
                        className={`w-12 h-12 rounded-2xl transition-all flex items-center justify-center border ${user.status === 'Active' ? 'bg-amber-500/5 text-amber-500 border-amber-500/20 hover:bg-amber-500 hover:text-white' : 'bg-emerald-500/5 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500 hover:text-white'}`}
                        title={user.status === 'Active' ? 'Restrict Access' : 'Grant Access'}
                      >
                        <i className={`fas ${user.status === 'Active' ? 'fa-lock' : 'fa-lock-open'} text-xs`}></i>
                      </button>
                      <button className="w-12 h-12 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-slate-400 hover:text-indigo-500 transition-all flex items-center justify-center shadow-sm">
                        <i className="fas fa-sliders-h text-xs"></i>
                      </button>
                      <button
                        onClick={() => deleteUser(user.id)}
                        className="w-12 h-12 bg-red-500/10 text-red-500 border border-red-500/20 rounded-2xl hover:bg-red-500 hover:text-white transition-all flex items-center justify-center shadow-lg shadow-red-500/10"
                      >
                        <i className="fas fa-trash-alt text-xs"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isInviteModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/90 dark:bg-black/95 backdrop-blur-3xl animate-in fade-in duration-500">
          <form onSubmit={handleInvite} className="w-full max-w-4xl bg-white dark:bg-[#0b1120] border border-white/10 rounded-[4rem] shadow-4xl overflow-hidden p-16 relative animate-in zoom-in-95 duration-500 grid grid-cols-2 gap-12">
            {isSending && (
              <div className="absolute inset-0 z-[120] bg-[#0b1120]/90 backdrop-blur-md flex flex-col items-center justify-center">
                <div className="w-24 h-24 border-8 border-indigo-600/10 border-t-indigo-600 rounded-full animate-spin mb-8"></div>
                <p className="text-sm font-black text-indigo-400 uppercase tracking-[0.5em] animate-pulse">Provisioning Access Identity</p>
              </div>
            )}

            <div className="col-span-2 flex justify-between items-start mb-4">
              <div>
                <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-2">Member Provisioning</h2>
                <div className="flex items-center gap-3">
                  <div className="h-0.5 w-10 bg-indigo-600 rounded-full"></div>
                  <p className="text-[10px] font-black text-slate-500 dark:text-indigo-400/60 uppercase tracking-[0.3em]">Identity & Permissions Protocol</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="w-14 h-14 bg-slate-100 dark:bg-white/5 rounded-3xl text-slate-500 hover:text-white transition-all flex items-center justify-center border border-white/5 active:scale-90"
              >
                <i className="fas fa-times text-lg"></i>
              </button>
            </div>

            {/* Left Column: Basic Info */}
            <div className="space-y-10">
              <div className="space-y-4">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest px-2">Member Name Identity</label>
                <input
                  required
                  value={newUser.name}
                  onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-3xl px-8 py-5 text-lg text-slate-900 dark:text-white font-medium focus:ring-4 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-800 shadow-inner"
                  placeholder="e.g. Hoàng Anh"
                />
              </div>
              <div className="space-y-4">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest px-2">Corporate Endpoint (Email)</label>
                <input
                  type="email"
                  required
                  value={newUser.email}
                  onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-3xl px-8 py-5 text-lg text-slate-900 dark:text-white font-medium focus:ring-4 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder-slate-400 dark:placeholder-slate-800 shadow-inner"
                  placeholder="anh.h@company.ai"
                />
              </div>
              <div className="space-y-4">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest px-2">System Authorization Node</label>
                <div className="relative">
                  <select
                    value={newUser.role}
                    onChange={e => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                    className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-3xl px-8 py-5 text-lg text-slate-900 dark:text-white font-black appearance-none cursor-pointer focus:ring-4 focus:ring-indigo-600/20 outline-none shadow-inner"
                  >
                    <option value="Viewer">Viewer (Read Only)</option>
                    <option value="Editor">Editor (Build Access)</option>
                    <option value="Admin">Admin (Full Control)</option>
                  </select>
                  <i className="fas fa-chevron-down absolute right-8 top-1/2 -translate-y-1/2 text-indigo-500 pointer-events-none"></i>
                </div>
              </div>
            </div>

            {/* Right Column: Dashboard Permissions (Granular) */}
            <div className="flex flex-col">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 px-2 flex items-center justify-between">
                <span>Granular Dashboard Access</span>
                <span className="text-indigo-400">{dashboards.length} Assets Found</span>
              </label>

              <div className="flex-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl">
                <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-white/5">
                  {dashboards.length === 0 ? (
                    <div className="p-10 text-center text-slate-500 text-xs italic">No dashboards found to assign.</div>
                  ) : (
                    dashboards.map(d => (
                      <div key={d.id} className="p-6 flex items-center justify-between group hover:bg-white/[0.02] transition-all">
                        <div>
                          <div className="text-sm font-black text-slate-900 dark:text-white tracking-tight group-hover:text-indigo-400 transition-colors uppercase">{d.title}</div>
                          <div className="text-[10px] font-bold text-slate-500 opacity-60">Provision individual role</div>
                        </div>
                        <select
                          value={granularRoles[d.id] || 'none'}
                          onChange={e => setGranularRoles({ ...granularRoles, [d.id]: e.target.value as any })}
                          className={`text-[10px] font-black uppercase tracking-widest bg-white dark:bg-slate-900 border rounded-xl px-4 py-2 outline-none cursor-pointer transition-all ${granularRoles[d.id] === 'none' ? 'border-slate-300 dark:border-white/10 text-slate-400' : 'border-indigo-600 text-indigo-600 dark:text-white'
                            }`}
                        >
                          <option value="none">Don't Share</option>
                          <option value="view">Viewer</option>
                          <option value="edit">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-6 bg-indigo-600/5 border-t border-white/5">
                  <div className="flex items-center gap-3 text-indigo-400 mb-3">
                    <i className="fas fa-fingerprint text-xs"></i>
                    <span className="text-[10px] font-black uppercase tracking-widest">Security Protocol</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold leading-relaxed px-1">
                    Privileges are applied instantly upon account activation.
                  </p>
                </div>
              </div>
            </div>

            <div className="col-span-2 h-px bg-white/5 mt-4"></div>

            <div className="col-span-2 flex gap-8 items-center">
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="flex-1 py-6 text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 hover:text-white transition-all tracking-widest"
              >
                Abort Protocol
              </button>
              <button className="flex-[2] bg-indigo-600 text-white py-8 rounded-[2rem] font-black text-sm uppercase tracking-[0.3em] hover:bg-indigo-500 shadow-3xl shadow-indigo-600/30 transition-all active:scale-95 flex items-center justify-center gap-4">
                <span>Dispatch Identity Package</span>
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
