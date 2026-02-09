
import React, { useState, useEffect } from 'react';
import { Field } from './types';

interface FormulaEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (name: string, formula: string) => void;
    initialName?: string;
    initialFormula?: string;
    availableFields: Field[];
}

interface FunctionDoc {
    name: string;
    syntax: string;
    description: string;
    example: string;
    category: 'math' | 'logic' | 'text' | 'date';
}

const SUPPORTED_FUNCTIONS: FunctionDoc[] = [
    // Math
    { name: 'ABS', syntax: 'Math.abs(x)', description: 'Returns the absolute value of a number', example: 'Math.abs([Profit])', category: 'math' },
    { name: 'CEIL', syntax: 'Math.ceil(x)', description: 'Rounds a number up to the next largest integer', example: 'Math.ceil([Sales])', category: 'math' },
    { name: 'FLOOR', syntax: 'Math.floor(x)', description: 'Rounds a number down to the next smallest integer', example: 'Math.floor([Sales])', category: 'math' },
    { name: 'MAX', syntax: 'Math.max(x, y)', description: 'Returns the largest of zero or more numbers', example: 'Math.max([Q1], [Q2])', category: 'math' },
    { name: 'MIN', syntax: 'Math.min(x, y)', description: 'Returns the smallest of zero or more numbers', example: 'Math.min([Q1], [Q2])', category: 'math' },
    { name: 'POW', syntax: 'Math.pow(x, y)', description: 'Returns base to the exponent power', example: 'Math.pow([Radius], 2)', category: 'math' },
    { name: 'ROUND', syntax: 'Math.round(x)', description: 'Rounds a number to the nearest integer', example: 'Math.round([Score])', category: 'math' },
    { name: 'SQRT', syntax: 'Math.sqrt(x)', description: 'Returns the square root of a number', example: 'Math.sqrt([Area])', category: 'math' },

    // Logic
    { name: 'IF / TERNARY', syntax: 'condition ? trueVal : falseVal', description: 'Conditional operator (if-else)', example: '[Sales] > 100 ? "High" : "Low"', category: 'logic' },

    // Text (JS String methods usually work on normalized data if treated as string, but engine parses numeric primarily. We'll include basic ones if applicable)
    // Note: The engine attempts to parse everything as number with (Number(row[x]) || 0). String operations might be tricky unless field is strictly string.
    // We'll stick to Math/Logic for now as the engine seems numeric-focused.
];

