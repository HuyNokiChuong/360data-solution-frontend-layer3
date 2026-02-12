import React, { useEffect, useMemo, useState } from 'react';
import { BIDashboard, DashboardRLSConfig, SharePermission, ShareSavePayload } from '../types';
import { RLSConfigPanel } from './RLSConfigPanel';
import { useLanguageStore } from '../../../store/languageStore';
import { API_BASE } from '../../../services/api';
import { useDataStore } from '../store/dataStore';

interface ShareModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    itemType: 'dashboard' | 'folder';
    permissions: SharePermission[];
    dashboard?: BIDashboard;
    folderDashboards?: BIDashboard[];
    onSave: (email: string, payload: ShareSavePayload) => void;
}

const createDefaultConfig = (dashboard?: BIDashboard): DashboardRLSConfig => ({
    allowedPageIds: (dashboard?.pages || []).map((p) => p.id),
    rules: [],
});

const getDashboardFields = (dashboard?: BIDashboard, dataSources: any[] = [], allowedPageIds?: string[]): string[] => {
    if (!dashboard) return [];
    const fieldSet = new Set<string>();
    const pageScope = Array.isArray(allowedPageIds) && allowedPageIds.length > 0
        ? new Set(allowedPageIds)
        : null;

    (dashboard.dataSources || []).forEach((ds) => {
        (ds.schema || []).forEach((f) => {
            if (f?.name) fieldSet.add(f.name);
        });
    });

    const pageWidgets = (dashboard.pages || [])
        .filter((p) => !pageScope || pageScope.has(p.id))
        .flatMap((p) => p.widgets || []);
    const allWidgets = [...(dashboard.widgets || []), ...pageWidgets];

    const addSchemaFieldsFromSource = (widget: any) => {
        if (!widget) return;
        const widgetSource = dataSources.find((ds: any) =>
            (widget.dataSourceId && ds.id === widget.dataSourceId) ||
            (widget.dataSourceName && (ds.name === widget.dataSourceName || ds.tableName === widget.dataSourceName))
        );

        (widgetSource?.schema || []).forEach((f: any) => {
            if (f?.name) fieldSet.add(String(f.name));
        });
    };

    allWidgets.forEach((w: any) => {
        addSchemaFieldsFromSource(w);

        const candidates = [
            w.xAxis,
            ...(w.yAxis || []),
            ...(w.values || []),
            ...(w.dimensions || []),
            ...(w.measures || []),
            ...((w.columns || []).map((c: any) => c?.field).filter(Boolean)),
            ...((w.pivotRows || []).filter(Boolean)),
            ...((w.pivotCols || []).filter(Boolean)),
            ...((w.pivotValues || []).map((pv: any) => pv?.field).filter(Boolean)),
            w.metric,
            w.comparisonValue,
            w.legend,
            w.slicerField,
        ].filter(Boolean);

        candidates.forEach((c) => fieldSet.add(String(c)));
    });

    (dashboard.globalFilters || []).forEach((gf: any) => {
        if (gf?.field) fieldSet.add(String(gf.field));
    });
    (dashboard.calculatedFields || []).forEach((cf: any) => {
        if (cf?.name) fieldSet.add(String(cf.name));
    });
    (dashboard.quickMeasures || []).forEach((qm: any) => {
        if (qm?.field) fieldSet.add(String(qm.field));
        if (qm?.label) fieldSet.add(String(qm.label));
    });

    return Array.from(fieldSet).sort((a, b) => a.localeCompare(b));
};

const validateRule = (rule: any): boolean => {
    const conditions = Array.isArray(rule?.conditions) ? rule.conditions : [];
    if (conditions.length === 0) return false;

    return conditions.every((condition: any) => {
        if (!condition?.field) return false;
        const op = condition.operator;
        if (['isNull', 'isNotNull'].includes(op)) return true;
        if (op === 'in') return Array.isArray(condition.values) && condition.values.length > 0;
        if (op === 'between') return !!String(condition.value || '').trim() && !!String(condition.value2 || '').trim();
        return !!String(condition.value || '').trim();
    });
};

