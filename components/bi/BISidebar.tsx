
import React, { useState } from 'react';
import { useLanguageStore } from '../../store/languageStore';
import { BIFolder, BIDashboard } from './types';
import DataSourcesPanel from './panels/DataSourcesPanel';
import FieldsListPanel from './panels/FieldsListPanel';
import { useDashboardStore } from './store/dashboardStore';
import { useDataStore } from './store/dataStore';
import { ShareModal } from './modals/ShareModal';
import { SharePermission, ShareSavePayload } from './types';
import {
    useDraggable,
    useDroppable,
} from '@dnd-kit/core';

interface BISidebarProps {
    folders: BIFolder[];
    dashboards: BIDashboard[];
    currentUserId: string;
    currentUserEmail?: string;
    currentUserGroup?: string;
    activeDashboardId: string | null;
    onSelectDashboard: (id: string) => void;
    onCreateFolder: (name: string, parentId?: string) => void;
    onCreateDashboard: (folderId?: string) => void;
    onReloadDataSource?: (id: string) => void;
    onStopDataSource?: (id: string) => void;
    onSelectDataSource?: (id: string) => void;
}

const DeleteConfirmationPopup: React.FC<{
    onConfirm: () => void;
    onCancel: () => void;
    title: string;
    position: { top: number, left: number };
}> = ({ onConfirm, onCancel, title, position }) => {
    const { t } = useLanguageStore();
    return (
        <>
            {/* Transparent backdrop for click-outside to close */}
            <div
                className="fixed inset-0 z-[9998] bg-transparent"
                onClick={onCancel}
            />
            <div
                className="fixed z-[9999] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-2xl p-4 w-64 animate-in fade-in zoom-in duration-200"
                style={{
                    top: `${Math.min(window.innerHeight - 150, position.top)}px`,
                    left: `${position.left + 20}px`
                }}
                onClick={e => e.stopPropagation()}
            >
                <div className="text-slate-900 dark:text-white text-xs font-bold mb-1">{t('bi.confirm_delete')}</div>
                <div className="text-slate-500 dark:text-slate-400 text-[10px] mb-4">{t('bi.delete_desc').replace('{title}', title)}</div>
                <div className="flex gap-2">
                    <button
                        onClick={onConfirm}
                        className="flex-1 bg-red-600 hover:bg-red-500 text-white text-[10px] font-black py-2 rounded-lg transition-colors"
                    >
                        {t('bi.delete_btn')}
                    </button>
                    <button
                        onClick={onCancel}
                        className="flex-1 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 text-[10px] font-black py-2 rounded-lg transition-colors"
                    >
                        {t('bi.cancel_btn')}
                    </button>
                </div>
            </div>
        </>
    );
};

type SidebarTab = 'dashboards' | 'data' | 'fields';

