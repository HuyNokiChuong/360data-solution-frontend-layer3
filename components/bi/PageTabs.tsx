// ============================================
// Page Tabs - Dashboard Page Navigation
// ============================================

import React, { useState } from 'react';
import { BIDashboard, DashboardPage } from './types';
import { useDashboardStore } from './store/dashboardStore';
import { useLanguageStore } from '../../store/languageStore';

interface PageTabsProps {
    dashboard: BIDashboard;
}

const DeleteConfirmationPopup: React.FC<{
    onConfirm: () => void;
    onCancel: () => void;
    title: string;
    position: { left: number };
}> = ({ onConfirm, onCancel, title, position }) => {
    const { t } = useLanguageStore();
    return (
        <div
            className="fixed z-[9999] bg-slate-900 border border-white/10 rounded-xl shadow-2xl p-4 w-64 animate-in fade-in zoom-in duration-200"
            style={{
                bottom: '60px',
                left: `${position.left}px`,
                transform: 'translateX(-50%)'
            }}
            onClick={e => e.stopPropagation()}
        >
            <div className="text-white text-xs font-bold mb-1">{t('bi.confirm_delete')}</div>
            <div className="text-slate-400 text-[10px] mb-4">{t('bi.delete_page_desc').replace('{title}', title)}</div>
            <div className="flex gap-2">
                <button
                    onClick={onConfirm}
                    className="flex-1 bg-red-600 hover:bg-red-500 text-white text-[10px] font-black py-2 rounded-lg transition-colors"
                >
                    {t('bi.delete_btn')}
                </button>
                <button
                    onClick={onCancel}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-black py-2 rounded-lg transition-colors"
                >
                    {t('bi.cancel_btn')}
                </button>
            </div>
        </div>
    );
};

const PageTabs: React.FC<PageTabsProps> = ({ dashboard }) => {
    const { t } = useLanguageStore();
    const { addPage, setActivePage, deletePage, updatePage, duplicatePage } = useDashboardStore();
    const [editingPageId, setEditingPageId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, pageId: string, pageTitle: string } | null>(null);
    const [deleteRequest, setDeleteRequest] = useState<{ id: string, title: string, left: number } | null>(null);

    const handleAddPage = () => {
        addPage(dashboard.id, `Page ${dashboard.pages.length + 1}`);
    };

    const handleRename = (id: string, currentTitle: string) => {
        setEditingPageId(id);
        setEditValue(currentTitle);
        setContextMenu(null);
    };

    const submitRename = (pageId: string) => {
        if (editValue.trim()) {
            updatePage(dashboard.id, pageId, { title: editValue.trim() });
        }
        setEditingPageId(null);
    };

    // Close context menu on click outside
    React.useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    return (
        <div className="flex items-center gap-1 bg-slate-900 border-t border-white/5 px-4 h-10 select-none relative">
            <div className="flex items-center overflow-x-auto no-scrollbar max-w-full">
                {dashboard.pages.map((page) => (
                    <div
                        key={page.id}
                        onDoubleClick={() => handleRename(page.id, page.title)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                pageId: page.id,
                                pageTitle: page.title
                            });
                        }}
                        className={`group relative flex items-center h-10 px-4 min-w-[100px] cursor-pointer transition-all border-r border-white/5 ${dashboard.activePageId === page.id
                            ? 'bg-indigo-600/10 text-indigo-400 font-bold border-b-2 border-b-indigo-500'
                            : 'text-slate-400 hover:bg-white/5'
                            }`}
                        onClick={() => setActivePage(dashboard.id, page.id)}
                    >
                        {editingPageId === page.id ? (
                            <input
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => submitRename(page.id)}
                                onKeyDown={(e) => e.key === 'Enter' && submitRename(page.id)}
                                className="bg-slate-800 text-white text-[11px] px-2 py-0.5 rounded outline-none w-full border border-indigo-500/50"
                            />
                        ) : (
                            <span className="text-[11px] uppercase tracking-wider truncate select-none">{page.title}</span>
                        )}

                        {/* Actions - Delete Only */}
                        <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            {dashboard.pages.length > 1 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setDeleteRequest({
                                            id: page.id,
                                            title: page.title,
                                            left: rect.left + rect.width / 2
                                        });
                                    }}
                                    className="p-1 hover:text-red-400 text-slate-500"
                                    title={t('bi.delete_page')}
                                >
                                    <i className="fas fa-times text-[10px]"></i>
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Page Actions */}
            <div className="flex items-center gap-1 ml-2 border-l border-white/5 pl-2">
                <button
                    onClick={handleAddPage}
                    className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/5 text-slate-400 hover:text-indigo-400 transition-all"
                    title={t('bi.add_new_page')}
                >
                    <i className="fas fa-plus text-xs"></i>
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        if (e.shiftKey) {
                            // Bulk delete others: Filter out the active page and delete the rest
                            if (dashboard.pages.length > 1) {
                                const pagesToDelete = dashboard.pages.filter(p => p.id !== dashboard.activePageId);
                                pagesToDelete.forEach(p => deletePage(dashboard.id, p.id));
                            }
                        } else {
                            // Single delete: Target the active page
                            if (dashboard.pages.length > 1) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setDeleteRequest({
                                    id: dashboard.activePageId!,
                                    title: dashboard.pages.find(p => p.id === dashboard.activePageId)!.title,
                                    left: rect.left + rect.width / 2
                                });
                            }
                        }
                    }}
                    className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/5 text-slate-400 hover:text-red-400 transition-all"
                    title="Delete active page (Shift+Click to delete others)"
                >
                    <i className="fas fa-minus text-xs"></i>
                </button>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-[9999] bg-slate-900 border border-white/10 rounded-lg shadow-2xl py-1 min-w-[140px] animate-in fade-in zoom-in duration-100"
                    style={{ bottom: window.innerHeight - contextMenu.y + 10, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/10 hover:text-white flex items-center gap-2"
                        onClick={() => handleRename(contextMenu.pageId, contextMenu.pageTitle)}
                    >
                        <i className="fas fa-edit text-[10px] w-4"></i>
                        Rename
                    </button>
                    <button
                        className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/10 hover:text-white flex items-center gap-2"
                        onClick={() => {
                            duplicatePage(dashboard.id, contextMenu.pageId);
                            setContextMenu(null);
                        }}
                    >
                        <i className="fas fa-copy text-[10px] w-4"></i>
                        Duplicate
                    </button>
                    {dashboard.pages.length > 1 && (
                        <div className="border-t border-white/5 mt-1 pt-1">
                            <button
                                className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                                onClick={(e) => {
                                    const rect = (e.target as HTMLElement).getBoundingClientRect(); // Approximate position
                                    setDeleteRequest({
                                        id: contextMenu.pageId,
                                        title: contextMenu.pageTitle,
                                        left: contextMenu.x
                                    });
                                    setContextMenu(null);
                                }}
                            >
                                <i className="fas fa-trash text-[10px] w-4"></i>
                                Delete
                            </button>
                        </div>
                    )}
                </div>
            )}

            {deleteRequest && (
                <DeleteConfirmationPopup
                    title={deleteRequest.title}
                    position={{ left: deleteRequest.left }}
                    onCancel={() => setDeleteRequest(null)}
                    onConfirm={() => {
                        deletePage(dashboard.id, deleteRequest.id);
                        setDeleteRequest(null);
                    }}
                />
            )}
        </div>
    );
};

export default PageTabs;
