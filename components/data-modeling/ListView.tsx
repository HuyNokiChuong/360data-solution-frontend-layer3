import React, { useMemo, useState } from 'react';
import type { ModelRelationship, ModelTable, RelationshipSuggestion } from '../../types';
import { useLanguageStore } from '../../store/languageStore';

interface ListViewProps {
  tables: ModelTable[];
  relationships: ModelRelationship[];
  selectedTableId: string | null;
  onSelectTable: (tableId: string) => void;
  onAutoDetect: () => void;
  autoDetectLoading: boolean;
  suggestions: RelationshipSuggestion[];
  canEdit: boolean;
  onCreateRelationship: (payload: {
    fromTableId: string;
    fromColumn: string;
    toTableId: string;
    toColumn: string;
    relationshipType: '1-1' | '1-n' | 'n-1' | 'n-n';
    crossFilterDirection: 'single' | 'both';
  }) => Promise<void>;
  onDeleteRelationship: (relationshipId: string) => Promise<void>;
  onAcceptSuggestion: (suggestion: RelationshipSuggestion) => Promise<void>;
  onRejectSuggestion: (suggestionId: string) => void;
}

const ListView: React.FC<ListViewProps> = ({
  tables,
  relationships,
  selectedTableId,
  onSelectTable,
  onAutoDetect,
  autoDetectLoading,
  suggestions,
  canEdit,
  onCreateRelationship,
  onDeleteRelationship,
  onAcceptSuggestion,
  onRejectSuggestion,
}) => {
  const { t } = useLanguageStore();
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({
    fromTableId: selectedTableId || '',
    fromColumn: '',
    toTableId: '',
    toColumn: '',
    relationshipType: '1-n' as '1-1' | '1-n' | 'n-1' | 'n-n',
    crossFilterDirection: 'single' as 'single' | 'both',
  });
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);

  const filteredTables = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return tables;
    return tables.filter((table) =>
      table.tableName.toLowerCase().includes(keyword) ||
      String(table.datasetName || '').toLowerCase().includes(keyword)
    );
  }, [tables, search]);

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) || null,
    [tables, selectedTableId]
  );

  const relatedColumnSet = useMemo(() => {
    const set = new Set<string>();
    if (!selectedTable) return set;
    relationships.forEach((rel) => {
      if (rel.fromTableId === selectedTable.id) set.add(rel.fromColumn.toLowerCase());
      if (rel.toTableId === selectedTable.id) set.add(rel.toColumn.toLowerCase());
    });
    return set;
  }, [relationships, selectedTable]);

  const fromColumns = useMemo(() => {
    return tables.find((table) => table.id === form.fromTableId)?.schema || [];
  }, [form.fromTableId, tables]);

  const toColumns = useMemo(() => {
    return tables.find((table) => table.id === form.toTableId)?.schema || [];
  }, [form.toTableId, tables]);

  const toggleSuggestion = (id: string) => {
    setSelectedSuggestionIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleBulkAccept = async () => {
    const targets = suggestions.filter((item) => selectedSuggestionIds.includes(item.id));
    for (const suggestion of targets) {
      await onAcceptSuggestion(suggestion);
    }
    setSelectedSuggestionIds([]);
  };

  const handleBulkReject = () => {
    selectedSuggestionIds.forEach((id) => onRejectSuggestion(id));
    setSelectedSuggestionIds([]);
  };

  return (
    <div className="h-full flex gap-4 p-4 overflow-hidden">
      <aside className="w-72 shrink-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-3 overflow-hidden flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('dm.search_tables')}
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white"
          />
        </div>
        <div className="overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {filteredTables.map((table) => {
            const active = table.id === selectedTableId;
            return (
              <button
                key={table.id}
                onClick={() => onSelectTable(table.id)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  active
                    ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500/40'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 hover:border-indigo-400/40'
                }`}
              >
                <div className="text-xs font-black text-slate-900 dark:text-white truncate">{table.tableName}</div>
                <div className="text-[10px] text-slate-500 truncate">{table.datasetName || t('dm.dataset')}</div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden flex flex-col">
        <header className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">{selectedTable ? selectedTable.tableName : t('dm.title')}</h3>
            <p className="text-[11px] text-slate-500">{t('dm.list_view')}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onAutoDetect}
              disabled={autoDetectLoading}
              className="px-3 py-2 rounded-lg text-[11px] font-black bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30 disabled:opacity-50"
            >
              {autoDetectLoading ? t('dm.detecting') : t('dm.auto_detect_relationship')}
            </button>
            {canEdit && (
              <button
                onClick={() => {
                  setForm((prev) => ({ ...prev, fromTableId: selectedTableId || prev.fromTableId }));
                  setIsCreating((prev) => !prev);
                }}
                className="px-3 py-2 rounded-lg text-[11px] font-black bg-indigo-600 text-white"
              >
                {t('dm.create_relationship')}
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {isCreating && canEdit && (
            <div className="p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/5">
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={form.fromTableId}
                  onChange={(e) => setForm((prev) => ({ ...prev, fromTableId: e.target.value, fromColumn: '' }))}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2 text-xs"
                >
                  <option value="">{t('dm.table_a')}</option>
                  {tables.map((table) => (
                    <option key={table.id} value={table.id}>{table.tableName}</option>
                  ))}
                </select>
                <select
                  value={form.fromColumn}
                  onChange={(e) => setForm((prev) => ({ ...prev, fromColumn: e.target.value }))}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2 text-xs"
                >
                  <option value="">{t('dm.column_a')}</option>
                  {fromColumns.map((col) => (
                    <option key={col.name} value={col.name}>{col.name}</option>
                  ))}
                </select>
                <select
                  value={form.toTableId}
                  onChange={(e) => setForm((prev) => ({ ...prev, toTableId: e.target.value, toColumn: '' }))}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2 text-xs"
                >
                  <option value="">{t('dm.table_b')}</option>
                  {tables.map((table) => (
                    <option key={table.id} value={table.id}>{table.tableName}</option>
                  ))}
                </select>
                <select
                  value={form.toColumn}
                  onChange={(e) => setForm((prev) => ({ ...prev, toColumn: e.target.value }))}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2 text-xs"
                >
                  <option value="">{t('dm.column_b')}</option>
                  {toColumns.map((col) => (
                    <option key={col.name} value={col.name}>{col.name}</option>
                  ))}
                </select>
                <select
                  value={form.relationshipType}
                  onChange={(e) => setForm((prev) => ({ ...prev, relationshipType: e.target.value as any }))}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2 text-xs"
                >
                  <option value="1-1">1-1</option>
                  <option value="1-n">1-n</option>
                  <option value="n-1">n-1</option>
                  <option value="n-n">n-n (saved as invalid)</option>
                </select>
                <select
                  value={form.crossFilterDirection}
                  onChange={(e) => setForm((prev) => ({ ...prev, crossFilterDirection: e.target.value as any }))}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2 text-xs"
                >
                  <option value="single">{t('dm.single')}</option>
                  <option value="both">{t('dm.both')}</option>
                </select>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setIsCreating(false)}
                  className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-white/10"
                >
                  {t('dm.cancel')}
                </button>
                <button
                  onClick={async () => {
                    await onCreateRelationship(form);
                    setIsCreating(false);
                    setForm((prev) => ({ ...prev, fromColumn: '', toColumn: '' }));
                  }}
                  disabled={!form.fromTableId || !form.fromColumn || !form.toTableId || !form.toColumn}
                  className="px-3 py-2 rounded-lg text-xs font-black bg-indigo-600 text-white disabled:opacity-50"
                >
                  {t('dm.save_relationship')}
                </button>
              </div>
            </div>
          )}

          {selectedTable && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950/40">
              <div className="text-xs font-black text-slate-700 dark:text-slate-300 mb-2">{t('dm.columns')}</div>
              <div className="space-y-1">
                {selectedTable.schema.map((col) => {
                  const hasKey = relatedColumnSet.has(String(col.name).toLowerCase());
                  return (
                    <div key={col.name} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5">
                      <div className="flex items-center gap-2">
                        {hasKey ? <i className="fas fa-key text-[10px] text-amber-500" /> : <i className="fas fa-circle text-[6px] text-slate-400" />}
                        <span className="text-slate-800 dark:text-slate-200">{col.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-500">{col.type}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="p-4 rounded-xl border border-slate-200 dark:border-white/10">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-black text-slate-700 dark:text-slate-300">{t('dm.auto_detect_suggestions')}</div>
              {selectedSuggestionIds.length > 0 && canEdit && (
                <div className="flex gap-2">
                  <button
                    onClick={handleBulkReject}
                    className="px-2 py-1 text-[10px] font-black rounded border border-slate-200 dark:border-white/10"
                  >
                    {t('dm.reject_selected')}
                  </button>
                  <button
                    onClick={handleBulkAccept}
                    className="px-2 py-1 text-[10px] font-black rounded bg-indigo-600 text-white"
                  >
                    {t('dm.accept_selected')}
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {suggestions.length === 0 && (
                <div className="text-xs text-slate-500">{t('dm.no_suggestion')}</div>
              )}
              {suggestions.map((suggestion) => (
                <div key={suggestion.id} className="p-2 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950/40">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs text-slate-800 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={selectedSuggestionIds.includes(suggestion.id)}
                        onChange={() => toggleSuggestion(suggestion.id)}
                      />
                      <span>
                        {suggestion.fromTable}.{suggestion.fromColumn} {'->'} {suggestion.toTable}.{suggestion.toColumn}
                      </span>
                    </label>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-black">
                      {suggestion.confidence}%
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500 flex items-center gap-2">
                    <span>{suggestion.relationshipType}</span>
                    <span>•</span>
                    <span>{suggestion.validationStatus}</span>
                    {suggestion.invalidReason && <span>• {suggestion.invalidReason}</span>}
                  </div>
                  {canEdit && (
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => onRejectSuggestion(suggestion.id)}
                        className="px-2 py-1 text-[10px] font-black rounded border border-slate-200 dark:border-white/10"
                      >
                        {t('dm.reject')}
                      </button>
                      <button
                        onClick={() => onAcceptSuggestion(suggestion)}
                        className="px-2 py-1 text-[10px] font-black rounded bg-indigo-600 text-white"
                      >
                        {t('dm.accept')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      </section>
    </div>
  );
};

export default ListView;