export const ShareModal: React.FC<ShareModalProps> = ({
    isOpen,
    onClose,
    title,
    itemType,
    dashboard,
    folderDashboards,
    onSave,
}) => {
    const { t } = useLanguageStore();
    const dataSources = useDataStore((s) => s.dataSources);
    const [email, setEmail] = useState('');
    const [workspaceUserEmails, setWorkspaceUserEmails] = useState<string[]>([]);
    const [isEmailSuggestionOpen, setIsEmailSuggestionOpen] = useState(false);
    const [granularRoles, setGranularRoles] = useState<Record<string, SharePermission['permission'] | 'none'>>({});
    const [dashboardRLS, setDashboardRLS] = useState<Record<string, DashboardRLSConfig>>({});
    const [confirmedDashboardIds, setConfirmedDashboardIds] = useState<Set<string>>(new Set());
    const [activeDashboardId, setActiveDashboardId] = useState<string>('');

    const dashboards = useMemo(() => (itemType === 'dashboard' ? (dashboard ? [dashboard] : []) : (folderDashboards || [])), [itemType, dashboard, folderDashboards]);
    const dashboardById = useMemo(() => new Map(dashboards.map((d) => [d.id, d])), [dashboards]);

    useEffect(() => {
        if (!isOpen) return;

        const roles: Record<string, SharePermission['permission'] | 'none'> = {};
        const rlsMap: Record<string, DashboardRLSConfig> = {};

        if (itemType === 'folder') {
            roles.folder = 'none';
        }

        dashboards.forEach((d, idx) => {
            roles[itemType === 'dashboard' ? 'dashboard' : d.id] = 'none';
            rlsMap[d.id] = createDefaultConfig(d);
            if (idx === 0) setActiveDashboardId(d.id);
        });

        setGranularRoles(roles);
        setDashboardRLS(rlsMap);
        setConfirmedDashboardIds(new Set());
        if (!dashboards.length) setActiveDashboardId('');
    }, [isOpen, itemType, dashboards]);

    useEffect(() => {
        if (!isOpen) return;
        const token = localStorage.getItem('auth_token');
        if (!token) return;

        fetch(`${API_BASE}/users`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((res) => res.json())
            .then((data) => {
                const emails = Array.isArray(data?.data)
                    ? data.data.map((u: any) => String(u?.email || '').trim()).filter(Boolean)
                    : [];
                setWorkspaceUserEmails(Array.from(new Set(emails)));
            })
            .catch(() => {
                setWorkspaceUserEmails([]);
            });
    }, [isOpen]);

    if (!isOpen) return null;

    const filteredSuggestions = (() => {
        const keyword = email.trim().toLowerCase();
        if (!keyword) return [];
        return workspaceUserEmails
            .filter((candidate) => candidate.toLowerCase().includes(keyword))
            .slice(0, 8);
    })();

    const selectedDashboard = dashboardById.get(activeDashboardId) || dashboards[0];
    const selectedRoleKey = itemType === 'dashboard' ? 'dashboard' : selectedDashboard?.id || '';

    const handleRoleChange = (id: string, role: SharePermission['permission'] | 'none') => {
        setGranularRoles((prev) => ({ ...prev, [id]: role }));
        if (itemType === 'folder' && id !== 'folder' && role === 'none') {
            setConfirmedDashboardIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const saveDisabled = (() => {
        const roleEntries = Object.entries(granularRoles).filter(([k]) => k !== 'folder');
        const activeDashboardEntries = roleEntries.filter(([, role]) => role !== 'none');

        if (activeDashboardEntries.length === 0) return false;

        for (const [key] of activeDashboardEntries) {
            const dashboardId = itemType === 'dashboard' ? dashboard?.id : key;
            if (!dashboardId) continue;
            const cfg = dashboardRLS[dashboardId];
            if (!cfg || cfg.allowedPageIds.length === 0) return true;
            if (cfg.rules.some((rule) => !validateRule(rule))) return true;
            if (itemType === 'folder' && !confirmedDashboardIds.has(dashboardId)) return true;
        }
        return false;
    })();

    const handleSave = () => {
        if (!email.trim() || !email.includes('@')) {
            alert(t('share.invalid_email'));
            return;
        }

        onSave(email.trim(), {
            roles: granularRoles,
            dashboardRLS,
            confirmedDashboardIds: Array.from(confirmedDashboardIds),
        });
        onClose();
        setEmail('');
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-300" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-[2rem] w-[1100px] max-w-[95vw] shadow-3xl animate-in zoom-in-95 duration-300 overflow-hidden flex flex-col max-h-[92vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-8 pb-5 border-b border-white/5 shrink-0">
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{t('share.title')}</h2>
                        <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1 italic">{t('share.subtitle')}</p>
                    </div>
                    <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded-2xl bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="px-8 pt-6">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] pb-2">{t('share.user_email')}</label>
                    <div className="relative">
                        <input
                            autoFocus
                            type="email"
                            value={email}
                            onChange={(e) => {
                                setEmail(e.target.value);
                                setIsEmailSuggestionOpen(true);
                            }}
                            onFocus={() => setIsEmailSuggestionOpen(true)}
                            onBlur={() => {
                                setTimeout(() => setIsEmailSuggestionOpen(false), 120);
                            }}
                            placeholder={t('share.email_placeholder')}
                            className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-4 text-base font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-600"
                        />

                        {isEmailSuggestionOpen && filteredSuggestions.length > 0 && (
                            <div className="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
                                {filteredSuggestions.map((suggestion) => (
                                    <button
                                        key={suggestion}
                                        type="button"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            setEmail(suggestion);
                                            setIsEmailSuggestionOpen(false);
                                        }}
                                        className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5"
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-5 flex-1 min-h-0 overflow-hidden">
                    <div className="min-h-0 flex flex-col bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500">{t('share.resource_name_purpose')}</div>
                        <div className="overflow-y-auto divide-y divide-slate-200 dark:divide-white/5">
                            {itemType === 'folder' && (
                                <div className="px-5 py-4 flex items-center justify-between gap-3 bg-amber-50/80 dark:bg-amber-500/10 border-y border-amber-200/80 dark:border-amber-500/20">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-300 flex items-center justify-center">
                                            <i className="fas fa-folder text-xs"></i>
                                        </div>
                                        <div>
                                            <div className="text-sm font-black text-slate-900 dark:text-white">
                                                {title}
                                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md bg-amber-500/20 text-[9px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-200">
                                                    {t('share.folder')}
                                                </span>
                                            </div>
                                            <div className="text-[10px] text-amber-700/90 dark:text-amber-200/80 uppercase font-bold">{t('share.container_access')}</div>
                                        </div>
                                    </div>
                                    <select value={granularRoles.folder || 'none'} onChange={(e) => handleRoleChange('folder', e.target.value as any)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs font-bold">
                                        <option value="none">{t('share.dont_share')}</option>
                                        <option value="view">{t('share.viewer')}</option>
                                        <option value="edit">{t('share.editor')}</option>
                                        <option value="admin">{t('share.admin')}</option>
                                    </select>
                                </div>
                            )}

                            {(itemType === 'dashboard' ? dashboards : dashboards).map((d) => {
                                const rowKey = itemType === 'dashboard' ? 'dashboard' : d.id;
                                const isActive = selectedDashboard?.id === d.id;
                                const configured = confirmedDashboardIds.has(d.id);

                                return (
                                    <button
                                        key={d.id}
                                        type="button"
                                        onClick={() => setActiveDashboardId(d.id)}
                                        className={`w-full text-left px-5 py-4 flex items-center justify-between gap-3 ${isActive ? 'bg-indigo-50 dark:bg-indigo-600/10' : 'hover:bg-slate-100 dark:hover:bg-white/5'}`}
                                    >
                                        <div>
                                            <div className="text-sm font-bold text-slate-900 dark:text-white">{d.title}</div>
                                            <div className="text-[10px] text-slate-500 uppercase font-bold">{t('share.dashboard')}</div>
                                            {itemType === 'folder' && granularRoles[d.id] !== 'none' && (
                                                <div className={`text-[10px] mt-1 font-bold uppercase ${configured ? 'text-emerald-500' : 'text-amber-500'}`}>
                                                    {configured ? t('share.configured') : t('share.not_configured')}
                                                </div>
                                            )}
                                        </div>
                                        <select
                                            value={granularRoles[rowKey] || 'none'}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                handleRoleChange(rowKey, e.target.value as any);
                                            }}
                                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs font-bold"
                                        >
                                            <option value="none">{t('share.dont_share')}</option>
                                            <option value="view">{t('share.viewer')}</option>
                                            <option value="edit">{t('share.editor')}</option>
                                            <option value="admin">{t('share.admin')}</option>
                                        </select>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {selectedDashboard ? (
                        <RLSConfigPanel
                            dashboard={selectedDashboard}
                            role={(granularRoles[selectedRoleKey] || 'none') as any}
                            config={dashboardRLS[selectedDashboard.id] || createDefaultConfig(selectedDashboard)}
                            fields={getDashboardFields(
                                selectedDashboard,
                                dataSources,
                                dashboardRLS[selectedDashboard.id]?.allowedPageIds
                            )}
                            isConfirmed={confirmedDashboardIds.has(selectedDashboard.id)}
                            onChange={(nextConfig) => {
                                setDashboardRLS((prev) => ({ ...prev, [selectedDashboard.id]: nextConfig }));
                                setConfirmedDashboardIds((prev) => {
                                    const next = new Set(prev);
                                    next.delete(selectedDashboard.id);
                                    return next;
                                });
                            }}
                            onConfirm={() => {
                                setConfirmedDashboardIds((prev) => {
                                    const next = new Set(prev);
                                    next.add(selectedDashboard.id);
                                    return next;
                                });
                            }}
                        />
                    ) : (
                        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-white/10 flex items-center justify-center text-sm text-slate-500">{t('share.no_dashboard_available')}</div>
                    )}
                </div>

                <div className="p-8 border-t border-white/5 bg-slate-50/50 dark:bg-white/[0.01] shrink-0 flex justify-end gap-4">
                    <button onClick={onClose} className="px-7 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">{t('share.cancel')}</button>
                    <button
                        onClick={handleSave}
                        disabled={saveDisabled}
                        className="px-9 py-4 rounded-xl bg-indigo-600 disabled:bg-slate-400 disabled:cursor-not-allowed hover:bg-indigo-500 text-white transition-all font-black text-xs uppercase tracking-widest flex items-center gap-2"
                    >
                        <span>{t('share.confirm_save')}</span>
                        <i className="fas fa-paper-plane text-[10px] opacity-70"></i>
                    </button>
                </div>
            </div>
        </div>
    );
};
