import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Field } from './types';
import { CalculationEngine } from './engine/calculationEngine';
import { useLanguageStore } from '../../store/languageStore';
import { AI_MODELS } from '../../constants';
import { generateCalculatedFieldFormula } from '../../services/ai';

interface FormulaEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (name: string, formula: string) => void;
    initialName?: string;
    initialFormula?: string;
    availableFields: Field[];
    existingFieldNames?: string[];
    editingFieldName?: string;
}

interface FunctionDoc {
    name: string;
    syntax: string;
    description: string;
    example: string;
}

const SUPPORTED_FUNCTIONS: FunctionDoc[] = [
    { name: 'IF', syntax: 'IF(condition, trueVal, falseVal)', description: 'If-else logic', example: 'IF([Revenue] > 0, [Profit] / [Revenue], 0)' },
    { name: 'AND', syntax: 'AND(cond1, cond2)', description: 'True when all conditions are true', example: 'AND([Revenue] > 0, [Cost] > 0)' },
    { name: 'OR', syntax: 'OR(cond1, cond2)', description: 'True when any condition is true', example: 'OR([City] == "HN", [City] == "HCM")' },
    { name: 'NOT', syntax: 'NOT(value)', description: 'Logical negation', example: 'NOT([IsActive])' },
    { name: 'ABS', syntax: 'ABS(x)', description: 'Absolute value', example: 'ABS([Profit])' },
    { name: 'ROUND', syntax: 'ROUND(x, digits)', description: 'Round with optional precision', example: 'ROUND([Revenue] / [Orders], 2)' },
    { name: 'CEILING', syntax: 'CEILING(x)', description: 'Round up', example: 'CEILING([Score])' },
    { name: 'FLOOR', syntax: 'FLOOR(x)', description: 'Round down', example: 'FLOOR([Score])' },
    { name: 'MAX', syntax: 'MAX(x, y)', description: 'Larger value', example: 'MAX([Q1], [Q2])' },
    { name: 'MIN', syntax: 'MIN(x, y)', description: 'Smaller value', example: 'MIN([Q1], [Q2])' },
    { name: 'UPPER', syntax: 'UPPER(text)', description: 'Uppercase text', example: 'UPPER([City])' },
    { name: 'LOWER', syntax: 'LOWER(text)', description: 'Lowercase text', example: 'LOWER([City])' },
    { name: 'CONCAT', syntax: 'CONCAT(a, b)', description: 'Concatenate text', example: 'CONCAT([FirstName], " ", [LastName])' },
    { name: 'LEN', syntax: 'LEN(text)', description: 'Text length', example: 'LEN([OrderCode])' },
];

