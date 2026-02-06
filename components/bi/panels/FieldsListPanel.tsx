
import React, { useMemo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDataStore } from '../store/dataStore';
import { Field } from '../types';

interface FieldItemProps {
    field: Field;
    dataSourceId: string;
}

const FieldItem: React.FC<FieldItemProps> = ({ field, dataSourceId }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: `${dataSourceId}-${field.name}`,
        data: { field, dataSourceId }
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const getFieldIcon = (type: string) => {
        switch (type) {
            case 'number':
                return 'fa-hashtag';
            case 'string':
                return 'fa-font';
            case 'date':
                return 'fa-calendar';
            case 'boolean':
                return 'fa-toggle-on';
            default:
                return 'fa-question';
        }
    };

    const getFieldColor = (type: string) => {
        switch (type) {
            case 'number':
                return 'text-blue-400 bg-blue-500/10';
            case 'string':
                return 'text-green-400 bg-green-500/10';
            case 'date':
                return 'text-purple-400 bg-purple-500/10';
            case 'boolean':
                return 'text-orange-400 bg-orange-500/10';
            default:
                return 'text-slate-400 bg-slate-500/10';
        }
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={`
                group flex items-center gap-2 px-3 py-2 rounded-lg cursor-move
                bg-slate-900/50 border border-white/10 hover:border-indigo-500/30 hover:bg-white/5
                transition-all
                ${isDragging ? 'ring-2 ring-indigo-500 shadow-lg' : ''}
            `}
        >
            <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${getFieldColor(field.type)}`}>
                <i className={`fas ${getFieldIcon(field.type)} text-[10px]`}></i>
            </div>

            <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-200 truncate">{field.name}</div>
                <div className="text-[9px] text-slate-500 uppercase tracking-wider">{field.type}</div>
            </div>

            {field.aggregation && (
                <span className="px-1.5 py-0.5 bg-indigo-600/20 text-indigo-400 text-[8px] font-black uppercase rounded border border-indigo-500/30">
                    {field.aggregation}
                </span>
            )}

            <i className="fas fa-grip-vertical text-slate-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity"></i>
        </div>
    );
};

interface FieldsListPanelProps {
    onFieldDragStart?: (field: Field, dataSourceId: string) => void;
}

const FieldsListPanel: React.FC<FieldsListPanelProps> = ({ onFieldDragStart }) => {
    const { dataSources, selectedDataSourceId, setSelectedDataSource } = useDataStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'number' | 'string' | 'date' | 'boolean'>('all');

    const selectedDataSource = useMemo(() => {
        return dataSources.find(ds => ds.id === selectedDataSourceId);
    }, [dataSources, selectedDataSourceId]);

    const filteredFields = useMemo(() => {
        if (!selectedDataSource) return [];

        let fields = selectedDataSource.schema;

        // Filter by type
        if (filterType !== 'all') {
            fields = fields.filter(f => f.type === filterType);
        }

        // Filter by search
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            fields = fields.filter(f => f.name.toLowerCase().includes(query));
        }

        return fields;
    }, [selectedDataSource, filterType, searchQuery]);

    const fieldTypeCounts = useMemo(() => {
        if (!selectedDataSource) return { number: 0, string: 0, date: 0, boolean: 0 };

        return selectedDataSource.schema.reduce((acc, field) => {
            acc[field.type] = (acc[field.type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
    }, [selectedDataSource]);

    return (
        <div className="flex flex-col h-full bg-slate-950">
            {/* Header */}
            <div className="p-4 border-b border-white/5">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Fields</h3>

                {/* Data Source Selector */}
                <div className="mb-3">
                    <div className="flex items-center justify-between mb-2">
                        <label className="block text-[10px] text-slate-500 uppercase tracking-wider font-black">
                            Source
                        </label>
                        <label className="cursor-pointer text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1">
                            <input
                                type="file"
                                accept=".csv,.json"
                                onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    const ext = file.name.split('.').pop()?.toLowerCase();
                                    try {
                                        if (ext === 'csv') await useDataStore.getState().loadCSVFile(file);
                                        else if (ext === 'json') await useDataStore.getState().loadJSONFile(file);
                                    } catch (err) {
                                        console.error('Failed to load file:', err);
                                    }
                                    e.target.value = '';
                                }}
                                className="hidden"
                            />
                            <i className="fas fa-plus-circle text-xs"></i>
                            <span className="text-[9px] font-black uppercase tracking-wider">Add</span>
                        </label>
                    </div>
                    <select
                        value={selectedDataSourceId || ''}
                        onChange={(e) => setSelectedDataSource(e.target.value)}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-indigo-400 font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none hover:border-indigo-500/50 transition-all cursor-pointer"
                    >
                        <option value="">Select data table...</option>
                        {dataSources.map(ds => (
                            <option key={ds.id} value={ds.id}>
                                {ds.datasetName && ds.tableName
                                    ? `${ds.datasetName}.${ds.tableName}`
                                    : ds.name
                                }
                                {ds.type !== 'bigquery' && ` (${ds.type})`}
                            </option>
                        ))}
                    </select>
                </div>

                {selectedDataSource && (
                    <>
                        {/* Search */}
                        <div className="relative mb-3">
                            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
                            <input
                                type="text"
                                placeholder="Search fields..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-slate-900 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                        </div>

                        {/* Type Filter */}
                        <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-1">
                            <button
                                onClick={() => setFilterType('all')}
                                className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-all flex-shrink-0 ${filterType === 'all'
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-900 text-slate-500 hover:text-white'
                                    }`}
                            >
                                All ({selectedDataSource.schema.length.toLocaleString()})
                            </button>
                            <button
                                onClick={() => setFilterType('number')}
                                className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-all flex-shrink-0 ${filterType === 'number'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-900 text-slate-500 hover:text-white'
                                    }`}
                            >
                                <i className="fas fa-hashtag mr-1"></i>
                                {(fieldTypeCounts.number || 0).toLocaleString()}
                            </button>
                            <button
                                onClick={() => setFilterType('string')}
                                className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-all flex-shrink-0 ${filterType === 'string'
                                    ? 'bg-green-600 text-white'
                                    : 'bg-slate-900 text-slate-500 hover:text-white'
                                    }`}
                            >
                                <i className="fas fa-font mr-1"></i>
                                {(fieldTypeCounts.string || 0).toLocaleString()}
                            </button>
                            <button
                                onClick={() => setFilterType('date')}
                                className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider transition-all flex-shrink-0 ${filterType === 'date'
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-slate-900 text-slate-500 hover:text-white'
                                    }`}
                            >
                                <i className="fas fa-calendar mr-1"></i>
                                {(fieldTypeCounts.date || 0).toLocaleString()}
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Fields List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {!selectedDataSource && (
                    <div className="text-center py-8 text-slate-500">
                        <i className="fas fa-table text-3xl mb-2 opacity-20"></i>
                        <p className="text-xs">No data source selected</p>
                    </div>
                )}

                {selectedDataSource && filteredFields.length === 0 && (
                    <div className="text-center py-8 text-slate-500">
                        <i className="fas fa-search text-3xl mb-2 opacity-20"></i>
                        <p className="text-xs">No fields found</p>
                        <p className="text-[10px] mt-1">Try adjusting your filters</p>
                    </div>
                )}

                {selectedDataSource && filteredFields.map((field) => (
                    <FieldItem
                        key={field.name}
                        field={field}
                        dataSourceId={selectedDataSource.id}
                    />
                ))}
            </div>

            {/* Footer Info */}
            {selectedDataSource && (
                <div className="p-3 border-t border-white/5 bg-slate-900/30">
                    <div className="flex items-center gap-2 text-[9px] text-slate-500">
                        <i className="fas fa-info-circle"></i>
                        <span>Drag fields to canvas to create visuals</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FieldsListPanel;
