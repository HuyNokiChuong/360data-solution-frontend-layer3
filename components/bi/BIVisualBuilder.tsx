// ============================================
// BI Visual Builder - Properties Panel
// ============================================

import React, { useState } from 'react';
import { BIWidget, ChartType, AggregationType, PivotValue, ConditionalFormat, DataSource } from './types';
import { useDataStore } from './store/dataStore';
import { useDashboardStore } from './store/dashboardStore';
import ColorPicker from './panels/ColorPicker';
import { useDroppable } from '@dnd-kit/core';
import { CHART_COLORS } from './utils/chartColors';
import { getAutoTitle } from './utils/widgetUtils';
import { useFilterStore } from './store/filterStore';
import FormulaEditorModal from './FormulaEditorModal';
import { fetchExcelTableData } from '../../services/excel';
import { normalizeSchema } from '../../utils/schema';
import {
    AGGREGATION_OPTIONS,
    coerceAggregationForFieldType,
    getAggregationOptionsForFieldType,
    getDefaultAggregationForFieldType,
    normalizeAggregation
} from '../../utils/aggregation';

interface BIVisualBuilderProps {
    activeWidget?: BIWidget;
    onUpdateWidget?: (widget: BIWidget) => void;
    onAddWidget?: (type: string) => void;
    activeTab: 'visualizations' | 'data' | 'format' | 'calculations';
    setActiveTab: (tab: 'visualizations' | 'data' | 'format' | 'calculations') => void;
}

const FieldIcon: React.FC<{ field: any }> = ({ field }) => {
    let icon = "fa-question";
    let color = "text-slate-400";

    if (field.isQuickMeasure && field.isQuickMeasure !== undefined) {
        icon = "fa-magic";
        color = "text-purple-500";
    } else if (field.isCalculated) {
        icon = "fa-calculator";
        color = "text-orange-500";
    } else {
        switch (field.type) {
            case 'number': icon = "fa-hashtag"; color = "text-blue-500"; break;
            case 'string': icon = "fa-font"; color = "text-slate-500"; break;
            case 'date': icon = "fa-calendar"; color = "text-pink-500"; break;
            case 'boolean': icon = "fa-check-square"; color = "text-green-500"; break;
        }
    }

    return <i className={`fas ${icon} ${color} w-3 text-center text-[10px]`}></i>;
};

