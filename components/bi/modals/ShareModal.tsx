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
    onSave: (target: { targetType: 'user' | 'group'; targetId: string }, payload: ShareSavePayload) => void;
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
    permissions,
    dashboard,
    folderDashboards,
    onSave,
}) => {
    const { t } = useLanguageStore();
    const dataSources = useDataStore((s) => s.dataSources);
    const [targetType, setTargetType] = useState<'user' | 'group'>('user');
    const [targetId, setTargetId] = useState('');
    const [workspaceUserEmails, setWorkspaceUserEmails] = useState<string[]>([]);
    const [workspaceGroups, setWorkspaceGroups] = useState<string[]>([]);
    const [isTargetSuggestionOpen, setIsTargetSuggestionOpen] = useState(false);
    const [granularRoles, setGranularRoles] = useState<Record<string, SharePermission['permission'] | 'none'>>({});
    const [dashboardRLS, setDashboardRLS] = useState<Record<string, DashboardRLSConfig>>({});
    const [confirmedDashboardIds, setConfirmedDashboardIds] = useState<Set<string>>(new Set());
    const [activeDashboardId, setActiveDashboardId] = useState<string>('');
    const [viewMode, setViewMode] = useState<'manage' | 'overview'>('manage');

    const dashboards = useMemo(() => (itemType === 'dashboard' ? (dashboard ? [dashboard] : []) : (folderDashboards || [])), [itemType, dashboard, folderDashboards]);
    const dashboardById = useMemo(() => new Map(dashboards.map((d) => [d.id, d])), [dashboards]);
    const sharedResources = useMemo(() => {
        const dedupeShares = (shares: SharePermission[] = []) => {
            const byTarget = new Map<string, SharePermission>();
            shares.forEach((share) => {
                const normalizedTargetType = String(share?.targetType || '').trim().toLowerCase() === 'group' ? 'group' : 'user';
                const normalizedTargetId = String(
                    share?.targetId || (normalizedTargetType === 'group' ? share?.groupId : share?.userId) || ''
                ).trim();
                if (!normalizedTargetId) return;
                const key = `${normalizedTargetType}:${normalizedTargetId.toLowerCase()}`;
                byTarget.set(key, {
                    ...share,
                    targetType: normalizedTargetType,
                    targetId: normalizedTargetId,
                    userId: normalizedTargetType === 'user' ? normalizedTargetId : undefined,
                    groupId: normalizedTargetType === 'group' ? normalizedTargetId : undefined,
                });
            });
            return Array.from(byTarget.values()).sort((a, b) => {
                const aType = String(a.targetType || 'user');
                const bType = String(b.targetType || 'user');
                if (aType !== bType) return aType.localeCompare(bType);
                return String(a.targetId || '').localeCompare(String(b.targetId || ''));
            });
        };

        if (itemType === 'dashboard') {
            return [{
                resourceType: 'dashboard' as const,
                resourceId: dashboard?.id || 'dashboard-root',
                resourceLabel: dashboard?.title || title,
                shares: dedupeShares(permissions || []),
            }];
        }

        return [
            {
                resourceType: 'folder' as const,
                resourceId: 'folder-root',
                resourceLabel: title,
                shares: dedupeShares(permissions || []),
            },
            ...dashboards.map((d) => ({
                resourceType: 'dashboard' as const,
                resourceId: d.id,
                resourceLabel: d.title,
                shares: dedupeShares(d.sharedWith || []),
            })),
        ];
    }, [itemType, permissions, dashboards, dashboard?.id, dashboard?.title, title]);

    const permissionBadgeClass = (permission: SharePermission['permission']) => {
        if (permission === 'admin') return 'bg-rose-500/15 text-rose-300 border border-rose-500/30';
        if (permission === 'edit') return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
        return 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30';
    };

    const permissionLabel = (permission: SharePermission['permission']) => {
        if (permission === 'admin') return t('share.admin');
        if (permission === 'edit') return t('share.editor');
        return t('share.viewer');
    };

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
        setViewMode('manage');
        setTargetType('user');
        setTargetId('');
        setIsTargetSuggestionOpen(false);
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
                const rows = Array.isArray(data?.data) ? data.data : [];
                const emails = rows.map((u: any) => String(u?.email || '').trim()).filter(Boolean);
                const groups = rows.map((u: any) => String(u?.groupName || '').trim()).filter(Boolean);
                setWorkspaceUserEmails(Array.from(new Set(emails)));
                setWorkspaceGroups(Array.from(new Set(groups)));
            })
            .catch(() => {
                setWorkspaceUserEmails([]);
                setWorkspaceGroups([]);
            });
    }, [isOpen]);

    if (!isOpen) return null;

    const filteredSuggestions = (() => {
        const keyword = targetId.trim().toLowerCase();
        if (!keyword) return [];
        const source = targetType === 'group' ? workspaceGroups : workspaceUserEmails;
        return source
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
        const normalizedTargetId = targetId.trim();
        if (!normalizedTargetId) {
            alert(targetType === 'group' ? 'Please enter a group name.' : t('share.invalid_email'));
            return;
        }

        if (targetType === 'user' && !normalizedTargetId.includes('@')) {
            alert(t('share.invalid_email'));
            return;
        }

        onSave({ targetType, targetId: normalizedTargetId }, {
            roles: granularRoles,
            dashboardRLS,
            confirmedDashboardIds: Array.from(confirmedDashboardIds),
        });
        onClose();
        setTargetId('');
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

                <div className="px-8 pt-4">
                    <div className="inline-flex rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 p-1">
                        <button
                            type="button"
                            onClick={() => setViewMode('manage')}
                            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${viewMode === 'manage' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            Manage Access
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('overview')}
                            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${viewMode === 'overview' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            Shared List
                        </button>
                    </div>
                </div>

                {viewMode === 'manage' ? (
                    <>
                        <div className="px-8 pt-6">
                            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] pb-2">
                                {targetType === 'group' ? 'Group Name' : t('share.user_email')}
                            </label>
                            <div className="relative">
                                <div className="mb-2 inline-flex rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 p-1">
                                    <button
                                        type="button"
                                        onClick={() => setTargetType('user')}
                                        className={`px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest ${targetType === 'user' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                                    >
                                        User
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setTargetType('group')}
                                        className={`px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest ${targetType === 'group' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                                    >
                                        Group
                                    </button>
                                </div>
                                <input
                                    autoFocus
                                    type={targetType === 'group' ? 'text' : 'email'}
                                    value={targetId}
                                    onChange={(e) => {
                                        setTargetId(e.target.value);
                                        setIsTargetSuggestionOpen(true);
                                    }}
                                    onFocus={() => setIsTargetSuggestionOpen(true)}
                                    onBlur={() => {
                                        setTimeout(() => setIsTargetSuggestionOpen(false), 120);
                                    }}
                                    placeholder={targetType === 'group' ? 'sales, finance, marketing...' : t('share.email_placeholder')}
                                    className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-4 text-base font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-600"
                                />

                                {isTargetSuggestionOpen && filteredSuggestions.length > 0 && (
                                    <div className="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
                                        {filteredSuggestions.map((suggestion) => (
                                            <button
                                                key={suggestion}
                                                type="button"
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    setTargetId(suggestion);
                                                    setIsTargetSuggestionOpen(false);
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
                    </>
                ) : (
                    <div className="p-8 flex-1 min-h-0 overflow-hidden">
                        <div className="h-full rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 overflow-hidden flex flex-col">
                            <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                Current Shares For This Resource
                            </div>
                            <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-white/5">
                                {sharedResources.every((resource) => resource.shares.length === 0) ? (
                                    <div className="h-full flex items-center justify-center text-sm text-slate-500">
                                        This resource is not shared with anyone yet.
                                    </div>
                                ) : sharedResources.map((resource) => (
                                    <div key={`${resource.resourceType}-${resource.resourceId}`} className="px-5 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="text-sm font-black text-slate-900 dark:text-white">{resource.resourceLabel}</div>
                                            <span className="px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-white/10 text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
                                                {resource.resourceType === 'folder' ? t('share.folder') : t('share.dashboard')}
                                            </span>
                                        </div>

                                        {resource.shares.length === 0 ? (
                                            <div className="mt-2 text-xs text-slate-500">No shared users.</div>
                                        ) : (
                                            <div className="mt-3 space-y-2">
                                                {resource.shares.map((share) => (
                                                    <div key={`${resource.resourceId}-${share.targetType || 'user'}-${share.targetId || share.userId || share.groupId}`} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/60 px-3 py-2 flex items-center justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                                                {share.targetId || share.userId || share.groupId}
                                                            </div>
                                                            <div className="text-[10px] uppercase tracking-wider text-slate-500">
                                                                {(share.targetType || 'user') === 'group' ? 'Group' : 'User'}
                                                            </div>
                                                        </div>
                                                        <span className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-black ${permissionBadgeClass(share.permission)}`}>
                                                            {permissionLabel(share.permission)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <div className="p-8 border-t border-white/5 bg-slate-50/50 dark:bg-white/[0.01] shrink-0 flex justify-end gap-4">
                    <button onClick={onClose} className="px-7 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">{t('share.cancel')}</button>
                    {viewMode === 'manage' && (
                        <button
                            onClick={handleSave}
                            disabled={saveDisabled}
                            className="px-9 py-4 rounded-xl bg-indigo-600 disabled:bg-slate-400 disabled:cursor-not-allowed hover:bg-indigo-500 text-white transition-all font-black text-xs uppercase tracking-widest flex items-center gap-2"
                        >
                            <span>{t('share.confirm_save')}</span>
                            <i className="fas fa-paper-plane text-[10px] opacity-70"></i>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
