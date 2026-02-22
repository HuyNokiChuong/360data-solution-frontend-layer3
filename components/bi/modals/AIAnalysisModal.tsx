import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChartAnalysisOutputLanguage, ReportLanguage } from '../../../services/ai';

import { createPortal } from 'react-dom';

interface AIAnalysisModalProps {
    isOpen: boolean;
    onClose: () => void;
    isLoading: boolean;
    analysisResult: string | null;
    error: string | null;
    title: string;
    onReAnalyze?: (provider: string, modelId: string, outputLanguage: ChartAnalysisOutputLanguage) => void;
    defaultOutputLanguage?: ChartAnalysisOutputLanguage | ReportLanguage;
    uiLanguage?: ReportLanguage;
    onOutputLanguageChange?: (language: ChartAnalysisOutputLanguage) => void;
}

interface ParsedTable {
    headers: string[];
    rows: string[][];
}

const OUTPUT_LANGUAGE_STORAGE_KEY = 'bi_ai_analysis_output_language';
const OUTPUT_LANGUAGE_OPTIONS: Array<{ value: ChartAnalysisOutputLanguage; label: string }> = [
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'en', label: 'English' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' },
    { value: 'zh-CN', label: '简体中文' },
    { value: 'th', label: 'ไทย' }
];

const normalizeOutputLanguage = (
    input: string | null | undefined,
    fallback: ChartAnalysisOutputLanguage = 'vi'
): ChartAnalysisOutputLanguage => {
    const raw = String(input || '').trim().toLowerCase();
    if (raw === 'vi' || raw.startsWith('vi-')) return 'vi';
    if (raw === 'en' || raw.startsWith('en-')) return 'en';
    if (raw === 'ja' || raw.startsWith('ja-') || raw === 'jp') return 'ja';
    if (raw === 'ko' || raw.startsWith('ko-') || raw === 'kr') return 'ko';
    if (raw === 'th' || raw.startsWith('th-')) return 'th';
    if (
        raw === 'zh'
        || raw === 'zh-cn'
        || raw === 'zh_hans'
        || raw === 'zh-hans'
        || raw === 'zh-sg'
        || raw === 'cn'
    ) {
        return 'zh-CN';
    }
    return fallback;
};

const extractHighlightLines = (rawText: string | null | undefined): string[] => {
    if (!rawText) return [];
    const lines = rawText
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const highlights = lines
        .filter((line) => /^[-*]\s*🔥/.test(line) || /^🔥/.test(line) || /^\[HIGHLIGHT\]/i.test(line))
        .map((line) => line.replace(/^[-*]\s*/, '').replace(/^\[HIGHLIGHT\]\s*/i, '').replace(/^🔥\s*/, '').trim())
        .filter(Boolean);

    return highlights.slice(0, 6);
};

const nodeToText = (node: React.ReactNode): string => {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map((item) => nodeToText(item)).join('');
    if (React.isValidElement(node)) return nodeToText(node.props.children);
    return '';
};

const splitMarkdownTableRow = (line: string): string[] => {
    const normalized = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return normalized.split('|').map((cell) => cell.trim());
};

const isMarkdownTableDivider = (line: string): boolean => {
    const compact = line.replace(/\s/g, '');
    return compact.includes('-') && /^[:|\-]+$/.test(compact);
};

const parseMarkdownTable = (rawText: string): ParsedTable | null => {
    if (!rawText || !rawText.includes('|')) return null;

    let text = rawText.replace(/\r/g, '').trim();
    if (!text.includes('\n') && text.includes('||') && /[:|\-\s]{3,}/.test(text)) {
        // Some model outputs collapse table rows into one line using `||`.
        text = text.replace(/\s*\|\|\s*/g, '\n');
    }

    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length < 3) return null;

    const dividerIndex = lines.findIndex((line) => isMarkdownTableDivider(line));
    if (dividerIndex < 1) return null;

    const headers = splitMarkdownTableRow(lines[dividerIndex - 1]).filter((cell) => cell !== '');
    if (headers.length < 2) return null;

    const rawRows = lines
        .slice(dividerIndex + 1)
        .filter((line) => line.includes('|'))
        .map((line) => splitMarkdownTableRow(line))
        .filter((row) => row.some((cell) => cell !== ''));

    if (rawRows.length === 0) return null;

    const columnCount = headers.length;
    const rows = rawRows.map((row) => {
        if (row.length === columnCount) return row;
        if (row.length > columnCount) return row.slice(0, columnCount);
        return [...row, ...Array(columnCount - row.length).fill('')];
    });

    return { headers, rows };
};