const CustomFieldDropdown: React.FC<{
    value?: string;
    onChange: (val: string) => void;
    fields: any[];
    placeholder?: string;
    className?: string; // for wrapper styling
    dropUp?: boolean;
    disabled?: boolean;
    allowNone?: boolean;
}> = ({ value, onChange, fields, placeholder, className, dropUp, disabled, allowNone }) => {
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const selectedField = fields.find(f => f.name === value);

    return (
        <div className={`relative ${className || ''}`} ref={wrapperRef}>
            <div
                onClick={() => !disabled && setIsOpen(!isOpen)}
                className={`w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded px-2 py-1.5 flex items-center justify-between cursor-pointer hover:border-indigo-500/50 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${isOpen ? 'border-indigo-500 ring-1 ring-indigo-500/20' : ''}`}
            >
                {selectedField ? (
                    <div className="flex items-center gap-2 overflow-hidden">
                        <FieldIcon field={selectedField} />
                        <span className="text-xs truncate text-slate-700 dark:text-slate-200 font-medium">{selectedField.name}</span>
                        <span className="text-[9px] text-slate-400 hidden sm:inline">({selectedField?.type})</span>
                    </div>
                ) : (
                    <span className={`text-xs truncate ${value === '' && allowNone ? 'text-slate-700 dark:text-slate-200 font-medium' : 'text-slate-500'}`}>
                        {value === '' && allowNone ? 'None' : (placeholder || 'Select...')}
                    </span>
                )}
                <i className={`fas fa-chevron-${isOpen ? 'up' : 'down'} text-[10px] text-slate-400 ml-2`}></i>
            </div>

            {isOpen && (
                <div className={`absolute z-[100] left-0 w-full min-w-[200px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg shadow-xl max-h-60 overflow-y-auto ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                    {allowNone && (
                        <div
                            onClick={() => { onChange(''); setIsOpen(false); }}
                            className="flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer border-b border-slate-100 dark:border-white/5"
                        >
                            <span className="text-xs font-medium text-slate-500 italic">None</span>
                        </div>
                    )}
                    {fields.length === 0 && <div className="p-2 text-xs text-slate-400 italic text-center">No fields available</div>}
                    {fields.map(field => (
                        <div
                            key={field.name}
                            onClick={() => { onChange(field.name); setIsOpen(false); }}
                            className={`flex items-center gap-2 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer border-b last:border-0 border-slate-100 dark:border-white/5 ${value === field.name ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}
                        >
                            <FieldIcon field={field} />
                            <div className="flex flex-col overflow-hidden">
                                <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{field.name}</span>
                                <div className="flex items-center gap-1">
                                    <span className="text-[9px] text-slate-400 font-mono">{field.type}</span>
                                    {field.isCalculated && !field.isQuickMeasure && <span className="text-[8px] text-orange-400 bg-orange-400/10 px-1 rounded">Calc</span>}
                                    {field.isQuickMeasure && <span className="text-[8px] text-purple-400 bg-purple-400/10 px-1 rounded">Quick</span>}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

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
                `${fieldName}___year`,
                `${fieldName}___half`,
                `${fieldName}___quarter`,
                `${fieldName}___month`,
                `${fieldName}___day`
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
            `${fieldName}___year`,
            `${fieldName}___half`,
            `${fieldName}___quarter`,
            `${fieldName}___month`,
            `${fieldName}___day`
        ];
        const newHierarchy = [...hierarchy];
        newHierarchy.splice(index, 1, ...timeHierarchy);
        onChange(newHierarchy);
    };

    return (
        <div
            ref={setNodeRef}
            className={`space-y-2 pb-2 border-b border-slate-200 dark:border-white/5 last:border-0 last:pb-0 p-2 rounded-lg transition-all hover:bg-slate-50 dark:hover:bg-white/5 ${isOver ? 'bg-indigo-50 dark:bg-indigo-600/20 ring-2 ring-indigo-500/50' : ''
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
                        const isTimePart = fieldName.includes('___');

                        return (
                            <div key={`${fieldName}-${idx}`} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded px-2 py-1.5 group">
                                <span className="text-[10px] font-bold text-slate-500 w-4">#{idx + 1}</span>
                                <span className="flex-1 text-xs text-slate-900 dark:text-white truncate">
                                    {isTimePart
                                        ? `${fieldName.split('___')[0]} (${fieldName.split('___')[1].toUpperCase()})`
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
            <CustomFieldDropdown
                value=""
                onChange={(val) => handleAddField(val)}
                fields={fields}
                placeholder={placeholder || 'Add level to hierarchy...'}
                allowNone={false}
                className="mt-1"
            />


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
    const selectedField = fields.find((f) => f.name === value);
    const aggregationOptions = selectedField ? getAggregationOptionsForFieldType(selectedField.type) : AGGREGATION_OPTIONS;
    const safeAggregation = coerceAggregationForFieldType(aggregation || 'sum', selectedField?.type);

    return (
        <div ref={setNodeRef} className={`p-2 rounded-lg transition-all border border-transparent hover:border-slate-200 dark:hover:border-white/5 hover:bg-slate-50 dark:hover:bg-white/5 ${isOver ? 'bg-indigo-50 dark:bg-indigo-600/20 ring-2 ring-indigo-500/50' : ''}`}>
            <div className="flex items-center justify-between mb-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    {label}
                </label>
                {onAggregationChange && value && (
                    <select
                        value={safeAggregation}
                        onChange={(e) => onAggregationChange(coerceAggregationForFieldType(e.target.value, selectedField?.type))}
                        className="bg-white dark:bg-slate-950 text-[10px] text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-white/10 rounded px-1.5 py-0.5 outline-none font-bold hover:border-indigo-500/50 transition-colors cursor-pointer"
                    >
                        {aggregationOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                )}
            </div>
            <CustomFieldDropdown
                value={value}
                onChange={onChange}
                fields={fields}
                placeholder={placeholder || 'Select field...'}
                allowNone={allowNone}
            />
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
    hideAxisSelector?: boolean;
}> = ({ label, values = [], fields, onChange, slotId, defaultAxis = 'left', hideAxisSelector }) => {
    const { setNodeRef, isOver } = useDroppable({
        id: slotId,
        data: { slot: slotId }
    });

    const [rulesModalIndex, setRulesModalIndex] = useState<number | null>(null);

    const getDefaultAggregation = (fieldName: string): AggregationType => {
        const selectedField = fields.find((f) => f.name === fieldName);
        return getDefaultAggregationForFieldType(selectedField?.type);
    };

    const getFieldType = (fieldName: string) => {
        return fields.find((f) => f.name === fieldName)?.type;
    };

    const handleAdd = (fieldName: string) => {
        if (!fieldName) return;
        onChange([
            ...values,
            { field: fieldName, aggregation: getDefaultAggregation(fieldName), yAxisId: defaultAxis, format: 'standard' }
        ]);
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
                { condition: 'greater', value: 0, textColor: '#10b981', compareMode: 'literal', compareScope: 'cell', compareFormula: 'ROW_TOTAL * 0.1' }
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

    const handleApplyPreset = (index: number, preset: 'traffic' | 'stoplight' | 'heatmap') => {
        const newValues = [...values];
        let newRules: ConditionalFormat[] = [];

        switch (preset) {
            case 'traffic':
                newRules = [
                    { condition: 'greater', value: 1000, textColor: '#10b981' }, // Green
                    { condition: 'between', value: 500, value2: 1000, textColor: '#f59e0b' }, // Amber
                    { condition: 'less', value: 500, textColor: '#ef4444' } // Red
                ];
                break;
            case 'stoplight':
                newRules = [
                    { condition: 'greater', value: 1000, backgroundColor: '#064e3b', textColor: '#ffffff' },
                    { condition: 'between', value: 500, value2: 1000, backgroundColor: '#78350f', textColor: '#ffffff' },
                    { condition: 'less', value: 500, backgroundColor: '#7f1d1d', textColor: '#ffffff' }
                ];
                break;
            case 'heatmap':
                newRules = [
                    { condition: 'greater', value: 2000, backgroundColor: '#1e3a8a', textColor: '#ffffff' },
                    { condition: 'between', value: 1000, value2: 2000, backgroundColor: '#3b82f6', textColor: '#ffffff' },
                    { condition: 'between', value: 500, value2: 1000, backgroundColor: '#93c5fd', textColor: '#1e3a8a' },
                    { condition: 'less', value: 500, backgroundColor: '#eff6ff', textColor: '#1e3a8a' }
                ];
                break;
        }

        newValues[index] = { ...newValues[index], conditionalFormatting: newRules };
        onChange(newValues);
    };

    const applyCompareTarget = (valIndex: number, ruleIndex: number, target: string) => {
        const [compareField, compareAggregation] = target.split('::');
        handleUpdateRule(valIndex, ruleIndex, {
            compareField: compareField || undefined,
            compareAggregation: (compareAggregation as AggregationType) || undefined
        });
    };

    const activeRuleMetric = rulesModalIndex !== null ? values[rulesModalIndex] : null;
    const compareMetricOptions = React.useMemo(() => {
        const options: Array<{ field: string; aggregation: AggregationType; source: 'value' | 'calculated' }> = [];
        const seen = new Set<string>();

        values.forEach((v) => {
            const key = `${v.field}::${v.aggregation}`;
            if (seen.has(key)) return;
            seen.add(key);
            options.push({ field: v.field, aggregation: v.aggregation, source: 'value' });
        });

        fields
            .filter((f) => f.type === 'number' && (f.isCalculated || f.isQuickMeasure))
            .forEach((f) => {
                const agg = getDefaultAggregationForFieldType(f.type);
                const key = `${f.name}::${agg}`;
                if (seen.has(key)) return;
                seen.add(key);
                options.push({ field: f.name, aggregation: agg, source: 'calculated' });
            });

        return options;
    }, [values, fields]);

    return (
        <div ref={setNodeRef} className={`space-y-2 p-2 rounded-lg transition-all ${isOver ? 'bg-indigo-50 dark:bg-indigo-600/20 ring-2 ring-indigo-500/50' : ''}`}>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">{label}</label>
            <div className="space-y-2">
                {values.map((v, idx) => (
                    <div key={`${v.field}-${idx}`} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded p-2">
                        <div className="flex items-center gap-1.5 mb-1">
                            <span className="flex-1 text-[11px] text-slate-900 dark:text-white truncate font-bold">{v.field}</span>
                            <button
                                onClick={() => setRulesModalIndex(idx)}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] uppercase font-black transition-all border ${(v.conditionalFormatting?.length ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30' : 'bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-indigo-500/50 hover:text-indigo-600')
                                    }`}
                            >
                                <i className={`fas fa-paint-brush ${v.conditionalFormatting?.length ? 'animate-pulse' : ''}`}></i>
                                Rules {v.conditionalFormatting?.length ? `(${v.conditionalFormatting.length})` : ''}
                            </button>
                            <button onClick={() => handleRemove(idx)} className="text-slate-400 dark:text-slate-600 hover:text-red-500 p-0.5 ml-1">
                                <i className="fas fa-times text-[10px]"></i>
                            </button>
                        </div>

                        <div className="flex items-center gap-1 mb-1">
                            {!hideAxisSelector && (
                                <div className="flex items-center gap-1 bg-white dark:bg-slate-950 rounded p-0.5 border border-slate-200 dark:border-white/10">
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
                            )}
                            <select
                                value={coerceAggregationForFieldType(v.aggregation, getFieldType(v.field))}
                                onChange={(e) => handleUpdate(idx, { aggregation: coerceAggregationForFieldType(e.target.value, getFieldType(v.field)) })}
                                className="flex-1 bg-white dark:bg-slate-950 text-[10px] text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-white/10 rounded px-1 outline-none py-0.5"
                            >
                                {getAggregationOptionsForFieldType(getFieldType(v.field)).map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <select
                                value={v.format || ''}
                                onChange={(e) => handleUpdate(idx, { format: e.target.value || undefined })}
                                className={`flex-1 bg-white dark:bg-slate-950 text-[10px] ${v.format ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'} border border-slate-200 dark:border-white/10 rounded px-1 outline-none py-0.5`}
                            >
                                <option value="">Auto</option>
                                <option value="standard">Std</option>
                                <option value="integer">Int</option>
                                <option value="compact">Cpt</option>
                                <option value="currency_vnd">VND</option>
                                <option value="currency_usd">USD</option>
                                <option value="percentage">%</option>
                                <option value="percentage_2">%.2f</option>
                            </select>
                        </div>

                        {!!v.conditionalFormatting?.length && (
                            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-white/5 text-[10px] text-slate-500 dark:text-slate-400">
                                {v.conditionalFormatting.length} rule(s) configured
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <CustomFieldDropdown
                value=""
                onChange={handleAdd}
                fields={fields}
                placeholder="+ Add value..."
                className="mt-1"
            />

            {rulesModalIndex !== null && activeRuleMetric && (
                <div
                    className="fixed inset-0 z-[120] bg-slate-950/70 backdrop-blur-[2px] flex items-center justify-center p-4"
                    onClick={() => setRulesModalIndex(null)}
                >
                    <div
                        className="w-full max-w-4xl max-h-[85vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="sticky top-0 z-10 px-5 py-4 border-b border-slate-200 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm flex items-center justify-between">
                            <div>
                                <div className="text-sm font-black text-slate-900 dark:text-white">Conditional Formatting Rules</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Metric: <span className="font-bold text-indigo-600 dark:text-indigo-400">{activeRuleMetric.field}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setRulesModalIndex(null)}
                                className="w-8 h-8 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                                    Rules are evaluated top-down. First match wins.
                                </div>
                                <div className="flex items-center gap-2">
                                    <select
                                        onChange={(e) => e.target.value && handleApplyPreset(rulesModalIndex, e.target.value as any)}
                                        className="bg-slate-100 dark:bg-slate-950 text-xs text-indigo-600 dark:text-indigo-300 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 outline-none"
                                        value=""
                                    >
                                        <option value="" disabled>Apply preset...</option>
                                        <option value="traffic">Traffic (Text)</option>
                                        <option value="stoplight">Stoplight (Bg)</option>
                                        <option value="heatmap">Heatmap</option>
                                    </select>
                                    <button
                                        onClick={() => handleAddRule(rulesModalIndex)}
                                        className="text-xs bg-indigo-600 text-white px-3 py-2 rounded-lg hover:bg-indigo-500 transition-colors font-black"
                                    >
                                        + Add Rule
                                    </button>
                                </div>
                            </div>

                            {activeRuleMetric.conditionalFormatting?.map((rule, rIdx) => {
                                const compareTarget = `${rule.compareField || activeRuleMetric.field}::${rule.compareAggregation || activeRuleMetric.aggregation}`;
                                const useLiteral = !rule.compareMode || rule.compareMode === 'literal' || rule.condition === 'between';
                                const useFormula = rule.compareMode === 'formula' && rule.condition !== 'between';
                                return (
                                    <div key={rIdx} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="text-xs font-black uppercase tracking-wider text-slate-500">Rule #{rIdx + 1}</div>
                                            <button
                                                onClick={() => handleRemoveRule(rulesModalIndex, rIdx)}
                                                className="text-xs text-red-500 hover:text-red-400 font-bold"
                                            >
                                                Remove
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-500 mb-1">Operator</label>
                                                <select
                                                    value={rule.condition}
                                                    onChange={(e) => handleUpdateRule(rulesModalIndex, rIdx, { condition: e.target.value })}
                                                    className="w-full bg-white dark:bg-slate-900 text-sm border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2"
                                                >
                                                    <option value="greater">&gt; Greater Than</option>
                                                    <option value="less">&lt; Less Than</option>
                                                    <option value="equal">= Equal</option>
                                                    <option value="between">Between</option>
                                                </select>
                                            </div>

                                            {rule.condition !== 'between' && (
                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Compare Type</label>
                                                    <select
                                                        value={rule.compareMode || 'literal'}
                                                        onChange={(e) => handleUpdateRule(rulesModalIndex, rIdx, { compareMode: e.target.value })}
                                                        className="w-full bg-white dark:bg-slate-900 text-sm border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2"
                                                    >
                                                        <option value="literal">Fixed Number</option>
                                                        <option value="field">Metric / Total</option>
                                                        <option value="formula">Formula</option>
                                                    </select>
                                                </div>
                                            )}

                                            {useLiteral ? (
                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Value</label>
                                                    <input
                                                        type="number"
                                                        value={rule.value}
                                                        onChange={(e) => handleUpdateRule(rulesModalIndex, rIdx, { value: e.target.value })}
                                                        className="w-full bg-white dark:bg-slate-900 text-sm border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2"
                                                        placeholder="Enter threshold..."
                                                    />
                                                </div>
                                            ) : useFormula ? (
                                                <div className="md:col-span-2">
                                                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Formula</label>
                                                    <input
                                                        type="text"
                                                        value={rule.compareFormula || ''}
                                                        onChange={(e) => handleUpdateRule(rulesModalIndex, rIdx, { compareFormula: e.target.value })}
                                                        className="w-full bg-white dark:bg-slate-900 text-sm border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2 font-mono"
                                                        placeholder="e.g. ROW_TOTAL * 0.1 or VALUE_doanh_so_san_sum * 1.2"
                                                    />
                                                </div>
                                            ) : (
                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Target Metric</label>
                                                    <select
                                                        value={compareTarget}
                                                        onChange={(e) => applyCompareTarget(rulesModalIndex, rIdx, e.target.value)}
                                                        className="w-full bg-white dark:bg-slate-900 text-sm border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2"
                                                    >
                                                        {compareMetricOptions.map((mv, mvIdx) => (
                                                            <option key={`${mv.field}-${mv.aggregation}-${mvIdx}`} value={`${mv.field}::${mv.aggregation}`}>
                                                                {mv.field} ({mv.aggregation.toUpperCase()}){mv.source === 'calculated' ? ' • Calc' : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}

                                            {!useLiteral && (
                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Target Scope</label>
                                                    <select
                                                        value={rule.compareScope || 'cell'}
                                                        onChange={(e) => handleUpdateRule(rulesModalIndex, rIdx, { compareScope: e.target.value })}
                                                        className="w-full bg-white dark:bg-slate-900 text-sm border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2"
                                                    >
                                                        <option value="cell">Same Cell</option>
                                                        <option value="rowTotal">Same Row Total</option>
                                                        <option value="columnTotal">Same Column Total</option>
                                                        <option value="grandTotal">Grand Total</option>
                                                    </select>
                                                </div>
                                            )}
                                        </div>

                                        {useFormula && (
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-950/60 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2">
                                                Variables: <span className="font-mono">VALUE</span>, <span className="font-mono">ROW_TOTAL</span>, <span className="font-mono">COLUMN_TOTAL</span>, <span className="font-mono">GRAND_TOTAL</span>, <span className="font-mono">VALUE_[field]_[agg]</span>, <span className="font-mono">ROW_TOTAL_[field]_[agg]</span>
                                            </div>
                                        )}

                                        {rule.condition === 'between' && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Lower Bound</label>
                                                    <input
                                                        type="number"
                                                        value={rule.value}
                                                        onChange={(e) => handleUpdateRule(rulesModalIndex, rIdx, { value: e.target.value })}
                                                        className="w-full bg-white dark:bg-slate-900 text-sm border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Upper Bound</label>
                                                    <input
                                                        type="number"
                                                        value={rule.value2}
                                                        onChange={(e) => handleUpdateRule(rulesModalIndex, rIdx, { value2: e.target.value })}
                                                        className="w-full bg-white dark:bg-slate-900 text-sm border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-500 mb-1">Color Style</label>
                                                <select
                                                    value={rule.textColor || rule.backgroundColor || ''}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        const updates: any = { textColor: undefined, backgroundColor: undefined };
                                                        if (val.startsWith('text:')) updates.textColor = val.split(':')[1];
                                                        else if (val.startsWith('bg:')) updates.backgroundColor = val.split(':')[1];
                                                        handleUpdateRule(rulesModalIndex, rIdx, updates);
                                                    }}
                                                    className="w-full bg-white dark:bg-slate-900 text-sm border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2"
                                                >
                                                    <option value="text:#10b981">Green Text</option>
                                                    <option value="text:#ef4444">Red Text</option>
                                                    <option value="text:#f59e0b">Amber Text</option>
                                                    <option value="text:#ffffff">White Text</option>
                                                    <option value="bg:#064e3b">Green Background</option>
                                                    <option value="bg:#7f1d1d">Red Background</option>
                                                    <option value="bg:#78350f">Amber Background</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-500 mb-1">Icon</label>
                                                <select
                                                    value={rule.icon || ''}
                                                    onChange={(e) => handleUpdateRule(rulesModalIndex, rIdx, { icon: e.target.value || undefined })}
                                                    className="w-full bg-white dark:bg-slate-900 text-sm border border-slate-200 dark:border-white/10 rounded-lg px-2 py-2"
                                                >
                                                    <option value="">No Icon</option>
                                                    <option value="fas fa-arrow-up">Up</option>
                                                    <option value="fas fa-arrow-down">Down</option>
                                                    <option value="fas fa-minus">Flat</option>
                                                    <option value="fas fa-circle-exclamation">Alert</option>
                                                    <option value="fas fa-star">Star</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {(!activeRuleMetric.conditionalFormatting || activeRuleMetric.conditionalFormatting.length === 0) && (
                                <div className="text-sm text-slate-500 dark:text-slate-400 italic border border-dashed border-slate-300 dark:border-white/10 rounded-xl p-4 text-center">
                                    No rules yet. Click <span className="font-bold text-indigo-500">+ Add Rule</span> to start.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
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
    const { dataSources, selectedDataSourceId, setSelectedDataSource, connections, updateDataSource } = useDataStore();
    const { getActiveDashboard, updateWidget, updateDashboard, syncDashboardDataSource, syncPageDataSource } = useDashboardStore();



    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));
    const activePage = activeDashboard?.pages?.find(p => p.id === (activeDashboard as any).activePageId);
    const effectiveDataSourceId = activePage?.dataSourceId || activeWidget?.dataSourceId || activeDashboard?.dataSourceId || selectedDataSourceId;

    React.useEffect(() => {
        const ds = effectiveDataSourceId
            ? dataSources.find((item) => item.id === effectiveDataSourceId)
            : null;
        if (!ds || ds.type !== 'excel') return;

        const currentSchema = Array.isArray(ds.schema) ? ds.schema : [];
        const shouldRefreshSchema = currentSchema.length === 0 || currentSchema.every((field) => field.type === 'string');
        if (!shouldRefreshSchema) return;

        const tableId = ds.syncedTableId || ds.id.replace('excel:', '');
        if (!tableId) return;

        let cancelled = false;
        (async () => {
            try {
                const page = await fetchExcelTableData(tableId, 0, 1);
                const normalized = normalizeSchema(page?.schema || []);
                if (cancelled || normalized.length === 0) return;

                if (JSON.stringify(normalized) !== JSON.stringify(currentSchema)) {
                    updateDataSource(ds.id, { schema: normalized });
                }
            } catch (err) {
                // Ignore background schema refresh error to avoid breaking editor flow.
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [effectiveDataSourceId, dataSources, updateDataSource]);


    const [isAddingCalc, setIsAddingCalc] = useState(false);
    const [newCalcName, setNewCalcName] = useState('');
    const [newCalcFormula, setNewCalcFormula] = useState('');
    const [dsSearchQuery, setDsSearchQuery] = useState('');
    const [selectedSourceKey, setSelectedSourceKey] = useState('');

    const [editingCalcId, setEditingCalcId] = useState<string | null>(null);

    // Quick Measure State
    const [isAddingMeasure, setIsAddingMeasure] = useState(false);
    const [editingMeasureId, setEditingMeasureId] = useState<string | null>(null);
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
        { type: 'area', icon: 'fa-chart-area', label: 'Area Chart' },
        { type: 'pie', icon: 'fa-chart-pie', label: 'Pie Chart' },
        { type: 'donut', icon: 'fa-circle-dot', label: 'Donut Chart' },
        { type: 'scatter', icon: 'fa-braille', label: 'Scatter Plot' },

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
            currentTitle === 'Filter' ||
            currentTitle === 'Date Range' ||
            currentTitle === 'Search' ||
            currentTitle === '' ||
            currentTitle.startsWith('New ');

        // Check if relevant fields have changed
        const fieldsChanged =
            updates.xAxis !== undefined ||
            updates.yAxis !== undefined ||
            updates.pivotRows !== undefined ||
            updates.pivotCols !== undefined ||
            updates.pivotValues !== undefined ||
            updates.metric !== undefined ||
            updates.legend !== undefined ||
            updates.slicerField !== undefined ||
            updates.columns !== undefined;

        if (isDefaultTitle && fieldsChanged) {
            const newTitle = getAutoTitle(nextWidgetState as BIWidget);
            // Only update if we got a meaningful title (not a generic fallback)
            if (newTitle && newTitle !== 'New Chart' && newTitle !== '' && newTitle !== currentTitle) {
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



    const handleSaveCalculation = (name: string, formula: string) => {
        if (!activeDashboard) return;
        const normalizedName = name.trim();
        const normalizedFormula = formula.trim();
        if (!normalizedName || !normalizedFormula) return;

        const currentCalcs = activeDashboard.calculatedFields || [];

        if (editingCalcId) {
            // Update existing
            const updatedCalcs = currentCalcs.map(c =>
                c.id === editingCalcId ? { ...c, name: normalizedName, formula: normalizedFormula } : c
            );
            updateDashboard(activeDashboard.id, {
                calculatedFields: updatedCalcs
            });
            setEditingCalcId(null);
        } else {
            // Create new
            const newField = {
                id: `calc-${Date.now()}`,
                name: normalizedName,
                formula: normalizedFormula,
                type: 'number' as const
            };
            updateDashboard(activeDashboard.id, {
                calculatedFields: [...currentCalcs, newField]
            });
        }
        setIsAddingCalc(false);
    };

    const handleEditCalculation = (calc: any) => {
        setNewCalcName(calc.name);
        setNewCalcFormula(calc.formula);
        setEditingCalcId(calc.id);
        setIsAddingCalc(true);
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

    const handleEditMeasure = (measure: any) => {
        setNewMeasureLabel(measure.label);
        setNewMeasureField(measure.field);
        setNewMeasureType(measure.calculation);
        if (measure.window) setNewMeasureWindow(String(measure.window));
        setEditingMeasureId(measure.id);
        setIsAddingMeasure(true);
    };

    const handleAddMeasure = () => {
        if (!newMeasureLabel || !newMeasureField || !activeDashboard) return;

        const currentMeasures = activeDashboard.quickMeasures || [];

        if (editingMeasureId) {
            // Update existing
            const updatedMeasures = currentMeasures.map(m =>
                m.id === editingMeasureId
                    ? {
                        ...m,
                        label: newMeasureLabel,
                        field: newMeasureField,
                        calculation: newMeasureType as any,
                        window: newMeasureType === 'movingAverage' ? parseInt(newMeasureWindow) : undefined
                    }
                    : m
            );
            updateDashboard(activeDashboard.id, {
                quickMeasures: updatedMeasures
            });
            setEditingMeasureId(null);
        } else {
            // Create New
            const newMeasure = {
                id: `qm-${Date.now()}`,
                label: newMeasureLabel,
                field: newMeasureField,
                calculation: newMeasureType as any,
                window: newMeasureType === 'movingAverage' ? parseInt(newMeasureWindow) : undefined
            };
            updateDashboard(activeDashboard.id, {
                quickMeasures: [...currentMeasures, newMeasure]
            });
        }

        setIsAddingMeasure(false);
        setNewMeasureLabel('');
        setNewMeasureField('');
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

    const availableFields = effectiveDataSourceId
        ? dataSources.find(ds => ds.id === effectiveDataSourceId)?.schema || []
        : [];

    const dashboardCalculatedFields = activeDashboard?.calculatedFields?.map(c => ({
        name: c.name,
        type: (c.type || 'number') as 'number' | 'string' | 'date' | 'boolean',
        isCalculated: true
    })) || [];

    const widgetCalculatedFields = activeWidget?.calculatedFields?.map(c => ({
        name: c.name,
        type: (c.type || 'number') as 'number' | 'string' | 'date' | 'boolean',
        isCalculated: true
    })) || [];

    const dashboardQuickMeasures = activeDashboard?.quickMeasures?.map(m => ({
        name: m.label,
        type: 'number' as const,
        isCalculated: true,
        isQuickMeasure: true
    })) || [];

    const widgetQuickMeasures = activeWidget?.quickMeasures?.map(m => ({
        name: m.label,
        type: 'number' as const,
        isCalculated: true,
        isQuickMeasure: true
    })) || [];

    const fields = [
        ...availableFields,
        ...dashboardCalculatedFields,
        ...widgetCalculatedFields,
        ...dashboardQuickMeasures,
        ...widgetQuickMeasures
    ];

    const getDefaultAggregationForField = (fieldName?: string): AggregationType => {
        if (!fieldName) return normalizeAggregation(activeWidget?.aggregation || 'sum');
        const selectedField = fields.find((f) => f.name === fieldName);
        if (!selectedField) return normalizeAggregation(activeWidget?.aggregation || 'sum');
        return coerceAggregationForFieldType(activeWidget?.aggregation || 'sum', selectedField.type);
    };

    React.useEffect(() => {
        if (!activeDashboard?.activePageId || activePage?.dataSourceId || !activeWidget?.dataSourceId) return;
        syncPageDataSource(
            activeDashboard.id,
            activeDashboard.activePageId,
            activeWidget.dataSourceId,
            activeWidget.dataSourceName,
            activeWidget.dataSourcePipelineName
        );
    }, [
        activeDashboard?.id,
        activeDashboard?.activePageId,
        activePage?.dataSourceId,
        activeWidget?.dataSourceId,
        activeWidget?.dataSourceName,
        activeWidget?.dataSourcePipelineName,
        syncPageDataSource
    ]);

    const getSourceKey = (ds: DataSource) => {
        if (ds.connectionId) {
            return `conn:${ds.connectionId}`;
        }
        if (['csv', 'json', 'manual', 'api'].includes(ds.type)) {
            return `${ds.type}:local`;
        }
        return `${ds.type}:default`;
    };

    const getSourceLabel = (ds: DataSource) => {
        if (ds.connectionId) {
            const conn = connections.find((c: any) => c.id === ds.connectionId);
            if (conn?.name) return conn.name;
        }
        switch (ds.type) {
            case 'bigquery': return 'BigQuery';
            case 'excel': return 'Excel';
            case 'csv': return 'CSV';
            case 'json': return 'JSON';
            case 'api': return 'API';
            default: return 'Manual';
        }
    };

    const getTableLabel = (ds: DataSource) => ds.tableName || ds.name;

    const effectiveDataSource = effectiveDataSourceId
        ? dataSources.find(ds => ds.id === effectiveDataSourceId)
        : undefined;
    const effectiveSourceKey = effectiveDataSource ? getSourceKey(effectiveDataSource) : '';

    React.useEffect(() => {
        setSelectedSourceKey(effectiveSourceKey || '');
    }, [effectiveSourceKey]);

    const activeSourceKey = selectedSourceKey || effectiveSourceKey;

    const sourceOptions = React.useMemo(() => {
        const seen = new Map<string, string>();
        dataSources.forEach(ds => {
            const key = getSourceKey(ds);
            if (!seen.has(key)) seen.set(key, getSourceLabel(ds));
        });
        return Array.from(seen.entries()).map(([key, label]) => ({ key, label }));
    }, [dataSources, connections]);

    const normalizedDsSearchQuery = dsSearchQuery.toLowerCase().trim();
    const tableOptions = dataSources
        .filter(ds => !activeSourceKey || getSourceKey(ds) === activeSourceKey)
        .filter(ds => {
            if (!normalizedDsSearchQuery) return true;
            const haystack = `${getSourceLabel(ds)} ${getTableLabel(ds)}`.toLowerCase();
            return haystack.includes(normalizedDsSearchQuery);
        });

    const selectedTableId = effectiveDataSourceId && dataSources.find(ds =>
        ds.id === effectiveDataSourceId && (!activeSourceKey || getSourceKey(ds) === activeSourceKey)
    )
        ? effectiveDataSourceId
        : '';

    const handleSelectDataSource = (dsId: string) => {
        const selectedDs = dataSources.find(d => d.id === dsId);
        const dsName = selectedDs ? (selectedDs.tableName || selectedDs.name) : undefined;
        const dsPipelineName = selectedDs?.connectionId
            ? connections.find((c: any) => c.id === selectedDs.connectionId)?.name
            : undefined;

        const dashboard = getActiveDashboard();
        if (dashboard) {
            if (dashboard.activePageId) {
                syncPageDataSource(dashboard.id, dashboard.activePageId, dsId, dsName, dsPipelineName);
            } else {
                syncDashboardDataSource(dashboard.id, dsId, dsName, dsPipelineName);
            }
        }
        setSelectedDataSource(dsId || null);
    };

    return (
        <div className="flex flex-col h-full bg-white dark:bg-slate-950 transition-colors duration-300">
            {/* Tabs */}
            <div className="flex border-b border-white/5">
                <button
                    onClick={() => setActiveTab('visualizations')}
                    className={`flex-1 px-3 py-2 text-xs font-bold transition-colors ${activeTab === 'visualizations'
                        ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                >
                    <i className="fas fa-shapes mr-2"></i>
                    Visuals
                </button>
                <button
                    onClick={() => setActiveTab('data')}
                    className={`flex-1 px-3 py-2 text-xs font-bold transition-colors ${activeTab === 'data'
                        ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                >
                    <i className="fas fa-database mr-2"></i>
                    Pivot
                </button>
                <button
                    onClick={() => setActiveTab('format')}
                    className={`flex-1 px-3 py-2 text-xs font-bold transition-colors ${activeTab === 'format'
                        ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                >
                    <i className="fas fa-palette mr-2"></i>
                    Format
                </button>
                <button
                    onClick={() => setActiveTab('calculations')}
                    className={`flex-1 px-3 py-2 text-xs font-bold transition-colors ${activeTab === 'calculations'
                        ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                >
                    <i className="fas fa-calculator mr-2"></i>
                    Calculated
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
                                            ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 shadow-lg dark:shadow-[0_0_15px_rgba(99,102,241,0.3)]'
                                            : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/10 hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/10'
                                            }`}
                                    >
                                        <i className={`fas ${viz.icon} text-2xl ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'} group-hover:text-indigo-600 dark:group-hover:text-indigo-400 mb-2`}></i>
                                        <div className={`text-[10px] ${isActive ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'} group-hover:text-slate-900 dark:group-hover:text-white font-bold`}>{viz.label}</div>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="pt-3 border-t border-white/5">
                            <button
                                onClick={() => onAddWidget?.('card')}
                                className={`w-full p-3 rounded-lg border transition-all text-left ${activeWidget?.type === 'card'
                                    ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 shadow-md dark:shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/10 hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-bolt text-lg ${activeWidget?.type === 'card' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'card' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>KPI Card</span>
                            </button>

                            <button
                                onClick={() => onAddWidget?.('table')}
                                className={`w-full p-3 rounded-lg border transition-all text-left mt-2 ${activeWidget?.type === 'table'
                                    ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 shadow-md dark:shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/10 hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-table-list text-lg ${activeWidget?.type === 'table' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'table' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Data Table</span>
                            </button>

                            <button
                                onClick={() => onAddWidget?.('slicer')}
                                className={`w-full p-3 rounded-lg border transition-all text-left mt-2 ${activeWidget?.type === 'slicer'
                                    ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 shadow-md dark:shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/10 hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-filter text-lg ${activeWidget?.type === 'slicer' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'slicer' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Filter Slicer</span>
                            </button>

                            <button
                                onClick={() => onAddWidget?.('date-range')}
                                className={`w-full p-3 rounded-lg border transition-all text-left mt-2 ${activeWidget?.type === 'date-range'
                                    ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 shadow-md dark:shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/10 hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-calendar-days text-lg ${activeWidget?.type === 'date-range' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'date-range' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Date Range</span>
                            </button>

                            <button
                                onClick={() => onAddWidget?.('search')}
                                className={`w-full p-3 rounded-lg border transition-all text-left mt-2 ${activeWidget?.type === 'search'
                                    ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 shadow-md dark:shadow-[0_0_15_rgb(99,102,241,0.2)]'
                                    : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/10 hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-magnifying-glass text-lg ${activeWidget?.type === 'search' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'search' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Search Box</span>
                            </button>

                            <button
                                onClick={() => onAddWidget?.('pivot')}
                                className={`w-full p-3 rounded-lg border transition-all text-left mt-2 ${activeWidget?.type === 'pivot'
                                    ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-500 shadow-md dark:shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/10 hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/10'
                                    }`}
                            >
                                <i className={`fas fa-table-cells text-lg ${activeWidget?.type === 'pivot' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'} mr-2`}></i>
                                <span className={`text-xs font-bold ${activeWidget?.type === 'pivot' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Pivot Table</span>
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
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-lg pl-8 pr-3 py-1.5 text-[10px] text-slate-900 dark:text-white focus:ring-1 focus:ring-indigo-500 focus:outline-none placeholder-slate-400 dark:placeholder-slate-600 transition-all"
                                />
                            </div>
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">
                                Nguồn
                            </label>
                            <select
                                value={selectedSourceKey || effectiveSourceKey || ''}
                                onChange={(e) => setSelectedSourceKey(e.target.value)}
                                className={`w-full bg-slate-50 dark:bg-slate-900 border rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none ${!dataSources.find(ds => ds.id === effectiveDataSourceId) && effectiveDataSourceId
                                    ? 'border-red-500 text-red-500'
                                    : 'border-slate-200 dark:border-white/10'
                                    }`}
                            >
                                <option value="">Select source...</option>
                                {sourceOptions.map(source => (
                                    <option key={source.key} value={source.key}>{source.label}</option>
                                ))}
                            </select>

                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mt-3 mb-1">
                                Tên bảng
                            </label>
                            <select
                                value={selectedTableId || ''}
                                onChange={(e) => handleSelectDataSource(e.target.value)}
                                className={`w-full bg-slate-50 dark:bg-slate-900 border rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none ${!dataSources.find(ds => ds.id === effectiveDataSourceId) && effectiveDataSourceId
                                    ? 'border-red-500 text-red-500'
                                    : 'border-slate-200 dark:border-white/10'
                                    }`}
                            >
                                <option value="">Select table name...</option>
                                {tableOptions.map(ds => (
                                    <option key={ds.id} value={ds.id}>{getTableLabel(ds)}</option>
                                ))}

                                {/* SHOW MISSING TABLE OPTION IF ID EXISTS BUT NOT IN LIST */}
                                {effectiveDataSourceId && !dataSources.find(ds => ds.id === effectiveDataSourceId) && (
                                    <option value={effectiveDataSourceId} disabled>
                                        ⚠️ Missing: {activePage?.dataSourceName || activeWidget?.dataSourceName || activeDashboard?.dataSourceName || 'Unknown Table'}
                                    </option>
                                )}
                            </select>

                            {/* AUTO RECOVERY LOGIC & STATUS */}
                            {/* DATA SOURCE STATUS & AUTO-RECOVERY UI */}
                            {(effectiveDataSourceId) && (() => {
                                const ds = dataSources.find(ds => ds.id === effectiveDataSourceId);
                                const savedName = activePage?.dataSourceName || activeWidget?.dataSourceName || activeDashboard?.dataSourceName;
                                const isMissing = !ds;

                                // --- UI: STATUS INDICATOR ---
                                return (
                                    <div className="space-y-2 mt-2">
                                        <div className={`flex items-center justify-between text-[10px] border rounded p-1.5 px-2 transition-colors ${isMissing
                                            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-500/30'
                                            : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/5'
                                            }`}>
                                            <span className={`font-black uppercase tracking-tighter ${isMissing ? 'text-red-500' : 'text-slate-500 dark:text-slate-500'}`}>
                                                {isMissing ? 'Connection Error' : 'Status'}
                                            </span>

                                            {isMissing ? (
                                                <span className="text-red-500 font-bold flex items-center gap-1.5 animate-pulse">
                                                    <i className="fas fa-exclamation-triangle"></i>
                                                    Missing Source
                                                </span>
                                            ) : ds?.isLoaded ? (
                                                <span className="text-emerald-400 font-black flex items-center gap-1.5 line-clamp-1">
                                                    <i className="fas fa-check-circle text-[8px]"></i>
                                                    Synced
                                                </span>
                                            ) : ds?.isLoadingPartial ? (
                                                <span className="text-amber-400 font-black animate-pulse flex items-center gap-1.5 line-clamp-1">
                                                    <i className="fas fa-spinner fa-spin text-[8px]"></i>
                                                    Loading... ({ds?.totalRows ? Math.round(((ds.data?.length || 0) / ds.totalRows) * 100) : 0}%)
                                                </span>
                                            ) : (ds?.data?.length || 0) > 0 ? (
                                                <span className="text-indigo-400 font-black flex items-center gap-1.5 line-clamp-1">
                                                    <i className="fas fa-database text-[8px]"></i>
                                                    {ds?.data?.length.toLocaleString()} Rows
                                                </span>
                                            ) : (
                                                <span className="text-slate-500 font-black flex items-center gap-1.5">
                                                    <i className="fas fa-circle-notch text-[8px] opacity-30"></i>
                                                    Initialized
                                                </span>
                                            )}
                                        </div>

                                        {/* MISSING SOURCE DETAILS & RECOVERY FEEDBACK */}
                                        {isMissing && savedName && (
                                            <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-500/20 rounded-lg p-3 space-y-2">
                                                <div className="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">
                                                    The data table <span className="font-bold font-mono bg-red-100 dark:bg-red-900/40 px-1 rounded">{savedName}</span> cannot be found.
                                                </div>

                                                <div className="flex items-center gap-2 pt-1">
                                                    <div className="flex-1 h-0.5 bg-red-200 dark:bg-red-900/30"></div>
                                                    <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider">Troubleshooting</span>
                                                    <div className="flex-1 h-0.5 bg-red-200 dark:bg-red-900/30"></div>
                                                </div>

                                                <ul className="space-y-1.5">
                                                    <li className="flex gap-2 text-[10px] text-slate-600 dark:text-slate-400">
                                                        <i className="fas fa-1 text-[8px] mt-0.5 opacity-50"></i>
                                                        <span>Did you delete the Data Warehouse?</span>
                                                    </li>
                                                    <li className="flex gap-2 text-[10px] text-slate-600 dark:text-slate-400">
                                                        <i className="fas fa-2 text-[8px] mt-0.5 opacity-50"></i>
                                                        <span>Add the table back with the exact name: <strong>{savedName}</strong></span>
                                                    </li>
                                                </ul>

                                                <div className="pt-1 text-[9px] text-slate-400 italic text-center">
                                                    <i className="fas fa-sync fa-spin mr-1"></i>
                                                    Auto-scanning for match...
                                                </div>
                                            </div>
                                        )}

                                        {!isMissing && ds && !ds.isLoaded && (ds.totalRows || 0) > 0 && (ds.data?.length || 0) < (ds.totalRows || 0) && (
                                            <div className="w-full h-1 bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden border border-slate-200 dark:border-white/5">
                                                <div
                                                    className="h-full bg-indigo-500 transition-all duration-500 ease-out shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                                                    style={{ width: `${(ds.totalRows ? Math.round(((ds.data?.length || 0) / ds.totalRows) * 100) : 0)}%` }}
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
                                    Selected table: <span className="text-indigo-400 italic">{(dataSources.find(ds => ds.id === effectiveDataSourceId)?.tableName || dataSources.find(ds => ds.id === effectiveDataSourceId)?.name || 'none')}</span>
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

                                    // BAR / LINE / AREA / HORIZONTAL BAR / STACKED BAR
                                    if (['bar', 'line', 'area', 'horizontalBar', 'stackedBar'].includes(type as string)) {
                                        const totalSeries = (activeWidget.yAxisConfigs?.length || 0) + (activeWidget.lineAxisConfigs?.length || 0);
                                        const showLegendField = totalSeries <= 1;
                                        const isColumnChart = type === 'bar' || type === 'stackedBar' || activeWidget.stacked === true;

                                        return (
                                            <div className="space-y-4">
                                                <HierarchyFieldSelector
                                                    label="X-Axis / Category (Hierarchy)"
                                                    hierarchy={activeWidget.drillDownHierarchy}
                                                    fields={fields}
                                                    onChange={(h) => {
                                                        handleUpdateWidget({
                                                            drillDownHierarchy: h,
                                                            xAxis: h[0] || ''
                                                        });
                                                        // RESET DRILL DOWN STATE ON HIERARCHY CHANGE
                                                        useFilterStore.getState().setDrillDown(activeWidget.id, null);
                                                    }}
                                                    placeholder="Add X-Axis level..."
                                                    slotId="xAxis-hierarchy"
                                                />
                                                <PivotValueSelector
                                                    label="Y-Axis / Values (Column)"
                                                    values={
                                                        (activeWidget.yAxisConfigs && activeWidget.yAxisConfigs.length > 0)
                                                            ? activeWidget.yAxisConfigs
                                                            : (activeWidget.yAxis || [])
                                                                .filter((field): field is string => !!field)
                                                                .map((field) => ({
                                                                    field,
                                                                    aggregation: getDefaultAggregationForField(field),
                                                                    yAxisId: 'left' as const
                                                                }))
                                                    }
                                                    fields={fields}
                                                    onChange={(v) => {
                                                        const isStacked = type === 'stackedBar' || activeWidget.stacked === true;
                                                        handleUpdateWidget({
                                                            yAxisConfigs: v,
                                                            yAxis: v.map(item => item.field),
                                                            stacked: isStacked,
                                                            chartType: isStacked ? 'bar' : type as ChartType
                                                        });
                                                    }}
                                                    slotId="yAxis-multi"
                                                    defaultAxis="left"
                                                    hideAxisSelector={type === 'line'}
                                                />
                                                {isColumnChart && (
                                                    <PivotValueSelector
                                                        label="Line Values (Optional)"
                                                        values={activeWidget.lineAxisConfigs}
                                                        fields={fields}
                                                        onChange={(v) => handleUpdateWidget({ lineAxisConfigs: v })}
                                                        slotId="lineAxis-multi"
                                                        defaultAxis="left"
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
                                                    <div className="grid grid-cols-2 gap-2 bg-slate-800 rounded-lg p-2">
                                                        <button
                                                            onClick={() => handleUpdateWidget({ sortBy: 'none' })}
                                                            className={`py-1.5 px-2 rounded-md text-[10px] font-bold transition-all ${!activeWidget.sortBy || activeWidget.sortBy === 'none' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            Default
                                                        </button>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ sortBy: 'category_asc' })}
                                                            className={`py-1.5 px-2 rounded-md text-[10px] font-bold transition-all ${activeWidget.sortBy === 'category_asc' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            A → Z
                                                        </button>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ sortBy: 'value_desc' })}
                                                            className={`py-1.5 px-2 rounded-md text-[10px] font-bold transition-all ${activeWidget.sortBy === 'value_desc' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            High → Low
                                                        </button>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ sortBy: 'value_asc' })}
                                                            className={`py-1.5 px-2 rounded-md text-[10px] font-bold transition-all ${activeWidget.sortBy === 'value_asc' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
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
                                                <div className="pt-2 border-t border-white/5">
                                                    <label className="text-[10px] text-slate-400 font-bold uppercase mb-2 block">Sort Order</label>
                                                    <div className="grid grid-cols-2 gap-2 bg-slate-800 rounded-lg p-2">
                                                        <button
                                                            onClick={() => handleUpdateWidget({ sortBy: 'none' })}
                                                            className={`py-1.5 px-2 rounded-md text-[10px] font-bold transition-all ${(!activeWidget.sortBy || activeWidget.sortBy === 'none') ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            Default
                                                        </button>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ sortBy: 'category_asc' })}
                                                            className={`py-1.5 px-2 rounded-md text-[10px] font-bold transition-all ${activeWidget.sortBy === 'category_asc' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            A → Z
                                                        </button>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ sortBy: 'value_desc' })}
                                                            className={`py-1.5 px-2 rounded-md text-[10px] font-bold transition-all ${activeWidget.sortBy === 'value_desc' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            High → Low
                                                        </button>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ sortBy: 'value_asc' })}
                                                            className={`py-1.5 px-2 rounded-md text-[10px] font-bold transition-all ${activeWidget.sortBy === 'value_asc' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                                                        >
                                                            Low → High
                                                        </button>
                                                    </div>
                                                </div>
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
                                                <div className="p-3 border border-dashed border-slate-200 dark:border-white/10 rounded-lg text-center bg-slate-50 dark:bg-slate-900/30">
                                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-2">Drag fields from Sidebar or select below</p>
                                                    <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1 mb-2">
                                                        {activeWidget.columns?.map((col, idx) => (
                                                            <div key={col.field} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-lg p-3 group hover:border-indigo-500/30 transition-all">
                                                                <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-200 dark:border-white/5">
                                                                    <div className="flex items-center gap-2 overflow-hidden">
                                                                        <div className="w-5 h-5 rounded bg-indigo-500/20 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                                                            <i className="fas fa-columns text-[10px]"></i>
                                                                        </div>
                                                                        <span className="text-[10px] font-bold text-slate-900 dark:text-white truncate" title={col.field}>{col.field}</span>
                                                                    </div>
                                                                    <button onClick={() => {
                                                                        const newCols = activeWidget.columns?.filter(c => c.field !== col.field);
                                                                        handleUpdateWidget({ columns: newCols });
                                                                    }} className="text-slate-400 dark:text-slate-500 hover:text-red-500 w-5 h-5 flex items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                                                                        <i className="fas fa-times text-[10px]"></i>
                                                                    </button>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    <div>
                                                                        <label className="text-[8px] text-slate-500 uppercase font-black block mb-1">Header</label>
                                                                        <input
                                                                            type="text"
                                                                            value={col.header || col.field}
                                                                            onChange={(e) => {
                                                                                const newCols = [...(activeWidget.columns || [])];
                                                                                newCols[idx] = { ...col, header: e.target.value };
                                                                                handleUpdateWidget({ columns: newCols });
                                                                            }}
                                                                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded px-2 py-1.5 text-[10px] text-slate-900 dark:text-white focus:border-indigo-500/50 outline-none transition-colors"
                                                                            placeholder="Column Label"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-[8px] text-slate-500 uppercase font-black block mb-1">Format</label>
                                                                        <select
                                                                            value={col.format || 'standard'}
                                                                            onChange={(e) => {
                                                                                const newCols = [...(activeWidget.columns || [])];
                                                                                newCols[idx] = { ...col, format: e.target.value };
                                                                                handleUpdateWidget({ columns: newCols });
                                                                            }}
                                                                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded px-2 py-1.5 text-[10px] text-slate-900 dark:text-white focus:border-indigo-500/50 outline-none transition-colors appearance-none"
                                                                        >
                                                                            <optgroup label="Standard">
                                                                                <option value="standard">Standard (1,234.56)</option>
                                                                                <option value="integer">Integer (1,234)</option>
                                                                            </optgroup>
                                                                            <optgroup label="Compact & Large">
                                                                                <option value="compact">Auto Compact (1.2K)</option>
                                                                                <option value="compact_long">Long Compact (1.2 thousand)</option>
                                                                                <option value="1k">Thousands (1K)</option>
                                                                                <option value="1m">Millions (1M)</option>
                                                                                <option value="1b">Billions (1B)</option>
                                                                            </optgroup>
                                                                            <optgroup label="Currency">
                                                                                <option value="currency">US Dollar ($)</option>
                                                                                <option value="currency_vnd">Vietnamese Dong (₫)</option>
                                                                                <option value="currency_eur">Euro (€)</option>
                                                                                <option value="currency_gbp">British Pound (£)</option>
                                                                                <option value="currency_jpy">Japanese Yen (¥)</option>
                                                                                <option value="accounting">Accounting ($1,234)</option>
                                                                            </optgroup>
                                                                            <optgroup label="Percentage">
                                                                                <option value="percentage">Percentage (12.3%)</option>
                                                                                <option value="percentage_0">Percentage (12%)</option>
                                                                                <option value="percentage_2">Percentage (12.34%)</option>
                                                                            </optgroup>
                                                                            <optgroup label="Scientific & Float">
                                                                                <option value="float_1">Float (1.2)</option>
                                                                                <option value="float_2">Float (1.23)</option>
                                                                                <option value="float_3">Float (1.234)</option>
                                                                                <option value="float_4">Float (1.2345)</option>
                                                                                <option value="scientific">Scientific (1.23E+4)</option>
                                                                            </optgroup>
                                                                            <optgroup label="Date">
                                                                                <option value="date:YYYY-MM-DD">YYYY-MM-DD</option>
                                                                                <option value="date:DD/MM/YYYY">DD/MM/YYYY</option>
                                                                                <option value="date:MM/DD/YYYY">MM/DD/YYYY</option>
                                                                                <option value="date:DD-MM-YYYY">DD-MM-YYYY</option>
                                                                                <option value="date:DD MMM YYYY">DD MMM YYYY</option>
                                                                                <option value="date:MMM DD, YYYY">MMM DD, YYYY</option>
                                                                            </optgroup>
                                                                            <optgroup label="Time">
                                                                                <option value="time:HH:mm">Time (HH:mm)</option>
                                                                                <option value="time:hh:mm A">Time (hh:mm AM/PM)</option>
                                                                                <option value="datetime:YYYY-MM-DD HH:mm:ss">Full DateTime</option>
                                                                            </optgroup>
                                                                        </select>
                                                                    </div>
                                                                </div>
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
                                                    label="Rows (Optional Hierarchy)"
                                                    hierarchy={activeWidget.pivotRows}
                                                    fields={fields}
                                                    onChange={(h) => handleUpdateWidget({ pivotRows: h, drillDownHierarchy: h })}
                                                    placeholder="Add row level..."
                                                    hint="💡 Leave empty to auto-group as Total"
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
                                                    hideAxisSelector={true}
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
                                                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
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
                                                            <div className="text-xs font-bold text-slate-900 dark:text-white">Dropdown Mode</div>
                                                            <div className="text-[10px] text-slate-500">Compact selection view</div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ slicerMode: activeWidget.slicerMode === 'dropdown' ? 'list' : 'dropdown' })}
                                                            className={`w-10 h-5 rounded-full relative transition-colors ${activeWidget.slicerMode === 'dropdown' ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800'}`}
                                                        >
                                                            <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${activeWidget.slicerMode === 'dropdown' ? 'right-1' : 'left-1'}`}></div>
                                                        </button>
                                                    </div>

                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <div className="text-xs font-bold text-slate-900 dark:text-white">Show "Select All"</div>
                                                            <div className="text-[10px] text-slate-500">Quickly toggle all options</div>
                                                        </div>
                                                        <button
                                                            onClick={() => handleUpdateWidget({ showSelectAll: !activeWidget.showSelectAll })}
                                                            className={`w-10 h-5 rounded-full relative transition-colors ${activeWidget.showSelectAll ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800'}`}
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

                                        <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 rounded-xl p-4 space-y-3">
                                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">
                                                Value Formatting
                                            </label>
                                            <div className="relative group">
                                                <i className="fas fa-hashtag absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[10px] group-hover:text-indigo-400 transition-colors"></i>
                                                <select
                                                    value={activeWidget.valueFormat || 'standard'}
                                                    onChange={(e) => handleUpdateWidget({ valueFormat: e.target.value })}
                                                    className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg pl-8 pr-3 py-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none appearance-none cursor-pointer hover:border-indigo-500/20 transition-all font-bold"
                                                >
                                                    <optgroup label="General" className="bg-slate-900">
                                                        <option value="standard">Standard (1,234.56)</option>
                                                        <option value="float_2">Float (1,234.56)</option>
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

                                    </>
                                )}

                                <div className="pt-3 border-t border-slate-200 dark:border-white/5">
                                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
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
                                            className="rounded border-slate-200 dark:border-white/20 bg-white dark:bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        Enable Cross-Filtering
                                    </label>
                                </div>
                            </>
                        )
                        }
                    </div>
                )
                }

                {/* Format Tab */}
                {
                    activeTab === 'format' && activeWidget && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                    Title
                                </label>
                                <input
                                    type="text"
                                    value={activeWidget.title}
                                    onChange={(e) => handleUpdateWidget({ title: e.target.value })}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                />
                            </div>



                            {['pivot', 'table'].includes(activeWidget.type) && (
                                <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-white/5">
                                    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={activeWidget.hideZeros || false}
                                            onChange={(e) => handleUpdateWidget({ hideZeros: e.target.checked })}
                                            className="rounded border-slate-200 dark:border-white/20 bg-white dark:bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        Hide Zeros (Show '-')
                                    </label>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={activeWidget.showLegend !== false}
                                        onChange={(e) => handleUpdateWidget({ showLegend: e.target.checked })}
                                        className="rounded border-slate-200 dark:border-white/20 bg-white dark:bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    Show Legend
                                </label>

                                {activeWidget.showLegend !== false && (
                                    <div className="ml-6 pl-2 border-l border-slate-200 dark:border-white/10 space-y-2">
                                        <label className="block text-[9px] text-slate-500 uppercase">Position</label>
                                        <select
                                            value={activeWidget.legendPosition || 'bottom'}
                                            onChange={(e) => handleUpdateWidget({ legendPosition: e.target.value as any })}
                                            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-[10px] text-slate-900 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                        >
                                            <option value="right">Right</option>
                                            <option value="bottom">Bottom</option>
                                            <option value="top">Top</option>
                                            <option value="left">Left</option>
                                        </select>
                                        <div className="pt-1">
                                            <label className="flex justify-between items-center text-[9px] text-slate-500 uppercase mb-1">
                                                <span>Font Size</span>
                                                <span className="text-slate-900 dark:text-white font-mono">{activeWidget.legendFontSize || 10}px</span>
                                            </label>
                                            <input
                                                type="range"
                                                min="6"
                                                max="24"
                                                step="1"
                                                value={activeWidget.legendFontSize || 10}
                                                onChange={(e) => handleUpdateWidget({ legendFontSize: parseInt(e.target.value) })}
                                                className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                            />
                                        </div>
                                    </div>
                                )}

                                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={activeWidget.showGrid !== false}
                                        onChange={(e) => handleUpdateWidget({ showGrid: e.target.checked })}
                                        className="rounded border-slate-200 dark:border-white/20 bg-white dark:bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    Show Grid
                                </label>

                                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={activeWidget.showLabels !== false}
                                        onChange={(e) => handleUpdateWidget({ showLabels: e.target.checked })}
                                        className="rounded border-slate-200 dark:border-white/20 bg-white dark:bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    Show Labels
                                </label>

                                {activeWidget.showLabels !== false && (
                                    <div className="ml-6 pl-2 border-l border-slate-200 dark:border-white/10 space-y-2">
                                        <label className="block text-[9px] text-slate-500 uppercase">Label Mode</label>
                                        <select
                                            value={activeWidget.labelMode || 'categoricalValue'}
                                            onChange={(e) => handleUpdateWidget({ labelMode: e.target.value as any })}
                                            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-[10px] text-slate-900 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                        >
                                            <option value="value">Value Only</option>
                                            <option value="percent">Percent Only</option>
                                            <option value="category">Category Only</option>
                                            <option value="categoricalValue">Category + Value</option>
                                            <option value="categoricalPercent">Category + Percent</option>
                                        </select>

                                        {(!activeWidget.labelMode || ['value', 'categoricalValue', 'categoricalPercent'].includes(activeWidget.labelMode)) && (
                                            <div className="mt-2 space-y-1">
                                                <div className="flex justify-between items-center group">
                                                    <label className="block text-[9px] text-slate-500 uppercase">Override Format</label>
                                                    {activeWidget.labelFormat && (
                                                        <button
                                                            onClick={() => handleUpdateWidget({ labelFormat: undefined })}
                                                            className="text-[8px] text-indigo-400 hover:text-indigo-300"
                                                        >
                                                            Reset
                                                        </button>
                                                    )}
                                                </div>
                                                <select
                                                    value={activeWidget.labelFormat || activeWidget.valueFormat || 'standard'}
                                                    onChange={(e) => handleUpdateWidget({ labelFormat: e.target.value })}
                                                    className={`w-full bg-slate-50 dark:bg-slate-900 border ${activeWidget.labelFormat ? 'border-indigo-500/50' : 'border-slate-200 dark:border-white/10'} rounded px-2 py-1 text-[10px] text-slate-900 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-none`}
                                                >
                                                    <option value="">Use Global Format</option>
                                                    <option value="standard">Standard (1,000,000)</option>
                                                    <option value="compact">Compact (1M / 1B)</option>
                                                    <option value="integer">Integer (No decimals)</option>
                                                    <option value="percentage">Percent (0.0%)</option>
                                                    <option value="currency_vnd">Currency (VND)</option>
                                                    <option value="currency_usd">Currency (USD)</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                )}
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
                                            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded px-2 py-1.5 text-[10px] text-slate-900 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-none"
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
                                                className="flex-1 h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                            />
                                            <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 min-w-[24px]">
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
                                                className="flex-1 h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                            />
                                            <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 min-w-[24px]">
                                                {activeWidget.borderRadius || 12}px
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] text-slate-500 dark:text-slate-400 uppercase">Show Shadow</label>
                                        <button
                                            onClick={() => handleUpdateWidget({ showShadow: !activeWidget.showShadow })}
                                            className={`w-10 h-5 rounded-full transition-colors relative ${activeWidget.showShadow ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'}`}
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
                    )
                }
                {/* Calculated Fields Tab */}
                {
                    activeTab === 'calculations' && (
                        <div className="space-y-4">
                            <div className="">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                        Calculated Fields
                                    </label>
                                    <button
                                        onClick={() => {
                                            setNewCalcName('');
                                            setNewCalcFormula('');
                                            setEditingCalcId(null);
                                            setIsAddingCalc(true);
                                        }}
                                        className="text-xs text-indigo-400 hover:text-indigo-300"
                                    >
                                        <i className="fas fa-plus"></i> Add
                                    </button>
                                </div>



                                <div className="space-y-1">
                                    {/* Dashboard Level */}
                                    {activeDashboard?.calculatedFields?.map(calc => (
                                        <div key={calc.id} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900 border border-indigo-500/20 dark:border-indigo-500/30 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-all group">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className="w-5 h-5 flex items-center justify-center rounded bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
                                                    <i className="fas fa-globe text-[8px] absolute -top-1 -right-1"></i>
                                                    <i className="fas fa-calculator text-[10px]"></i>
                                                </div>
                                                <div className="flex flex-col overflow-hidden">
                                                    <span className="text-xs text-slate-900 dark:text-white truncate font-bold">{calc.name}</span>
                                                    <span className="text-[8px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-tighter">Dashboard Global</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                <button
                                                    onClick={() => handleEditCalculation(calc)}
                                                    className="text-slate-500 hover:text-indigo-400 transition-all p-1"
                                                >
                                                    <i className="fas fa-edit text-[10px]"></i>
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteCalculation(calc.id)}
                                                    className="text-slate-500 hover:text-red-400 transition-all p-1"
                                                >
                                                    <i className="fas fa-trash text-[10px]"></i>
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Widget Level (Deprecated) */}
                                    {activeWidget?.calculatedFields?.map(calc => (
                                        <div key={calc.id} className="flex items-center justify-between p-2 bg-white dark:bg-slate-950/50 rounded border border-slate-200 dark:border-white/5 hover:border-indigo-500/30 group">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                                    <i className="fas fa-calculator text-[10px]"></i>
                                                </div>
                                                <div className="flex flex-col overflow-hidden">
                                                    <span className="text-xs text-slate-900 dark:text-slate-400 truncate">{calc.name}</span>
                                                    <span className="text-[8px] text-slate-400 dark:text-slate-600 uppercase font-black tracking-tighter">Widget Local</span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteCalculation(calc.id)}
                                                className="opacity-0 group-hover:opacity-100 text-slate-400 dark:text-slate-700 hover:text-red-500 dark:hover:text-red-400"
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

                            <div className="pt-3 border-t border-slate-200 dark:border-white/5">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                        Quick Measures
                                    </label>
                                    <button
                                        onClick={() => {
                                            setNewMeasureLabel('');
                                            setNewMeasureField('');
                                            setEditingMeasureId(null);
                                            setIsAddingMeasure(true);
                                        }}
                                        className="text-xs text-indigo-400 hover:text-indigo-300"
                                    >
                                        <i className="fas fa-plus"></i> Add
                                    </button>
                                </div>

                                {isAddingMeasure && (
                                    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg p-3 mb-3">
                                        <input
                                            type="text"
                                            placeholder="Label"
                                            value={newMeasureLabel}
                                            onChange={(e) => setNewMeasureLabel(e.target.value)}
                                            className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-xs text-slate-900 dark:text-white mb-2"
                                        />
                                        <select
                                            value={newMeasureField}
                                            onChange={(e) => setNewMeasureField(e.target.value)}
                                            className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-xs text-slate-900 dark:text-white mb-2"
                                        >
                                            <option value="">Select Field...</option>
                                            {fields.filter(f => f.type === 'number').map(f => (
                                                <option key={f.name} value={f.name}>{f.name} ({f.type})</option>
                                            ))}
                                        </select>
                                        <select
                                            value={newMeasureType}
                                            onChange={(e) => setNewMeasureType(e.target.value)}
                                            className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-xs text-slate-900 dark:text-white mb-2"
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
                                                    className="w-16 bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-xs text-slate-900 dark:text-white"
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
                                                {editingMeasureId ? 'Update' : 'Save'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-1">
                                    {/* Dashboard Level */}
                                    {activeDashboard?.quickMeasures?.map(measure => (
                                        <div key={measure.id} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900 border border-indigo-500/20 dark:border-indigo-500/30 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-all group">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className="w-5 h-5 flex items-center justify-center rounded bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
                                                    <i className="fas fa-globe text-[8px] absolute -top-1 -right-1"></i>
                                                    <i className="fas fa-magic text-[10px]"></i>
                                                </div>
                                                <div className="flex flex-col overflow-hidden">
                                                    <span className="text-xs text-slate-900 dark:text-white truncate font-bold">{measure.label}</span>
                                                    <span className="text-[8px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-tighter">Dashboard Global</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                <button
                                                    onClick={() => handleEditMeasure(measure)}
                                                    className="text-slate-400 dark:text-slate-500 hover:text-indigo-400 transition-all p-1"
                                                >
                                                    <i className="fas fa-edit text-[10px]"></i>
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteMeasure(measure.id)}
                                                    className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-all p-1"
                                                >
                                                    <i className="fas fa-trash text-[10px]"></i>
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Widget Level (Deprecated) */}
                                    {activeWidget?.quickMeasures?.map(measure => (
                                        <div key={measure.id} className="flex items-center justify-between p-2 bg-white dark:bg-slate-950/50 rounded border border-slate-200 dark:border-white/5 hover:border-indigo-500/30 group">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                                    <i className="fas fa-magic text-[10px]"></i>
                                                </div>
                                                <div className="flex flex-col overflow-hidden">
                                                    <span className="text-xs text-slate-900 dark:text-slate-400 truncate">{measure.label}</span>
                                                    <span className="text-[8px] text-slate-400 dark:text-slate-600 uppercase font-black tracking-tighter">Widget Local</span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteMeasure(measure.id)}
                                                className="opacity-0 group-hover:opacity-100 text-slate-400 dark:text-slate-700 hover:text-red-500 dark:hover:text-red-400"
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
                        </div>
                    )
                }

                {
                    !activeWidget && activeTab !== 'visualizations' && activeTab !== 'calculations' && (
                        <div className="flex items-center justify-center h-full text-slate-500 text-xs">
                            Select a widget to configure
                        </div>
                    )
                }
            </div >
            <FormulaEditorModal
                isOpen={isAddingCalc}
                onClose={() => setIsAddingCalc(false)}
                onSave={handleSaveCalculation}
                availableFields={fields}
                existingFieldNames={fields.map(f => f.name)}
                editingFieldName={
                    editingCalcId
                        ? [...(activeDashboard?.calculatedFields || []), ...(activeWidget?.calculatedFields || [])].find(c => c.id === editingCalcId)?.name || ''
                        : ''
                }
                initialName={newCalcName}
                initialFormula={newCalcFormula}
            />
        </div >
    );
};

export default BIVisualBuilder;