const FormulaEditorModal: React.FC<FormulaEditorModalProps> = ({
    isOpen,
    onClose,
    onSave,
    initialName = '',
    initialFormula = '',
    availableFields,
    existingFieldNames = [],
    editingFieldName = '',
}) => {
    const { language } = useLanguageStore();
    const isVi = language === 'vi';
    const [name, setName] = useState(initialName);
    const [formula, setFormula] = useState(initialFormula);
    const [activeTab, setActiveTab] = useState<'fields' | 'functions'>('fields');
    const [selectedItem, setSelectedItem] = useState<Field | FunctionDoc | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [aiPrompt, setAiPrompt] = useState('');
    const [isGeneratingAI, setIsGeneratingAI] = useState(false);
    const [aiError, setAiError] = useState('');
    const [aiExplanation, setAiExplanation] = useState('');
    const [aiModelId, setAiModelId] = useState(() => {
        if (typeof localStorage === 'undefined') return 'gpt-5.1';
        return localStorage.getItem('preferred_ai_model') || 'gpt-5.1';
    });
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const hasGoogleKey = typeof localStorage !== 'undefined' && !!localStorage.getItem('gemini_api_key');
    const hasOpenAIKey = typeof localStorage !== 'undefined' && !!localStorage.getItem('openai_api_key');
    const hasAnthropicKey = typeof localStorage !== 'undefined' && !!localStorage.getItem('anthropic_api_key');
    const hasAnyAiKey = hasGoogleKey || hasOpenAIKey || hasAnthropicKey;

    const aiModelOptions = useMemo(() => {
        const modelsWithKey = AI_MODELS.filter((model) => {
            if (model.provider === 'Google') return hasGoogleKey;
            if (model.provider === 'OpenAI') return hasOpenAIKey;
            if (model.provider === 'Anthropic') return hasAnthropicKey;
            return false;
        });
        return modelsWithKey.length > 0 ? modelsWithKey : AI_MODELS;
    }, [hasGoogleKey, hasOpenAIKey, hasAnthropicKey]);

    useEffect(() => {
        if (!isOpen) return;
        setName(initialName);
        setFormula(initialFormula);
        setSelectedItem(null);
        setSearchTerm('');
        setAiPrompt('');
        setAiError('');
        setAiExplanation('');
        if (typeof localStorage !== 'undefined') {
            setAiModelId(localStorage.getItem('preferred_ai_model') || 'gpt-5.1');
        }
    }, [isOpen, initialName, initialFormula]);

    useEffect(() => {
        if (!aiModelOptions.some(m => m.id === aiModelId)) {
            setAiModelId(aiModelOptions[0]?.id || 'gpt-5.1');
        }
    }, [aiModelId, aiModelOptions]);

    useEffect(() => {
        if (typeof localStorage !== 'undefined' && aiModelId) {
            localStorage.setItem('preferred_ai_model', aiModelId);
        }
    }, [aiModelId]);

    const normalizedName = name.trim();
    const normalizedFormula = formula.trim();
    const availableFieldNames = useMemo(() => availableFields.map(f => f.name), [availableFields]);
    const existingNameSet = useMemo(
        () => new Set(existingFieldNames.map(n => n.trim().toLowerCase())),
        [existingFieldNames]
    );
    const isDuplicateName = !!normalizedName &&
        normalizedName.toLowerCase() !== editingFieldName.trim().toLowerCase() &&
        existingNameSet.has(normalizedName.toLowerCase());

    const formulaValidation = useMemo(() => {
        if (!normalizedFormula) return { valid: false, error: isVi ? 'Công thức là bắt buộc' : 'Formula is required' };
        return CalculationEngine.validateFormula(normalizedFormula, availableFieldNames);
    }, [normalizedFormula, availableFieldNames, isVi]);

    const formError = useMemo(() => {
        if (!normalizedName) return isVi ? 'Tên trường là bắt buộc' : 'Field name is required';
        if (isDuplicateName) return isVi ? 'Tên trường đã tồn tại' : 'Field name already exists';
        if (!formulaValidation.valid) return formulaValidation.error || (isVi ? 'Công thức không hợp lệ' : 'Invalid formula');
        return '';
    }, [normalizedName, isDuplicateName, formulaValidation, isVi]);

    const filteredFields = useMemo(() => {
        const keyword = searchTerm.trim().toLowerCase();
        if (!keyword) return availableFields;
        return availableFields.filter(f =>
            f.name.toLowerCase().includes(keyword) ||
            String(f.type).toLowerCase().includes(keyword)
        );
    }, [availableFields, searchTerm]);

    const filteredFunctions = useMemo(() => {
        const keyword = searchTerm.trim().toLowerCase();
        if (!keyword) return SUPPORTED_FUNCTIONS;
        return SUPPORTED_FUNCTIONS.filter(f =>
            f.name.toLowerCase().includes(keyword) ||
            f.syntax.toLowerCase().includes(keyword) ||
            f.description.toLowerCase().includes(keyword)
        );
    }, [searchTerm]);

    const selectedAiModel = useMemo(
        () => aiModelOptions.find(m => m.id === aiModelId) || aiModelOptions[0],
        [aiModelId, aiModelOptions]
    );

    if (!isOpen) return null;

    const insertText = (text: string) => {
        const textarea = textareaRef.current;
        if (!textarea) {
            setFormula(prev => prev + text);
            return;
        }

        const start = textarea.selectionStart ?? formula.length;
        const end = textarea.selectionEnd ?? formula.length;
        const nextFormula = `${formula.slice(0, start)}${text}${formula.slice(end)}`;
        setFormula(nextFormula);

        requestAnimationFrame(() => {
            textarea.focus();
            const nextCursor = start + text.length;
            textarea.setSelectionRange(nextCursor, nextCursor);
        });
    };

    const handleSave = () => {
        if (formError) return;
        onSave(normalizedName, normalizedFormula);
    };

    const handleGenerateFormula = async () => {
        const normalizedPrompt = aiPrompt.trim();
        if (!normalizedPrompt) {
            setAiError(isVi ? 'Mô tả công thức trước khi generate.' : 'Describe the formula before generating.');
            return;
        }

        setAiError('');
        setAiExplanation('');
        setIsGeneratingAI(true);
        try {
            const result = await generateCalculatedFieldFormula({
                prompt: normalizedPrompt,
                modelId: selectedAiModel?.id,
                provider: selectedAiModel?.provider as 'Google' | 'OpenAI' | 'Anthropic',
                currentFieldName: normalizedName,
                availableFields: availableFields.map(f => ({ name: f.name, type: f.type })),
            });

            setFormula(result.formula);
            if (!normalizedName && result.suggestedName) {
                setName(result.suggestedName);
            }

            const info = result.explanation?.trim()
                || (isVi
                    ? `Đã generate bằng ${result.provider} • ${result.modelId}`
                    : `Generated by ${result.provider} • ${result.modelId}`);
            setAiExplanation(info);
        } catch (error: any) {
            setAiError(error?.message || (isVi ? 'Không thể generate công thức.' : 'Failed to generate formula.'));
        } finally {
            setIsGeneratingAI(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-5xl h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-white/10 animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                            <i className="fas fa-calculator text-lg"></i>
                        </div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{isVi ? 'Trình soạn công thức' : 'Formula Editor'}</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-slate-500 transition-colors"
                    >
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="flex-1 flex flex-col p-6 gap-6 overflow-hidden">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{isVi ? 'Tên trường' : 'Field Name'}</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={isVi ? 'Nhập tên trường tính toán...' : 'Enter calculated field name...'}
                            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                    </div>

                    <div className="border border-slate-200 dark:border-white/10 rounded-xl p-3 bg-slate-50 dark:bg-slate-950/70 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
                                <i className="fas fa-wand-magic-sparkles text-indigo-500"></i>
                                <span className="text-xs font-bold uppercase tracking-wider">{isVi ? 'AI Formula Assistant' : 'AI Formula Assistant'}</span>
                            </div>
                            <select
                                value={selectedAiModel?.id || aiModelId}
                                onChange={(e) => setAiModelId(e.target.value)}
                                className="min-w-[220px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            >
                                {aiModelOptions.map(model => (
                                    <option key={model.id} value={model.id}>
                                        {model.name} ({model.provider})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                placeholder={isVi
                                    ? 'VD: Tính lợi nhuận = doanh thu - chi phí; nếu null thì trả 0'
                                    : 'Example: Profit = revenue - cost; return 0 when null'}
                                className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                            <button
                                onClick={handleGenerateFormula}
                                disabled={isGeneratingAI || !aiPrompt.trim()}
                                className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px]"
                            >
                                {isGeneratingAI
                                    ? (isVi ? 'Đang tạo...' : 'Generating...')
                                    : (isVi ? 'Generate AI' : 'Generate AI')}
                            </button>
                        </div>
                        {!hasAnyAiKey && (
                            <div className="text-[11px] text-amber-500">
                                {isVi ? 'Chưa có API Key. Vào AI Settings để thêm key trước khi generate.' : 'No API key found. Add one in AI Settings before generating.'}
                            </div>
                        )}
                        {aiExplanation && (
                            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-2">
                                {aiExplanation}
                            </div>
                        )}
                        {aiError && (
                            <div className="text-[11px] text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-2">
                                {aiError}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 flex flex-col gap-2 min-h-0">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{isVi ? 'Biểu thức công thức' : 'Formula Expression'}</label>
                            <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded">{isVi ? 'Dùng cú pháp `[FieldName]`' : 'Use `[FieldName]` syntax'}</span>
                        </div>
                        <div className="flex-1 relative group">
                            <textarea
                                ref={textareaRef}
                                value={formula}
                                onChange={(e) => setFormula(e.target.value)}
                                placeholder={isVi ? '// Ví dụ: [Revenue] - [Cost]' : '// Example: [Revenue] - [Cost]'}
                                className="w-full h-full resize-none bg-slate-50 dark:bg-[#0B1121] border border-slate-200 dark:border-white/10 rounded-xl p-4 font-mono text-sm text-slate-900 dark:text-indigo-100 leading-relaxed focus:ring-2 focus:ring-indigo-500 focus:outline-none custom-scrollbar"
                                spellCheck={false}
                            />
                            <div className="absolute top-2 right-2 flex gap-1">
                                <button
                                    onClick={() => setFormula('')}
                                    className="p-1.5 text-xs bg-slate-200 dark:bg-white/10 hover:bg-red-500 hover:text-white rounded text-slate-500 transition-colors"
                                    title={isVi ? 'Xóa' : 'Clear'}
                                >
                                    <i className="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="h-[240px] flex border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-900/50 shrink-0">
                        <div className="w-1/3 border-r border-slate-200 dark:border-white/10 flex flex-col bg-white dark:bg-slate-950">
                            <div className="flex border-b border-slate-200 dark:border-white/10">
                                <button
                                    onClick={() => { setActiveTab('fields'); setSelectedItem(null); }}
                                    className={`flex-1 py-2 text-xs font-bold uppercase transition-colors border-b-2 ${activeTab === 'fields' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}
                                >
                                    {isVi ? 'Trường' : 'Fields'}
                                </button>
                                <button
                                    onClick={() => { setActiveTab('functions'); setSelectedItem(null); }}
                                    className={`flex-1 py-2 text-xs font-bold uppercase transition-colors border-b-2 ${activeTab === 'functions' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}
                                >
                                    {isVi ? 'Hàm' : 'Functions'}
                                </button>
                            </div>

                            <div className="p-2 border-b border-slate-200 dark:border-white/10">
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        placeholder={activeTab === 'fields'
                                            ? (isVi ? 'Tìm trường...' : 'Search fields...')
                                            : (isVi ? 'Tìm hàm...' : 'Search functions...')}
                                        className="w-full text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded px-2 py-1.5 outline-none focus:border-indigo-500"
                                    />
                                    <i className="fas fa-search absolute right-2 top-1.5 text-slate-400 text-xs"></i>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                                {activeTab === 'fields' ? (
                                    filteredFields.length > 0 ? (
                                        filteredFields.map(field => (
                                            <div
                                                key={field.name}
                                                onClick={() => setSelectedItem(field)}
                                                onDoubleClick={() => insertText(`[${field.name}]`)}
                                                className={`group flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${selectedItem === field ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-white' : 'hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300'}`}
                                            >
                                                <div className="flex items-center gap-2 truncate">
                                                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${field.type === 'number' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                                                        {field.type === 'number' ? '#' : 'T'}
                                                    </span>
                                                    <span className="text-xs truncate">{field.name}</span>
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); insertText(`[${field.name}]`); }}
                                                    className="opacity-0 group-hover:opacity-100 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 w-6 h-6 rounded flex items-center justify-center transition-all"
                                                >
                                                    <i className="fas fa-plus text-[10px]"></i>
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="p-2 text-xs text-slate-400 italic text-center">{isVi ? 'Không có trường phù hợp' : 'No matching fields'}</div>
                                    )
                                ) : (
                                    filteredFunctions.length > 0 ? (
                                        filteredFunctions.map(func => (
                                            <div
                                                key={func.name}
                                                onClick={() => setSelectedItem(func)}
                                                onDoubleClick={() => insertText(func.syntax)}
                                                className={`group flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${selectedItem === func ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-white' : 'hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300'}`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-mono bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300 px-1.5 py-0.5 rounded">ƒ</span>
                                                    <span className="text-xs font-bold">{func.name}</span>
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); insertText(func.syntax); }}
                                                    className="opacity-0 group-hover:opacity-100 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 w-6 h-6 rounded flex items-center justify-center transition-all"
                                                >
                                                    <i className="fas fa-plus text-[10px]"></i>
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="p-2 text-xs text-slate-400 italic text-center">{isVi ? 'Không có hàm phù hợp' : 'No matching functions'}</div>
                                    )
                                )}
                            </div>
                        </div>

                        <div className="flex-1 bg-slate-50 dark:bg-[#0B1121] p-4 overflow-y-auto custom-scrollbar">
                            {selectedItem ? (
                                activeTab === 'fields' ? (
                                    <div className="space-y-4">
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                                <i className="fas fa-cube text-slate-400"></i>
                                                {(selectedItem as Field).name}
                                            </h4>
                                            <span className="text-xs text-slate-500 mt-1 block">{isVi ? 'Kiểu' : 'Type'}: {(selectedItem as Field).type}</span>
                                        </div>
                                        <button
                                            onClick={() => insertText(`[${(selectedItem as Field).name}]`)}
                                            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-500 transition-all flex items-center justify-center gap-2"
                                        >
                                            <i className="fas fa-plus"></i> {isVi ? 'Chèn trường' : 'Insert Field'}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                                <i className="fas fa-function text-purple-500"></i>
                                                {(selectedItem as FunctionDoc).name}
                                            </h4>
                                            <p className="text-xs text-slate-500 mt-2 leading-relaxed">{(selectedItem as FunctionDoc).description}</p>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="text-xs text-slate-500 uppercase font-bold">{isVi ? 'Cú pháp' : 'Syntax'}</div>
                                            <div className="bg-slate-200 dark:bg-white/5 border border-slate-300 dark:border-white/5 rounded p-2 font-mono text-xs text-slate-800 dark:text-slate-300">
                                                {(selectedItem as FunctionDoc).syntax}
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="text-xs text-slate-500 uppercase font-bold">{isVi ? 'Ví dụ' : 'Example'}</div>
                                            <div className="bg-slate-200 dark:bg-white/5 border border-slate-300 dark:border-white/5 rounded p-2 font-mono text-xs text-emerald-600 dark:text-emerald-400">
                                                {(selectedItem as FunctionDoc).example}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => insertText((selectedItem as FunctionDoc).syntax)}
                                            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-500 transition-all flex items-center justify-center gap-2"
                                        >
                                            <i className="fas fa-code"></i> {isVi ? 'Chèn hàm' : 'Insert Function'}
                                        </button>
                                    </div>
                                )
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
                                    <i className="fas fa-mouse-pointer text-2xl mb-2 opacity-50"></i>
                                    <p className="text-xs">{isVi ? 'Chọn một mục trong danh sách' : 'Select an item from the list'}<br />{isVi ? 'để xem chi tiết' : 'to view details'}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950 flex items-center justify-between">
                    <div className={`text-xs flex items-center gap-2 ${formError ? 'text-red-500' : 'text-emerald-600'}`}>
                        <i className={`fas ${formError ? 'fa-exclamation-circle' : 'fa-check-circle'}`}></i>
                        <span>{formError || (isVi ? 'Công thức hợp lệ' : 'Formula is valid')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 font-medium hover:text-slate-900 dark:hover:text-white transition-colors"
                        >
                            {isVi ? 'Hủy' : 'Cancel'}
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!!formError}
                            className="px-6 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isVi ? 'Lưu phép tính' : 'Save Calculation'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FormulaEditorModal;
