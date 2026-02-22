import React from 'react';
import { BIDashboard, DashboardRLSConfig, RLSRule } from '../types';
import { RLSRuleBuilder } from './RLSRuleBuilder';
import { useLanguageStore } from '../../../store/languageStore';

interface RLSConfigPanelProps {
    dashboard: BIDashboard;
    role: 'view' | 'edit' | 'admin' | 'none';
    config: DashboardRLSConfig;
    fields: string[];
    isConfirmed: boolean;
    onChange: (config: DashboardRLSConfig) => void;
    onConfirm: () => void;
}

const createRule = (): RLSRule => ({
    id: `rls-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    combinator: 'AND',
    conditions: [{
        id: `rls-cond-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        field: '',
        operator: 'eq',
        value: '',
    }],
});

export const RLSConfigPanel: React.FC<RLSConfigPanelProps> = ({ dashboard, role, config, fields, isConfirmed, onChange, onConfirm }) => {
    const { t } = useLanguageStore();
    const disabled = role === 'none';

    const togglePage = (pageId: string) => {
        const next = config.allowedPageIds.includes(pageId)
            ? config.allowedPageIds.filter((id) => id !== pageId)
            : [...config.allowedPageIds, pageId];
        onChange({ ...config, allowedPageIds: next });
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-2xl p-4 gap-4">
            <div className="text-center">
                <div className="text-sm font-bold text-slate-900 dark:text-white">{dashboard.title}</div>
            </div>

            <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('share.allowed_pages')}</div>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                    {(dashboard.pages || []).map((page) => (
                        <label key={page.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                            <input
                                type="checkbox"
                                checked={config.allowedPageIds.includes(page.id)}
                                onChange={() => togglePage(page.id)}
                                disabled={disabled}
                            />
                            <span>{page.title}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className="space-y-2 flex-1 min-h-0">
                <div className="flex items-center justify-between">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('share.rules')}</div>
                    <button
                        type="button"
                        onClick={() => onChange({ ...config, rules: [...config.rules, createRule()] })}
                        disabled={disabled}
                        className="text-[10px] font-black uppercase tracking-widest text-indigo-500 disabled:text-slate-400"
                    >
                        {t('share.add_rule')}
                    </button>
                </div>
                <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                    {config.rules.length === 0 && (
                        <div className="text-[11px] text-slate-500 border border-dashed border-slate-300 dark:border-white/10 rounded-xl p-3">
                            {t('share.no_rule_yet')}
                        </div>
                    )}
                    {config.rules.map((rule, idx) => (
                        <RLSRuleBuilder
                            key={rule.id}
                            rule={rule}
                            index={idx}
                            fields={fields}
                            onChange={(nextRule) => {
                                onChange({
                                    ...config,
                                    rules: config.rules.map((r) => (r.id === rule.id ? nextRule : r)),
                                });
                            }}
                            onRemove={() => {
                                onChange({ ...config, rules: config.rules.filter((r) => r.id !== rule.id) });
                            }}
                        />
                    ))}
                </div>
            </div>

            <button
                type="button"
                onClick={onConfirm}
                disabled={disabled}
                className={`rounded-xl px-4 py-3 text-xs font-black uppercase tracking-widest transition-colors ${isConfirmed ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white'} disabled:bg-slate-300 disabled:text-slate-500`}
            >
                {isConfirmed ? t('share.configured') : t('share.confirm_dashboard')}
            </button>
        </div>
    );
};
