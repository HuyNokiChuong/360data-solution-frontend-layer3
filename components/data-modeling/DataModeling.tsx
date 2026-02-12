import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User, DataModel, ModelRelationship, ModelTable, RelationshipSuggestion } from '../../types';
import {
  autoDetectRelationships,
  createRelationship,
  deleteRelationship,
  getDefaultDataModel,
  getModelTables,
  getRelationships,
} from '../../services/dataModeling';
import ListView from './ListView';
import DiagramView from './DiagramView';
import '@xyflow/react/dist/style.css';
import { useLanguageStore } from '../../store/languageStore';

interface DataModelingProps {
  currentUser: User;
}

const DataModeling: React.FC<DataModelingProps> = ({ currentUser }) => {
  const { t } = useLanguageStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'diagram'>('list');
  const [dataModel, setDataModel] = useState<DataModel | null>(null);
  const [tables, setTables] = useState<ModelTable[]>([]);
  const [relationships, setRelationships] = useState<ModelRelationship[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<RelationshipSuggestion[]>([]);
  const [autoDetectLoading, setAutoDetectLoading] = useState(false);

  const canEdit = useMemo(() => ['Admin', 'Editor'].includes(currentUser.role), [currentUser.role]);

  const refreshData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const model = await getDefaultDataModel();
      const [nextTables, nextRelationships] = await Promise.all([
        getModelTables(model.id),
        getRelationships(model.id),
      ]);

      setDataModel(model);
      setTables(nextTables);
      setRelationships(nextRelationships);
      setSelectedTableId((prev) => prev && nextTables.some((table) => table.id === prev) ? prev : (nextTables[0]?.id || null));
    } catch (err: any) {
      setError(err.message || t('dm.title'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const handleCreateRelationship = useCallback(async (payload: {
    fromTableId: string;
    fromColumn: string;
    toTableId: string;
    toColumn: string;
    relationshipType: '1-1' | '1-n' | 'n-n';
    crossFilterDirection: 'single' | 'both';
  }) => {
    if (!dataModel) return;
    const created = await createRelationship({ ...payload, dataModelId: dataModel.id });
    setRelationships((prev) => {
      const idx = prev.findIndex((item) => item.id === created.id);
      if (idx >= 0) {
        const clone = [...prev];
        clone[idx] = created;
        return clone;
      }
      return [...prev, created];
    });
  }, [dataModel]);

  const handleDeleteRelationship = useCallback(async (relationshipId: string) => {
    await deleteRelationship(relationshipId);
    setRelationships((prev) => prev.filter((item) => item.id !== relationshipId));
  }, []);

  const handleAutoDetect = useCallback(async () => {
    if (!dataModel) return;
    setAutoDetectLoading(true);
    try {
      const detected = await autoDetectRelationships({ dataModelId: dataModel.id });
      setSuggestions(detected);
    } catch (err: any) {
      setError(err.message || t('dm.auto_detect_relationship'));
    } finally {
      setAutoDetectLoading(false);
    }
  }, [dataModel]);

  const handleAcceptSuggestion = useCallback(async (suggestion: RelationshipSuggestion) => {
    await handleCreateRelationship({
      fromTableId: suggestion.fromTableId,
      fromColumn: suggestion.fromColumn,
      toTableId: suggestion.toTableId,
      toColumn: suggestion.toColumn,
      relationshipType: suggestion.relationshipType,
      crossFilterDirection: suggestion.crossFilterDirection,
    });
    setSuggestions((prev) => prev.filter((item) => item.id !== suggestion.id));
  }, [handleCreateRelationship]);

  const handleRejectSuggestion = useCallback((suggestionId: string) => {
    setSuggestions((prev) => prev.filter((item) => item.id !== suggestionId));
  }, []);

  return (
    <div className="h-full bg-slate-50 dark:bg-[#020617] overflow-hidden p-4">
      <div className="h-full bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-black text-slate-900 dark:text-white">{t('dm.title')}</h2>
            <p className="text-[11px] text-slate-500">
              {dataModel ? `${dataModel.name} • ${tables.length} tables • ${relationships.length} relationships` : t('dm.semantic_layer')}
            </p>
            {!canEdit && (
              <p className="text-[11px] text-amber-600 dark:text-amber-300 mt-1">
                {t('dm.read_only')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-2 rounded-lg text-[11px] font-black ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
            >
              {t('dm.list_view')}
            </button>
            <button
              onClick={() => setViewMode('diagram')}
              className={`px-3 py-2 rounded-lg text-[11px] font-black ${viewMode === 'diagram' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
            >
              {t('dm.diagram_view')}
            </button>
            <button
              onClick={refreshData}
              className="px-3 py-2 rounded-lg text-[11px] font-black border border-slate-200 dark:border-white/10"
            >
              {t('dm.refresh')}
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex-1 p-6">
            <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-500 text-sm">{error}</div>
          </div>
        ) : viewMode === 'list' ? (
          <ListView
            tables={tables}
            relationships={relationships}
            selectedTableId={selectedTableId}
            onSelectTable={setSelectedTableId}
            onAutoDetect={handleAutoDetect}
            autoDetectLoading={autoDetectLoading}
            suggestions={suggestions}
            canEdit={canEdit}
            onCreateRelationship={handleCreateRelationship}
            onDeleteRelationship={handleDeleteRelationship}
            onAcceptSuggestion={handleAcceptSuggestion}
            onRejectSuggestion={handleRejectSuggestion}
          />
        ) : (
          <div className="flex-1 p-4">
            <DiagramView
              tables={tables}
              relationships={relationships}
              canEdit={canEdit}
              onCreateRelationship={handleCreateRelationship}
              onDeleteRelationship={handleDeleteRelationship}
              onActionError={setError}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default DataModeling;
