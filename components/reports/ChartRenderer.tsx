import React, { useEffect, useMemo, useState } from 'react';
import {
    BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area,
    CartesianGrid, Legend
} from 'recharts';
import { ChartConfig } from '../../types';
import { useThemeStore } from '../../store/themeStore';
import { stripBigQueryProjectPrefixFromSql } from '../../utils/sql';

const DARK_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#4f46e5'];
const LIGHT_COLORS = ['#1f4fd6', '#0f766e', '#0ea5e9', '#d97706', '#be123c', '#6d28d9', '#2563eb', '#059669'];

interface ChartRendererProps {
    chart: ChartConfig;
    index: number;
    onUpdateSQL?: (newSQL: string) => void;
}

const CustomTooltip = ({ active, payload, label, theme }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className={`
                p-4 rounded-xl shadow-2xl backdrop-blur-xl z-[200] border
                ${theme === 'dark'
                    ? 'bg-slate-950/90 border-indigo-500/50'
                    : 'bg-white/95 border-indigo-100'
                }
            `}>
                <p className={`
                    text-[10px] font-black uppercase tracking-widest mb-2 border-b pb-1
                    ${theme === 'dark' ? 'text-indigo-400 border-white/10' : 'text-indigo-600 border-slate-200'}
                `}>{label}</p>
                {payload.map((entry: any, index: number) => (
                    <div key={index} className="flex items-center justify-between gap-6 mb-1">
                        <span className={`text-[10px] font-bold capitalize ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>
                            {entry.name.replace('_', ' ')}:
                        </span>
                        <span className={`text-xs font-black ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
                        </span>
                    </div>
                ))}
            </div>
        );
    }
    return null;
};

const normalizeInsightText = (raw: any): string => String(raw || '').replace(/\s+/g, ' ').trim();

const parseListItems = (rawValue: any): string[] => {
    const text = String(rawValue || '').replace(/\r/g, '\n').trim();
    if (!text) return [];

    const strippedPrefix = text.replace(/^\s*(?:hành động|action|nguyên nhân|cause)\s*:?\s*/i, '').trim();
    if (!strippedPrefix) return [];

    const numberedLineParts = strippedPrefix
        .split(/\n(?=\s*\d+\s*[.)]\s+)/)
        .map((part) => part.replace(/^\s*\d+\s*[.)]\s*/, '').trim())
        .filter(Boolean);
    if (numberedLineParts.length >= 2) {
        return numberedLineParts;
    }

    const inlineNumberedParts = (` ${strippedPrefix}`)
        .split(/\s(?=\d+\s*[.)]\s+)/)
        .map((part) => part.replace(/^\s*\d+\s*[.)]\s*/, '').trim())
        .filter(Boolean);
    if (inlineNumberedParts.length >= 2) {
        return inlineNumberedParts;
    }

    const lineParts = strippedPrefix
        .split(/\n+/)
        .map((line) => line.replace(/^\s*(?:[-*•✓]+|\d+\s*[.):])\s*/, '').trim())
        .filter(Boolean);
    if (lineParts.length >= 2) {
        return lineParts;
    }

    const segmentedParts = strippedPrefix
        .split(/\s*[;|]\s*/)
        .map((part) => part.trim())
        .filter(Boolean);
    if (segmentedParts.length >= 2) {
        return segmentedParts;
    }

    return [strippedPrefix];
};

