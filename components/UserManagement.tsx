
import React, { useState } from 'react';
import { User, UserRole } from '../types';

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([
    { id: '1', name: 'Admin User', email: 'admin@360data-solutions.ai', role: 'Admin', status: 'Active', joinedAt: '2023-01-15' },
    { id: '2', name: 'Thành Đạt', email: 'dat@360data-solutions.ai', role: 'Editor', status: 'Active', joinedAt: '2023-05-20' },
    { id: '3', name: 'Minh Khôi', email: 'khoi@360data-solutions.ai', role: 'Viewer', status: 'Pending', joinedAt: '2023-11-22' },
  ]);

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showToast, setShowToast] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Viewer' as UserRole });

  const deleteUser = (id: string) => {
    setUsers(users.filter(u => u.id !== id));
  };

  const triggerToast = (message: string) => {
    setShowToast(message);
    setTimeout(() => setShowToast(null), 3000);
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);
    
    // Simulate SMTP dispatch
    setTimeout(() => {
      const user: User = {
        id: Date.now().toString(),
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        status: 'Pending',
        joinedAt: new Date().toISOString().split('T')[0]
      };
      setUsers([...users, user]);
      setIsSending(false);
      setIsInviteModalOpen(false);
      setNewUser({ name: '', email: '', role: 'Viewer' });
      triggerToast(`Invitation email dispatched to ${user.email}`);
    }, 1500);
  };

  const resendInvitation = (email: string) => {
    triggerToast(`Re-sending secure invitation to ${email}...`);
  };

  return (
    <div className="p-10 max-w-7xl mx-auto relative">
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-10 right-10 z-[100] animate-in slide-in-from-right-10 fade-in duration-300">
          <div className="bg-emerald-500 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4">
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
              <i className="fas fa-paper-plane text-xs"></i>
            </div>
            <span className="text-sm font-black uppercase tracking-widest">{showToast}</span>
          </div>
        </div>
      )}

      <div className="flex justify-between items-start mb-12">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tighter mb-2">Team Management</h2>
          <p className="text-slate-500 font-medium">Provision user access and define role-based permissions (RBAC)</p>
        </div>
        <button 
          onClick={() => setIsInviteModalOpen(true)}
          className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black tracking-tight hover:bg-indigo-500 transition-all flex items-center gap-3 shadow-xl shadow-indigo-600/20 active:scale-95"
        >
          <i className="fas fa-user-plus"></i> Invite Member
        </button>
      </div>

      <div className="bg-slate-900/50 backdrop-blur-md rounded-[2.5rem] border border-white/5 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest">User Details</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest">Access Role</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Joined</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {users.map(user => (
                <tr key={user.id} className="group hover:bg-white/[0.01] transition-colors">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-400 flex items-center justify-center font-black shadow-inner border border-white/5">
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-slate-200 font-bold text-sm">{user.name}</div>
                        <div className="text-[10px] font-black text-slate-600 uppercase tracking-widest mt-0.5">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border ${
                      user.role === 'Admin' ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500/20' :
                      user.role === 'Editor' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                      'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${
                        user.status === 'Active' ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' :
                        user.status === 'Pending' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
                      }`}></div>
                      <span className="text-xs font-black uppercase tracking-widest text-slate-400">{user.status}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-center">
                    <span className="text-slate-600 text-[10px] font-black uppercase tracking-widest">{user.joinedAt}</span>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex justify-end gap-3 opacity-40 group-hover:opacity-100 transition-opacity">
                      {user.status === 'Pending' && (
                        <button 
                          onClick={() => resendInvitation(user.email)}
                          className="w-10 h-10 bg-amber-500/10 rounded-xl text-amber-500 hover:bg-amber-500 hover:text-white transition-all flex items-center justify-center"
                          title="Resend Invitation Email"
                        >
                          <i className="fas fa-paper-plane text-xs"></i>
                        </button>
                      )}
                      <button className="w-10 h-10 bg-white/5 rounded-xl text-slate-500 hover:text-white transition-all flex items-center justify-center">
                        <i className="fas fa-pen text-xs"></i>
                      </button>
                      <button 
                        onClick={() => deleteUser(user.id)} 
                        className="w-10 h-10 bg-white/5 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-all flex items-center justify-center"
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
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
          <form onSubmit={handleInvite} className="w-full max-w-xl bg-[#0f172a] border border-white/10 rounded-[3rem] shadow-3xl overflow-hidden p-12 relative animate-in zoom-in-95 duration-300">
            {isSending && (
              <div className="absolute inset-0 z-10 bg-[#0f172a]/80 backdrop-blur-sm flex flex-col items-center justify-center">
                <div className="w-16 h-16 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin mb-6"></div>
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em]">Dispatching Secure Email...</p>
              </div>
            )}
            
            <div className="flex justify-between items-center mb-10">
              <div>
                <h2 className="text-3xl font-black text-white tracking-tight">Invite Member</h2>
                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mt-1 italic">Identity Provisioning Layer</p>
              </div>
              <button 
                type="button"
                onClick={() => setIsInviteModalOpen(false)} 
                className="w-12 h-12 bg-white/5 rounded-full text-slate-500 hover:text-white transition-all"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="space-y-8">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-2">Member Name</label>
                <input 
                  required
                  value={newUser.name}
                  onChange={e => setNewUser({...newUser, name: e.target.value})}
                  className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-800"
                  placeholder="e.g. Hoàng Anh"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-2">Corporate Email</label>
                <input 
                  type="email"
                  required
                  value={newUser.email}
                  onChange={e => setNewUser({...newUser, email: e.target.value})}
                  className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder-slate-800"
                  placeholder="anh.h@360data-solutions.ai"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-2">Authorization Level</label>
                <select 
                  value={newUser.role}
                  onChange={e => setNewUser({...newUser, role: e.target.value as UserRole})}
                  className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white focus:ring-2 focus:ring-indigo-600 outline-none appearance-none cursor-pointer"
                >
                  <option value="Viewer">Viewer (Read Analysis Only)</option>
                  <option value="Editor">Editor (Build & Save Reports)</option>
                  <option value="Admin">Admin (Full Infrastructure Control)</option>
                </select>
              </div>
            </div>

            <div className="mt-12 p-6 bg-indigo-600/5 border border-indigo-500/10 rounded-3xl">
              <div className="flex items-center gap-3 text-indigo-400 mb-2">
                <i className="fas fa-info-circle"></i>
                <span className="text-[10px] font-black uppercase tracking-widest">Email Notification</span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                An automated invitation email containing a secure access token will be sent immediately to the specified address.
              </p>
            </div>

            <div className="flex gap-4 mt-12">
              <button 
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="flex-1 py-5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button className="flex-[2] bg-indigo-600 text-white py-5 rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-indigo-500 shadow-2xl shadow-indigo-600/30 transition-all active:scale-95">
                Dispatch Invitation
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