const formatNumericString = (rawValue: string): string => {
    const value = String(rawValue || '').trim();
    if (!value) return value;

    const fullMatch = value.match(/^([+-]?)(\d+)(?:\.(\d+))?(%)?$/);
    if (!fullMatch) return value;

    const [, sign = '', integerPart = '', decimalPart = '', percentSuffix = ''] = fullMatch;

    // Keep short values like year/day as-is to avoid "2,025".
    if (integerPart.length < 5) return value;

    const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const decimalSegment = decimalPart ? `.${decimalPart}` : '';
    return `${sign}${groupedInteger}${decimalSegment}${percentSuffix}`;
};

const formatCellForDisplay = (rawCell: string): string => {
    const trimmed = String(rawCell || '').trim();
    if (!trimmed) return trimmed;
    return formatNumericString(trimmed);
};

const AIAnalysisModal: React.FC<AIAnalysisModalProps> = ({
    isOpen,
    onClose,
    isLoading,
    analysisResult,
    error,
    title,
    onReAnalyze,
    defaultOutputLanguage = 'vi',
    uiLanguage = 'vi',
    onOutputLanguageChange
}) => {
    const [selectedProvider, setSelectedProvider] = React.useState('Google');
    const [selectedModel, setSelectedModel] = React.useState('gemini-2.5-flash');
    const autoRunOutputLanguage = normalizeOutputLanguage(defaultOutputLanguage, uiLanguage === 'en' ? 'en' : 'vi');
    const [selectedOutputLanguage, setSelectedOutputLanguage] = React.useState<ChartAnalysisOutputLanguage>(() => {
        const fallback = autoRunOutputLanguage;
        if (typeof window === 'undefined') return fallback;
        const stored = window.localStorage.getItem(OUTPUT_LANGUAGE_STORAGE_KEY);
        return normalizeOutputLanguage(stored, fallback);
    });
    const hasInitialized = React.useRef(false);
    const isEnglishUi = uiLanguage === 'en';
    const text = isEnglishUi
        ? {
            modalTitle: 'AI Analysis Insight',
            context: 'Context',
            rerun: 'Re-analyze',
            running: 'Running...',
            runningDetail: (provider: string) => `Running deep trend analysis with ${provider}...`,
            runningSubDetail: 'System is aggregating statistics, detecting anomalies, and evaluating overall trends.',
            failed: 'Analysis Failed',
            retry: 'Retry',
            watchNow: 'Critical Signal Points',
            close: 'Close',
            outputLanguageTitle: 'Output language',
        }
        : {
            modalTitle: 'AI Analysis Insight',
            context: 'Context',
            rerun: 'Phân tích lại',
            running: 'Running...',
            runningDetail: (provider: string) => `Đang thực hiện phân tích chuyên sâu & tìm xu hướng với ${provider}...`,
            runningSubDetail: 'Hệ thống đang tổng hợp thống kê, tìm kiếm điểm bất thường và đánh giá xu hướng tổng thể.',
            failed: 'Phân tích thất bại',
            retry: 'Thử lại',
            watchNow: 'Điểm cần theo dõi ngay',
            close: 'Đóng',
            outputLanguageTitle: 'Ngôn ngữ output',
        };
    const highlightLines = React.useMemo(() => extractHighlightLines(analysisResult), [analysisResult]);

    React.useEffect(() => {
        if (!isOpen) {
            hasInitialized.current = false;
        }
    }, [isOpen]);

    React.useEffect(() => {
        if (!isOpen) return;
        setSelectedOutputLanguage(autoRunOutputLanguage);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(OUTPUT_LANGUAGE_STORAGE_KEY, autoRunOutputLanguage);
        }
    }, [isOpen, autoRunOutputLanguage]);

    React.useEffect(() => {
        if (isOpen && !analysisResult && !isLoading && !error && !hasInitialized.current && onReAnalyze) {
            hasInitialized.current = true;
            onReAnalyze(selectedProvider, selectedModel, autoRunOutputLanguage);
        }
    }, [isOpen, analysisResult, isLoading, error, onReAnalyze, selectedProvider, selectedModel, autoRunOutputLanguage]);

    if (!isOpen) return null;
    if (typeof document === 'undefined') return null;

    const handleOutputLanguageChange = (rawLanguage: string) => {
        const normalized = normalizeOutputLanguage(rawLanguage, uiLanguage === 'en' ? 'en' : 'vi');
        setSelectedOutputLanguage(normalized);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(OUTPUT_LANGUAGE_STORAGE_KEY, normalized);
        }
        onOutputLanguageChange?.(normalized);
    };

    const handleReAnalyze = () => {
        if (onReAnalyze) {
            onReAnalyze(selectedProvider, selectedModel, selectedOutputLanguage);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-2 md:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-indigo-500/30 rounded-xl shadow-2xl w-[96vw] max-w-[1600px] max-h-[94vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-4 md:p-5 border-b border-white/10 bg-slate-800/50">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
                            <i className="fas fa-robot text-white text-lg"></i>
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-lg font-bold text-white">{text.modalTitle}</h3>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                                <p className="text-xs text-slate-400 truncate max-w-[480px]">{text.context}: {title}</p>
                                {/* Model Selector */}
                                <select
                                    value={selectedProvider}
                                    onChange={(e) => {
                                        const p = e.target.value;
                                        setSelectedProvider(p);
                                        if (p === 'Google') setSelectedModel('gemini-2.5-flash');
                                        if (p === 'OpenAI') setSelectedModel('gpt-5.1');
                                        if (p === 'Anthropic') setSelectedModel('claude-sonnet-4-20250514');
                                    }}
                                    className="bg-slate-800 border border-slate-600 text-xs text-white rounded px-2 py-0.5 focus:outline-none focus:border-indigo-500"
                                >
                                    <option value="Google">Google (Gemini 2.5 Flash)</option>
                                    <option value="OpenAI">OpenAI (GPT-5.1)</option>
                                    <option value="Anthropic">Anthropic (Claude Sonnet 4)</option>
                                </select>
                                <select
                                    value={selectedOutputLanguage}
                                    onChange={(e) => handleOutputLanguageChange(e.target.value)}
                                    title={text.outputLanguageTitle}
                                    className="bg-slate-800 border border-slate-600 text-xs text-white rounded px-2 py-0.5 focus:outline-none focus:border-indigo-500"
                                >
                                    {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={handleReAnalyze}
                                    disabled={isLoading}
                                    className="px-2 py-0.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors disabled:opacity-50"
                                >
                                    {isLoading ? text.running : text.rerun}
                                </button>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                    >
                        <i className="fas fa-times text-lg"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar bg-slate-900/80">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full space-y-6">
                            <div className="relative w-20 h-20">
                                <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20"></div>
                                <div className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <i className="fas fa-brain text-indigo-400 text-2xl animate-pulse"></i>
                                </div>
                            </div>
                            <p className="text-sm text-indigo-300 font-medium animate-pulse">
                                {text.runningDetail(selectedProvider)}
                            </p>
                            <p className="text-xs text-slate-500 text-center max-w-xs">
                                {text.runningSubDetail}
                            </p>
                        </div>
                    ) : error ? (
                        <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-4">
                            <i className="fas fa-exclamation-triangle text-red-400 text-xl mt-1"></i>
                            <div>
                                <h4 className="text-base font-bold text-red-400">{text.failed}</h4>
                                <p className="text-sm text-red-300/80 mt-1">{error}</p>
                                <button
                                    onClick={handleReAnalyze}
                                    className="mt-3 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs rounded border border-red-500/30 transition-colors"
                                >
                                    {text.retry}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {highlightLines.length > 0 && (
                                <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-r from-amber-400/10 via-orange-400/10 to-rose-400/10 p-4 md:p-5">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-8 h-8 rounded-lg bg-amber-300/20 border border-amber-300/40 flex items-center justify-center">
                                            <i className="fas fa-bullseye text-amber-200 text-sm"></i>
                                        </div>
                                        <h4 className="text-sm md:text-base font-black text-amber-100 uppercase tracking-[0.08em]">
                                            {text.watchNow}
                                        </h4>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {highlightLines.map((line, idx) => (
                                            <div
                                                key={`hl-card-${idx}`}
                                                className="rounded-xl border border-amber-300/25 bg-slate-950/50 px-3 py-3 text-sm text-amber-50/95 leading-relaxed"
                                            >
                                                <span className="text-amber-200 font-black mr-2">#{idx + 1}</span>
                                                {line}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="prose prose-invert prose-base md:prose-lg max-w-none">
                            <ReactMarkdown
                                components={{
                                    h1: ({ ...props }) => <h1 className="text-2xl font-bold text-indigo-300 mb-4 border-b border-indigo-500/30 pb-2" {...props} />,
                                    h2: ({ ...props }) => <h2 className="text-xl md:text-2xl font-black text-white mb-3 mt-7 flex items-center gap-2 border-b border-slate-700/70 pb-2" {...props} />,
                                    h3: ({ ...props }) => <h3 className="text-lg md:text-xl font-black text-slate-200 mb-2 mt-5" {...props} />,
                                    p: ({ children, ...props }) => {
                                        const contentText = nodeToText(children);
                                        const table = parseMarkdownTable(contentText);
                                        if (table) {
                                            return (
                                                <div className="my-5 overflow-x-auto rounded-2xl border border-slate-700/80 bg-slate-950/70">
                                                    <table className="min-w-full border-separate border-spacing-0">
                                                        <thead>
                                                            <tr>
                                                                {table.headers.map((header, index) => (
                                                                    <th
                                                                        key={`header-${index}`}
                                                                        className="bg-slate-800/90 px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-cyan-100 border-b border-slate-600/80 whitespace-nowrap"
                                                                    >
                                                                        {header}
                                                                    </th>
                                                                ))}
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {table.rows.map((row, rowIndex) => (
                                                                <tr
                                                                    key={`row-${rowIndex}`}
                                                                    className={rowIndex % 2 === 0 ? 'bg-slate-900/45' : 'bg-slate-900/20'}
                                                                >
                                                                    {row.map((cell, cellIndex) => (
                                                                        <td
                                                                            key={`cell-${rowIndex}-${cellIndex}`}
                                                                            className="px-4 py-3 text-sm text-slate-200 font-semibold border-b border-slate-800/70 whitespace-nowrap"
                                                                        >
                                                                            {formatCellForDisplay(cell)}
                                                                        </td>
                                                                    ))}
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            );
                                        }

                                        return <p className="text-sm md:text-[15px] text-slate-300 leading-relaxed mb-4 text-justify" {...props}>{children}</p>;
                                    },
                                    ul: ({ ...props }) => <ul className="list-disc list-outside ml-5 space-y-2 mb-4 text-slate-300" {...props} />,
                                    li: ({ ...props }) => <li className="text-sm md:text-[15px] leading-relaxed pl-1 marker:text-indigo-500" {...props} />,
                                    strong: ({ ...props }) => <strong className="font-bold text-indigo-200" {...props} />,
                                    blockquote: ({ ...props }) => (
                                        <blockquote className="border-l-4 border-indigo-500 pl-4 italic text-slate-400 my-4 bg-slate-800/30 py-3 rounded-r-lg" {...props} />
                                    ),
                                    code: ({ ...props }) => <code className="bg-slate-800 text-indigo-300 px-1 py-0.5 rounded text-xs font-mono" {...props} />,
                                }}
                            >
                                {analysisResult || ''}
                            </ReactMarkdown>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-white/10 bg-slate-800/50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors border border-white/5"
                    >
                        {text.close}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default AIAnalysisModal;
