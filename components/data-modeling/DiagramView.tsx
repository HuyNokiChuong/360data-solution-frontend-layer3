import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  ConnectionMode,
  Connection,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import type { ModelRelationship, ModelTable } from '../../types';
import { useLanguageStore } from '../../store/languageStore';

interface DiagramViewProps {
  tables: ModelTable[];
  relationships: ModelRelationship[];
  canEdit: boolean;
  onCreateRelationship: (payload: {
    fromTableId: string;
    fromColumn: string;
    toTableId: string;
    toColumn: string;
    relationshipType: '1-1' | '1-n' | 'n-n';
    crossFilterDirection: 'single' | 'both';
  }) => Promise<void>;
  onDeleteRelationship: (relationshipId: string) => Promise<void>;
  onActionError?: (message: string) => void;
}

interface DataTableNodeData {
  tableName: string;
  datasetName?: string;
  columns: { name: string; type: string }[];
}

const DataTableNode: React.FC<{ data: DataTableNodeData }> = ({ data }) => {
  return (
    <div className="min-w-[260px] bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 rounded-xl shadow-lg">
      <div className="table-drag-handle px-3 py-2 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/40 rounded-t-xl cursor-grab active:cursor-grabbing">
        <div className="text-xs font-black text-slate-900 dark:text-white truncate">{data.tableName}</div>
        <div className="text-[10px] text-slate-500 truncate">{data.datasetName || 'dataset'}</div>
      </div>
      <div className="max-h-[280px] overflow-y-auto custom-scrollbar">
        {data.columns.map((col) => (
          <div key={col.name} className="relative px-3 py-1.5 text-xs border-b last:border-b-0 border-slate-100 dark:border-white/5">
            <Handle
              id={`left:${col.name}`}
              type="target"
              position={Position.Left}
              className="!w-3 !h-3 !bg-indigo-500 !border !border-white dark:!border-slate-900 !shadow"
            />
            <Handle
              id={`right:${col.name}`}
              type="source"
              position={Position.Right}
              className="!w-3 !h-3 !bg-indigo-500 !border !border-white dark:!border-slate-900 !shadow"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-800 dark:text-slate-200 truncate">{col.name}</span>
              <span className="text-[10px] text-slate-500">{col.type}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const nodeTypes = {
  dataTable: DataTableNode,
};

interface EdgeContextMenuState {
  edgeId: string;
  x: number;
  y: number;
  relationshipType: '1-1' | '1-n' | 'n-n';
  crossFilterDirection: 'single' | 'both';
}

const DiagramView: React.FC<DiagramViewProps> = ({
  tables,
  relationships,
  canEdit,
  onCreateRelationship,
  onDeleteRelationship,
  onActionError,
}) => {
  const { t } = useLanguageStore();
  const positionMap = useRef<Map<string, { x: number; y: number }>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [edgeContextMenu, setEdgeContextMenu] = useState<EdgeContextMenuState | null>(null);

  const openEdgeMenuById = useCallback((edgeId: string, clientX: number, clientY: number) => {
    const rel = relationships.find((item) => item.id === edgeId);
    if (!rel) return;

    setSelectedEdgeId(edgeId);

    const bounds = containerRef.current?.getBoundingClientRect();
    const rawX = bounds ? clientX - bounds.left : clientX;
    const rawY = bounds ? clientY - bounds.top : clientY;
    const x = Math.max(8, Math.min(rawX, (bounds?.width || rawX) - 300));
    const y = Math.max(8, Math.min(rawY, (bounds?.height || rawY) - 220));

    setEdgeContextMenu({
      edgeId: rel.id,
      x,
      y,
      relationshipType: rel.relationshipType,
      crossFilterDirection: rel.crossFilterDirection,
    });
  }, [relationships]);

  const initialNodes = useMemo<Node[]>(() => {
    return tables.map((table, index) => {
      const row = Math.floor(index / 4);
      const col = index % 4;
      const existing = positionMap.current.get(table.id);
      return {
        id: table.id,
        type: 'dataTable',
        position: existing || { x: col * 320, y: row * 380 },
        data: {
          tableName: table.tableName,
          datasetName: table.datasetName,
          columns: table.schema || [],
        },
      };
    });
  }, [tables]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    // Reconcile nodes from tables while preserving current dragged positions.
    setNodes((prev) => {
      const prevMap = new Map(prev.map((node) => [node.id, node]));
      return initialNodes.map((nextNode) => {
        const existing = prevMap.get(nextNode.id);
        if (!existing) return nextNode;
        return {
          ...existing,
          data: nextNode.data,
        };
      });
    });
  }, [initialNodes, setNodes]);

  useEffect(() => {
    const nextEdges: Edge[] = relationships.map((rel) => ({
      id: rel.id,
      source: rel.fromTableId,
      target: rel.toTableId,
      sourceHandle: `right:${rel.fromColumn}`,
      targetHandle: `left:${rel.toColumn}`,
      label: (
        <button
          type="button"
          className={`px-2 py-1 rounded-md border text-[10px] font-black shadow-sm transition ${
            rel.id === selectedEdgeId
              ? 'bg-amber-50 border-amber-400 text-amber-700'
              : rel.validationStatus === 'invalid'
                ? 'bg-red-50 border-red-300 text-red-600'
                : 'bg-white border-slate-200 text-slate-600'
          }`}
          onClick={(event) => {
            event.stopPropagation();
            setSelectedEdgeId(rel.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openEdgeMenuById(rel.id, event.clientX, event.clientY);
          }}
          title={t('dm.right_click_hint')}
        >
          {`${rel.relationshipType} • ${rel.crossFilterDirection}`}
        </button>
      ),
      animated: rel.validationStatus === 'invalid',
      interactionWidth: 48,
      style: (() => {
        const isSelected = rel.id === selectedEdgeId;
        if (rel.validationStatus === 'invalid') {
          return {
            stroke: isSelected ? '#f97316' : '#ef4444',
            strokeDasharray: '4 4',
            strokeWidth: isSelected ? 4 : 2,
            filter: isSelected ? 'drop-shadow(0 0 6px rgba(249, 115, 22, 0.85))' : undefined,
          };
        }
        return {
          stroke: isSelected ? '#f59e0b' : '#6366f1',
          strokeWidth: isSelected ? 4 : 2,
          filter: isSelected ? 'drop-shadow(0 0 6px rgba(245, 158, 11, 0.85))' : undefined,
        };
      })(),
      zIndex: rel.id === selectedEdgeId ? 1000 : 1,
    }));
    setEdges(nextEdges);
  }, [openEdgeMenuById, relationships, selectedEdgeId, setEdges]);

  useEffect(() => {
    if (!selectedEdgeId) return;
    if (relationships.some((rel) => rel.id === selectedEdgeId)) return;
    setSelectedEdgeId(null);
    setEdgeContextMenu(null);
  }, [relationships, selectedEdgeId]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setEdgeContextMenu(null);
      setSelectedEdgeId(null);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, []);

  const parseHandleColumn = (handleId: string) => {
    const idx = handleId.indexOf(':');
    return idx >= 0 ? handleId.slice(idx + 1) : handleId;
  };

  const onConnect = async (connection: Connection) => {
    if (!canEdit) return;
    if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return;

    const fromColumn = parseHandleColumn(connection.sourceHandle);
    const toColumn = parseHandleColumn(connection.targetHandle);
    if (!fromColumn || !toColumn) return;

    try {
      setCanvasError(null);
      await onCreateRelationship({
        fromTableId: connection.source,
        fromColumn,
        toTableId: connection.target,
        toColumn,
        relationshipType: '1-n',
        crossFilterDirection: 'single',
      });
    } catch (err: any) {
      const message = err?.message || t('dm.create_relationship');
      setCanvasError(message);
      onActionError?.(message);
    }
  };

  const openEdgeContextMenu = (event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    event.stopPropagation();
    openEdgeMenuById(edge.id, event.clientX, event.clientY);
  };

  const selectedRelationship = useMemo(() => {
    if (!edgeContextMenu?.edgeId) return null;
    return relationships.find((rel) => rel.id === edgeContextMenu.edgeId) || null;
  }, [edgeContextMenu?.edgeId, relationships]);

  const handleSaveEdgeSettings = async () => {
    if (!canEdit || !selectedRelationship || !edgeContextMenu) return;

    try {
      setCanvasError(null);
      await onCreateRelationship({
        fromTableId: selectedRelationship.fromTableId,
        fromColumn: selectedRelationship.fromColumn,
        toTableId: selectedRelationship.toTableId,
        toColumn: selectedRelationship.toColumn,
        relationshipType: edgeContextMenu.relationshipType,
        crossFilterDirection: edgeContextMenu.crossFilterDirection,
      });
      setEdgeContextMenu(null);
    } catch (err: any) {
      const message = err?.message || t('dm.save_relationship');
      setCanvasError(message);
      onActionError?.(message);
    }
  };

  const handleDeleteSelectedRelationship = async () => {
    if (!canEdit || !selectedRelationship) return;
    try {
      setCanvasError(null);
      await onDeleteRelationship(selectedRelationship.id);
      setEdgeContextMenu(null);
      setSelectedEdgeId(null);
    } catch (err: any) {
      const message = err?.message || t('dm.delete');
      setCanvasError(message);
      onActionError?.(message);
    }
  };

  return (
    <div ref={containerRef} className="h-full rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden relative">
      {!canEdit && (
        <div className="absolute top-2 left-2 z-20 px-3 py-1.5 rounded-lg text-[11px] font-black bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30">
          {t('dm.read_only_diagram')}
        </div>
      )}
      {canvasError && (
        <div className="absolute top-2 right-2 z-20 px-3 py-1.5 max-w-[460px] rounded-lg text-[11px] font-bold bg-red-500/15 text-red-500 border border-red-500/30">
          {canvasError}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDrag={(_, node) => {
          positionMap.current.set(node.id, node.position);
        }}
        onNodeDragStop={(_, node) => {
          positionMap.current.set(node.id, node.position);
        }}
        onEdgesChange={onEdgesChange}
        onEdgeClick={(_, edge) => {
          setSelectedEdgeId(edge.id);
        }}
        onEdgeContextMenu={openEdgeContextMenu}
        onPaneClick={() => {
          setEdgeContextMenu(null);
          setSelectedEdgeId(null);
        }}
        onPaneContextMenu={() => {
          setEdgeContextMenu(null);
          setSelectedEdgeId(null);
        }}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.6}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={36}
        nodesConnectable={canEdit}
        nodesDraggable={canEdit}
        dragHandle=".table-drag-handle"
        deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : []}
        onEdgesDelete={async (deletedEdges) => {
          if (!canEdit) return;
          for (const edge of deletedEdges) {
            try {
              await onDeleteRelationship(edge.id);
            } catch (err: any) {
              const message = err?.message || 'Failed to delete relationship';
              setCanvasError(message);
              onActionError?.(message);
            }
          }
        }}
      >
        <Background gap={20} size={1} color="#cbd5e1" />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>

      {edgeContextMenu && selectedRelationship && (
        <div
          className="absolute z-30 w-[280px] rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl p-3"
          style={{ left: edgeContextMenu.x, top: edgeContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[11px] font-black text-slate-700 dark:text-slate-200 mb-2">
            {selectedRelationship.fromTable}.{selectedRelationship.fromColumn} {'->'} {selectedRelationship.toTable}.{selectedRelationship.toColumn}
          </div>

          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">{t('dm.relationship_type')}</label>
          <select
            value={edgeContextMenu.relationshipType}
            onChange={(e) => setEdgeContextMenu((prev) => prev ? { ...prev, relationshipType: e.target.value as '1-1' | '1-n' | 'n-n' } : prev)}
            className="w-full mb-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2 text-xs"
          >
            <option value="1-1">1-1</option>
            <option value="1-n">1-n</option>
            <option value="n-n">n-n</option>
          </select>

          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">{t('dm.cross_filter_direction')}</label>
          <select
            value={edgeContextMenu.crossFilterDirection}
            onChange={(e) => setEdgeContextMenu((prev) => prev ? { ...prev, crossFilterDirection: e.target.value as 'single' | 'both' } : prev)}
            className="w-full mb-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2 text-xs"
          >
            <option value="single">{t('dm.single')}</option>
            <option value="both">{t('dm.both')}</option>
          </select>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setEdgeContextMenu(null)}
              className="px-2 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-white/10"
            >
              {t('dm.close')}
            </button>
            <div className="flex items-center gap-2">
              {canEdit && (
                <button
                  type="button"
                  onClick={handleDeleteSelectedRelationship}
                  className="px-2 py-1.5 rounded-lg text-[11px] font-black border border-red-500/30 text-red-500"
                >
                  {t('dm.delete')}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={handleSaveEdgeSettings}
                  className="px-2 py-1.5 rounded-lg text-[11px] font-black bg-indigo-600 text-white"
                >
                  {t('dm.save')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiagramView;
