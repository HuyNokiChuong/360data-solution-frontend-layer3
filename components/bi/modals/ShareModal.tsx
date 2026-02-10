import React, { useState, useEffect } from 'react';
import { SharePermission, BIDashboard } from '../types';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    itemType: 'dashboard' | 'folder';
    permissions: SharePermission[];
    folderDashboards?: BIDashboard[];
    onSave: (email: string, roles: Record<string, SharePermission['permission'] | 'none'>) => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, title, itemType, permissions, folderDashboards, onSave }) => {
    const [email, setEmail] = useState('');
    const [granularRoles, setGranularRoles] = useState<Record<string, SharePermission['permission'] | 'none'>>({});
    const [currentPermissions, setCurrentPermissions] = useState<SharePermission[]>(permissions || []);

    // Initialize granular roles
    useEffect(() => {
        if (isOpen) {
            const initialRoles: Record<string, SharePermission['permission'] | 'none'> = {};
            if (itemType === 'folder' && folderDashboards) {
                // Default all to 'none' (Don't Share) - users must explicitly grant permissions
                folderDashboards.forEach(d => {
                    initialRoles[d.id] = 'none';
                });
                // Also handle the folder itself (using 'folder' as key)
                initialRoles['folder'] = 'none';
            } else {
                initialRoles['dashboard'] = 'none';
            }
            setGranularRoles(initialRoles);
        }
    }, [isOpen, itemType, folderDashboards]);

    if (!isOpen) return null;

    const handleRoleChange = (id: string, role: SharePermission['permission'] | 'none') => {
        setGranularRoles(prev => ({ ...prev, [id]: role }));
    };

    const handleSave = () => {
        if (!email.trim() || !email.includes('@')) {
            alert("Please enter a valid corporate email.");
            return;
        }

        // Construct permissions list to pass back
        // For 'folder' itemType, we need to pass which dashboard gets what perms
        // But the onSave signature is (permissions, selectedDashboardIds)
        // We'll adapt: if granular Roles are all the same, use standard flow.
        // If different, we might need to call onSave multiple times or enhance it.

        // Let's assume onSave can handle a mapping or we call it per dashboard.
        // Actually, let's keep it simple: 
        // 1. Apply folder permission if applicable
        // 2. Apply each dashboard permission individually

        // We'll pass the granularRoles back as a special case or just fix the parent.
        // For now, let's pass a special 'granularMapping' in the permissions array or similar? No.

        // BETTER: I will update the BISidebar and DashboardToolbar to handle the granular mapping.
        // I'll change the onSave signature to take the role mapping.

        (onSave as any)(email, granularRoles);
        onClose();
        setEmail('');
    };

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-300"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-[2.5rem] w-[640px] shadow-3xl animate-in zoom-in-95 duration-300 overflow-hidden flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-10 pb-6 border-b border-white/5 shrink-0">
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Share Access</h2>
                        <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1 italic">Identity & Permission Provisioning</p>
                    </div>
                    <button onClick={onClose} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all hover:scale-110 active:scale-95">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="p-10 flex-1 overflow-y-auto custom-scrollbar space-y-10">
                    {/* Step 1: Email */}
                    <div className="space-y-4">
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                            <i className="fas fa-envelope text-indigo-500"></i>
                            User Email Address
                        </label>
                        <input
                            autoFocus
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="collaborator@yourcompany.com"
                            className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-6 py-5 text-lg font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 transition-all placeholder-slate-400 dark:placeholder-slate-800 shadow-inner"
                        />
                    </div>

                    {/* Step 2: Granular List */}
                    <div className="space-y-4">
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                            <i className="fas fa-shield-alt text-indigo-500"></i>
                            Define Workspace Permissions
                        </label>

                        <div className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-3xl overflow-hidden shadow-2xl">
                            {/* List Header */}
                            <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-slate-100 dark:bg-white/[0.03] border-b border-white/5 font-black text-[9px] text-slate-400 uppercase tracking-widest">
                                <div className="col-span-12">Resource Name & Purpose</div>
                            </div>

                            <div className="divide-y divide-white/5 max-h-[350px] overflow-y-auto custom-scrollbar">
                                {/* Folder itself if applicable */}
                                {itemType === 'folder' && (
                                    <div className="grid grid-cols-12 gap-4 px-6 py-5 hover:bg-white/[0.02] transition-colors items-center group">
                                        <div className="col-span-7 flex items-center gap-4">
                                            <div className="w-10 h-10 bg-yellow-500/10 text-yellow-500 rounded-xl flex items-center justify-center text-sm shadow-inner group-hover:scale-110 transition-transform">
                                                <i className="fas fa-folder"></i>
                                            </div>
                                            <div>
                                                <div className="text-sm font-black text-slate-900 dark:text-white tracking-tight">{title} <span className="text-[10px] text-slate-500 uppercase ml-2">(Folder)</span></div>
                                                <div className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">Container & Organizational Access</div>
                                            </div>
                                        </div>
                                        <div className="col-span-5 flex justify-end">
                                            <select
                                                value={granularRoles['folder']}
                                                onChange={e => handleRoleChange('folder', e.target.value as any)}
                                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 dark:text-white outline-none cursor-pointer focus:border-indigo-600 appearance-none shadow-sm min-w-[100px] text-center"
                                            >
                                                <option value="none">Don't Share</option>
                                                <option value="view">Viewer</option>
                                                <option value="edit">Editor</option>
                                                <option value="admin">Admin</option>
                                            </select>
                                        </div>
                                    </div>
                                )}

                                {/* Dashboards */}
                                {itemType === 'dashboard' ? (
                                    <div className="grid grid-cols-12 gap-4 px-6 py-5 hover:bg-white/[0.02] transition-colors items-center group">
                                        <div className="col-span-7 flex items-center gap-4">
                                            <div className="w-10 h-10 bg-indigo-500/10 text-indigo-400 rounded-xl flex items-center justify-center text-sm shadow-inner group-hover:scale-110 transition-transform">
                                                <i className="fas fa-chart-line"></i>
                                            </div>
                                            <div>
                                                <div className="text-sm font-black text-slate-900 dark:text-white tracking-tight">{title}</div>
                                                <div className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">Primary Dashboard Asset</div>
                                            </div>
                                        </div>
                                        <div className="col-span-5 flex justify-end">
                                            <select
                                                value={granularRoles['dashboard']}
                                                onChange={e => handleRoleChange('dashboard', e.target.value as any)}
                                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 dark:text-white outline-none cursor-pointer focus:border-indigo-600 appearance-none shadow-sm min-w-[100px] text-center"
                                            >
                                                <option value="none">Don't Share</option>
                                                <option value="view">Viewer</option>
                                                <option value="edit">Editor</option>
                                                <option value="admin">Admin</option>
                                            </select>
                                        </div>
                                    </div>
                                ) : (
                                    folderDashboards?.map(dashboard => (
                                        <div key={dashboard.id} className="grid grid-cols-12 gap-4 px-6 py-5 hover:bg-white/[0.02] transition-colors items-center group">
                                            <div className="col-span-7 flex items-center gap-4">
                                                <div className="w-10 h-10 bg-indigo-500/5 text-slate-400 group-hover:text-indigo-400 rounded-xl flex items-center justify-center text-sm shadow-inner transition-all">
                                                    <i className="fas fa-chart-bar"></i>
                                                </div>
                                                <div>
                                                    <div className="text-sm font-bold text-slate-700 dark:text-slate-300 group-hover:text-white transition-colors">{dashboard.title}</div>
                                                    <div className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">Report Resource</div>
                                                </div>
                                            </div>
                                            <div className="col-span-5 flex justify-end">
                                                <select
                                                    value={granularRoles[dashboard.id] || 'none'}
                                                    onChange={e => handleRoleChange(dashboard.id, e.target.value as any)}
                                                    className={`border rounded-xl px-4 py-2 text-xs font-bold outline-none cursor-pointer appearance-none shadow-sm min-w-[100px] text-center transition-all ${granularRoles[dashboard.id] === 'none'
                                                        ? 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/5 text-slate-400'
                                                        : 'bg-white dark:bg-slate-900 border-indigo-500/50 text-indigo-500 dark:text-white'
                                                        }`}
                                                >
                                                    <option value="none">Don't Share</option>
                                                    <option value="view">Viewer</option>
                                                    <option value="edit">Editor</option>
                                                    <option value="admin">Admin</option>
                                                </select>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-10 border-t border-white/5 bg-slate-50/50 dark:bg-white/[0.01] shrink-0 flex justify-end gap-5">
                    <button
                        onClick={onClose}
                        className="px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-10 py-5 rounded-[1.5rem] bg-indigo-600 hover:bg-indigo-500 text-white shadow-2xl shadow-indigo-600/30 transition-all font-black text-xs uppercase tracking-widest active:scale-95 flex items-center gap-3"
                    >
                        <span>Confirm & Save Access</span>
                        <i className="fas fa-paper-plane text-[10px] opacity-50"></i>
                    </button>
                </div>
            </div>
        </div>
    );
};
