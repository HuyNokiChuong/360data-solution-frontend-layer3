import React, { useState } from 'react';
import { SharePermission } from '../types';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    itemType: 'dashboard' | 'folder';
    permissions: SharePermission[];
    onSave: (permissions: SharePermission[]) => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, title, itemType, permissions, onSave }) => {
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<'view' | 'edit' | 'admin'>('view');
    const [currentPermissions, setCurrentPermissions] = useState<SharePermission[]>(permissions || []);

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
        onSave(currentPermissions);
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="bg-slate-900 border border-white/10 rounded-xl w-[500px] shadow-2xl animate-in fade-in zoom-in duration-200"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <h2 className="text-white font-bold text-lg">Share {itemType === 'dashboard' ? 'Dashboard' : 'Folder'}: {title}</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="p-4">
                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="Enter user email or ID..."
                            onKeyDown={e => e.key === 'Enter' && handleAddUser()}
                            className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-indigo-500 transition-colors"
                        />
                        <select
                            value={role}
                            onChange={e => setRole(e.target.value as any)}
                            className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-indigo-500 cursor-pointer"
                        >
                            <option value="view">Viewer</option>
                            <option value="edit">Editor</option>
                            <option value="admin">Admin</option>
                        </select>
                        <button
                            onClick={handleAddUser}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 rounded-lg transition-colors text-sm"
                        >
                            Invite
                        </button>
                    </div>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {currentPermissions.length === 0 ? (
                            <div className="text-center py-8 text-slate-500 text-sm">
                                Not shared with anyone yet.
                            </div>
                        ) : (
                            currentPermissions.map(perm => (
                                <div key={perm.userId} className="flex items-center justify-between bg-white/5 rounded-lg p-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs border border-indigo-500/30">
                                            {perm.userId.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="text-white text-sm font-medium">{perm.userId}</div>
                                            <div className="text-slate-400 text-[10px]">Shared {new Date(perm.sharedAt).toLocaleDateString()}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <select
                                            value={perm.permission}
                                            onChange={e => {
                                                const newRole = e.target.value as any;
                                                setCurrentPermissions(prev => prev.map(p => p.userId === perm.userId ? { ...p, permission: newRole } : p));
                                            }}
                                            className="bg-transparent text-slate-300 text-xs outline-none cursor-pointer hover:text-white"
                                        >
                                            <option value="view" className="bg-slate-800">Viewer</option>
                                            <option value="edit" className="bg-slate-800">Editor</option>
                                            <option value="admin" className="bg-slate-800">Admin</option>
                                        </select>
                                        <button
                                            onClick={() => handleRemoveUser(perm.userId)}
                                            className="text-slate-500 hover:text-red-400 transition-colors"
                                        >
                                            <i className="fas fa-trash-alt"></i>
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-white/10 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 transition-all font-bold text-sm"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};
