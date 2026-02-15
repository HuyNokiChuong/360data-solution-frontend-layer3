
import React, { useState } from 'react';
import { useDashboardStore } from '../store/dashboardStore';
import { useDataStore } from '../store/dataStore';
import { GlobalFilter, FilterOperator } from '../types';
import { isAssistantGeneratedDataSource } from '../utils/dataSourceVisibility';

const GlobalFiltersPanel: React.FC = () => {
    const { getActiveDashboard, addGlobalFilter, removeGlobalFilter, updateDashboard } = useDashboardStore();
    const { dataSources } = useDataStore();
    const visibleDataSources = dataSources.filter((ds) => !isAssistantGeneratedDataSource(ds));

    const activeDashboard = getActiveDashboard();
    const [isAddingFilter, setIsAddingFilter] = useState(false);

    const [newFilterName, setNewFilterName] = useState('');
    const [selectedDataSourceId, setSelectedDataSourceId] = useState('');
    const [selectedField, setSelectedField] = useState('');
    const [operator, setOperator] = useState<FilterOperator>('equals');
    const [value, setValue] = useState('');

    if (!activeDashboard) {
        return (
            <div className="flex flex-col h-full items-center justify-center text-slate-500 p-4 text-center">
                <i className="fas fa-chart-pie text-3xl mb-2 opacity-20"></i>
                <p className="text-xs">Select a dashboard to manage filters</p>
            </div>
        );
    }

    const dataSource = visibleDataSources.find(ds => ds.id === selectedDataSourceId);
    const fields = dataSource?.schema || [];

    const handleAddFilter = () => {
        if (!selectedField || !value) return;

        const newFilter: GlobalFilter = {
            id: `gf-${Date.now()}`,
            name: newFilterName || `${selectedField} ${operator} ${value}`,
            field: selectedField,
            operator,
            value,
            appliedToWidgets: [] // Default to none? Or all? Let's assume logic handles "all" if empty or specific flag
        };

        addGlobalFilter(activeDashboard.id, newFilter);
        setIsAddingFilter(false);
        resetForm();
    };

    const resetForm = () => {
        setNewFilterName('');
        setSelectedDataSourceId('');
        setSelectedField('');
        setOperator('equals');
        setValue('');
    };

    const handleDeleteFilter = (filterId: string) => {
        removeGlobalFilter(activeDashboard.id, filterId);
    };

    return (
        <div className="flex flex-col h-full bg-slate-950">
            {/* Header */}
            <div className="p-4 border-b border-white/5">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Global Filters</h3>
                    <button
                        onClick={() => setIsAddingFilter(true)}
                        className="text-slate-500 hover:text-indigo-400 transition-colors"
                    >
                        <i className="fas fa-plus-circle text-sm"></i>
                    </button>
                </div>
                <p className="text-[10px] text-slate-500">
                    Filters apply to all compatible widgets
                </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                {isAddingFilter && (
                    <div className="bg-slate-900 border border-white/10 rounded-lg p-3 space-y-3 animate-in fade-in slide-in-from-top-2">
                        <input
                            type="text"
                            placeholder="Filter Name (optional)"
                            value={newFilterName}
                            onChange={(e) => setNewFilterName(e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:ring-1 focus:ring-indigo-500 outline-none"
                        />

                        <select
                            value={selectedDataSourceId}
                            onChange={(e) => setSelectedDataSourceId(e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                        >
                            <option value="">Select Data Source...</option>
                            {visibleDataSources.map(ds => (
                                <option key={ds.id} value={ds.id}>
                                    {ds.tableName || ds.name}
                                </option>
                            ))}
                        </select>

                        <select
                            value={selectedField}
                            onChange={(e) => setSelectedField(e.target.value)}
                            disabled={!selectedDataSourceId}
                            className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50"
                        >
                            <option value="">Select Field...</option>
                            {fields.map(f => (
                                <option key={f.name} value={f.name}>{f.name} ({f.type})</option>
                            ))}
                        </select>

                        <div className="grid grid-cols-2 gap-2">
                            <select
                                value={operator}
                                onChange={(e) => setOperator(e.target.value as FilterOperator)}
                                className="bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                            >
                                <option value="equals">Equals</option>
                                <option value="notEquals">Not Equals</option>
                                <option value="contains">Contains</option>
                                <option value="greaterThan">&gt;</option>
                                <option value="lessThan">&lt;</option>
                                <option value="between">Between</option>
                            </select>
                            <input
                                type="text"
                                placeholder="Value"
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                className="bg-slate-950 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                            <button
                                onClick={() => { setIsAddingFilter(false); resetForm(); }}
                                className="px-2 py-1 text-xs text-slate-400 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddFilter}
                                disabled={!selectedField || !value}
                                className="px-3 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Add Filter
                            </button>
                        </div>
                    </div>
                )}

                {!isAddingFilter && (activeDashboard.globalFilters?.length === 0 || !activeDashboard.globalFilters) && (
                    <div className="text-center py-8 text-slate-500">
                        <i className="fas fa-filter text-3xl mb-2 opacity-20"></i>
                        <p className="text-xs">No global filters applied</p>
                    </div>
                )}

                {activeDashboard.globalFilters?.map(filter => (
                    <div key={filter.id} className="bg-slate-900/50 border border-white/5 rounded-lg p-3 group hover:border-indigo-500/30 transition-colors">
                        <div className="flex items-start justify-between">
                            <div>
                                <h4 className="text-xs font-bold text-slate-200">{filter.name}</h4>
                                <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-2">
                                    <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{filter.field}</span>
                                    <span>{filter.operator}</span>
                                    <span className="text-indigo-400 font-mono">{filter.value}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => handleDeleteFilter(filter.id)}
                                className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                            >
                                <i className="fas fa-trash text-xs"></i>
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default GlobalFiltersPanel;
