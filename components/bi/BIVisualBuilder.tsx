// ============================================
// BI Visual Builder - Properties Panel
// ============================================

import React, { useState } from 'react';
import { BIWidget, ChartType, AggregationType, PivotValue } from './types';
import { useDataStore } from './store/dataStore';
import { useDashboardStore } from './store/dashboardStore';
import ColorPicker from './panels/ColorPicker';
import { useDroppable } from '@dnd-kit/core';
import { CHART_COLORS } from './utils/chartColors';
import { getAutoTitle } from './utils/widgetUtils';

interface BIVisualBuilderProps {
    activeWidget?: BIWidget;
    onUpdateWidget?: (widget: BIWidget) => void;
    onAddWidget?: (type: string) => void;
    activeTab: 'visualizations' | 'data' | 'format' | 'filters';
    setActiveTab: (tab: 'visualizations' | 'data' | 'format' | 'filters') => void;
}

const HierarchyFieldSelector: React.FC<{
    label: string;
    hierarchy?: string[];
    fields: any[];
    onChange: (hierarchy: string[]) => void;
    hint?: string;
    placeholder?: string;
    slotId: string;
}> = ({ label, hierarchy = [], fields, onChange, hint, placeholder, slotId }) => {
    const { setNodeRef, isOver } = useDroppable({
        id: slotId,
        data: { slot: slotId }
    });

    const handleAddField = (fieldName: string) => {
        if (!fieldName || hierarchy.includes(fieldName)) return;
        const fieldDef = fields.find(f => f.name === fieldName);
        if (fieldDef?.type === 'date') {
            const timeHierarchy = [
                `${fieldName}.__year`,
                `${fieldName}.__half`,
                `${fieldName}.__quarter`,
                `${fieldName}.__month`,
                `${fieldName}.__day`
            ];
            onChange([...hierarchy, ...timeHierarchy]);
        } else {
            onChange([...hierarchy, fieldName]);
        }
    };

    const handleRemoveField = (index: number) => {
        const newHierarchy = [...hierarchy];
        newHierarchy.splice(index, 1);
        onChange(newHierarchy);
    };

    const handleMoveUp = (index: number) => {
        if (index === 0) return;
        const newHierarchy = [...hierarchy];
        [newHierarchy[index - 1], newHierarchy[index]] = [newHierarchy[index], newHierarchy[index - 1]];
        onChange(newHierarchy);
    };

    const handleMoveDown = (index: number) => {
        if (index === hierarchy.length - 1) return;
        const newHierarchy = [...hierarchy];
        [newHierarchy[index + 1], newHierarchy[index]] = [newHierarchy[index], newHierarchy[index + 1]];
        onChange(newHierarchy);
    };

    const handleAutoTime = (fieldName: string, index: number) => {
        const timeHierarchy = [
            `${fieldName}.__year`,
            `${fieldName}.__half`,
            `${fieldName}.__quarter`,
            `${fieldName}.__month`,
            `${fieldName}.__day`
        ];
        const newHierarchy = [...hierarchy];
        newHierarchy.splice(index, 1, ...timeHierarchy);
        onChange(newHierarchy);
    };

    return (
        <div
            ref={setNodeRef}
            className={`space-y-2 pb-2 border-b border-white/5 last:border-0 last:pb-0 p-2 rounded-lg transition-all hover:bg-white/5 ${isOver ? 'bg-indigo-600/20 ring-2 ring-indigo-500/50' : ''
                }`}
        >
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">
                {label}
            </label>

            {/* Hierarchy List */}
            {hierarchy.length > 0 && (
                <div className="space-y-1.5 mb-2">
                    {hierarchy.map((fieldName, idx) => {
                        const fieldDef = fields.find(f => f.name === fieldName);
                        const isDate = fieldDef?.type === 'date';
                        const isTimePart = fieldName.includes('.__');

                        return (
                            <div key={`${fieldName}-${idx}`} className="flex items-center gap-2 bg-slate-900 border border-white/10 rounded px-2 py-1.5 group">
                                <span className="text-[10px] font-bold text-slate-500 w-4">#{idx + 1}</span>
                                <span className="flex-1 text-xs text-white truncate">
                                    {isTimePart
                                        ? `${fieldName.split('.__')[0]} (${fieldName.split('.__')[1].toUpperCase()})`
                                        : fieldName}
                                </span>
                                <div className="flex items-center gap-1.5">
                                    {isDate && !isTimePart && (
                                        <button
                                            onClick={() => handleAutoTime(fieldName, idx)}
                                            className="text-indigo-400 hover:text-indigo-300 transition-all p-1"
                                            title="Expand into Time Hierarchy (Year, Half, Quarter, Month, Day)"
                                        >
                                            <i className="fas fa-layer-group text-[10px]"></i>
                                        </button>
                                    )}
                                    <button
                                        onClick={() => handleMoveUp(idx)}
                                        disabled={idx === 0}
                                        className="text-slate-500 hover:text-indigo-400 disabled:opacity-0 transition-all"
                                        title="Move Up"
                                    >
                                        <i className="fas fa-chevron-up text-[9px]"></i>
                                    </button>
                                    <button
                                        onClick={() => handleMoveDown(idx)}
                                        disabled={idx === hierarchy.length - 1}
                                        className="text-slate-500 hover:text-indigo-400 disabled:opacity-0 transition-all"
                                        title="Move Down"
                                    >
                                        <i className="fas fa-chevron-down text-[9px]"></i>
                                    </button>
                                    <button
                                        onClick={() => handleRemoveField(idx)}
                                        className="text-slate-500 hover:text-red-400 ml-1"
                                        title="Remove Field"
                                    >
                                        <i className="fas fa-times text-[10px]"></i>
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add Field Dropdown */}
            <select
                value=""
                onChange={(e) => handleAddField(e.target.value)}
                className={`w-full bg-slate-950/50 border border-dashed border-white/20 rounded px-3 py-2 text-xs text-slate-400 focus:ring-1 focus:ring-indigo-500 outline-none hover:border-indigo-500/50 transition-colors ${isOver ? 'border-indigo-500' : ''
                    }`}
            >
                <option value="">+ {placeholder || 'Add level to hierarchy...'}</option>
                {fields.map(field => (
                    <option key={field.name} value={field.name} disabled={hierarchy.includes(field.name)}>
                        {field.name} ({field.type})
                    </option>
                ))}
            </select>

            {hint && <div className="text-[9px] text-slate-500 mt-0.5 ml-1">{hint}</div>}
        </div>
    );
};

const FieldSelector: React.FC<{
    label: string;
    value?: string;
    fields: any[];
    onChange: (val: string) => void;
    aggregation?: AggregationType;
    onAggregationChange?: (agg: AggregationType) => void;
    hint?: string;
    allowNone?: boolean;
    placeholder?: string;
    slotId: string;
}> = ({ label, value, fields, onChange, aggregation, onAggregationChange, hint, allowNone, placeholder, slotId }) => {
    const { setNodeRef, isOver } = useDroppable({
        id: slotId,
        data: { slot: slotId }
    });

    return (
        <div ref={setNodeRef} className={`p-2 rounded-lg transition-all border border-transparent hover:border-white/5 hover:bg-white/5 ${isOver ? 'bg-indigo-600/20 ring-2 ring-indigo-500/50' : ''}`}>
            <div className="flex items-center justify-between mb-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    {label}
                </label>
                {onAggregationChange && value && (
                    <select
                        value={aggregation || 'sum'}
                        onChange={(e) => onAggregationChange(e.target.value as AggregationType)}
                        className="bg-slate-950 text-[10px] text-indigo-400 border border-white/10 rounded px-1.5 py-0.5 outline-none font-bold hover:border-indigo-500/50 transition-colors cursor-pointer"
                    >
                        <option value="sum">SUM</option>
                        <option value="avg">AVG</option>
                        <option value="count">COUNT</option>
                        <option value="countDistinct">DISTINCT</option>
                        <option value="min">MIN</option>
                        <option value="max">MAX</option>
                    </select>
                )}
            </div>
            <select
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                className={`w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none ${isOver ? 'border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.3)]' : ''
                    }`}
            >
                {allowNone ? (
                    <option value="">None (Standard)</option>
                ) : (
                    <option value="">{placeholder || 'Select field...'}</option>
                )}
                {fields.map(field => (
                    <option key={field.name} value={field.name}>
                        {field.name} ({field.type})
                    </option>
                ))}
            </select>
            {hint && <div className="text-[9px] text-slate-500 mt-1">{hint}</div>}
        </div>
    );
};

const PivotValueSelector: React.FC<{
    label: string;
    values?: PivotValue[];
    fields: any[];
    onChange: (values: PivotValue[]) => void;
    slotId: string;
    defaultAxis?: 'left' | 'right';
}> = ({ label, values = [], fields, onChange, slotId, defaultAxis = 'left' }) => {
    const { setNodeRef, isOver } = useDroppable({
        id: slotId,
        data: { slot: slotId }
    });

    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

    const handleAdd = (fieldName: string) => {
        if (!fieldName) return;
        onChange([...values, { field: fieldName, aggregation: 'sum', yAxisId: defaultAxis }]);
    };

    const handleRemove = (index: number) => {
        const newValues = [...values];
        newValues.splice(index, 1);
        onChange(newValues);
    };

    const handleUpdate = (index: number, updates: Partial<PivotValue>) => {
        const newValues = [...values];
        newValues[index] = { ...newValues[index], ...updates };
        onChange(newValues);
    };

    const handleAddRule = (index: number) => {
        const newValues = [...values];
        const currentRules = newValues[index].conditionalFormatting || [];
        newValues[index] = {
            ...newValues[index],
            conditionalFormatting: [
                ...currentRules,
                { condition: 'greater', value: 0, textColor: '#10b981' }
            ]
        };
        onChange(newValues);
    };

    const handleUpdateRule = (valIndex: number, ruleIndex: number, updates: any) => {
        const newValues = [...values];
        const rules = [...(newValues[valIndex].conditionalFormatting || [])];
        rules[ruleIndex] = { ...rules[ruleIndex], ...updates };
        newValues[valIndex] = { ...newValues[valIndex], conditionalFormatting: rules };
        onChange(newValues);
    };

    const handleRemoveRule = (valIndex: number, ruleIndex: number) => {
        const newValues = [...values];
        const rules = [...(newValues[valIndex].conditionalFormatting || [])];
        rules.splice(ruleIndex, 1);
        newValues[valIndex] = { ...newValues[valIndex], conditionalFormatting: rules };
        onChange(newValues);
    };

    return (
        <div ref={setNodeRef} className={`space-y-2 p-2 rounded-lg transition-all ${isOver ? 'bg-indigo-600/20 ring-2 ring-indigo-500/50' : ''}`}>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">{label}</label>
            <div className="space-y-2">
                {values.map((v, idx) => (
                    <div key={`${v.field}-${idx}`} className="bg-slate-900 border border-white/5 rounded p-2">
                        <div className="flex items-center gap-1.5 mb-1">
                            <span className="flex-1 text-[11px] text-white truncate font-bold">{v.field}</span>
                            <button
                                onClick={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
                                className={`p-1 rounded text-[8px] uppercase font-bold border transition-colors ${expandedIndex === idx ? 'bg-indigo-500 text-white border-indigo-400' : 'bg-slate-950 text-slate-400 border-white/10 hover:text-white'}`}
                            >
                                <i className="fas fa-paint-brush mr-1"></i>
                                Rules
                            </button>
                            <button onClick={() => handleRemove(idx)} className="text-slate-600 hover:text-red-400 p-0.5 ml-1">
                                <i className="fas fa-times text-[10px]"></i>
                            </button>
                        </div>

                        <div className="flex items-center gap-1 mb-1">
                            <div className="flex items-center gap-1 bg-slate-950 rounded p-0.5 border border-white/10">
                                <button
                                    onClick={() => handleUpdate(idx, { yAxisId: 'left' })}
                                    className={`px-1.5 py-0.5 rounded text-[8px] font-black tracking-tighter transition-colors ${v.yAxisId === 'left' || !v.yAxisId ? 'bg-indigo-500 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    L
                                </button>
                                <button
                                    onClick={() => handleUpdate(idx, { yAxisId: 'right' })}
                                    className={`px-1.5 py-0.5 rounded text-[8px] font-black tracking-tighter transition-colors ${v.yAxisId === 'right' ? 'bg-indigo-500 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    R
                                </button>
                            </div>
                            <select
                                value={v.aggregation}
                                onChange={(e) => handleUpdate(idx, { aggregation: e.target.value as any })}
                                className="flex-1 bg-slate-950 text-[10px] text-indigo-400 border border-white/10 rounded px-1 outline-none py-0.5"
                            >
                                <option value="sum">SUM</option>
                                <option value="avg">AVG</option>
                                <option value="count">COUNT</option>
                                <option value="min">MIN</option>
                                <option value="max">MAX</option>
                                <option value="countDistinct">DISTINCT</option>
                            </select>
                            <select
                                value={v.format || 'standard'}
                                onChange={(e) => handleUpdate(idx, { format: e.target.value })}
                                className="flex-1 bg-slate-950 text-[10px] text-slate-400 border border-white/10 rounded px-1 outline-none py-0.5"
                            >
                                <option value="standard">Std</option>
                                <option value="integer">Int</option>
                                <option value="compact">Cpt</option>
                                <option value="currency_vnd">VND</option>
                                <option value="currency_usd">USD</option>
                                <option value="percentage">%</option>
                                <option value="percentage_2">%.2f</option>
                            </select>
                        </div>

                        {/* Conditional Formatting Rules UI */}
                        {expandedIndex === idx && (
                            <div className="mt-2 pt-2 border-t border-white/5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-slate-500 font-bold uppercase">Formatting Rules</span>
                                    <button onClick={() => handleAddRule(idx)} className="text-[9px] text-indigo-400 hover:text-white">+ Add Rule</button>
                                </div>
                                {v.conditionalFormatting?.map((rule, rIdx) => (
                                    <div key={rIdx} className="flex items-center gap-1 bg-slate-950 p-1 rounded border border-white/5">
                                        <select
                                            value={rule.condition}
                                            onChange={(e) => handleUpdateRule(idx, rIdx, { condition: e.target.value })}
                                            className="w-[55px] bg-transparent text-[9px] text-slate-300 outline-none border-none py-0"
                                        >
                                            <option value="greater">&gt;</option>
                                            <option value="less">&lt;</option>
                                            <option value="equal">=</option>
                                            <option value="between">btw</option>
                                        </select>
                                        <input
                                            type="number"
                                            value={rule.value}
                                            onChange={(e) => handleUpdateRule(idx, rIdx, { value: e.target.value })}
                                            className="w-[40px] bg-white/5 text-[9px] text-white rounded px-1 border-none focus:ring-1 focus:ring-indigo-500"
                                            placeholder="Val"
                                        />
                                        {rule.condition === 'between' && (
                                            <input
                                                type="number"
                                                value={rule.value2}
                                                onChange={(e) => handleUpdateRule(idx, rIdx, { value2: e.target.value })}
                                                className="w-[40px] bg-white/5 text-[9px] text-white rounded px-1 border-none focus:ring-1 focus:ring-indigo-500"
                                                placeholder="Val2"
                                            />
                                        )}
                                        <select
                                            value={rule.textColor || rule.backgroundColor || ''}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                const updates: any = { textColor: undefined, backgroundColor: undefined };
                                                if (val.startsWith('text:')) updates.textColor = val.split(':')[1];
                                                else if (val.startsWith('bg:')) updates.backgroundColor = val.split(':')[1];
                                                handleUpdateRule(idx, rIdx, updates);
                                            }}
                                            className="w-[60px] bg-transparent text-[9px] text-indigo-400 outline-none border-none py-0"
                                        >
                                            <option value="text:#10b981">Green Txt</option>
                                            <option value="text:#ef4444">Red Txt</option>
                                            <option value="text:#f59e0b">Amber Txt</option>
                                            <option value="text:#ffffff">White Txt</option>
                                            <option value="bg:#064e3b">Green Bg</option>
                                            <option value="bg:#7f1d1d">Red Bg</option>
                                            <option value="bg:#78350f">Amber Bg</option>
                                        </select>
                                        <button onClick={() => handleRemoveRule(idx, rIdx)} className="text-slate-600 hover:text-red-400 px-1">
                                            ×
                                        </button>
                                    </div>
                                ))}
                                {(!v.conditionalFormatting || v.conditionalFormatting.length === 0) && (
                                    <div className="text-[8px] text-slate-600 text-center italic">No rules defined</div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <select
                value=""
                onChange={(e) => handleAdd(e.target.value)}
                className="w-full bg-slate-950/30 border border-dashed border-white/10 rounded px-2 py-1.5 text-[10px] text-slate-500 outline-none hover:border-indigo-500/50 mt-1"
            >
                <option value="">+ Add value...</option>
                {fields.filter(f => f.type === 'number').map(f => (
                    <option key={f.name} value={f.name}>{f.name} ({f.type})</option>
                ))}
            </select>
        </div>
    );
};



const BIVisualBuilder: React.FC<BIVisualBuilderProps> = ({
    activeWidget,
    onUpdateWidget,
    onAddWidget,
    activeTab,
    setActiveTab
}) => {
    const { dataSources, selectedDataSourceId, setSelectedDataSource } = useDataStore();
    const { getActiveDashboard, updateWidget, updateDashboard, syncDashboardDataSource, syncPageDataSource } = useDashboardStore();



    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));
    const activePage = activeDashboard?.pages?.find(p => p.id === (activeDashboard as any).activePageId);
    const editingWidgetId = useDashboardStore(state => state.editingWidgetId);

    const [isAddingCalc, setIsAddingCalc] = useState(false);
    const [newCalcName, setNewCalcName] = useState('');
    const [newCalcFormula, setNewCalcFormula] = useState('');
    const [dsSearchQuery, setDsSearchQuery] = useState('');

    // Quick Measure State
    const [isAddingMeasure, setIsAddingMeasure] = useState(false);
    const [newMeasureLabel, setNewMeasureLabel] = useState('');
    const [newMeasureField, setNewMeasureField] = useState('');
    const [newMeasureType, setNewMeasureType] = useState('percentOfTotal');
    const [newMeasureWindow, setNewMeasureWindow] = useState('3');

    // Visualization types
    const visualizations: { type: ChartType; icon: string; label: string }[] = [
        { type: 'bar', icon: 'fa-chart-column', label: 'Clustered Column' },
        { type: 'stackedBar', icon: 'fa-layer-group', label: 'Stacked Column' },
        { type: 'horizontalBar', icon: 'fa-chart-bar', label: 'Horizontal Bar' },
        { type: 'line', icon: 'fa-chart-line', label: 'Line Chart' },
        { type: 'pie', icon: 'fa-chart-pie', label: 'Pie Chart' },
        { type: 'donut', icon: 'fa-circle-dot', label: 'Donut Chart' },
        { type: 'scatter', icon: 'fa-braille', label: 'Scatter Plot' },
        { type: 'combo', icon: 'fa-chart-line', label: 'Combo Chart' },
        { type: 'pivot' as any, icon: 'fa-table-cells-large', label: 'Pivot Table' }
    ];

    const handleUpdateWidget = (updates: Partial<BIWidget>) => {
        if (!activeWidget || !activeDashboard) return;

        // Ensure we handle arrays correctly for Y-Axis if it's sent as a single value
        if (updates.yAxis && !Array.isArray(updates.yAxis)) {
            updates.yAxis = [updates.yAxis as any];
        }

        // AUTO-BIND data source if widget doesn't have one but dashboard/editor does
        if (!activeWidget.dataSourceId && effectiveDataSourceId) {
            updates.dataSourceId = effectiveDataSourceId as string;
        }

        // --- AUTO TITLE LOGIC ---
        // We calculate the NEXT state of the widget to generate the title
        const nextWidgetState = { ...activeWidget, ...updates };

        // Define default titles that should be overwritten
        const currentTitle = activeWidget.title || '';
        const isDefaultTitle =
            currentTitle === 'New Chart' ||
            currentTitle === 'New Card' ||
            currentTitle === 'Pivot Table' ||
            currentTitle === 'Table' ||
            currentTitle === 'Slicer' ||
            currentTitle === '' ||
            currentTitle.startsWith('New ');

        // Check if relevant fields have changed
        const fieldsChanged =
            updates.xAxis !== undefined ||
            updates.yAxis !== undefined ||
            updates.pivotRows !== undefined ||
            updates.pivotValues !== undefined ||
            updates.metric !== undefined ||
            updates.legend !== undefined ||
            updates.slicerField !== undefined;

        if (isDefaultTitle && fieldsChanged) {
            const newTitle = getAutoTitle(nextWidgetState as BIWidget);
            // Only update if we got a meaningful title (not fallback)
            if (newTitle !== 'New Chart' && newTitle !== 'Pivot Table' && newTitle !== 'New Card') {
                updates.title = newTitle;
            }
        }
        // ------------------------

        const updated = { ...activeWidget, ...updates };
        updateWidget(activeDashboard.id, activeWidget.id, updates);

        if (onUpdateWidget) {
            onUpdateWidget(updated);
        }
    };

    const handleColorChange = (index: number, newColor: string) => {
        const currentColors = activeWidget?.colors || ['#6366f1', '#ec4899', '#8b5cf6', '#14b8a6', '#f59e0b', '#ef4444', '#f97316', '#84cc16'];
        const newColors = [...currentColors];
        newColors[index] = newColor;
        handleUpdateWidget({ colors: newColors });
    };

    const handleAddVisualization = (chartType: ChartType) => {
        if (onAddWidget) {
            onAddWidget(chartType);
        }
    };

    const handleAddCalculation = () => {
        if (!newCalcName || !newCalcFormula || !activeDashboard) return;
        const newField = {
            id: `calc-${Date.now()}`,
            name: newCalcName,
            formula: newCalcFormula,
            type: 'number' as const
        };
        const currentCalcs = activeDashboard.calculatedFields || [];
        updateDashboard(activeDashboard.id, {
            calculatedFields: [...currentCalcs, newField]
        });
        setIsAddingCalc(false);
        setNewCalcName('');
        setNewCalcFormula('');
    };

    const handleDeleteCalculation = (id: string) => {
        if (!activeDashboard) return;
        // Check dashboard level
        const dashCalcs = activeDashboard.calculatedFields || [];
        if (dashCalcs.find(c => c.id === id)) {
            updateDashboard(activeDashboard.id, {
                calculatedFields: dashCalcs.filter(c => c.id !== id)
            });
            return;
        }
        // Fallback to widget level
        const widgetCalcs = activeWidget?.calculatedFields || [];
        handleUpdateWidget({ calculatedFields: widgetCalcs.filter(c => c.id !== id) });
    };

    const handleAddMeasure = () => {
        if (!newMeasureLabel || !newMeasureField || !activeDashboard) return;
        const newMeasure = {
            id: `qm-${Date.now()}`,
            label: newMeasureLabel,
            field: newMeasureField,
            calculation: newMeasureType as any,
            window: newMeasureType === 'movingAverage' ? parseInt(newMeasureWindow) : undefined
        };
        const currentMeasures = activeDashboard.quickMeasures || [];
        updateDashboard(activeDashboard.id, {
            quickMeasures: [...currentMeasures, newMeasure]
        });
        setIsAddingMeasure(false);
        setNewMeasureLabel('');
        setNewMeasureField('');
        setNewMeasureType('percentOfTotal');
    };

    const handleDeleteMeasure = (id: string) => {
        if (!activeDashboard) return;
        const dashMeasures = activeDashboard.quickMeasures || [];
        if (dashMeasures.find(m => m.id === id)) {
            updateDashboard(activeDashboard.id, {
                quickMeasures: dashMeasures.filter(m => m.id !== id)
            });
            return;
        }
        const widgetMeasures = activeWidget?.quickMeasures || [];
        handleUpdateWidget({ quickMeasures: widgetMeasures.filter(m => m.id !== id) });
    };

    // Get fields for selected data source
    // Get fields for selected data source + calculated fields
    const effectiveDataSourceId = activeWidget?.dataSourceId || activePage?.dataSourceId || activeDashboard?.dataSourceId || selectedDataSourceId;
    const availableFields = effectiveDataSourceId
        ? dataSources.find(ds => ds.id === effectiveDataSourceId)?.schema || []
        : [];

    const dashboardCalculatedFields = activeDashboard?.calculatedFields?.map(c => ({
        name: c.name,
        type: c.type || 'number',
        isCalculated: true
    })) || [];

    const widgetCalculatedFields = activeWidget?.calculatedFields?.map(c => ({
        name: c.name,
        type: c.type || 'number',
        isCalculated: true
    })) || [];

    const dashboardQuickMeasures = activeDashboard?.quickMeasures?.map(m => ({
        name: m.label,
        type: 'number',
        isCalculated: true
    })) || [];

    const widgetQuickMeasures = activeWidget?.quickMeasures?.map(m => ({
        name: m.label,
        type: 'number',
        isCalculated: true
    })) || [];

    const fields = [
        ...availableFields,
        ...dashboardCalculatedFields,
        ...widgetCalculatedFields,
        ...dashboardQuickMeasures,
        ...widgetQuickMeasures
    ];

    return (
        <div className="flex flex-col h-full bg-slate-950">
            {/* Tabs */}
            <div className="flex border-b border-white/5">
                <button
                    onClick={() => setActiveTab('visualizations')}
                    className={`flex-1 px-3 py-2 text-xs font-bold transition-colors ${activeTab === 'visualizations'
                        ? 'text-indigo-400 border-b-2 border-indigo-400'
                        : 'text-slate-400 hover:text-white'
                        }`}
                >
                    <i className="fas fa-shapes mr-2"></i>
                    Visuals
                </button>
                <button
                    onClick={() => setActiveTab('data')}
                    className={`flex-1 px-3 py-2 text-xs font-bold transition-colors ${activeTab === 'data'
                        ? 'text-indigo-400 border-b-2 border-indigo-400'
                        : 'text-slate-400 hover:text-white'
                        }`}
                >
                    <i className="fas fa-database mr-2"></i>
                    Pivot
                </button>
                <button
                    onClick={() => setActiveTab('format')}
                    className={`flex-1 px-3 py-2 text-xs font-bold transition-colors ${activeTab === 'format'
                        ? 'text-indigo-400 border-b-2 border-indigo-400'
                        : 'text-slate-400 hover:text-white'
                        }`}
                >
                    <i className="fas fa-palette mr-2"></i>
                    Format
                </button>
                <button
                    onClick={() => setActiveTab('filters')}
                    className={`flex-1 px-3 py-2 text-xs font-bold transition-colors ${activeTab === 'filters'
                        ? 'text-indigo-400 border-b-2 border-indigo-400'
                        : 'text-slate-400 hover:text-white'
                        }`}
                >
                    <i className="fas fa-filter mr-2"></i>
                    Filters
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {/* Visualizations Tab */}
                {activeTab === 'visualizations' && (
                    <div className="space-y-3">
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">Chart Types</h4>
                        <div className="grid grid-cols-2 gap-2">
                            {visualizations.map((viz) => {
                                const isActive = activeWidget && (
                                    (activeWidget.type === 'chart' && activeWidget.chartType === viz.type) ||
                                    (activeWidget.type === (viz.type as any))
                                );

                                return (
                                    <button
                                        key={viz.type}
                                        onClick={() => handleAddVisualization(viz.type)}
                                        className={`p-3 rounded-lg transition-all group border-2 ${isActive
                                            ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.3)]'
                                            : 'bg-slate-900/50 border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10'
                                            }`}
                                    >
                                        <i className={`fas ${viz.icon} text-2xl ${isActive ? 'text-indigo-400' : 'text-slate-400'} group-hover:text-indigo-400 mb-2`}></i>
                                        <div className={`text-[10px] ${isActive ? 'text-white' : 'text-slate-400'} group-hover:text-white font-bold`}>{viz.label}</div>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="pt-3 border-t border-white/5">
                            <button
                                onClick={() => onAddWidget?.('card')}
                                className={`w-full p-3 rounded-lg border transition-all text-left ${activeWidget?.type === 'card'
                                    ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : 'bg-slate-900/50 border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-bolt text-lg ${activeWidget?.type === 'card' ? 'text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'card' ? 'text-white' : 'text-slate-400'}`}>KPI Card</span>
                            </button>

                            <button
                                onClick={() => onAddWidget?.('table')}
                                className={`w-full p-3 rounded-lg border transition-all text-left mt-2 ${activeWidget?.type === 'table'
                                    ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : 'bg-slate-900/50 border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-table-list text-lg ${activeWidget?.type === 'table' ? 'text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'table' ? 'text-white' : 'text-slate-400'}`}>Data Table</span>
                            </button>

                            <button
                                onClick={() => onAddWidget?.('slicer')}
                                className={`w-full p-3 rounded-lg border transition-all text-left mt-2 ${activeWidget?.type === 'slicer'
                                    ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : 'bg-slate-900/50 border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-filter text-lg ${activeWidget?.type === 'slicer' ? 'text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'slicer' ? 'text-white' : 'text-slate-400'}`}>Filter Slicer</span>
                            </button>

                            <button
                                onClick={() => onAddWidget?.('date-range')}
                                className={`w-full p-3 rounded-lg border transition-all text-left mt-2 ${activeWidget?.type === 'date-range'
                                    ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : 'bg-slate-900/50 border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-calendar-days text-lg ${activeWidget?.type === 'date-range' ? 'text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'date-range' ? 'text-white' : 'text-slate-400'}`}>Date Range</span>
                            </button>

                            <button
                                onClick={() => onAddWidget?.('search')}
                                className={`w-full p-3 rounded-lg border transition-all text-left mt-2 ${activeWidget?.type === 'search'
                                    ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : 'bg-slate-900/50 border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-magnifying-glass text-lg ${activeWidget?.type === 'search' ? 'text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'search' ? 'text-white' : 'text-slate-400'}`}>Search Box</span>
                            </button>

                            <button
                                onClick={() => onAddWidget?.('pivot')}
                                className={`w-full p-3 rounded-lg border transition-all text-left mt-2 ${activeWidget?.type === 'pivot'
                                    ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : 'bg-slate-900/50 border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-table-cells text-lg ${activeWidget?.type === 'pivot' ? 'text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'pivot' ? 'text-white' : 'text-slate-400'}`}>Pivot Table</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Data Tab */}
                {activeTab === 'data' && (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                Data Tables
                            </label>
                            <div className="relative mb-2">
                                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[10px]"></i>
                                <input
                                    type="text"
                                    value={dsSearchQuery}
                                    onChange={(e) => setDsSearchQuery(e.target.value)}
                                    placeholder="Tìm kiếm bảng..."
                                    className="w-full bg-slate-900 border border-white/5 rounded-lg pl-8 pr-3 py-1.5 text-[10px] text-white focus:ring-1 focus:ring-indigo-500 focus:outline-none placeholder-slate-600 transition-all"
                                />
                            </div>
                            <select
                                value={activeWidget?.dataSourceId || activePage?.dataSourceId || activeDashboard?.dataSourceId || selectedDataSourceId || ''}
                                onChange={(e) => {
                                    const dsId = e.target.value;
                                    const dashboard = getActiveDashboard();
                                    if (dashboard) {
                                        if (editingWidgetId) {
                                            if (activeWidget) {
                                                onUpdateWidget({ ...activeWidget, dataSourceId: dsId });
                                            }
                                        } else if (dashboard.activePageId) {
                                            syncPageDataSource(dashboard.id, dashboard.activePageId, dsId);
                                        } else {
                                            syncDashboardDataSource(dashboard.id, dsId);
                                        }
                                    }
                                    setSelectedDataSource(dsId);
                                }}
                                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            >
                                <option value="">Select data table...</option>
                                {dataSources
                                    .filter(ds => {
                                        const displayName = (ds.datasetName && ds.tableName
                                            ? `[${ds.datasetName}] ${ds.tableName}`
                                            : `[${ds.type.toUpperCase()}] ${ds.name}`).toLowerCase();
                                        return displayName.includes(dsSearchQuery.toLowerCase());
                                    })
                                    .map(ds => {
                                        const displayName = ds.datasetName && ds.tableName
                                            ? `[${ds.datasetName}] ${ds.tableName}`
                                            : `[${ds.type.toUpperCase()}] ${ds.name}`;

                                        return (
                                            <option key={ds.id} value={ds.id}>{displayName}</option>
                                        );
                                    })}
                            </select>
                            {(effectiveDataSourceId) && (() => {
                                const ds = dataSources.find(ds => ds.id === effectiveDataSourceId);
                                const isLoaded = ds?.isLoaded;
                                const isLoadingPartial = ds?.isLoadingPartial;
                                const rowCount = ds?.data.length || 0;
                                const totalRows = ds?.totalRows || 0;
                                const progress = totalRows > 0 ? Math.round((rowCount / totalRows) * 100) : 0;

                                return (
                                    <div className="space-y-2 mt-2">
                                        <div className="flex items-center justify-between text-[10px] bg-slate-900/50 border border-white/5 rounded p-1.5 px-2">
                                            <span className="text-slate-500 font-black uppercase tracking-tighter">Status</span>
                                            {isLoaded ? (
                                                <span className="text-emerald-400 font-black flex items-center gap-1.5 line-clamp-1">
                                                    <i className="fas fa-check-circle text-[8px]"></i>
                                                    {rowCount.toLocaleString()} Dòng (100%)
                                                </span>
                                            ) : isLoadingPartial ? (
                                                <span className="text-amber-400 font-black animate-pulse flex items-center gap-1.5 line-clamp-1">
                                                    <i className="fas fa-spinner fa-spin text-[8px]"></i>
                                                    {rowCount.toLocaleString()} {totalRows > 0 ? `/ ${totalRows.toLocaleString()}` : ''} ({progress}%)
                                                </span>
                                            ) : rowCount > 0 ? (
                                                <span className="text-indigo-400 font-black flex items-center gap-1.5 line-clamp-1">
                                                    <i className="fas fa-database text-[8px]"></i>
                                                    {rowCount.toLocaleString()}
                                                    {totalRows > 0 ? (
                                                        ` / ${totalRows.toLocaleString()} (${progress}%)`
                                                    ) : (
                                                        ' Dòng'
                                                    )}
                                                </span>
                                            ) : (
                                                <span className="text-slate-500 font-black flex items-center gap-1.5">
                                                    <i className="fas fa-circle-notch text-[8px] opacity-30"></i>
                                                    Chưa tải
                                                </span>
                                            )}
                                        </div>

                                        {!isLoaded && totalRows > 0 && rowCount < totalRows && (
                                            <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden border border-white/5">
                                                <div
                                                    className="h-full bg-indigo-500 transition-all duration-500 ease-out shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>

                        {!activeWidget && (
                            <div className="flex flex-col items-center justify-center pt-10 text-center opacity-40">
                                <i className="fas fa-mouse-pointer text-3xl mb-3 text-slate-600"></i>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-6 leading-relaxed">
                                    Selected table: <span className="text-indigo-400 italic">{(dataSources.find(ds => ds.id === effectiveDataSourceId)?.name || 'none')}</span>
                                    <br />
                                    Select a widget to bind fields
                                </p>
                            </div>
                        )}

                        {activeWidget && (
                            <>

                                {/* Date Range Configuration */}
                                {activeWidget.type === 'date-range' && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                                Date Field
                                            </label>
                                            <select
                                                value={activeWidget.slicerField || ''}
                                                onChange={(e) => handleUpdateWidget({ slicerField: e.target.value })}
                                                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                            >
                                                <option value="">Select date field...</option>
                                                {fields.filter(f => f.type === 'date' || f.name.toLowerCase().includes('date') || f.name.toLowerCase().includes('time')).map(field => (
                                                    <option key={field.name} value={field.name}>
                                                        {field.name} ({field.type})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}

                                {/* Search Configuration */}
                                {activeWidget.type === 'search' && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                                Search Field
                                            </label>
                                            <select
                                                value={activeWidget.slicerField || ''}
                                                onChange={(e) => handleUpdateWidget({ slicerField: e.target.value })}
                                                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                            >
                                                <option value="">Select text field...</option>
                                                {fields.filter(f => f.type === 'string').map(field => (
                                                    <option key={field.name} value={field.name}>
                                                        {field.name} ({field.type})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}

                                {/* Widget Specific Configurations */}
                                {effectiveDataSourceId && fields.length > 0 && (() => {
                                    const type = activeWidget.chartType || activeWidget.type;

                                    // BAR / LINE / HORIZONTAL BAR / STACKED BAR / COMBO
                                    if (['bar', 'line', 'horizontalBar', 'stackedBar', 'combo'].includes(type as string)) {
                                        const totalSeries = (activeWidget.yAxisConfigs?.length || 0) + (activeWidget.lineAxisConfigs?.length || 0);
                                        const showLegendField = totalSeries <= 1;

                                        return (
                                            <div className="space-y-4">
                                                <HierarchyFieldSelector
                                                    label="X-Axis / Category (Hierarchy)"
                                                    hierarchy={activeWidget.drillDownHierarchy}
                                                    fields={fields}
                                                    onChange={(h) => handleUpdateWidget({
                                                        drillDownHierarchy: h,
                                                        xAxis: h[0] || ''
                                                    })}
                                                    placeholder="Add X-Axis level..."
                                                    slotId="xAxis-hierarchy"
                                                />
                                                <PivotValueSelector
                                                    label="Y-Axis / Values (Column/Line)"
                                                    values={activeWidget.yAxisConfigs}
                                                    fields={fields}
                                                    onChange={(v) => {
                                                        const isStacked = type === 'stackedBar' || activeWidget.stacked === true;
                                                        handleUpdateWidget({
                                                            yAxisConfigs: v,
                                                            stacked: isStacked,
                                                            chartType: isStacked ? 'bar' : type as ChartType
                                                        });
                                                    }}
                                                    slotId="yAxis-multi"
                                                    defaultAxis="left"
                                                />
                                                <PivotValueSelector
                                                    label="Line / Values (Combo Chart)"
                                                    values={activeWidget.lineAxisConfigs}
                                                    fields={fields}
                                                    onChange={(v) => {
                                                        handleUpdateWidget({
                                                            lineAxisConfigs: v
                                                        });
                                                    }}
                                                    slotId="lineAxis-multi"
                                                    defaultAxis="right"
                                                />
                                                {(!activeWidget.yAxisConfigs || activeWidget.yAxisConfigs.length === 0) && (
                                                    <FieldSelector
                                                        label="Y-Axis / Value (Simple)"
                                                        value={activeWidget.yAxis?.[0]}
                                                        fields={fields}
                                                        onChange={(val) => handleUpdateWidget({
                                                            yAxis: [val],
                                                            yAxisConfigs: [{ field: val, aggregation: activeWidget.aggregation || 'sum', yAxisId: 'left' }]
                                                        })}
                                                        aggregation={activeWidget.aggregation}
                                                        onAggregationChange={(agg) => handleUpdateWidget({ aggregation: agg })}
                                                        hint="💡 Use the multi-selector above for multiple series"
                                                        slotId="yAxis"
                                                    />
                                                )}

                                                {showLegendField && (
                                                    <HierarchyFieldSelector
                                                        label="Legend / Stack (Hierarchy)"
                                                        hierarchy={activeWidget.legendHierarchy}
                                                        fields={fields.filter(f => f.type === 'string')}
                                                        onChange={(h) => handleUpdateWidget({
                                                            legendHierarchy: h,
                                                            legend: h[0] || ''
                                                        })}
                                                        placeholder="Add legend level..."
                                                        hint="💡 Group data by these fields"
                                                        slotId="legend-hierarchy"
                                                    />
                                                )}

                                                <div className="pt-2 border-t border-white/5">
                                                    <label className="text-[10px] text-slate-400 font-bold uppercase mb-2 block">Sort Order</label>
                                                    <div className="flex bg-slate-800 rounded-lg p-1 gap-1">
                                                        <button
                                                            onClick={() => handleUpdateWidget({ sortBy: 'none' })}
                                                            className={`flex-1 py-1.5 px-2 rounded-md text-[10px] font-bold transition-all ${!activeWidget.sortBy || activeWidget.sortBy === 'none' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            Default
                                                        </button>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ sortBy: 'value_desc' })}
                                                            className={`flex-1 py-1.5 px-2 rounded-md text-[10px] font-bold transition-all ${activeWidget.sortBy === 'value_desc' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            High → Low
                                                        </button>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ sortBy: 'value_asc' })}
                                                            className={`flex-1 py-1.5 px-2 rounded-md text-[10px] font-bold transition-all ${activeWidget.sortBy === 'value_asc' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            Low → High
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }

                                    // PIE / DONUT
                                    if (['pie', 'donut'].includes(type as string)) {
                                        return (
                                            <div className="space-y-4">
                                                <HierarchyFieldSelector
                                                    label="Category / Slices (Hierarchy)"
                                                    hierarchy={activeWidget.drillDownHierarchy}
                                                    fields={fields}
                                                    onChange={(h) => handleUpdateWidget({
                                                        drillDownHierarchy: h,
                                                        xAxis: h[0] || ''
                                                    })}
                                                    placeholder="Add category level..."
                                                    slotId="xAxis-hierarchy"
                                                />
                                                <FieldSelector
                                                    label="Value (Size)"
                                                    value={activeWidget.yAxis?.[0]}
                                                    fields={fields}
                                                    onChange={(val) => handleUpdateWidget({ yAxis: [val] })}
                                                    aggregation={activeWidget.aggregation}
                                                    onAggregationChange={(agg) => handleUpdateWidget({ aggregation: agg })}
                                                    slotId="yAxis"
                                                />
                                            </div>
                                        );
                                    }

                                    // SCATTER
                                    if (type === 'scatter') {
                                        return (
                                            <div className="space-y-4">
                                                <FieldSelector
                                                    label="X-Axis (Numeric/Date)"
                                                    value={activeWidget.xAxis}
                                                    fields={fields}
                                                    onChange={(val) => handleUpdateWidget({ xAxis: val })}
                                                    hint="Select a numeric or date field for X axis"
                                                    slotId="xAxis"
                                                />
                                                <FieldSelector
                                                    label="Y-Axis (Numeric)"
                                                    value={activeWidget.yAxis?.[0]}
                                                    fields={fields}
                                                    onChange={(val) => handleUpdateWidget({ yAxis: [val, activeWidget.yAxis?.[1] || ''] })}
                                                    aggregation={activeWidget.aggregation}
                                                    onAggregationChange={(agg) => handleUpdateWidget({ aggregation: agg })}
                                                    hint="Select a numeric field for Y axis"
                                                    slotId="yAxis"
                                                />
                                                <FieldSelector
                                                    label="Bubble Size (Optional)"
                                                    value={activeWidget.yAxis?.[1]}
                                                    fields={fields}
                                                    onChange={(val) => handleUpdateWidget({ yAxis: [activeWidget.yAxis?.[0] || '', val] })}
                                                    aggregation={activeWidget.aggregation}
                                                    onAggregationChange={(agg) => handleUpdateWidget({ aggregation: agg })}
                                                    allowNone
                                                    hint="Select a field to control bubble size"
                                                    slotId="yAxis-size"
                                                />
                                                <HierarchyFieldSelector
                                                    label="Legend / Category"
                                                    hierarchy={activeWidget.legendHierarchy}
                                                    fields={fields.filter(f => f.type === 'string')}
                                                    onChange={(h) => handleUpdateWidget({
                                                        legendHierarchy: h,
                                                        legend: h[0] || ''
                                                    })}
                                                    placeholder="Add category..."
                                                    slotId="legend-hierarchy"
                                                />
                                            </div>
                                        );
                                    }



                                    // KPI CARD
                                    if (activeWidget.type === 'card') {
                                        return (
                                            <div className="space-y-4">
                                                <FieldSelector
                                                    label="Primary Metric"
                                                    value={activeWidget.yAxis?.[0]}
                                                    fields={fields}
                                                    onChange={(val) => handleUpdateWidget({ yAxis: [val] })}
                                                    aggregation={activeWidget.aggregation}
                                                    onAggregationChange={(agg) => handleUpdateWidget({ aggregation: agg })}
                                                    slotId="yAxis"
                                                />
                                                <FieldSelector
                                                    label="Comparison Value (Optional)"
                                                    value={activeWidget.comparisonValue}
                                                    fields={fields}
                                                    onChange={(val) => handleUpdateWidget({ comparisonValue: val })}
                                                    allowNone
                                                    slotId="yAxis-comparison"
                                                />
                                            </div>
                                        );
                                    }

                                    // TABLE
                                    if (activeWidget.type === 'table') {
                                        return (
                                            <div className="space-y-4">
                                                <div className="p-3 border border-dashed border-white/10 rounded-lg text-center bg-slate-900/30">
                                                    <p className="text-[10px] text-slate-500 mb-2">Drag fields from Sidebar or select below</p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {activeWidget.columns?.map(col => (
                                                            <div key={col.field} className="px-2 py-1 bg-indigo-500/20 rounded text-[10px] text-indigo-300 flex items-center gap-1">
                                                                {col.header}
                                                                <button onClick={() => {
                                                                    const newCols = activeWidget.columns?.filter(c => c.field !== col.field);
                                                                    handleUpdateWidget({ columns: newCols });
                                                                }} className="hover:text-red-400">
                                                                    ×
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <FieldSelector
                                                    label="Add Column"
                                                    value=""
                                                    fields={fields.filter(f => !activeWidget.columns?.find(c => c.field === f.name))}
                                                    onChange={(val) => {
                                                        if (!val) return;
                                                        const newCol = { field: val, header: val };
                                                        handleUpdateWidget({ columns: [...(activeWidget.columns || []), newCol] });
                                                    }}
                                                    placeholder="Select field to add..."
                                                    slotId="table-columns"
                                                />
                                            </div>
                                        );
                                    }

                                    // GAUGE
                                    if (activeWidget.type === 'gauge') {
                                        return (
                                            <div className="space-y-4">
                                                <FieldSelector
                                                    label="Current Value"
                                                    value={activeWidget.yAxis?.[0]}
                                                    fields={fields}
                                                    onChange={(val) => handleUpdateWidget({ yAxis: [val] })}
                                                    aggregation={activeWidget.aggregation}
                                                    onAggregationChange={(agg) => handleUpdateWidget({ aggregation: agg })}
                                                    slotId="yAxis"
                                                />
                                            </div>
                                        );
                                    }
                                    // PIVOT TABLE
                                    if (activeWidget.type === 'pivot') {
                                        return (
                                            <div className="space-y-4">
                                                <HierarchyFieldSelector
                                                    label="Rows (Hierarchy)"
                                                    hierarchy={activeWidget.pivotRows}
                                                    fields={fields}
                                                    onChange={(h) => handleUpdateWidget({ pivotRows: h })}
                                                    placeholder="Add row level..."
                                                    slotId="pivot-rows"
                                                />
                                                <HierarchyFieldSelector
                                                    label="Columns (Optional)"
                                                    hierarchy={activeWidget.pivotCols}
                                                    fields={fields}
                                                    onChange={(h) => handleUpdateWidget({ pivotCols: h })}
                                                    placeholder="Add column level..."
                                                    slotId="pivot-cols"
                                                    hint="💡 Leave empty for a simple summary table"
                                                />
                                                <PivotValueSelector
                                                    label="Values / Aggregations"
                                                    values={activeWidget.pivotValues}
                                                    fields={fields}
                                                    onChange={(v) => handleUpdateWidget({ pivotValues: v })}
                                                    slotId="pivot-values"
                                                />
                                            </div>
                                        );
                                    }

                                    // SLICER
                                    if (activeWidget.type === 'slicer') {
                                        return (
                                            <div className="space-y-4">
                                                <FieldSelector
                                                    label="Filter Field"
                                                    value={activeWidget.slicerField || ''}
                                                    fields={fields}
                                                    onChange={(val) => handleUpdateWidget({ slicerField: val })}
                                                    hint="💡 Users can filter by unique values in this field"
                                                    slotId="slicerField"
                                                />
                                                <div>
                                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                                        Selection Mode
                                                    </label>
                                                    <select
                                                        value={activeWidget.multiSelect !== false ? 'multi' : 'single'}
                                                        onChange={(e) => handleUpdateWidget({ multiSelect: e.target.value === 'multi' })}
                                                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                                    >
                                                        <option value="multi">Multiple Selection</option>
                                                        <option value="single">Single Selection</option>
                                                    </select>
                                                </div>

                                                <div className="pt-4 border-t border-white/5 space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <div className="text-xs font-bold text-white">Global Filter Bar</div>
                                                            <div className="text-[10px] text-slate-500">Pin to top of report</div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ isGlobalFilter: !activeWidget.isGlobalFilter })}
                                                            className={`w-10 h-5 rounded-full relative transition-colors ${activeWidget.isGlobalFilter ? 'bg-indigo-600' : 'bg-slate-800'}`}
                                                        >
                                                            <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${activeWidget.isGlobalFilter ? 'right-1' : 'left-1'}`}></div>
                                                        </button>
                                                    </div>

                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <div className="text-xs font-bold text-white">Dropdown Mode</div>
                                                            <div className="text-[10px] text-slate-500">Compact selection view</div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ slicerMode: activeWidget.slicerMode === 'dropdown' ? 'list' : 'dropdown' })}
                                                            className={`w-10 h-5 rounded-full relative transition-colors ${activeWidget.slicerMode === 'dropdown' ? 'bg-indigo-600' : 'bg-slate-800'}`}
                                                        >
                                                            <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${activeWidget.slicerMode === 'dropdown' ? 'right-1' : 'left-1'}`}></div>
                                                        </button>
                                                    </div>

                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <div className="text-xs font-bold text-white">Show "Select All"</div>
                                                            <div className="text-[10px] text-slate-500">Quickly toggle all options</div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ showSelectAll: !activeWidget.showSelectAll })}
                                                            className={`w-10 h-5 rounded-full relative transition-colors ${activeWidget.showSelectAll ? 'bg-indigo-600' : 'bg-slate-800'}`}
                                                        >
                                                            <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${activeWidget.showSelectAll ? 'right-1' : 'left-1'}`}></div>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }

                                    if (activeWidget.type === 'date-range' || activeWidget.type === 'search') {
                                        return (
                                            <div className="space-y-4">
                                                <FieldSelector
                                                    label="Filter Field"
                                                    value={activeWidget.slicerField || ''}
                                                    fields={fields}
                                                    onChange={(val) => handleUpdateWidget({ slicerField: val })}
                                                    slotId="slicerField"
                                                />
                                                <div className="pt-4 border-t border-white/5 space-y-4">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <div className="text-xs font-bold text-white">Global Filter Bar</div>
                                                            <div className="text-[10px] text-slate-500">Pin to top of report</div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ isGlobalFilter: !activeWidget.isGlobalFilter })}
                                                            className={`w-10 h-5 rounded-full relative transition-colors ${activeWidget.isGlobalFilter ? 'bg-indigo-600' : 'bg-slate-800'}`}
                                                        >
                                                            <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${activeWidget.isGlobalFilter ? 'right-1' : 'left-1'}`}></div>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }

                                    return null;
                                })()}

                                {/* Common Configurations for most charts */}
                                {effectiveDataSourceId && fields.length > 0 && !['table', 'slicer', 'date-range', 'search'].includes(activeWidget.type) && (
                                    <>

                                        <div className="bg-slate-900/50 border border-white/5 rounded-xl p-4 space-y-3">
                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">
                                                Value Formatting
                                            </label>
                                            <div className="relative group">
                                                <i className="fas fa-hashtag absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[10px] group-hover:text-indigo-400 transition-colors"></i>
                                                <select
                                                    value={activeWidget.valueFormat || 'standard'}
                                                    onChange={(e) => handleUpdateWidget({ valueFormat: e.target.value })}
                                                    className="w-full bg-slate-950 border border-white/10 rounded-lg pl-8 pr-3 py-2.5 text-xs text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none appearance-none cursor-pointer hover:border-white/20 transition-all font-bold"
                                                >
                                                    <optgroup label="General" className="bg-slate-900">
                                                        <option value="standard">Standard (1,234.56)</option>
                                                        <option value="integer">Integer (1,235)</option>
                                                        <option value="compact">Compact (1.2K)</option>
                                                    </optgroup>
                                                    <optgroup label="Currency" className="bg-slate-900">
                                                        <option value="currency_vnd">Currency (VND) ₫</option>
                                                        <option value="currency_usd">Currency (USD) $</option>
                                                    </optgroup>
                                                    <optgroup label="Percentage" className="bg-slate-900">
                                                        <option value="percentage">Percentage (12.3%)</option>
                                                        <option value="percentage_0">Percentage (12%)</option>
                                                        <option value="percentage_2">Percentage (12.34%)</option>
                                                    </optgroup>
                                                </select>
                                                <i className="fas fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-[10px] pointer-events-none"></i>
                                            </div>
                                            <div className="text-[9px] text-slate-500 italic px-1 pt-1">
                                                💡 Applied to all numeric values in this widget
                                            </div>
                                        </div>

                                        <div className="pt-3 border-t border-white/5">
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                                    Calculated Fields
                                                </label>
                                                <button
                                                    onClick={() => setIsAddingCalc(true)}
                                                    className="text-xs text-indigo-400 hover:text-indigo-300"
                                                >
                                                    <i className="fas fa-plus"></i> Add
                                                </button>
                                            </div>

                                            {isAddingCalc && (
                                                <div className="bg-slate-900 border border-white/10 rounded-lg p-3 mb-3">
                                                    <input
                                                        type="text"
                                                        placeholder="Name"
                                                        value={newCalcName}
                                                        onChange={(e) => setNewCalcName(e.target.value)}
                                                        className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1 text-xs text-white mb-2"
                                                    />
                                                    <textarea
                                                        placeholder="Formula (e.g. [Field1] + [Field2])"
                                                        value={newCalcFormula}
                                                        onChange={(e) => setNewCalcFormula(e.target.value)}
                                                        className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1 text-xs text-white mb-1 font-mono h-16"
                                                    />
                                                    <div className="flex items-center gap-1 mb-2 overflow-x-auto pb-1 custom-scrollbar">
                                                        <span className="text-[9px] text-slate-500 whitespace-nowrap">Insert:</span>
                                                        {availableFields.map(f => (
                                                            <button
                                                                key={f.name}
                                                                onClick={() => setNewCalcFormula(prev => prev + `[${f.name}]`)}
                                                                className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5 text-[9px] text-slate-400 hover:text-white hover:border-indigo-500/30 transition-all whitespace-nowrap"
                                                            >
                                                                {f.name} ({f.type})
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            onClick={() => setIsAddingCalc(false)}
                                                            className="px-2 py-1 text-xs text-slate-400 hover:text-white"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            onClick={handleAddCalculation}
                                                            className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-500"
                                                        >
                                                            Save
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            <div className="space-y-1">
                                                {/* Dashboard Level */}
                                                {activeDashboard?.calculatedFields?.map(calc => (
                                                    <div key={calc.id} className="flex items-center justify-between p-2 bg-slate-900 border border-indigo-500/30 rounded hover:bg-slate-800 transition-all group">
                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                            <div className="w-5 h-5 flex items-center justify-center rounded bg-indigo-500/20 text-indigo-400">
                                                                <i className="fas fa-globe text-[8px] absolute -top-1 -right-1"></i>
                                                                <i className="fas fa-calculator text-[10px]"></i>
                                                            </div>
                                                            <div className="flex flex-col overflow-hidden">
                                                                <span className="text-xs text-white truncate font-bold">{calc.name}</span>
                                                                <span className="text-[8px] text-slate-500 uppercase font-black tracking-tighter">Dashboard Global</span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleDeleteCalculation(calc.id)}
                                                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all"
                                                        >
                                                            <i className="fas fa-trash text-[10px]"></i>
                                                        </button>
                                                    </div>
                                                ))}

                                                {/* Widget Level (Deprecated) */}
                                                {activeWidget?.calculatedFields?.map(calc => (
                                                    <div key={calc.id} className="flex items-center justify-between p-2 bg-slate-950/50 rounded border border-white/5 hover:border-indigo-500/30 group">
                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                            <div className="w-5 h-5 flex items-center justify-center rounded bg-slate-800 text-slate-400">
                                                                <i className="fas fa-calculator text-[10px]"></i>
                                                            </div>
                                                            <div className="flex flex-col overflow-hidden">
                                                                <span className="text-xs text-slate-400 truncate">{calc.name}</span>
                                                                <span className="text-[8px] text-slate-600 uppercase font-black tracking-tighter">Widget Local</span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleDeleteCalculation(calc.id)}
                                                            className="opacity-0 group-hover:opacity-100 text-slate-700 hover:text-red-400"
                                                        >
                                                            <i className="fas fa-trash text-[10px]"></i>
                                                        </button>
                                                    </div>
                                                ))}

                                                {!activeDashboard?.calculatedFields?.length && !activeWidget?.calculatedFields?.length && !isAddingCalc && (
                                                    <div className="text-center py-2 text-[10px] text-slate-500 italic">
                                                        No calculated fields
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                    </>
                                )}

                                <div className="pt-3 border-t border-white/5">
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                            Quick Measures
                                        </label>
                                        <button
                                            onClick={() => setIsAddingMeasure(true)}
                                            className="text-xs text-indigo-400 hover:text-indigo-300"
                                        >
                                            <i className="fas fa-plus"></i> Add
                                        </button>
                                    </div>

                                    {isAddingMeasure && (
                                        <div className="bg-slate-900 border border-white/10 rounded-lg p-3 mb-3">
                                            <input
                                                type="text"
                                                placeholder="Label"
                                                value={newMeasureLabel}
                                                onChange={(e) => setNewMeasureLabel(e.target.value)}
                                                className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1 text-xs text-white mb-2"
                                            />
                                            <select
                                                value={newMeasureField}
                                                onChange={(e) => setNewMeasureField(e.target.value)}
                                                className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1 text-xs text-white mb-2"
                                            >
                                                <option value="">Select Field...</option>
                                                {fields.filter(f => f.type === 'number').map(f => (
                                                    <option key={f.name} value={f.name}>{f.name} ({f.type})</option>
                                                ))}
                                            </select>
                                            <select
                                                value={newMeasureType}
                                                onChange={(e) => setNewMeasureType(e.target.value)}
                                                className="w-full bg-slate-950 border border-white/10 rounded px-2 py-1 text-xs text-white mb-2"
                                            >
                                                <option value="percentOfTotal">% of Total</option>
                                                <option value="runningTotal">Running Total</option>
                                                <option value="yearOverYear">Year over Year</option>
                                                <option value="movingAverage">Moving Average</option>
                                                <option value="difference">Difference</option>
                                                <option value="percentChange">% Change</option>
                                            </select>
                                            {newMeasureType === 'movingAverage' && (
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="text-[10px] text-slate-400">Window:</span>
                                                    <input
                                                        type="number"
                                                        min="2"
                                                        value={newMeasureWindow}
                                                        onChange={(e) => setNewMeasureWindow(e.target.value)}
                                                        className="w-16 bg-slate-950 border border-white/10 rounded px-2 py-1 text-xs text-white"
                                                    />
                                                </div>
                                            )}
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => setIsAddingMeasure(false)}
                                                    className="px-2 py-1 text-xs text-slate-400 hover:text-white"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    onClick={handleAddMeasure}
                                                    className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-500"
                                                >
                                                    Save
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-1">
                                        {/* Dashboard Level */}
                                        {activeDashboard?.quickMeasures?.map(measure => (
                                            <div key={measure.id} className="flex items-center justify-between p-2 bg-slate-900 border border-indigo-500/30 rounded hover:bg-slate-800 transition-all group">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <div className="w-5 h-5 flex items-center justify-center rounded bg-indigo-500/20 text-indigo-400">
                                                        <i className="fas fa-globe text-[8px] absolute -top-1 -right-1"></i>
                                                        <i className="fas fa-magic text-[10px]"></i>
                                                    </div>
                                                    <div className="flex flex-col overflow-hidden">
                                                        <span className="text-xs text-white truncate font-bold">{measure.label}</span>
                                                        <span className="text-[8px] text-slate-500 uppercase font-black tracking-tighter">Dashboard Global</span>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleDeleteMeasure(measure.id)}
                                                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all"
                                                >
                                                    <i className="fas fa-trash text-[10px]"></i>
                                                </button>
                                            </div>
                                        ))}

                                        {/* Widget Level (Deprecated) */}
                                        {activeWidget?.quickMeasures?.map(measure => (
                                            <div key={measure.id} className="flex items-center justify-between p-2 bg-slate-950/50 rounded border border-white/5 hover:border-indigo-500/30 group">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <div className="w-5 h-5 flex items-center justify-center rounded bg-slate-800 text-slate-400">
                                                        <i className="fas fa-magic text-[10px]"></i>
                                                    </div>
                                                    <div className="flex flex-col overflow-hidden">
                                                        <span className="text-xs text-slate-400 truncate">{measure.label}</span>
                                                        <span className="text-[8px] text-slate-600 uppercase font-black tracking-tighter">Widget Local</span>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleDeleteMeasure(measure.id)}
                                                    className="opacity-0 group-hover:opacity-100 text-slate-700 hover:text-red-400"
                                                >
                                                    <i className="fas fa-trash text-[10px]"></i>
                                                </button>
                                            </div>
                                        ))}

                                        {!activeDashboard?.quickMeasures?.length && !activeWidget?.quickMeasures?.length && !isAddingMeasure && (
                                            <div className="text-center py-2 text-[10px] text-slate-500 italic">
                                                No quick measures
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="pt-3 border-t border-white/5">
                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={activeDashboard?.enableCrossFilter !== false}
                                    onChange={(e) => {
                                        if (activeDashboard) {
                                            updateDashboard(activeDashboard.id, { enableCrossFilter: e.target.checked });
                                            // Sync all existing widgets
                                            activeDashboard.widgets.forEach(w => {
                                                updateWidget(activeDashboard.id, w.id, { enableCrossFilter: e.target.checked });
                                            });
                                        }
                                    }}
                                    className="rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                                />
                                Enable Cross-Filtering
                            </label>
                        </div>
                    </div>
                )}

                {/* Format Tab */}
                {activeTab === 'format' && activeWidget && (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                Title
                            </label>
                            <input
                                type="text"
                                value={activeWidget.title}
                                onChange={(e) => handleUpdateWidget({ title: e.target.value })}
                                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                        </div>

                        {['pivot', 'table'].includes(activeWidget.type) && (
                            <div className="p-3 bg-slate-900/50 rounded-lg border border-white/5">
                                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={activeWidget.hideZeros || false}
                                        onChange={(e) => handleUpdateWidget({ hideZeros: e.target.checked })}
                                        className="rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    Hide Zeros (Show '-')
                                </label>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={activeWidget.showLegend !== false}
                                    onChange={(e) => handleUpdateWidget({ showLegend: e.target.checked })}
                                    className="rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                                />
                                Show Legend
                            </label>

                            {activeWidget.showLegend !== false && (
                                <div className="ml-6 pl-2 border-l border-white/10 space-y-2">
                                    <label className="block text-[9px] text-slate-500 uppercase">Position</label>
                                    <select
                                        value={activeWidget.legendPosition || 'bottom'}
                                        onChange={(e) => handleUpdateWidget({ legendPosition: e.target.value as any })}
                                        className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                    >
                                        <option value="right">Right</option>
                                        <option value="bottom">Bottom</option>
                                        <option value="top">Top</option>
                                        <option value="left">Left</option>
                                    </select>
                                </div>
                            )}

                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={activeWidget.showGrid !== false}
                                    onChange={(e) => handleUpdateWidget({ showGrid: e.target.checked })}
                                    className="rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                                />
                                Show Grid
                            </label>

                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={activeWidget.showLabels !== false}
                                    onChange={(e) => handleUpdateWidget({ showLabels: e.target.checked })}
                                    className="rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                                />
                                Show Labels
                            </label>
                        </div>

                        <div className="space-y-4 pt-4 border-t border-white/5">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                Typography
                            </label>

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-[9px] text-slate-500 uppercase mb-1">Font Family</label>
                                    <select
                                        value={activeWidget.fontFamily || 'Inter, sans-serif'}
                                        onChange={(e) => handleUpdateWidget({ fontFamily: e.target.value })}
                                        className="w-full bg-slate-900 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                    >
                                        <option value="Inter, sans-serif">Inter (Default)</option>
                                        <option value="'Roboto', sans-serif">Roboto</option>
                                        <option value="'Playfair Display', serif">Playfair Display</option>
                                        <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                                        <option value="'Outfit', sans-serif">Outfit</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[9px] text-slate-500 uppercase mb-1">Font Size</label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="range"
                                            min="8"
                                            max="24"
                                            step="1"
                                            value={activeWidget.fontSize || 12}
                                            onChange={(e) => handleUpdateWidget({ fontSize: parseInt(e.target.value) })}
                                            className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                        />
                                        <span className="text-[10px] font-mono text-indigo-400 min-w-[24px]">
                                            {activeWidget.fontSize || 12}px
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4 pt-4 border-t border-white/5">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                Border & Shadow
                            </label>

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-[9px] text-slate-500 uppercase mb-1">Border Radius</label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="range"
                                            min="0"
                                            max="32"
                                            step="4"
                                            value={activeWidget.borderRadius || 12}
                                            onChange={(e) => handleUpdateWidget({ borderRadius: parseInt(e.target.value) })}
                                            className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                        />
                                        <span className="text-[10px] font-mono text-indigo-400 min-w-[24px]">
                                            {activeWidget.borderRadius || 12}px
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] text-slate-400 uppercase">Show Shadow</label>
                                    <button
                                        onClick={() => handleUpdateWidget({ showShadow: !activeWidget.showShadow })}
                                        className={`w-10 h-5 rounded-full transition-colors relative ${activeWidget.showShadow ? 'bg-indigo-600' : 'bg-slate-700'}`}
                                    >
                                        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${activeWidget.showShadow ? 'left-6' : 'left-1'}`} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4 pt-4 border-t border-white/5">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                Chart Colors
                            </label>
                            <div className="grid grid-cols-2 gap-3 max-h-[200px] overflow-y-auto custom-scrollbar p-1">
                                {Array.from({ length: Math.max(4, activeWidget.colors?.length || 0) + 2 }).map((_, idx) => (
                                    <ColorPicker
                                        key={idx}
                                        label={`Series ${idx + 1}`}
                                        color={activeWidget.colors?.[idx] || CHART_COLORS[idx % CHART_COLORS.length]}
                                        onChange={(c) => handleColorChange(idx, c)}
                                    />
                                ))}
                            </div>
                            <div className="mt-2 flex justify-end">
                                <button
                                    onClick={() => handleUpdateWidget({ colors: CHART_COLORS })}
                                    className="text-[9px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-wider"
                                >
                                    Reset to Default Palette
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {/* Filters Tab */}
                {activeTab === 'filters' && activeWidget && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">Widget Filters</h4>
                            <button
                                onClick={() => {
                                    const newFilter = {
                                        id: `flt-${Date.now()}`,
                                        field: fields[0]?.name || '',
                                        operator: 'equals' as const,
                                        value: '',
                                        enabled: true
                                    };
                                    const currentFilters = activeWidget.filters || [];
                                    handleUpdateWidget({ filters: [...currentFilters, newFilter] });
                                }}
                                className="text-xs text-indigo-400 hover:text-indigo-300"
                            >
                                <i className="fas fa-plus"></i> Add Filter
                            </button>
                        </div>

                        <div className="space-y-3">
                            {activeWidget.filters?.map((filter, index) => (
                                <div key={filter.id} className="p-3 bg-slate-900/50 rounded-lg border border-white/5 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <select
                                            value={filter.field}
                                            onChange={(e) => {
                                                const newFilters = [...(activeWidget.filters || [])];
                                                newFilters[index] = { ...filter, field: e.target.value };
                                                handleUpdateWidget({ filters: newFilters });
                                            }}
                                            className="bg-transparent text-xs text-white font-bold border-none focus:ring-0 p-0"
                                        >
                                            <option value="" className="text-slate-500">Select field...</option>
                                            {fields.map(f => (
                                                <option key={f.name} value={f.name}>{f.name} ({f.type})</option>
                                            ))}
                                        </select>
                                        <button
                                            onClick={() => {
                                                const newFilters = (activeWidget.filters || []).filter(f => f.id !== filter.id);
                                                handleUpdateWidget({ filters: newFilters });
                                            }}
                                            className="text-slate-500 hover:text-red-400"
                                        >
                                            <i className="fas fa-trash text-[10px]"></i>
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                        <select
                                            value={filter.operator}
                                            onChange={(e) => {
                                                const newFilters = [...(activeWidget.filters || [])];
                                                newFilters[index] = { ...filter, operator: e.target.value as any };
                                                handleUpdateWidget({ filters: newFilters });
                                            }}
                                            className="bg-slate-950 border border-white/10 rounded px-2 py-1 text-[10px] text-white"
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
                                            value={filter.value}
                                            placeholder="Value"
                                            onChange={(e) => {
                                                const newFilters = [...(activeWidget.filters || [])];
                                                newFilters[index] = { ...filter, value: e.target.value };
                                                handleUpdateWidget({ filters: newFilters });
                                            }}
                                            className="bg-slate-950 border border-white/10 rounded px-2 py-1 text-[10px] text-white"
                                        />
                                    </div>
                                </div>
                            ))}
                            {!activeWidget.filters?.length && (
                                <div className="text-center py-8 text-slate-500">
                                    <i className="fas fa-filter text-3xl mb-2 opacity-20"></i>
                                    <p className="text-xs">No filters applied</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {!activeWidget && activeTab !== 'visualizations' && (
                    <div className="flex items-center justify-center h-full text-slate-500 text-xs">
                        Select a widget to configure
                    </div>
                )}
            </div>
        </div >
    );
};

export default BIVisualBuilder;
