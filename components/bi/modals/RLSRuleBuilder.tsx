import React from 'react';
import { RLSCondition, RLSRule, RLSRuleOperator } from '../types';
import { useLanguageStore } from '../../../store/languageStore';

const OPERATORS: Array<{ value: RLSRuleOperator; label: string; needsValue?: boolean; needsSecondValue?: boolean; supportsMulti?: boolean }> = [
    { value: 'eq', label: 'Equals', needsValue: true },
    { value: 'in', label: 'In list', needsValue: true, supportsMulti: true },
    { value: 'neq', label: 'Not equals', needsValue: true },
    { value: 'gt', label: 'Greater than', needsValue: true },
    { value: 'gte', label: 'Greater or equal', needsValue: true },
    { value: 'lt', label: 'Less than', needsValue: true },
    { value: 'lte', label: 'Less or equal', needsValue: true },
    { value: 'between', label: 'Between', needsValue: true, needsSecondValue: true },
    { value: 'contains', label: 'Contains', needsValue: true },
    { value: 'startsWith', label: 'Starts with', needsValue: true },
    { value: 'endsWith', label: 'Ends with', needsValue: true },
    { value: 'isNull', label: 'Is null' },
    { value: 'isNotNull', label: 'Is not null' },
];

interface RLSRuleBuilderProps {
    rule: RLSRule;
    index: number;
    fields: string[];
    onChange: (rule: RLSRule) => void;
    onRemove: () => void;
}

const newCondition = (): RLSCondition => ({
    id: `rls-cond-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    field: '',
    operator: 'eq',
    value: '',
});

export const RLSRuleBuilder: React.FC<RLSRuleBuilderProps> = ({ rule, index, fields, onChange, onRemove }) => {
    const { t } = useLanguageStore();

    const updateRule = (updates: Partial<RLSRule>) => {
        onChange({ ...rule, ...updates });
    };

    const updateCondition = (conditionId: string, updates: Partial<RLSCondition>) => {
        updateRule({
            conditions: (rule.conditions || []).map((c) => (c.id === conditionId ? { ...c, ...updates } : c)),
        });
    };

    const removeCondition = (conditionId: string) => {
        updateRule({
            conditions: (rule.conditions || []).filter((c) => c.id !== conditionId),
        });
    };

    return (
        <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/40 space-y-3">
            <div className="flex items-center justify-between">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('share.rule', { index: index + 1 })}</div>
                <button
                    type="button"
                    onClick={onRemove}
                    className="text-[10px] font-bold uppercase tracking-widest text-rose-500 hover:text-rose-400"
                >
                    {t('share.remove')}
                </button>
            </div>

            <div className="flex items-center justify-between">
                <select
                    value={rule.combinator || 'AND'}
                    onChange={(e) => updateRule({ combinator: e.target.value as 'AND' | 'OR' })}
                    className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs min-w-[140px]"
                >
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                </select>
                <button
                    type="button"
                    onClick={() => updateRule({ conditions: [...(rule.conditions || []), newCondition()] })}
                    className="text-[10px] font-black uppercase tracking-widest text-indigo-500"
                >
                    + Condition
                </button>
            </div>

            <div className="space-y-3">
                {(rule.conditions || []).map((condition, condIndex) => {
                    const operatorMeta = OPERATORS.find((op) => op.value === condition.operator) || OPERATORS[0];
                    return (
                        <div key={condition.id} className="rounded-lg border border-slate-200 dark:border-white/10 p-2 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Condition {condIndex + 1}</div>
                                {(rule.conditions || []).length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => removeCondition(condition.id)}
                                        className="text-[10px] font-bold uppercase tracking-widest text-rose-500 hover:text-rose-400"
                                    >
                                        {t('share.remove')}
                                    </button>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <select
                                    value={condition.field}
                                    onChange={(e) => updateCondition(condition.id, { field: e.target.value })}
                                    className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs"
                                >
                                    <option value="">{t('share.select_field')}</option>
                                    {fields.map((field) => (
                                        <option key={field} value={field}>{field}</option>
                                    ))}
                                </select>
                                <select
                                    value={condition.operator}
                                    onChange={(e) => updateCondition(condition.id, { operator: e.target.value as RLSRuleOperator, value: '', values: [], value2: '' })}
                                    className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs"
                                >
                                    {OPERATORS.map((op) => (
                                        <option key={op.value} value={op.value}>{op.label}</option>
                                    ))}
                                </select>
                            </div>

                            {operatorMeta.needsValue && !operatorMeta.supportsMulti && (
                                <input
                                    type="text"
                                    value={condition.value || ''}
                                    onChange={(e) => updateCondition(condition.id, { value: e.target.value })}
                                    placeholder={t('share.value')}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs"
                                />
                            )}

                            {operatorMeta.needsValue && operatorMeta.supportsMulti && (
                                <input
                                    type="text"
                                    value={(condition.values || []).join(', ')}
                                    onChange={(e) => updateCondition(condition.id, { values: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })}
                                    placeholder={t('share.values_csv')}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs"
                                />
                            )}

                            {operatorMeta.needsSecondValue && (
                                <input
                                    type="text"
                                    value={condition.value2 || ''}
                                    onChange={(e) => updateCondition(condition.id, { value2: e.target.value })}
                                    placeholder={t('share.value2')}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs"
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