const DraggableDashboard: React.FC<{
    dashboard: BIDashboard;
    isActive: boolean;
    isEditing: boolean;
    editValue: string;
    onSelect: () => void;
    onEdit: (val: string) => void;
    onSave: () => void;
    onStartRename: () => void;
    onCancelRename: () => void;
    onDuplicate: () => void;
    depth: number;
    onDeleteRequest: (e: React.MouseEvent) => void;
    onShareRequest: (e: React.MouseEvent) => void;
    canEdit: boolean;
    canShare: boolean;
}> = ({ dashboard, isActive, isEditing, editValue, onSelect, onEdit, onSave, onDeleteRequest, onShareRequest, onStartRename, onCancelRename, onDuplicate, depth, canEdit, canShare }) => {
    const { t } = useLanguageStore();
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: dashboard.id,
        data: { type: 'dashboard', dashboard }
    });

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50
    } : undefined;

    return (
        <div
            ref={setNodeRef}
            style={{ ...style, paddingLeft: `${depth * 12 + 20}px` }}
            className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group transition-colors ${isDragging ? 'opacity-50 ring-2 ring-indigo-500/50' : ''} ${isActive ? 'bg-indigo-600/10 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'}`}
            onClick={onSelect}
        >
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400">
                <i className="fas fa-grip-vertical text-[10px]"></i>
            </div>
            <i className="fas fa-chart-line text-[10px]"></i>
            {isEditing ? (
                <input
                    autoFocus
                    className="bg-slate-50 dark:bg-slate-900 border border-indigo-500 rounded px-1 py-0 text-xs text-slate-900 dark:text-white outline-none flex-1"
                    value={editValue}
                    onChange={e => onEdit(e.target.value)}
                    onBlur={() => onSave()}
                    onKeyDown={e => {
                        if (e.key === 'Enter') onSave();
                        if (e.key === 'Escape') onCancelRename();
                    }}
                    onClick={e => e.stopPropagation()}
                />
            ) : (
                <span
                    className="text-xs truncate flex-1"
                    onDoubleClick={(e) => { e.stopPropagation(); onStartRename(); }}
                >
                    {dashboard.title}
                </span>
            )}
            {!isEditing && (
                <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                    {canEdit && (
                        <button onClick={(e) => { e.stopPropagation(); onStartRename(); }} className="text-[10px] hover:text-indigo-400 p-1">
                            <i className="fas fa-edit"></i>
                        </button>
                    )}
                    {canEdit && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                            className="text-[10px] hover:text-emerald-400 p-1"
                            title={t('bi.duplicate_dashboard')}
                        >
                            <i className="fas fa-copy"></i>
                        </button>
                    )}
                    {canShare && (
                        <button onClick={(e) => { e.stopPropagation(); onShareRequest(e); }} className="text-[10px] hover:text-blue-400 p-1" title="Share">
                            <i className="fas fa-share-alt"></i>
                        </button>
                    )}
                    {canEdit && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDeleteRequest(e); }}
                            className="text-[10px] hover:text-red-400 p-1"
                            title="Delete"
                        >
                            <i className="fas fa-trash"></i>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

const DroppableFolder: React.FC<{
    folder: BIFolder;
    depth: number;
    isOpen: boolean;
    isEditing: boolean;
    editValue: string;
    onToggle: () => void;
    onStartRename: () => void;
    onEdit: (val: string) => void;
    onSave: () => void;
    onDeleteRequest: (e: React.MouseEvent) => void;
    onShareRequest: (e: React.MouseEvent) => void;
    onCreateSub: (type: 'folder' | 'dashboard') => void;
    canEdit: boolean;
    canShare: boolean;
    children?: React.ReactNode;
}> = ({ folder, depth, isOpen, isEditing, editValue, onToggle, onStartRename, onEdit, onSave, onDeleteRequest, onShareRequest, onCreateSub, canEdit, canShare, children }) => {
    const { setNodeRef, isOver } = useDroppable({
        id: folder.id,
        data: { type: 'folder', folder }
    });

    const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
        id: folder.id,
        data: { type: 'folder', folder }
    });

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50
    } : undefined;

    return (
        <div ref={setNodeRef} className={`rounded transition-colors ${isOver ? 'bg-indigo-600/10 ring-2 ring-indigo-500/30' : ''}`}>
            <div
                ref={setDragRef}
                style={{ ...style, paddingLeft: `${depth * 12 + 8}px` }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group transition-colors ${isDragging ? 'opacity-50' : ''} ${isOpen ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'} hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white`}
                onClick={onToggle}
            >
                <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400">
                    <i className="fas fa-grip-vertical text-[10px]"></i>
                </div>
                <i className={`fas fa-chevron-right text-[10px] transition-transform ${isOpen ? 'rotate-90' : ''}`}></i>
                <i className={`fas ${isOpen ? 'fa-folder-open' : 'fa-folder'} text-yellow-500/80`}></i>

                {isEditing ? (
                    <input
                        autoFocus
                        className="bg-slate-50 dark:bg-slate-900 border border-indigo-500 rounded px-1 py-0 text-xs text-slate-900 dark:text-white outline-none flex-1"
                        value={editValue}
                        onChange={e => onEdit(e.target.value)}
                        onBlur={() => onSave()}
                        onKeyDown={e => {
                            if (e.key === 'Enter') onSave();
                        }}
                        onClick={e => e.stopPropagation()}
                    />
                ) : (
                    <span
                        className="text-xs font-bold truncate flex-1"
                        onDoubleClick={(e) => { e.stopPropagation(); onStartRename(); }}
                    >
                        {folder.name}
                    </span>
                )}

                {!isEditing && (
                    <div className="opacity-0 group-hover:opacity-100 flex gap-2 items-center">
                        <button
                            onClick={(e) => { e.stopPropagation(); onCreateSub('dashboard'); }}
                            className="text-[10px] hover:text-indigo-600 dark:hover:text-indigo-400 p-1 flex items-center gap-1 bg-slate-200 dark:bg-white/5 px-1.5 rounded"
                            title="New Dashboard in this folder"
                        >
                            <i className="fas fa-chart-bar"></i>
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onCreateSub('folder'); }}
                            className="text-[10px] hover:text-yellow-600 dark:hover:text-yellow-400 p-1 flex items-center gap-1 bg-slate-200 dark:bg-white/5 px-1.5 rounded"
                            title="New Subfolder"
                        >
                            <i className="fas fa-folder-plus"></i>
                        </button>
                        {canEdit && (
                            <button onClick={(e) => { e.stopPropagation(); onStartRename(); }} className="text-[10px] hover:text-indigo-400 p-1">
                                <i className="fas fa-edit"></i>
                            </button>
                        )}
                        {canShare && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onShareRequest(e); }}
                                className="text-[10px] hover:text-blue-600 dark:hover:text-blue-400 p-1 flex items-center gap-1 bg-slate-200 dark:bg-white/5 px-1.5 rounded"
                                title="Share Folder"
                            >
                                <i className="fas fa-share-alt"></i>
                            </button>
                        )}
                        {canEdit && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onDeleteRequest(e); }}
                                className="text-[10px] hover:text-red-400 p-1"
                                title="Delete"
                            >
                                <i className="fas fa-trash"></i>
                            </button>
                        )}
                    </div>
                )}
            </div>
            {isOpen && <div className="mt-0.5">{children}</div>}
        </div>
    );
};