const formatMetricLabel = (rawKey: string): string => (
    String(rawKey || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
);

const formatMetricValue = (value: number): string => {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const formatPercent = (value: number | null): string => {
    if (value === null || !Number.isFinite(value)) return '0%';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
};

const normalizeMetricKey = (rawKey: string): string => (
    String(rawKey || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
);

const SPEND_METRIC_HINTS = [
    'chi_phi',
    'cost',
    'spend',
    'budget',
    'expense',
    'ads_cost',
    'ad_spend',
    'marketing_cost',
    'cp_',
];

const VALUE_METRIC_HINTS = [
    'doanh_thu',
    'doanh_so',
    'revenue',
    'sales',
    'gmv',
    'profit',
    'margin',
    'return',
    'new_sales',
];

const hasMetricHint = (key: string, hints: string[]): boolean => {
    const normalized = normalizeMetricKey(key);
    return hints.some((hint) => normalized.includes(hint));
};

const isSpendMetricKey = (key: string): boolean => hasMetricHint(key, SPEND_METRIC_HINTS);
const isValueMetricKey = (key: string): boolean => hasMetricHint(key, VALUE_METRIC_HINTS);

const ensureSpendValueMetricPair = (baseKeys: string[], numericKeysFromData: string[]): string[] => {
    if (!Array.isArray(baseKeys) || baseKeys.length === 0) return [];

    const maxKeys = 4;
    const limited = baseKeys.slice(0, maxKeys);
    const spendKey = baseKeys.find((key) => isSpendMetricKey(key));
    if (!spendKey) return limited;

    const hasValueInLimited = limited.some((key) => key !== spendKey && isValueMetricKey(key));
    if (hasValueInLimited) return limited;

    const valueCandidate = numericKeysFromData.find((key) => (
        key !== spendKey
        && !limited.includes(key)
        && isValueMetricKey(key)
    ));
    if (!valueCandidate) return limited;

    if (limited.length < maxKeys) return [...limited, valueCandidate];
    return [...limited.slice(0, maxKeys - 1), valueCandidate];
};

export const ChartRenderer: React.FC<ChartRendererProps> = ({ chart, index, onUpdateSQL }) => {
    const { type, data, dataKeys, xAxisKey, title, insight, sql } = chart;
    const [showSQL, setShowSQL] = useState(false);
    const [editedSQL, setEditedSQL] = useState(stripBigQueryProjectPrefixFromSql(sql || ''));
    const [isExecuting, setIsExecuting] = useState(false);
    const { theme } = useThemeStore();

    const COLORS = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
    const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    const textColor = theme === 'dark' ? '#94a3b8' : '#64748b';
    const axisColor = theme === 'dark' ? '#1e293b' : '#e2e8f0';

    const handleExecuteSQL = async () => {
        if (!onUpdateSQL) return;
        setIsExecuting(true);
        await onUpdateSQL(editedSQL);
        setIsExecuting(false);
        setShowSQL(false);
    };

    useEffect(() => {
        setEditedSQL(stripBigQueryProjectPrefixFromSql(sql || ''));
    }, [sql]);

    const toRenderableNumber = (value: any): number | null => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        const normalized = raw
            .replace(/[\s,]+/g, '')
            .replace(/%$/, '');
        if (!normalized) return null;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const normalizedData = useMemo(() => {
        if (!Array.isArray(data)) return [];

        const preferredKeys = Array.isArray(dataKeys) && dataKeys.length > 0
            ? dataKeys.map((key) => String(key || '').trim()).filter(Boolean)
            : [];

        return data
            .filter((row) => row && typeof row === 'object' && !Array.isArray(row) && !('_error' in row))
            .map((row, rowIndex) => {
                const next: any = { ...row };
                const rowKeys = Object.keys(next).filter((key) => key !== '_error');
                const candidateKeys = Array.from(new Set([...preferredKeys, ...rowKeys]));

                candidateKeys.forEach((key) => {
                    const parsed = toRenderableNumber(next[key]);
                    if (parsed !== null) next[key] = parsed;
                });

                if (xAxisKey && next[xAxisKey] === undefined) {
                    next[xAxisKey] = `#${rowIndex + 1}`;
                }

                return next;
            });
    }, [data, dataKeys, xAxisKey]);

    const xKey = useMemo(() => {
        if (xAxisKey && normalizedData.some((row) => row?.[xAxisKey] !== undefined && row?.[xAxisKey] !== null)) {
            return xAxisKey;
        }

        const sample = normalizedData[0] || {};
        const preferred = ['date', 'day', 'week', 'month', 'quarter', 'year', 'name', 'label']
            .find((key) => Object.prototype.hasOwnProperty.call(sample, key));
        if (preferred) return preferred;

        const firstStringKey = Object.keys(sample).find((key) => typeof sample[key] === 'string');
        return firstStringKey || 'label';
    }, [xAxisKey, normalizedData]);

    const keys = useMemo(() => {
        const preferredKeys = Array.isArray(dataKeys) && dataKeys.length > 0
            ? dataKeys.map((key) => String(key || '').trim()).filter(Boolean)
            : [];

        const numericKeysFromData = Array.from(new Set(
            normalizedData.flatMap((row) => (
                Object.keys(row || {}).filter((key) => key !== xKey && key !== '_error')
            ))
        )).filter((key) => (
            normalizedData.some((row) => typeof row?.[key] === 'number' && Number.isFinite(row[key]))
        ));

        const preferredNumericKeys = preferredKeys.filter((key) => (
            normalizedData.some((row) => typeof row?.[key] === 'number' && Number.isFinite(row[key]))
        ));

        const baseKeys = preferredNumericKeys.length > 0 ? preferredNumericKeys : numericKeysFromData;
        if (baseKeys.length > 0) return ensureSpendValueMetricPair(baseKeys, numericKeysFromData);
        return ['value'];
    }, [dataKeys, normalizedData, xKey]);

    const renderData = useMemo(() => {
        if (!Array.isArray(normalizedData) || normalizedData.length === 0) return [];
        const needsSyntheticValue = keys.length === 1
            && keys[0] === 'value'
            && !normalizedData.some((row) => typeof row?.value === 'number' && Number.isFinite(row.value));
        if (!needsSyntheticValue) return normalizedData;

        return normalizedData.map((row, rowIndex) => ({
            ...row,
            [xKey]: row?.[xKey] ?? `#${rowIndex + 1}`,
            value: rowIndex + 1,
        }));
    }, [normalizedData, keys, xKey]);

    const rawType = String((type as any) || '').trim().toLowerCase();
    const isTimeSeriesFromAxis = ['date', 'day', 'week', 'month', 'quarter', 'year', 'time', 'created', 'updated']
        .some((hint) => String(xKey || '').toLowerCase().includes(hint));
    const isDateLikeValue = (value: any): boolean => {
        const raw = String(value ?? '').trim();
        if (!raw) return false;
        if (/^(\d{4}-\d{1,2}-\d{1,2}|\d{4}\/\d{1,2}\/\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{1,2}|\d{4}q[1-4])(?:\s.*)?$/i.test(raw)) return true;
        if (/^\d{4}-\d{2}-\d{2}t/i.test(raw)) return true;
        if (/^[a-z]{3,9}\s+\d{4}$/i.test(raw)) return true;
        return false;
    };
    const isTimeSeriesFromData = Array.isArray(renderData)
        && renderData.length > 0
        && renderData.slice(0, Math.min(8, renderData.length)).some((row) => isDateLikeValue(row?.[xKey]));
    const isLikelyTimeSeries = isTimeSeriesFromAxis || isTimeSeriesFromData;

    // Hard guard: never render pie/donut/radial for time-series analysis.
    const effectiveType = (() => {
        if (rawType === 'donut' || rawType === 'doughnut' || rawType === 'radial') {
            return isLikelyTimeSeries ? 'line' : 'pie';
        }
        if (rawType === 'pie') {
            return isLikelyTimeSeries ? 'line' : 'pie';
        }
        if (rawType === 'combo') return 'line';
        if (rawType === 'scatter') return isLikelyTimeSeries ? 'line' : 'bar';
        if (rawType === 'horizontalbar' || rawType === 'stackedbar') return 'bar';
        if (rawType === 'bar' || rawType === 'line' || rawType === 'area') return rawType;
        return isLikelyTimeSeries ? 'line' : 'bar';
    })();

    const structuredInsight = insight && typeof insight === 'object' ? (insight as any) : null;
    const analysisText = structuredInsight ? normalizeInsightText(structuredInsight.analysis) : '';
    const trendText = structuredInsight ? normalizeInsightText(structuredInsight.trend) : '';
    const causeText = structuredInsight ? normalizeInsightText(structuredInsight.cause) : '';
    const actionText = structuredInsight ? normalizeInsightText(structuredInsight.action) : '';
    const hasDistinctTrend = !!trendText
        && !analysisText.toLowerCase().includes(trendText.toLowerCase())
        && !trendText.toLowerCase().includes(analysisText.toLowerCase());
    const statusText = [analysisText, hasDistinctTrend ? trendText : ''].filter(Boolean).join(' ').trim();
    const causeItems = parseListItems(causeText);
    const actionItems = parseListItems(actionText);

    const primaryMetricKey = keys.length > 0 ? keys[0] : null;

    const trendOverview = useMemo(() => {
        if (!primaryMetricKey || renderData.length < 2) return null;
        const first = toRenderableNumber(renderData[0]?.[primaryMetricKey]);
        const last = toRenderableNumber(renderData[renderData.length - 1]?.[primaryMetricKey]);
        if (first === null || last === null) return null;

        const delta = last - first;
        const deltaPct = first !== 0 ? (delta / Math.abs(first)) * 100 : null;
        const tone: 'good' | 'warning' | 'neutral' = delta > 0 ? 'good' : delta < 0 ? 'warning' : 'neutral';
        const verb = delta > 0 ? 'tăng' : delta < 0 ? 'giảm' : 'đi ngang';

        return {
            tone,
            text: `${formatMetricLabel(primaryMetricKey)} ${verb} ${formatPercent(deltaPct)}`,
            subText: `Biên độ: ${formatMetricValue(Math.abs(delta))}`,
        };
    }, [renderData, primaryMetricKey]);

    const spendValueOverview = useMemo(() => {
        if (!Array.isArray(renderData) || renderData.length === 0) return null;

        const numericKeysFromData = Array.from(new Set(
            renderData.flatMap((row) => (
                Object.keys(row || {}).filter((key) => {
                    if (key === xKey || key === '_error') return false;
                    const value = row?.[key];
                    return typeof value === 'number' && Number.isFinite(value);
                })
            ))
        ));

        const spendKey = keys.find((key) => isSpendMetricKey(key))
            || numericKeysFromData.find((key) => isSpendMetricKey(key));
        if (!spendKey) return null;

        const valueKey = keys.find((key) => key !== spendKey && isValueMetricKey(key))
            || numericKeysFromData.find((key) => key !== spendKey && isValueMetricKey(key))
            || null;

        const totalSpend = renderData.reduce((sum, row) => {
            const parsed = toRenderableNumber(row?.[spendKey]);
            return parsed === null ? sum : sum + parsed;
        }, 0);

        const totalValue = valueKey
            ? renderData.reduce((sum, row) => {
                const parsed = toRenderableNumber(row?.[valueKey]);
                return parsed === null ? sum : sum + parsed;
            }, 0)
            : null;

        const hasSpendData = renderData.some((row) => toRenderableNumber(row?.[spendKey]) !== null);
        if (!hasSpendData) return null;

        return {
            spendKey,
            valueKey,
            totalSpend,
            totalValue,
            efficiencyRatio: (valueKey && totalValue !== null && totalSpend !== 0)
                ? totalValue / totalSpend
                : null,
        };
    }, [renderData, keys, xKey]);

    if (!renderData || renderData.length === 0) {
        return (
            <div className={`
                flex flex-col relative dashboard-card shadow-xl overflow-hidden group/card min-h-[750px] rounded-[2.5rem] border
                ${theme === 'dark'
                    ? 'bg-slate-900/60 border-white/5'
                    : 'bg-white border-slate-200'
                }
            `}>
                <div className="p-10 pb-6 flex justify-between items-start z-10">
                    <div>
                        <h4 className={`text-lg font-black uppercase tracking-[0.2em] mb-2 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{title}</h4>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-tight italic">{`Biểu đồ #${index + 1}`}</div>
                    </div>
                    {onUpdateSQL && (
                        <button
                            onClick={() => setShowSQL(!showSQL)}
                            className={`p-3 rounded-lg transition-all ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-slate-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                            title="Gỡ lỗi SQL"
                        >
                            <i className="fas fa-code text-sm"></i>
                        </button>
                    )}
                </div>

                <div className="flex-1 flex flex-col items-center justify-center px-12 text-center">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-8 border border-red-500/20">
                        <i className="fas fa-exclamation-triangle text-2xl text-red-500 animate-pulse"></i>
                    </div>
                    <h5 className={`text-sm font-black uppercase tracking-widest mb-3 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Lỗi thực thi truy vấn</h5>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed max-w-[300px]">
                        AI không thể lấy dữ liệu cho biểu đồ này. Thường do bộ lọc quá chặt hoặc sai lệch schema.
                    </p>
                    <button
                        onClick={() => setShowSQL(true)}
                        className="mt-8 text-xs font-black text-indigo-400 uppercase tracking-[0.2em] hover:text-indigo-300 transition-colors border-b border-indigo-500/20 pb-1"
                    >
                        Điều chỉnh truy vấn SQL <i className="fas fa-arrow-right ml-2 text-[8px]"></i>
                    </button>
                </div>

                {showSQL && (
                    <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-xl z-[50] p-8 flex flex-col gap-4">
                        <div className="flex justify-between items-center">
                            <h5 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                                <i className="fas fa-terminal text-indigo-500"></i>
                                TRÌNH GỠ LỖI SQL
                            </h5>
                            <button onClick={() => setShowSQL(false)} className="text-slate-500 hover:text-white transition-colors p-2">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="flex-1 relative">
                            <textarea
                                value={editedSQL}
                                onChange={(e) => setEditedSQL(e.target.value)}
                                className="w-full h-full bg-black border border-white/5 rounded-2xl p-6 text-[11px] font-mono text-emerald-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-inner resize-none"
                                placeholder="-- Nhập truy vấn SQL..."
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowSQL(false)}
                                className="flex-1 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleExecuteSQL}
                                disabled={isExecuting}
                                className="flex-[2] bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 shadow-lg shadow-indigo-600/30 active:scale-95 disabled:opacity-50 transition-all"
                            >
                                {isExecuting ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-play"></i>}
                                Chạy lại & phân tích lại
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={`
            flex flex-col relative dashboard-card shadow-xl overflow-hidden group/card min-h-[750px] rounded-[2.5rem] border
            ${theme === 'dark'
                ? 'bg-slate-900/60 border-white/5'
                : 'bg-white border-slate-200'
            }
        `}>
            <div className="p-10 pb-6 flex justify-between items-start z-10">
                <div>
                    <h4 className={`text-lg font-black uppercase tracking-[0.2em] mb-2 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{title}</h4>
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-tight italic">{`Biểu đồ #${index + 1}`}</div>
                </div>
                {onUpdateSQL && (
                    <button
                        onClick={() => setShowSQL(!showSQL)}
                        className={`p-3 rounded-lg transition-all ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-slate-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                        title="Gỡ lỗi SQL"
                    >
                        <i className="fas fa-code text-sm"></i>
                    </button>
                )}
            </div>

            {(spendValueOverview || trendOverview) && (
                <div className="px-8 pb-4 -mt-2 flex flex-wrap items-center gap-2">
                    {spendValueOverview && (
                        <>
                            <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/45 bg-violet-500/15 text-violet-200 px-3 py-1.5 text-[10px] font-black tracking-wide">
                                <i className="fas fa-coins text-[9px]"></i>
                                <span>{`${formatMetricLabel(spendValueOverview.spendKey)}: ${formatMetricValue(spendValueOverview.totalSpend)}`}</span>
                            </div>

                            {spendValueOverview.valueKey && spendValueOverview.totalValue !== null ? (
                                <>
                                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/45 bg-emerald-500/15 text-emerald-200 px-3 py-1.5 text-[10px] font-black tracking-wide">
                                        <i className="fas fa-sack-dollar text-[9px]"></i>
                                        <span>{`${formatMetricLabel(spendValueOverview.valueKey)}: ${formatMetricValue(spendValueOverview.totalValue)}`}</span>
                                    </div>
                                    {spendValueOverview.efficiencyRatio !== null && Number.isFinite(spendValueOverview.efficiencyRatio) && (
                                        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/50 bg-cyan-500/15 text-cyan-200 px-3 py-1.5 text-[10px] font-black tracking-wide">
                                            <i className="fas fa-bullseye text-[9px]"></i>
                                            <span>{`Hiệu suất: 1đ chi phí -> ${spendValueOverview.efficiencyRatio.toFixed(2)}đ giá trị`}</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/45 bg-amber-500/15 text-amber-200 px-3 py-1.5 text-[10px] font-black tracking-wide">
                                    <i className="fas fa-circle-exclamation text-[9px]"></i>
                                    <span>Thiếu metric giá trị mang lại để đo hiệu suất chi phí.</span>
                                </div>
                            )}
                        </>
                    )}

                    {trendOverview && (
                        <div className={`
                            inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black tracking-wide
                            ${trendOverview.tone === 'good'
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                : trendOverview.tone === 'warning'
                                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                                    : 'bg-sky-500/15 border-sky-500/40 text-sky-300'}
                        `}>
                            <i className={`fas ${trendOverview.tone === 'good' ? 'fa-arrow-trend-up' : trendOverview.tone === 'warning' ? 'fa-arrow-trend-down' : 'fa-wave-square'} text-[9px]`}></i>
                            <span>{trendOverview.text}</span>
                            <span className="opacity-70">({trendOverview.subText})</span>
                        </div>
                    )}
                </div>
            )}

            <div className="flex-1 w-full px-8 pb-8 min-h-[450px]">
                <ResponsiveContainer width="100%" height="100%">
                    {effectiveType === 'bar' ? (
                        <BarChart data={renderData} margin={{ left: 10, right: 10, top: 20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                            <XAxis dataKey={xKey} fontSize={11} tick={{ fill: textColor }} stroke={axisColor} axisLine={false} tickLine={false} dy={10} />
                            <YAxis fontSize={11} tick={{ fill: textColor }} stroke={axisColor} width={60} axisLine={false} tickLine={false} tickFormatter={(val) => typeof val === 'number' ? (val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toString()) : val} />
                            <Tooltip content={<CustomTooltip theme={theme} />} cursor={{ fill: theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }} />
                            <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 'bold', color: textColor }} />
                            {keys.map((k, i) => (
                                <Bar
                                    key={k}
                                    dataKey={k}
                                    fill={COLORS[i % COLORS.length]}
                                    radius={[4, 4, 0, 0]}
                                    isAnimationActive={true}
                                    animationDuration={950 + (i * 120)}
                                    animationEasing="ease-out"
                                />
                            ))}
                        </BarChart>
                    ) : effectiveType === 'area' || effectiveType === 'line' ? (
                        <AreaChart data={renderData} margin={{ left: 10, right: 10, top: 20, bottom: 0 }}>
                            <defs>
                                {keys.map((k, i) => (
                                    <linearGradient key={k} id={`g-${i}-${index}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.4} />
                                        <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                                    </linearGradient>
                                ))}
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                            <XAxis dataKey={xKey} fontSize={11} tick={{ fill: textColor }} stroke={axisColor} axisLine={false} tickLine={false} dy={10} />
                            <YAxis fontSize={11} tick={{ fill: textColor }} stroke={axisColor} width={60} axisLine={false} tickLine={false} tickFormatter={(val) => typeof val === 'number' ? (val >= 1000000 ? `${(val / 1000000).toFixed(1)}M` : val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toString()) : val} />
                            <Tooltip content={<CustomTooltip theme={theme} />} />
                            <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 'bold', color: textColor }} />
                            {keys.map((k, i) => (
                                <Area
                                    key={k}
                                    type="monotone"
                                    dataKey={k}
                                    stroke={COLORS[i % COLORS.length]}
                                    fill={`url(#g-${i}-${index})`}
                                    strokeWidth={i === 0 ? 3.5 : 2.5}
                                    isAnimationActive={true}
                                    animationDuration={1050 + (i * 160)}
                                    animationEasing="ease-out"
                                    activeDot={{
                                        r: 6,
                                        fill: COLORS[i % COLORS.length],
                                        stroke: theme === 'dark' ? '#020617' : '#ffffff',
                                        strokeWidth: 2,
                                    }}
                                />
                            ))}
                        </AreaChart>
                    ) : (
                        <PieChart>
                            <Pie
                                data={renderData}
                                dataKey={keys[0]}
                                nameKey={xKey}
                                cx="50%"
                                cy="50%"
                                outerRadius={90}
                                innerRadius={65}
                                paddingAngle={5}
                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                labelLine={false}
                            >
                                {(renderData || []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                            </Pie>
                            <Tooltip content={<CustomTooltip theme={theme} />} />
                            <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', color: textColor }} />
                        </PieChart>
                    )}
                </ResponsiveContainer>
            </div>

            {showSQL && (
                <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-[50] p-8 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                        <h5 className="text-[10px] font-black text-white uppercase tracking-widest">Trình soạn SQL</h5>
                        <button onClick={() => setShowSQL(false)} className="text-slate-500 hover:text-white"><i className="fas fa-times"></i></button>
                    </div>
                    <textarea
                        value={editedSQL}
                        onChange={(e) => setEditedSQL(e.target.value)}
                        className="flex-1 bg-black border border-white/10 rounded-xl p-4 text-[10px] font-mono text-emerald-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="Nhập truy vấn SQL..."
                    />
                    <button
                        onClick={handleExecuteSQL}
                        disabled={isExecuting}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2"
                    >
                        {isExecuting ? <i className="fas fa-circle-notch animate-spin"></i> : <i className="fas fa-play"></i>}
                        Chạy truy vấn
                    </button>
                </div>
            )}

            {/* Render Insights if available */}
            {insight && (
                <div className={`
                    p-8 mt-auto border-t
                    ${theme === 'dark'
                        ? 'bg-indigo-600/[0.05] border-white/5'
                        : 'bg-indigo-50 border-indigo-100'
                    }
                `}>
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,1)]"></div>
                        <span className="text-xs font-black uppercase text-indigo-400 tracking-widest">Phân tích</span>
                    </div>
                    {typeof insight === 'string' ? (
                        <p className={`text-sm leading-relaxed font-medium ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>{insight}</p>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <div className={`text-xs font-black uppercase tracking-[0.15em] mb-2 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                                    Hiện trạng & xu hướng
                                </div>
                                <p className={`text-sm font-bold leading-relaxed ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>
                                    {statusText || analysisText || trendText || 'Chưa đủ dữ liệu để kết luận xu hướng.'}
                                </p>
                            </div>

                            <div>
                                <div className={`text-xs font-black uppercase tracking-[0.15em] mb-2 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                                    Nguyên nhân trực tiếp
                                </div>
                                {causeItems.length > 0 ? (
                                    <ul className={`space-y-1 pl-6 ${theme === 'dark' ? 'text-indigo-200/80' : 'text-indigo-700'}`}>
                                        {causeItems.map((item, itemIndex) => (
                                            <li key={itemIndex} className="list-disc text-sm font-medium leading-relaxed">
                                                {item}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className={`text-sm leading-relaxed ${theme === 'dark' ? 'text-indigo-200/70' : 'text-indigo-600/80'}`}>
                                        Chưa xác định rõ nguyên nhân trực tiếp từ dữ liệu hiện tại.
                                    </p>
                                )}
                            </div>

                            <div className={`text-sm font-bold leading-relaxed ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}>
                                <div className={`text-xs font-black uppercase tracking-[0.15em] mb-2 ${theme === 'dark' ? 'text-emerald-300/80' : 'text-emerald-700'}`}>
                                    Cần thực hiện gì
                                </div>
                                <ul className="space-y-1 pl-6">
                                    {(actionItems.length > 0
                                        ? actionItems
                                        : [actionText || 'Tiếp tục theo dõi dữ liệu và xác định hành động ưu tiên.'])
                                        .filter(Boolean)
                                        .map((item, itemIndex) => (
                                            <li key={itemIndex} className="list-disc font-medium">
                                                {item}
                                            </li>
                                        ))}
                                </ul>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
