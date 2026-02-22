
// ============================================
// Slicer Widget - For Data Filtering
// ============================================

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDirectQuery } from '../hooks/useDirectQuery';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import { formatBIValue } from '../engine/utils';
import { exportRowsToExcel } from '../utils/widgetExcelExport';
import { getFieldValue } from '../engine/utils';

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
    const [selectedValues, setSelectedValues] = useState<any[]>(() => {
        if (widget.filters && widget.filters.length > 0) {
            const f = widget.filters[0];
            return Array.isArray(f.value) ? f.value : (f.value !== undefined ? [f.value] : []);
        }
        return [];
    });
    const [searchQuery, setSearchQuery] = useState('');

    // Switch to useDirectQuery
    const { data: directData, isLoading, error: directError } = useDirectQuery(widget);

    const normalizeFieldToken = useCallback((value: string) => {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }, []);

    const resolveRowFieldValue = useCallback((row: Record<string, any>, fieldName: string) => {
        const direct = getFieldValue(row, fieldName);
        if (direct !== undefined) return direct;

        const target = normalizeFieldToken(fieldName);
        const targetTail = normalizeFieldToken(fieldName.split('.').pop() || fieldName);
        const matchedKey = Object.keys(row || {}).find((key) => {
            const keyToken = normalizeFieldToken(key);
            if (!keyToken) return false;
            if (keyToken === target || keyToken === targetTail) return true;
            const keyTail = normalizeFieldToken(key.split('.').pop() || key);
            return keyTail === targetTail;
        });

        if (!matchedKey) return undefined;
        return row[matchedKey];
    }, [normalizeFieldToken]);

    const { uniqueValues, dataSource } = useMemo(() => {
        if (!widget.dataSourceId || !widget.slicerField) return { uniqueValues: [], dataSource: null };
        const ds = getDataSource(widget.dataSourceId);
        if (!ds) return { uniqueValues: [], dataSource: null };

        let values: any[] = [];
        const pickValue = (row: Record<string, any>) => resolveRowFieldValue(row, widget.slicerField!);
        const usesDirectValues = ds.type === 'bigquery' || ds.type === 'semantic_model';

        if (usesDirectValues) {
            values = directData.map((row) => pickValue(row));
        } else {
            values = (ds.data || []).map((row: Record<string, any>) => pickValue(row));
        }

        // Include null/undefined values, convert them to "(Blank)" for display
        const mappedValues = values.map(v => (v === null || v === undefined) ? '(Blank)' : v);
        const unique = Array.from(new Set(mappedValues));
        const sorted = unique.sort((a, b) => (a > b ? 1 : -1));

        return { uniqueValues: sorted, dataSource: ds };
    }, [widget.dataSourceId, widget.slicerField, getDataSource, directData, resolveRowFieldValue]);

    React.useEffect(() => {
        if (!widget.slicerField) {
            if (selectedValues.length > 0) setSelectedValues([]);
            return;
        }

        const currentFilter = (widget.filters || []).find((f) => f.field === widget.slicerField);
        const nextSelected = currentFilter
            ? (Array.isArray(currentFilter.value)
                ? currentFilter.value
                : (currentFilter.value !== undefined ? [currentFilter.value] : []))
            : [];

        if (JSON.stringify(nextSelected) !== JSON.stringify(selectedValues)) {
            setSelectedValues(nextSelected);
        }
    }, [widget.slicerField, widget.filters]);

    // Filter values based on search query
    const filteredValues = useMemo(() => {
        if (!searchQuery.trim()) return uniqueValues;
        const query = searchQuery.toLowerCase();
        return uniqueValues.filter(val =>
            String(val).toLowerCase().includes(query)
        );
    }, [uniqueValues, searchQuery]);

    const handleSelect = (val: any) => {
        if (widget.multiSelect !== false) {
            setSelectedValues(prev =>
                prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
            );
        } else {
            setSelectedValues(prev => prev.includes(val) ? [] : [val]);
        }
    };

    const { updateWidget } = useDashboardStore();

    // Use useEffect to apply filters automatically when selectedValues change
    React.useEffect(() => {
        if (!widget.slicerField) return;

        const dashboard = getActiveDashboard();
        if (!dashboard) return;

        if (selectedValues.length === 0) {
            removeCrossFilter(widget.id);
            // Also clear from widget persistent state if it was there
            if (widget.filters && widget.filters.length > 0) {
                updateWidget(dashboard.id, widget.id, { filters: [] });
            }
            return;
        }

        const filter = {
            id: `slicer-${widget.id}`,
            field: widget.slicerField,
            operator: selectedValues.length > 1 ? 'in' as const : 'equals' as const,
            value: selectedValues.length > 1 ? selectedValues : selectedValues[0],
            enabled: true
        };

        const activePage = dashboard.pages?.find((p) => p.id === dashboard.activePageId);
        const pageWidgets = activePage ? activePage.widgets : (dashboard.widgets || []);

        const affectedIds = pageWidgets
            .filter(w => w.id !== widget.id)
            .map(w => w.id);

        addCrossFilter(widget.id, [filter], affectedIds);

        // Sync with dashboard store for persistence
        // Only update if the values are actually different to avoid cycles
        const currentStoredValue = widget.filters?.[0]?.value;
        const newVal = selectedValues.length > 1 ? selectedValues : selectedValues[0];

        if (JSON.stringify(currentStoredValue) !== JSON.stringify(newVal)) {
            updateWidget(dashboard.id, widget.id, { filters: [filter] });
        }
    }, [selectedValues, widget.id, widget.slicerField, getActiveDashboard, addCrossFilter, removeCrossFilter, updateWidget, widget.filters]);

    const handleClear = () => {
        setSelectedValues([]);
        removeCrossFilter(widget.id);
    };

    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        if (!isOpen) return;

        const handleOutsideClick = (event: MouseEvent) => {
            const target = event.target as Node;
            if (dropdownRef.current && !dropdownRef.current.contains(target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
        };
    }, [isOpen]);

    const handleSelectAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (selectedValues.length === uniqueValues.length) {
            setSelectedValues([]);
        } else {
            setSelectedValues([...uniqueValues]);
        }
    };

    const isAllSelected = uniqueValues.length > 0 && selectedValues.length === uniqueValues.length;

    const exportFields = useMemo(() => {
        if (!widget.slicerField) return [];
        return [{ field: widget.slicerField, header: widget.slicerField }];
    }, [widget.slicerField]);

    const handleExportExcel = useCallback(() => {
        exportRowsToExcel({
            title: widget.title || 'Slicer',
            rows: directData as Record<string, any>[],
            fields: exportFields
        });
    }, [widget.title, directData, exportFields]);

    const renderList = () => {
        if (isDraggingOrResizing && uniqueValues.length > 50) {
            return (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-[10px] italic bg-slate-100 dark:bg-slate-900/20 rounded-lg border border-slate-200 dark:border-white/5 m-1">
                    <i className="fas fa-list-ul mb-1 opacity-40"></i>
                    <span>{uniqueValues.length.toLocaleString()} items (Hidden during move)</span>
                </div>
            );
        }

        return (
            <>
                {/* Search Bar */}
                {uniqueValues.length > 5 && (
                    <div className="mb-2 px-1">
                        <div className="relative">
                            <i className="fas fa-search absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500"></i>
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg pl-7 pr-7 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                            {searchQuery && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setSearchQuery(''); }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                >
                                    <i className="fas fa-times text-[10px]"></i>
                                </button>
                            )}
                        </div>
                    </div>
                )}

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
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10'
                                }
                        `}>
                                {isAllSelected && <i className="fas fa-check text-[8px] text-white"></i>}
                                {!isAllSelected && selectedValues.length > 0 && <div className="w-1.5 h-0.5 bg-indigo-400 rounded-sm"></div>}
                            </div>
                            <span className="text-xs font-bold uppercase tracking-wider">Select All</span>
                        </label>
                    )}

                    {filteredValues.length === 0 && searchQuery && (
                        <div className="text-center py-4 text-slate-500 text-[10px]">
                            <i className="fas fa-search mb-1 opacity-40"></i>
                            <p>No results found for "{searchQuery}"</p>
                        </div>
                    )}

                    {filteredValues.length === 0 && !searchQuery && (
                        <div className="text-center py-4 text-slate-500 text-[10px]">
                            <i className="fas fa-filter mb-1 opacity-40"></i>
                            <p>{dataSource ? 'No values found for this field' : 'Data source not found'}</p>
                        </div>
                    )}

                    {filteredValues.map(val => (
                        <label
                            key={String(val)}
                            className={`
                            flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer transition-all
                            ${selectedValues.includes(val)
                                    ? 'bg-indigo-500/10 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-300'
                                    : 'hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }
                        `}
                            onClick={(e) => { e.stopPropagation(); }}
                        >
                            <div className={`
                            w-3.5 h-3.5 rounded border flex items-center justify-center transition-all
                            ${selectedValues.includes(val)
                                    ? 'bg-indigo-600 border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.4)]'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10'
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
            </>
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
                        <div className="relative" ref={dropdownRef}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsOpen(!isOpen);
                                    if (!isSelected && onClick) onClick(e);
                                }}
                                className="w-full flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white hover:border-indigo-500/50 transition-all"
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
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-indigo-500/30 rounded-xl shadow-2xl dark:shadow-[0_10px_40px_rgba(0,0,0,0.6)] z-[100] p-1.5 flex flex-col max-h-[400px] animate-in fade-in slide-in-from-top-2 duration-200">
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
            loading={isLoading}
            error={directError || undefined}
            onClick={onClick}
            onAction={selectedValues.length > 0 ? {
                icon: 'fa-filter-circle-xmark',
                onClick: handleClear,
                title: 'Clear Selection',
                color: 'text-orange-400 hover:text-orange-300'
            } : undefined}
            allowOverflow={widget.slicerMode === 'dropdown'}
            onExportExcel={handleExportExcel}
        >
            {content}
        </BaseWidget>
    );
};

export default SlicerWidget;
