import React, { useState, useEffect } from 'react';
import { SharePermission, BIDashboard } from '../types';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    itemType: 'dashboard' | 'folder';
    permissions: SharePermission[];
    folderDashboards?: BIDashboard[];
    onSave: (permissions: SharePermission[], selectedDashboardIds?: string[]) => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, title, itemType, permissions, folderDashboards, onSave }) => {
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<'view' | 'edit' | 'admin'>('view');
    const [currentPermissions, setCurrentPermissions] = useState<SharePermission[]>(permissions || []);
    const [selectedDashboardIds, setSelectedDashboardIds] = useState<Set<string>>(new Set());

    // Initialize selected dashboards to all when opening (optional, or none)
    // User requested: "Choose which dashboards to share". 
    // Usually better to start empty or all? Let's start with ALL because usually you share a folder to share its content.
    useEffect(() => {
        if (folderDashboards) {
            setSelectedDashboardIds(new Set(folderDashboards.map(d => d.id)));
        }
    }, [folderDashboards, isOpen]);

    if (!isOpen) return null;

    const handleAddUser = () => {
        if (!email.trim()) return;
        // Check if exists
        const exists = currentPermissions.find(p => p.userId === email);
        if (exists) {
            setCurrentPermissions(prev => prev.map(p => p.userId === email ? { ...p, permission: role } : p));
        } else {
            setCurrentPermissions(prev => [
                ...prev,
                { userId: email, permission: role, sharedAt: new Date().toISOString() }
            ]);
        }
        setEmail('');
    };

    const handleRemoveUser = (userId: string) => {
        setCurrentPermissions(prev => prev.filter(p => p.userId !== userId));
    };

    const handleSave = () => {
        onSave(currentPermissions, Array.from(selectedDashboardIds));
        onClose();
    };

    const toggleDashboard = (id: string) => {
        const newSet = new Set(selectedDashboardIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedDashboardIds(newSet);
    };

    const toggleAll = () => {
        if (!folderDashboards) return;
        if (selectedDashboardIds.size === folderDashboards.length) {
            setSelectedDashboardIds(new Set());
        } else {
            setSelectedDashboardIds(new Set(folderDashboards.map(d => d.id)));
        }
    };

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl w-[600px] shadow-2xl animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col max-h-[80vh]"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-white/10 shrink-0">
                    <h2 className="text-slate-900 dark:text-white font-black text-lg tracking-tight">Share {itemType === 'dashboard' ? 'Dashboard' : 'Folder'}: {title}</h2>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    <div className="flex gap-2 mb-6">
                        <input
                            type="text"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="Enter user email or ID..."
                            onKeyDown={e => e.key === 'Enter' && handleAddUser()}
                            className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all placeholder-slate-400 dark:placeholder-slate-600"
                        />
                        <select
                            value={role}
                            onChange={e => setRole(e.target.value as any)}
                            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white text-sm outline-none focus:border-indigo-500 cursor-pointer transition-all"
                        >
                            <option value="view">Viewer</option>
                            <option value="edit">Editor</option>
                            <option value="admin">Admin</option>
                        </select>
                        <button
                            onClick={handleAddUser}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white font-black px-6 rounded-xl transition-all text-xs uppercase tracking-widest shadow-lg shadow-indigo-600/20"
                        >
                            Invite
                        </button>
                    </div>

                    {itemType === 'folder' && folderDashboards && folderDashboards.length > 0 && (
                        <div className="mb-6 bg-slate-50 dark:bg-white/5 rounded-2xl p-4 border border-slate-100 dark:border-white/10">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                                    Include Dashboards
                                </h3>
                                <button
                                    onClick={toggleAll}
                                    className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                    {selectedDashboardIds.size === folderDashboards.length ? 'Deselect All' : 'Select All'}
                                </button>
                            </div>
                            <div className="space-y-2 max-h-[150px] overflow-y-auto pr-2 custom-scrollbar">
                                {folderDashboards.map(d => (
                                    <label key={d.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer transition-colors group">
                                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selectedDashboardIds.has(d.id) ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 dark:border-slate-600 group-hover:border-indigo-500'}`}>
                                            {selectedDashboardIds.has(d.id) && <i className="fas fa-check text-white text-[10px]"></i>}
                                        </div>
                                        <input
                                            type="checkbox"
                                            className="hidden"
                                            checked={selectedDashboardIds.has(d.id)}
                                            onChange={() => toggleDashboard(d.id)}
                                        />
                                        <span className={`text-xs font-medium transition-colors ${selectedDashboardIds.has(d.id) ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                                            {d.title}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">
                            Access List
                        </h3>
                        <div className="max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                            {currentPermissions.length === 0 ? (
                                <div className="text-center py-8 text-slate-500 text-sm">
                                    Not shared with anyone yet.
                                </div>
                            ) : (
                                currentPermissions.map(perm => (
                                    <div key={perm.userId} className="flex items-center justify-between bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl p-4 mb-2 transition-all hover:border-indigo-500/30 shadow-sm">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-black text-xs border border-indigo-500/20">
                                                {perm.userId.substring(0, 2).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="text-slate-900 dark:text-white text-sm font-bold tracking-tight">{perm.userId}</div>
                                                <div className="text-slate-400 dark:text-slate-500 text-[9px] font-black uppercase tracking-widest">Shared {new Date(perm.sharedAt).toLocaleDateString()}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <select
                                                value={perm.permission}
                                                onChange={e => {
                                                    const newRole = e.target.value as any;
                                                    setCurrentPermissions(prev => prev.map(p => p.userId === perm.userId ? { ...p, permission: newRole } : p));
                                                }}
                                                className="bg-transparent text-slate-600 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest outline-none cursor-pointer hover:text-indigo-600 dark:hover:text-white transition-colors"
                                            >
                                                <option value="view" className="bg-white dark:bg-slate-800">Viewer</option>
                                                <option value="edit" className="bg-white dark:bg-slate-800">Editor</option>
                                                <option value="admin" className="bg-white dark:bg-slate-800">Admin</option>
                                            </select>
                                            <button
                                                onClick={() => handleRemoveUser(perm.userId)}
                                                className="w-8 h-8 flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors bg-white dark:bg-white/5 rounded-xl border border-slate-100 dark:border-white/5"
                                            >
                                                <i className="fas fa-trash-alt text-[10px]"></i>
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-slate-100 dark:border-white/10 flex justify-end gap-3 bg-slate-50 dark:bg-white/[0.02] shrink-0">
                    <button
                        onClick={onClose}
                        className="px-6 py-3 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all text-[10px] font-black uppercase tracking-widest"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-8 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl shadow-indigo-600/30 transition-all font-black text-[10px] uppercase tracking-widest active:scale-95"
                    >
                        Save Permissions
                    </button>
                </div>
            </div>
        </div>
    );
};