const BISidebar: React.FC<BISidebarProps> = ({
    folders,
    dashboards,
    currentUserId,
    currentUserEmail,
    currentUserGroup,
    activeDashboardId,
    onSelectDashboard,
    onCreateFolder,
    onCreateDashboard,
    onReloadDataSource,
    onStopDataSource,
    onSelectDataSource,
}) => {
    const { t } = useLanguageStore();
    const { updateDashboard, deleteDashboard, updateFolder, deleteFolder, clearAll, shareFolder, shareDashboard, duplicateDashboard } = useDashboardStore();

    const [activeTab, setActiveTab] = useState<SidebarTab>('dashboards');
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [newFolderName, setNewFolderName] = useState('');
    const [isCreatingFolder, setIsCreatingFolder] = useState<string | null>(null);
    const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
    const [editingDashboardId, setEditingDashboardId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [deleteRequest, setDeleteRequest] = useState<{ id: string, type: 'folder' | 'dashboard', name: string, top: number, left: number } | null>(null);
    const [shareModalData, setShareModalData] = useState<{ isOpen: boolean; type: 'folder' | 'dashboard'; id: string; name: string; permissions: SharePermission[]; dashboard?: BIDashboard; folderDashboards?: BIDashboard[] } | null>(null);
    const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);

    const normalizeIdentity = (value?: string) => String(value || '').trim().toLowerCase();
    const permissionRank = (permission?: SharePermission['permission']) => {
        if (permission === 'admin') return 3;
        if (permission === 'edit') return 2;
        if (permission === 'view') return 1;
        return 0;
    };
    const isCurrentUser = (value?: string) => {
        const candidate = normalizeIdentity(value);
        if (!candidate) return false;
        return candidate === normalizeIdentity(currentUserId) || candidate === normalizeIdentity(currentUserEmail);
    };
    const shareMatchesCurrentUser = (share?: SharePermission) => {
        const targetType = normalizeIdentity(share?.targetType) === 'group' ? 'group' : 'user';
        const targetId = normalizeIdentity(share?.targetId || (targetType === 'group' ? share?.groupId : share?.userId));
        if (!targetId) return false;
        if (targetType === 'group') {
            return targetId === normalizeIdentity(currentUserGroup);
        }
        return isCurrentUser(targetId);
    };
    const getPermissionForCurrentUser = (sharedWith?: SharePermission[]) => {
        if (!Array.isArray(sharedWith)) return undefined;
        const matches = sharedWith.filter((share) => shareMatchesCurrentUser(share));
        if (matches.length === 0) return undefined;
        return [...matches].sort((a, b) => permissionRank(b.permission) - permissionRank(a.permission))[0]?.permission;
    };


    const renderFolderContent = (folder: BIFolder, depth = 0) => {
        const folderDashboards = dashboards.filter(d => d.folderId === folder.id);
        const subFolders = folders.filter(f => f.parentId === folder.id);
        const isOpen = expandedFolders.has(folder.id);
        const folderPermission = getPermissionForCurrentUser(folder.sharedWith) || ((isCurrentUser(folder.createdBy) || !folder.createdBy) ? 'admin' : 'view');
        const canEditFolder = folderPermission === 'admin' || folderPermission === 'edit';
        const canShareFolder = folderPermission === 'admin';

        return (
            <DroppableFolder
                key={folder.id}
                folder={folder}
                depth={depth}
                isOpen={isOpen}
                isEditing={editingFolderId === folder.id}
                editValue={editValue}
                canEdit={canEditFolder}
                canShare={canShareFolder}
                onToggle={() => {
                    const newSet = new Set(expandedFolders);
                    if (newSet.has(folder.id)) newSet.delete(folder.id);
                    else newSet.add(folder.id);
                    setExpandedFolders(newSet);
                }}
                onStartRename={() => { setEditingFolderId(folder.id); setEditValue(folder.name); }}
                onEdit={(val) => setEditValue(val)}
                onSave={() => { updateFolder(folder.id, { name: editValue }); setEditingFolderId(null); }}
                onDeleteRequest={(e) => {
                    setDeleteRequest({
                        id: folder.id,
                        type: 'folder',
                        name: folder.name,
                        top: e.clientY,
                        left: e.clientX
                    });
                }}
                onShareRequest={() => setShareModalData({ isOpen: true, type: 'folder', id: folder.id, name: folder.name, permissions: folder.sharedWith || [], folderDashboards: folderDashboards })}
                onCreateSub={(type) => {
                    if (type === 'dashboard') {
                        onCreateDashboard(folder.id);
                    } else {
                        setIsCreatingFolder(folder.id);
                    }
                    if (!isOpen) {
                        const ns = new Set(expandedFolders);
                        ns.add(folder.id);
                        setExpandedFolders(ns);
                    }
                }}
            >
                {subFolders.map(f => renderFolderContent(f, depth + 1))}
                {folderDashboards.map(d => (
                    <DraggableDashboard
                        key={d.id}
                        dashboard={d}
                        depth={depth}
                        isActive={activeDashboardId === d.id}
                        isEditing={editingDashboardId === d.id}
                        editValue={editValue}
                        onSelect={() => onSelectDashboard(d.id)}
                        onEdit={(val) => setEditValue(val)}
                        onSave={() => { updateDashboard(d.id, { title: editValue }); setEditingDashboardId(null); }}
                        onDuplicate={() => duplicateDashboard(d.id)}
                        onDeleteRequest={(e) => {
                            setDeleteRequest({
                                id: d.id,
                                type: 'dashboard',
                                name: d.title,
                                top: e.clientY,
                                left: e.clientX
                            });
                        }}
                onShareRequest={() => setShareModalData({ isOpen: true, type: 'dashboard', id: d.id, name: d.title, permissions: d.sharedWith || [], dashboard: d })}
                        onStartRename={() => { setEditingDashboardId(d.id); setEditValue(d.title); }}
                        onCancelRename={() => setEditingDashboardId(null)}
                        canEdit={getPermissionForCurrentUser(d.sharedWith) === 'admin' || getPermissionForCurrentUser(d.sharedWith) === 'edit' || isCurrentUser(d.createdBy)}
                        canShare={getPermissionForCurrentUser(d.sharedWith) === 'admin' || isCurrentUser(d.createdBy)}
                    />
                ))}
                {isCreatingFolder === folder.id && (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (newFolderName.trim()) {
                                onCreateFolder(newFolderName, folder.id);
                                setNewFolderName('');
                                setIsCreatingFolder(null);
                            }
                        }}
                        className="my-1 px-4"
                        style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
                    >
                        <input
                            autoFocus
                            className="w-full bg-slate-900 border border-indigo-500/50 rounded px-2 py-0.5 text-xs text-white outline-none"
                            placeholder="Folder name..."
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            onBlur={() => !newFolderName && setIsCreatingFolder(null)}
                        />
                    </form>
                )}
            </DroppableFolder>
        );
    };

    const rootFolders = folders.filter(f => !f.parentId);
    const unfiledDashboards = dashboards.filter(d => !d.folderId);

    return (
        <div className="w-full bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-white/5 flex flex-col h-full overflow-hidden">
            <div className="border-b border-slate-200 dark:border-white/5 flex bg-white dark:bg-slate-900/30 shrink-0 overflow-x-auto no-scrollbar">
                <button onClick={() => setActiveTab('dashboards')} className={`flex-1 min-w-[80px] px-3 py-3 text-[10px] font-black uppercase tracking-widest transition-colors ${activeTab === 'dashboards' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-600/10' : 'text-slate-500 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                    {t('bi.workspace')}
                </button>
                <button onClick={() => setActiveTab('data')} className={`flex-1 min-w-[80px] px-3 py-3 text-[10px] font-black uppercase tracking-widest transition-colors ${activeTab === 'data' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-600/10' : 'text-slate-500 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                    DATA
                </button>
                <button onClick={() => setActiveTab('fields')} className={`flex-1 min-w-[60px] px-2 py-3 text-[10px] font-black uppercase tracking-widest transition-colors ${activeTab === 'fields' ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-600/10' : 'text-slate-500 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                    {t('bi.fields')}
                </button>
            </div>

            <div className="flex-1 overflow-hidden">
                {activeTab === 'dashboards' && (
                    <div className="h-full flex flex-col">
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/5 flex items-center justify-between bg-slate-100 dark:bg-white/[0.02] shrink-0">
                            <h3 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[2px] truncate flex-1 min-w-0 mr-2">
                                {t('bi.dashboards_title')}
                            </h3>
                            <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                    onClick={() => setIsCreatingFolder('root')}
                                    onMouseEnter={() => setHoveredTooltip('folder')}
                                    onMouseLeave={() => setHoveredTooltip(null)}
                                    className="relative group p-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10 transition-all duration-200"
                                >
                                    <i className="fas fa-folder-plus text-xs"></i>
                                    {/* Floating Tooltip - Positioned Bottom to avoid clipping */}
                                    <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-[9px] font-black uppercase tracking-tighter rounded shadow-2xl transition-all duration-200 z-[100] whitespace-nowrap backdrop-blur-md pointer-events-none ${hoveredTooltip === 'folder' ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
                                        {t('bi.new_folder')}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-white dark:border-b-slate-800"></div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => onCreateDashboard()}
                                    onMouseEnter={() => setHoveredTooltip('dashboard')}
                                    onMouseLeave={() => setHoveredTooltip(null)}
                                    className="relative group p-2 rounded-lg text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10 transition-all duration-200"
                                >
                                    <i className="fas fa-chart-line text-xs"></i>
                                    {/* Floating Tooltip - Positioned Bottom to avoid clipping */}
                                    <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-[9px] font-black uppercase tracking-tighter rounded shadow-2xl transition-all duration-200 z-[100] whitespace-nowrap backdrop-blur-md pointer-events-none ${hoveredTooltip === 'dashboard' ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
                                        {t('bi.new_dashboard')}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-white dark:border-b-slate-800"></div>
                                    </div>
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar pt-2 pb-10">
                            {isCreatingFolder === 'root' && (
                                <form onSubmit={(e) => { e.preventDefault(); if (newFolderName.trim()) { onCreateFolder(newFolderName); setNewFolderName(''); setIsCreatingFolder(null); } }} className="px-4 mb-2">
                                    <input autoFocus className="w-full bg-white dark:bg-slate-900 border border-indigo-500/50 rounded px-2 py-1 text-xs text-slate-900 dark:text-white outline-none" placeholder={t('bi.folder_name_placeholder')} value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onBlur={() => !newFolderName && setIsCreatingFolder(null)} />
                                </form>
                            )}

                            <div className="space-y-0.5">
                                {rootFolders.map(folder => renderFolderContent(folder))}
                            </div>

                            <WorkspaceRootDroppable>
                                {unfiledDashboards.length > 0 && (
                                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5">
                                        <div className="px-4 py-1 mb-1 text-[10px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest">{t('bi.unfiled')}</div>
                                        {unfiledDashboards.map(d => (
                                            <DraggableDashboard
                                                key={d.id}
                                                dashboard={d}
                                                depth={-1}
                                                isActive={activeDashboardId === d.id}
                                                isEditing={editingDashboardId === d.id}
                                                editValue={editValue}
                                                onSelect={() => onSelectDashboard(d.id)}
                                                onEdit={(val) => setEditValue(val)}
                                                onSave={() => { updateDashboard(d.id, { title: editValue }); setEditingDashboardId(null); }}
                                                onDuplicate={() => duplicateDashboard(d.id)}
                                                onDeleteRequest={(e) => {
                                                    setDeleteRequest({
                                                        id: d.id,
                                                        type: 'dashboard',
                                                        name: d.title,
                                                        top: e.clientY,
                                                        left: e.clientX
                                                    });
                                                }}
                                                onShareRequest={() => setShareModalData({ isOpen: true, type: 'dashboard', id: d.id, name: d.title, permissions: d.sharedWith || [], dashboard: d })}
                                                onStartRename={() => { setEditingDashboardId(d.id); setEditValue(d.title); }}
                                                onCancelRename={() => setEditingDashboardId(null)}
                                                canEdit={getPermissionForCurrentUser(d.sharedWith) === 'admin' || getPermissionForCurrentUser(d.sharedWith) === 'edit' || isCurrentUser(d.createdBy)}
                                                canShare={getPermissionForCurrentUser(d.sharedWith) === 'admin' || isCurrentUser(d.createdBy)}
                                            />
                                        ))}
                                    </div>
                                )}
                            </WorkspaceRootDroppable>
                        </div>
                    </div>
                )}

                {activeTab === 'data' && <DataSourcesPanel onSelectDataSource={onSelectDataSource} onReloadDataSource={onReloadDataSource} onStopDataSource={onStopDataSource} />}
                {activeTab === 'fields' && <FieldsListPanel />}
            </div>

            {deleteRequest && (
                <DeleteConfirmationPopup
                    title={deleteRequest.name}
                    position={{ top: deleteRequest.top, left: deleteRequest.left }}
                    onCancel={() => setDeleteRequest(null)}
                    onConfirm={() => {
                        if (deleteRequest.type === 'folder') {
                            deleteFolder(deleteRequest.id);
                        } else {
                            deleteDashboard(deleteRequest.id);
                        }
                        setDeleteRequest(null);
                    }}
                />
            )}

            {shareModalData && (
                <ShareModal
                    isOpen={shareModalData.isOpen}
                    onClose={() => setShareModalData(null)}
                    itemType={shareModalData.type}
                    title={shareModalData.name}
                    permissions={shareModalData.permissions}
                    dashboard={shareModalData.dashboard}
                    folderDashboards={shareModalData.folderDashboards}
                    onSave={(target, payload: ShareSavePayload) => {
                        const now = new Date().toISOString();
                        const { roles, dashboardRLS } = payload;
                        const targetType = target.targetType === 'group' ? 'group' : 'user';
                        const targetId = String(target.targetId || '').trim();
                        const targetKey = `${targetType}:${targetId.toLowerCase()}`;
                        const permissionTargetKey = (perm: SharePermission) => {
                            const permType = String(perm?.targetType || '').trim().toLowerCase() === 'group' ? 'group' : 'user';
                            const permId = String(perm?.targetId || (permType === 'group' ? perm?.groupId : perm?.userId) || '').trim();
                            return `${permType}:${permId.toLowerCase()}`;
                        };

                        // 1. Handle Folder-level permission
                        if (shareModalData.type === 'folder') {
                            const folderRole = roles['folder'];
                            const folder = folders.find(f => f.id === shareModalData.id);
                            if (folder) {
                                let newPerms = [...(folder.sharedWith || [])].filter((p) => permissionTargetKey(p) !== targetKey);
                                if (folderRole !== 'none') {
                                    newPerms.push({
                                        targetType,
                                        targetId,
                                        userId: targetType === 'user' ? targetId : undefined,
                                        groupId: targetType === 'group' ? targetId : undefined,
                                        permission: folderRole,
                                        sharedAt: now
                                    });
                                }
                                shareFolder(folder.id, newPerms);
                            }
                        }

                        // 2. Handle Dashboard-level permissions
                        Object.entries(roles).forEach(([key, role]) => {
                            if (key === 'folder') return; // Handled above

                            // Determine target dashboard ID
                            const targetDashboardId = key === 'dashboard' ? shareModalData.id : key;
                            const dashboard = dashboards.find(d => d.id === targetDashboardId);

                            if (dashboard) {
                                let newPerms = [...(dashboard.sharedWith || [])].filter((p) => permissionTargetKey(p) !== targetKey);
                                if (role !== 'none') {
                                    const rlsCfg = dashboardRLS[dashboard.id];
                                    newPerms.push({
                                        targetType,
                                        targetId,
                                        userId: targetType === 'user' ? targetId : undefined,
                                        groupId: targetType === 'group' ? targetId : undefined,
                                        permission: role,
                                        sharedAt: now,
                                        allowedPageIds: rlsCfg?.allowedPageIds || [],
                                        rls: rlsCfg || { allowedPageIds: [], rules: [] },
                                    });
                                }
                                shareDashboard(dashboard.id, newPerms);
                            }
                        });
                    }}
                />
            )}
        </div>
    );
};

const WorkspaceRootDroppable: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { setNodeRef, isOver } = useDroppable({ id: 'workspace-root', data: { type: 'workspace-root' } });
    return (
        <div ref={setNodeRef} className={`min-h-[50px] transition-colors ${isOver ? 'bg-indigo-600/5' : ''}`}>
            {children}
            {isOver && <div className="text-[10px] text-indigo-400 text-center py-2 italic font-bold">Move to root</div>}
        </div>
    );
};

export default BISidebar;
