
// ============================================
// Slicer Widget - For Data Filtering
// ============================================

import React, { useMemo, useState } from 'react';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import { formatBIValue } from '../engine/utils';

interface SlicerWidgetProps {
    widget: BIWidget;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    isSelected?: boolean;
    isGlobalMode?: boolean;
    onClickDataTab?: () => void;
    isDraggingOrResizing?: boolean;
    onClick?: (e: React.MouseEvent) => void;
}

const SlicerWidget: React.FC<SlicerWidgetProps> = ({
    widget,
    onEdit,
    onDelete,
    onDuplicate,
    isSelected,
    isGlobalMode = false,
    onClickDataTab,
    isDraggingOrResizing = false,
    onClick
}) => {
    const { getDataSource } = useDataStore();
    const { addCrossFilter, removeCrossFilter } = useFilterStore();
    const { getActiveDashboard } = useDashboardStore();

    // Local state for current selection (before applying)
    const [selectedValues, setSelectedValues] = useState<any[]>([]);

    const { uniqueValues } = useMemo(() => {
        if (!widget.dataSourceId || !widget.slicerField) return { uniqueValues: [], dataSource: null };
        const ds = getDataSource(widget.dataSourceId);
        if (!ds) return { uniqueValues: [], dataSource: null };

        const values = ds.data.map(row => row[widget.slicerField!]);
        const unique = Array.from(new Set(values.filter(v => v !== null && v !== undefined)));
        const sorted = unique.sort((a, b) => (a > b ? 1 : -1));

        return { uniqueValues: sorted, dataSource: ds };
    }, [widget.dataSourceId, widget.slicerField, getDataSource]);

    const handleSelect = (val: any) => {
        if (widget.multiSelect !== false) {
            setSelectedValues(prev =>
                prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
            );
        } else {
            setSelectedValues(prev => prev.includes(val) ? [] : [val]);
        }
    };

    // Use useEffect to apply filters automatically when selectedValues change
    React.useEffect(() => {
        if (!widget.slicerField) return;

        if (selectedValues.length === 0) {
            removeCrossFilter(widget.id);
            return;
        }

        const filter = {
            id: `slicer-${widget.id}`,
            field: widget.slicerField,
            operator: selectedValues.length > 1 ? 'in' as const : 'equals' as const,
            value: selectedValues.length > 1 ? selectedValues : selectedValues[0],
            enabled: true
        };

        const dashboard = getActiveDashboard();
        if (dashboard) {
            const allWidgets = dashboard.pages && dashboard.pages.length > 0
                ? dashboard.pages.flatMap(p => p.widgets)
                : dashboard.widgets;

            const affectedIds = allWidgets
                .filter(w => w.id !== widget.id)
                .map(w => w.id);
            addCrossFilter(widget.id, [filter], affectedIds);
        }
    }, [selectedValues, widget.id, widget.slicerField, getActiveDashboard, addCrossFilter, removeCrossFilter]);

    const handleClear = () => {
        setSelectedValues([]);
        removeCrossFilter(widget.id);
    };

    const [isOpen, setIsOpen] = useState(false);

    const handleSelectAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (selectedValues.length === uniqueValues.length) {
            setSelectedValues([]);
        } else {
            setSelectedValues([...uniqueValues]);
        }
    };

    const isAllSelected = uniqueValues.length > 0 && selectedValues.length === uniqueValues.length;

    const renderList = () => {
        if (isDraggingOrResizing && uniqueValues.length > 50) {
            return (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-[10px] italic bg-slate-900/20 rounded-lg border border-white/5 m-1">
                    <i className="fas fa-list-ul mb-1 opacity-40"></i>
                    <span>{uniqueValues.length.toLocaleString()} items (Hidden during move)</span>
                </div>
            );
        }

        return (
            <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 space-y-0.5 mb-1 pr-1">
                {widget.showSelectAll && widget.multiSelect !== false && uniqueValues.length > 0 && (
                    <label
                        className={`
                        flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer transition-all border border-dashed
                        ${isAllSelected
                                ? 'bg-indigo-600/10 border-indigo-500/30 text-indigo-300'
                                : 'border-white/5 hover:bg-white/5 text-slate-400 hover:text-slate-200'
                            }
                    `}
                        onClick={(e) => { e.stopPropagation(); handleSelectAll(e); }}
                    >
                        <div className={`
                        w-3.5 h-3.5 rounded border flex items-center justify-center transition-all
                        ${isAllSelected
                                ? 'bg-indigo-600 border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.4)]'
                                : 'bg-slate-900 border-white/10'
                            }
                    `}>
                            {isAllSelected && <i className="fas fa-check text-[8px] text-white"></i>}
                            {!isAllSelected && selectedValues.length > 0 && <div className="w-1.5 h-0.5 bg-indigo-400 rounded-sm"></div>}
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider">Select All</span>
                    </label>
                )}

                {uniqueValues.map(val => (
                    <label
                        key={String(val)}
                        className={`
                        flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer transition-all
                        ${selectedValues.includes(val)
                                ? 'bg-indigo-600/20 text-indigo-300'
                                : 'hover:bg-white/5 text-slate-400 hover:text-slate-200'
                            }
                    `}
                        onClick={(e) => { e.stopPropagation(); }}
                    >
                        <div className={`
                        w-3.5 h-3.5 rounded border flex items-center justify-center transition-all
                        ${selectedValues.includes(val)
                                ? 'bg-indigo-600 border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.4)]'
                                : 'bg-slate-900 border-white/10'
                            }
                    `}>
                            {selectedValues.includes(val) && <i className="fas fa-check text-[8px] text-white"></i>}
                        </div>
                        <span className="text-xs truncate">{formatBIValue(val)}</span>
                        <input
                            type="checkbox"
                            className="hidden"
                            checked={selectedValues.includes(val)}
                            onChange={() => handleSelect(val)}
                        />
                    </label>
                ))}
            </div>
        );
    };

    const content = (
        <div className={`flex flex-col h-full ${isGlobalMode ? 'p-1.5' : 'p-2'}`}>
            {(!widget.slicerField && !isGlobalMode) ? (
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        if (onClick) onClick(e);
                        onClickDataTab?.();
                    }}
                    className="flex flex-col items-center justify-center h-full text-slate-500 text-[10px] text-center px-4 cursor-pointer group"
                >
                    <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center mb-3 group-hover:bg-indigo-500/20 transition-all">
                        <i className="fas fa-plus text-indigo-400 group-hover:scale-125 transition-transform"></i>
                    </div>
                    <span className="font-bold uppercase tracking-widest text-slate-400 group-hover:text-indigo-300 transition-colors">Select Field</span>
                    <p className="mt-1 opacity-60">Click here to select a field in the <span className="text-indigo-400 font-bold">Data</span> tab</p>
                </div>
            ) : (
                <>
                    {widget.slicerMode === 'dropdown' ? (
                        <div className="relative">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsOpen(!isOpen);
                                    if (!isSelected && onClick) onClick(e);
                                }}
                                className="w-full flex items-center justify-between bg-slate-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white hover:border-indigo-500/50 transition-all"
                            >
                                <span className="truncate">
                                    {selectedValues.length === 0 ? 'All' :
                                        selectedValues.length === uniqueValues.length ? 'All selected' :
                                            selectedValues.length === 1 ? formatBIValue(selectedValues[0]) :
                                                `${selectedValues.length.toLocaleString()} items`}
                                </span>
                                <i className={`fas fa-chevron-down text-[10px] text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}></i>
                            </button>

                            {isOpen && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-[#0f172a] border border-indigo-500/30 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] z-[100] p-1.5 flex flex-col max-h-[400px] animate-in fade-in slide-in-from-top-2 duration-200">
                                    {renderList()}
                                    <div className="border-t border-white/5 pt-1 mt-1 flex justify-end">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
                                            className="px-3 py-1 text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                                        >
                                            Done
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        renderList()
                    )}
                </>
            )}
        </div>
    );

    if (isGlobalMode) return content;

    return (
        <BaseWidget
            widget={widget}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isSelected={isSelected}
            onClick={onClick}
            onAction={selectedValues.length > 0 ? {
                icon: 'fa-filter-circle-xmark',
                onClick: handleClear,
                title: 'Clear Selection',
                color: 'text-orange-400 hover:text-orange-300'
            } : undefined}
            allowOverflow={widget.slicerMode === 'dropdown'}
        >
            {content}
        </BaseWidget>
    );
};

export default SlicerWidget;