const FormulaEditorModal: React.FC<FormulaEditorModalProps> = ({
    isOpen,
    onClose,
    onSave,
    initialName = '',
    initialFormula = '',
    availableFields
}) => {
    const [name, setName] = useState(initialName);
    const [formula, setFormula] = useState(initialFormula);
    const [activeTab, setActiveTab] = useState<'fields' | 'functions'>('fields');
    const [selectedItem, setSelectedItem] = useState<any>(null); // Field or Function

    useEffect(() => {
        if (isOpen) {
            setName(initialName);
            setFormula(initialFormula);
        }
    }, [isOpen, initialName, initialFormula]);

    if (!isOpen) return null;

    const insertText = (text: string) => {
        // Simple append for now, could be improved with ref and cursor position
        setFormula(prev => prev + text);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-5xl h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-white/10 animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                            <i className="fas fa-calculator text-lg"></i>
                        </div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Formula Editor</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-slate-500 transition-colors"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 flex flex-col p-6 gap-6 overflow-hidden">

                    {/* Name Input */}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Field Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter calculated field name..."
                            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                    </div>

                    {/* Formula Editor Area */}
                    <div className="flex-1 flex flex-col gap-2 min-h-0">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Formula Expression</label>
                            <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded">JavaScript Syntax Supported</span>
                        </div>
                        <div className="flex-1 relative group">
                            <textarea
                                value={formula}
                                onChange={(e) => setFormula(e.target.value)}
                                placeholder="// Example: [Revenue] - [Cost] or ([Price] * [Quantity]) * 0.9"
                                className="w-full h-full resize-none bg-slate-50 dark:bg-[#0B1121] border border-slate-200 dark:border-white/10 rounded-xl p-4 font-mono text-sm text-slate-900 dark:text-indigo-100 leading-relaxed focus:ring-2 focus:ring-indigo-500 focus:outline-none custom-scrollbar"
                                spellCheck={false}
                            />
                            {/* Toolbar overlay inside textarea (optional) */}
                            <div className="absolute top-2 right-2 flex gap-1">
                                <button
                                    onClick={() => setFormula('')}
                                    className="p-1.5 text-xs bg-slate-200 dark:bg-white/10 hover:bg-red-500 hover:text-white rounded text-slate-500 transition-colors"
                                    title="Clear"
                                >
                                    <i className="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Helper Panel (Split View) */}
                    <div className="h-[240px] flex border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-900/50 shrink-0">
                        {/* Sidebar */}
                        <div className="w-1/3 border-r border-slate-200 dark:border-white/10 flex flex-col bg-white dark:bg-slate-950">
                            {/* Tabs */}
                            <div className="flex border-b border-slate-200 dark:border-white/10">
                                <button
                                    onClick={() => { setActiveTab('fields'); setSelectedItem(null); }}
                                    className={`flex-1 py-2 text-xs font-bold uppercase transition-colors border-b-2 ${activeTab === 'fields' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}
                                >
                                    Fields
                                </button>
                                <button
                                    onClick={() => { setActiveTab('functions'); setSelectedItem(null); }}
                                    className={`flex-1 py-2 text-xs font-bold uppercase transition-colors border-b-2 ${activeTab === 'functions' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}
                                >
                                    Functions
                                </button>
                            </div>

                            {/* List */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                                {activeTab === 'fields' ? (
                                    <>
                                        <div className="relative mb-2">
                                            <input type="text" placeholder="Search fields..." className="w-full text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded px-2 py-1.5 outline-none focus:border-indigo-500" />
                                            <i className="fas fa-search absolute right-2 top-1.5 text-slate-400 text-xs"></i>
                                        </div>
                                        {availableFields.map(field => (
                                            <div
                                                key={field.name}
                                                onClick={() => setSelectedItem(field)}
                                                onDoubleClick={() => insertText(`[${field.name}]`)}
                                                className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${selectedItem === field ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-white' : 'hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300'}`}
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
                                        ))}
                                    </>
                                ) : (
                                    SUPPORTED_FUNCTIONS.map(func => (
                                        <div
                                            key={func.name}
                                            onClick={() => setSelectedItem(func)}
                                            onDoubleClick={() => insertText(func.syntax)}
                                            className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${selectedItem === func ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-white' : 'hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300'}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-mono bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300 px-1.5 py-0.5 rounded">
                                                    ƒ
                                                </span>
                                                <span className="text-xs font-bold">{func.name}</span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Details Panel */}
                        <div className="flex-1 bg-slate-50 dark:bg-[#0B1121] p-4 overflow-y-auto custom-scrollbar">
                            {selectedItem ? (
                                activeTab === 'fields' ? (
                                    <div className="space-y-4">
                                        <div>
                                            <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                                <i className="fas fa-cube text-slate-400"></i>
                                                {selectedItem.name}
                                            </h4>
                                            <span className="text-xs text-slate-500 mt-1 block">Type: {selectedItem.type}</span>
                                        </div>
                                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-lg p-3">
                                            <div className="text-xs text-slate-500 uppercase font-bold mb-2">Sample Preview</div>
                                            <div className="text-sm font-mono text-indigo-600 dark:text-indigo-400">
                                                [{(selectedItem as Field).name}]
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => insertText(`[${selectedItem.name}]`)}
                                            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-500 transition-all flex items-center justify-center gap-2"
                                        >
                                            <i className="fas fa-plus"></i> Insert Field
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
                                            <div className="text-xs text-slate-500 uppercase font-bold">Syntax</div>
                                            <div className="bg-slate-200 dark:bg-white/5 border border-slate-300 dark:border-white/5 rounded p-2 font-mono text-xs text-slate-800 dark:text-slate-300">
                                                {(selectedItem as FunctionDoc).syntax}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="text-xs text-slate-500 uppercase font-bold">Example</div>
                                            <div className="bg-slate-200 dark:bg-white/5 border border-slate-300 dark:border-white/5 rounded p-2 font-mono text-xs text-emerald-600 dark:text-emerald-400">
                                                {(selectedItem as FunctionDoc).example}
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => insertText((selectedItem as FunctionDoc).syntax)}
                                            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-500 transition-all flex items-center justify-center gap-2"
                                        >
                                            <i className="fas fa-code"></i> Insert Function
                                        </button>
                                    </div>
                                )
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
                                    <i className="fas fa-mouse-pointer text-2xl mb-2 opacity-50"></i>
                                    <p className="text-xs">Select an item from the list<br />to view details</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950 flex items-center justify-between">
                    <div className="text-xs text-slate-500 flex items-center gap-2">
                        <i className="fas fa-info-circle"></i>
                        <span>Press <strong>Ctrl+Space</strong> for auto-complete (Coming Soon)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 font-medium hover:text-slate-900 dark:hover:text-white transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => {
                                if (name && formula) {
                                    onSave(name, formula);
                                }
                            }}
                            disabled={!name || !formula}
                            className="px-6 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Save Calculation
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default FormulaEditorModal;
