import React, { useMemo, useState } from 'react';
import type { ModelRelationship } from '../../types';

interface ActiveRelationshipsViewProps {
  relationships: ModelRelationship[];
  canEdit: boolean;
  onDeleteRelationship: (relationshipId: string) => Promise<void>;
  onEditRelationship: (relationshipId: string, updates: {
    relationshipType: '1-1' | '1-n' | 'n-1' | 'n-n';
    crossFilterDirection: 'single' | 'both';
  }) => Promise<void>;
}

const badgeClassByStatus: Record<string, string> = {
  valid: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  invalid: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const ActiveRelationshipsView: React.FC<ActiveRelationshipsViewProps> = ({
  relationships,
  canEdit,
  onDeleteRelationship,
  onEditRelationship,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRelationshipType, setDraftRelationshipType] = useState<'1-1' | '1-n' | 'n-1' | 'n-n'>('1-n');
  const [draftCrossFilterDirection, setDraftCrossFilterDirection] = useState<'single' | 'both'>('single');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const activeRelationships = useMemo(
    () => relationships.filter((rel) => rel.validationStatus === 'valid'),
    [relationships]
  );

  const invalidRelationships = useMemo(
    () => relationships.filter((rel) => rel.validationStatus !== 'valid'),
    [relationships]
  );

  const orderedRelationships = useMemo(() => {
    return [...relationships].sort((a, b) => {
      const aScore = a.validationStatus === 'valid' ? 1 : 0;
      const bScore = b.validationStatus === 'valid' ? 1 : 0;
      return bScore - aScore;
    });
  }, [relationships]);

  const startEdit = (rel: ModelRelationship) => {
    setEditError(null);
    setEditingId(rel.id);
    setDraftRelationshipType(rel.relationshipType);
    setDraftCrossFilterDirection(rel.crossFilterDirection);
  };

  const cancelEdit = () => {
    setEditError(null);
    setEditingId(null);
    setSavingId(null);
  };

  const saveEdit = async (relationshipId: string) => {
    setEditError(null);
    setSavingId(relationshipId);
    try {
      await onEditRelationship(relationshipId, {
        relationshipType: draftRelationshipType,
        crossFilterDirection: draftCrossFilterDirection,
      });
      setEditingId(null);
    } catch (err: any) {
      setEditError(err?.message || 'Failed to edit relationship');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="h-full p-4 overflow-y-auto custom-scrollbar space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-black">Active</div>
          <div className="text-2xl font-black text-white mt-1">{activeRelationships.length}</div>
          <div className="text-[10px] text-emerald-200 mt-1">Executable relationships</div>
        </div>
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-red-300 font-black">Invalid</div>
          <div className="text-2xl font-black text-white mt-1">{invalidRelationships.length}</div>
          <div className="text-[10px] text-red-200 mt-1">Blocked at runtime</div>
        </div>
        <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-indigo-300 font-black">Total</div>
          <div className="text-2xl font-black text-white mt-1">{relationships.length}</div>
          <div className="text-[10px] text-indigo-200 mt-1">All saved relationships</div>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/60">
          <div className="text-xs font-black text-slate-800 dark:text-slate-200">Relationships</div>
          <div className="text-[10px] text-slate-500 mt-1">Status and delete actions are available directly on each relationship.</div>
        </div>

        <div className="p-3 space-y-2">
          {orderedRelationships.length === 0 && (
            <div className="text-xs text-slate-500">No relationship saved yet.</div>
          )}

          {orderedRelationships.map((rel) => {
            const statusClass = badgeClassByStatus[rel.validationStatus] || 'bg-slate-500/15 text-slate-300 border-slate-500/30';
            const isEditing = editingId === rel.id;
            const isSaving = savingId === rel.id;
            return (
            <div
              key={rel.id}
              className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2"
            >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-slate-900 dark:text-slate-200 font-bold">
                      {rel.fromTable}.{rel.fromColumn} {'->'} {rel.toTable}.{rel.toColumn}
                    </div>
                    {!isEditing ? (
                      <div className="text-[10px] text-slate-500 mt-1">
                        {rel.relationshipType} • {rel.crossFilterDirection}
                      </div>
                    ) : (
                      <div className="mt-2 flex items-center gap-2">
                        <select
                          value={draftRelationshipType}
                          onChange={(e) => setDraftRelationshipType(e.target.value as '1-1' | '1-n' | 'n-1' | 'n-n')}
                          className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-[10px] text-slate-800 dark:text-slate-200 outline-none"
                          disabled={isSaving}
                        >
                          <option value="1-1">1-1</option>
                          <option value="1-n">1-n</option>
                          <option value="n-1">n-1</option>
                          <option value="n-n">n-n</option>
                        </select>
                        <select
                          value={draftCrossFilterDirection}
                          onChange={(e) => setDraftCrossFilterDirection(e.target.value as 'single' | 'both')}
                          className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-[10px] text-slate-800 dark:text-slate-200 outline-none"
                          disabled={isSaving}
                        >
                          <option value="single">single</option>
                          <option value="both">both</option>
                        </select>
                      </div>
                    )}
                    {rel.invalidReason && (
                      <div className="text-[10px] text-red-400 mt-1">{rel.invalidReason}</div>
                    )}
                    {isEditing && editError && (
                      <div className="text-[10px] text-red-400 mt-1">{editError}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-1 rounded border font-black uppercase tracking-wide ${statusClass}`}>
                      {rel.validationStatus}
                    </span>
                    {canEdit && !isEditing && (
                      <>
                        <button
                          type="button"
                          onClick={() => startEdit(rel)}
                          className="px-2 py-1 text-[10px] font-black rounded border border-indigo-500/30 text-indigo-300"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteRelationship(rel.id)}
                          className="px-2 py-1 text-[10px] font-black rounded border border-red-500/30 text-red-400"
                        >
                          Delete
                        </button>
                      </>
                    )}
                    {canEdit && isEditing && (
                      <>
                        <button
                          type="button"
                          onClick={() => saveEdit(rel.id)}
                          className="px-2 py-1 text-[10px] font-black rounded border border-emerald-500/30 text-emerald-300 disabled:opacity-60"
                          disabled={isSaving}
                        >
                          {isSaving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="px-2 py-1 text-[10px] font-black rounded border border-slate-400/30 text-slate-300"
                          disabled={isSaving}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default ActiveRelationshipsView;
