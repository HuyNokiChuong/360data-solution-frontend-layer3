import React from 'react';
import ReactMarkdown from 'react-markdown';

import { createPortal } from 'react-dom';

interface AIAnalysisModalProps {
    isOpen: boolean;
    onClose: () => void;
    isLoading: boolean;
    analysisResult: string | null;
    error: string | null;
    title: string;
    onReAnalyze?: (provider: string, modelId: string) => void;
}

const AIAnalysisModal: React.FC<AIAnalysisModalProps> = ({
    isOpen,
    onClose,
    isLoading,
    analysisResult,
    error,
    title,
    onReAnalyze
}) => {
    const [selectedProvider, setSelectedProvider] = React.useState('Google');
    const [selectedModel, setSelectedModel] = React.useState('gemini-2.5-flash');
    const hasInitialized = React.useRef(false);

    React.useEffect(() => {
        if (isOpen && !analysisResult && !isLoading && !error && !hasInitialized.current && onReAnalyze) {
            hasInitialized.current = true;
            onReAnalyze('Google', 'gemini-2.5-flash');
        }
    }, [isOpen, analysisResult, isLoading, error, onReAnalyze]);

    if (!isOpen) return null;
    if (typeof document === 'undefined') return null;

    const handleReAnalyze = () => {
        if (onReAnalyze) {
            onReAnalyze(selectedProvider, selectedModel);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-indigo-500/30 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-white/10 bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
                            <i className="fas fa-robot text-white text-lg"></i>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">AI Analysis Insight</h3>
                            <div className="flex items-center gap-2 mt-1">
                                <p className="text-xs text-slate-400">Context: {title}</p>
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
                                    className="ml-2 bg-slate-800 border border-slate-600 text-xs text-white rounded px-2 py-0.5 focus:outline-none focus:border-indigo-500"
                                >
                                    <option value="Google">Google (Gemini 2.5 Flash)</option>
                                    <option value="OpenAI">OpenAI (GPT-5.1)</option>
                                    <option value="Anthropic">Anthropic (Claude Sonnet 4)</option>
                                </select>
                                <button
                                    onClick={handleReAnalyze}
                                    disabled={isLoading}
                                    className="ml-2 px-2 py-0.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors disabled:opacity-50"
                                >
                                    {isLoading ? 'Running...' : 'Phân tích lại'}
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
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-900/80">
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
                                Đang phân tích dữ liệu & tìm xu hướng với {selectedProvider}...
                            </p>
                        </div>
                    ) : error ? (
                        <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-4">
                            <i className="fas fa-exclamation-triangle text-red-400 text-xl mt-1"></i>
                            <div>
                                <h4 className="text-base font-bold text-red-400">Analysis Failed</h4>
                                <p className="text-sm text-red-300/80 mt-1">{error}</p>
                                <button
                                    onClick={handleReAnalyze}
                                    className="mt-3 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs rounded border border-red-500/30 transition-colors"
                                >
                                    Thử lại
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="prose prose-invert prose-base max-w-none">
                            <ReactMarkdown
                                components={{
                                    h1: ({ ...props }) => <h1 className="text-2xl font-bold text-indigo-300 mb-4 border-b border-indigo-500/30 pb-2" {...props} />,
                                    h2: ({ ...props }) => <h2 className="text-xl font-bold text-white mb-3 mt-6 flex items-center gap-2" {...props} />,
                                    h3: ({ ...props }) => <h3 className="text-lg font-bold text-slate-200 mb-2 mt-4" {...props} />,
                                    p: ({ ...props }) => <p className="text-sm text-slate-300 leading-relaxed mb-4 text-justify" {...props} />,
                                    ul: ({ ...props }) => <ul className="list-disc list-outside ml-5 space-y-2 mb-4 text-slate-300" {...props} />,
                                    li: ({ ...props }) => <li className="text-sm leading-relaxed pl-1 marker:text-indigo-500" {...props} />,
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
                    )}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-white/10 bg-slate-800/50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors border border-white/5"
                    >
                        Đóng
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default AIAnalysisModal;
