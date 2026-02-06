import React from 'react';
import { ReportSession } from '../../types';
import { useLanguageStore } from '../../store/languageStore';

interface ReportSidebarProps {
    sessions: ReportSession[];
    activeSessionId: string;
    onSelectSession: (id: string) => void;
    onNewSession: () => void;
    onRenameSession: (id: string, newTitle: string) => void;
    onDeleteSession: (id: string) => void;
}

export const ReportSidebar: React.FC<ReportSidebarProps> = ({
    sessions, activeSessionId, onSelectSession, onNewSession, onRenameSession, onDeleteSession
}) => {
    const { t } = useLanguageStore();
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [editValue, setEditValue] = React.useState('');
    const [deletingId, setDeletingId] = React.useState<string | null>(null);

    const handleStartEdit = (e: React.MouseEvent, session: ReportSession) => {
        e.stopPropagation();
        setEditingId(session.id);
        setEditValue(session.title);
    };

    const handleSaveEdit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (editingId && editValue.trim()) {
            onRenameSession(editingId, editValue.trim());
        }
        setEditingId(null);
    };

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDeletingId(id);
    };

    const confirmDelete = () => {
        if (deletingId) {
            onDeleteSession(deletingId);
            setDeletingId(null);
        }
    };

    return (
        <div className="w-80 border-r border-white/5 bg-[#020617] flex flex-col no-print h-full flex-shrink-0 relative">
            <div className="p-8 pb-4">
                <button
                    onClick={onNewSession}
                    className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-500 shadow-xl shadow-indigo-600/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                    <i className="fas fa-plus"></i> {t('reports.new_chat') || 'New Analysis'}
                </button>
            </div>

            <div className="px-8 pb-4">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-white/5 pb-2">
                    History
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 space-y-2 custom-scrollbar pb-8">
                {(sessions || []).map((s) => (
                    <div
                        key={s.id}
                        onClick={() => onSelectSession(s.id)}
                        className={`w-full text-left p-5 rounded-[1.5rem] border transition-all relative group cursor-pointer ${activeSessionId === s.id
                            ? 'bg-indigo-600/10 border-indigo-500/30 text-white shadow-lg'
                            : 'text-slate-500 border-transparent hover:bg-white/5 hover:text-slate-300'
                            }`}
                    >
                        {deletingId === s.id ? (
                            <div className="animate-in fade-in zoom-in duration-200 flex flex-col items-center text-center space-y-3" onClick={e => e.stopPropagation()}>
                                <p className="text-[10px] font-bold text-red-400">Bạn có chắc không?</p>
                                <div className="flex gap-2 w-full">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setDeletingId(null); }}
                                        className="flex-1 py-1.5 bg-white/5 text-slate-400 rounded text-[10px] font-black uppercase hover:bg-white/10"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); confirmDelete(); }}
                                        className="flex-1 py-1.5 bg-red-600 text-white rounded text-[10px] font-black uppercase hover:bg-red-500 shadow-lg shadow-red-600/20"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ) : editingId === s.id ? (
                            <form onSubmit={handleSaveEdit} onClick={e => e.stopPropagation()} className="flex items-center gap-2">
                                <input
                                    autoFocus
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={() => handleSaveEdit()}
                                    onKeyDown={e => {
                                        if (e.key === 'Escape') setEditingId(null);
                                    }}
                                    className="w-full bg-slate-950 border border-indigo-500 rounded px-2 py-1 text-xs text-white outline-none"
                                />
                                <button type="submit" className="text-emerald-400 hover:text-emerald-300"><i className="fas fa-check"></i></button>
                            </form>
                        ) : (
                            <>
                                <div className="font-bold text-sm truncate uppercase tracking-tight mb-1 pr-8">{s.title || 'Untitled Session'}</div>
                                <div className="flex justify-between items-center">
                                    <div className="text-[9px] font-black opacity-30 uppercase">{s.timestamp}</div>
                                    <div className="text-[9px] font-black opacity-30 bg-white/5 px-2 py-0.5 rounded-full">{s.messages.length} msgs</div>
                                </div>

                                {/* Actions */}
                                <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => handleStartEdit(e, s)}
                                        className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-white bg-slate-900/50 rounded hover:bg-indigo-600 transition-colors"
                                        title="Rename"
                                    >
                                        <i className="fas fa-edit text-[10px]"></i>
                                    </button>
                                    <button
                                        onClick={(e) => handleDeleteClick(e, s.id)}
                                        className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-red-400 bg-slate-900/50 rounded hover:bg-red-500/20 transition-colors"
                                        title="Delete"
                                    >
                                        <i className="fas fa-trash text-[10px]"></i>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                ))}
                {sessions.length === 0 && (
                    <div className="text-center py-10 opacity-30">
                        <i className="fas fa-history text-2xl mb-2"></i>
                        <p className="text-[10px] uppercase font-bold">No history available</p>
                    </div>
                )}
            </div>
        </div>
    );
};
