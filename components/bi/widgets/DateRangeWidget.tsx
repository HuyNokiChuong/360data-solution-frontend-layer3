
// ============================================
// Date Range Widget - For Time Filtering
// ============================================

import React, { useState, useEffect, useMemo } from 'react';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';

interface DateRangeWidgetProps {
    widget: BIWidget;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    isSelected?: boolean;
    isGlobalMode?: boolean;
    onClickDataTab?: () => void;
    onClick?: (e: React.MouseEvent) => void;
}

const DateRangeWidget: React.FC<DateRangeWidgetProps> = ({
    widget,
    onEdit,
    onDelete,
    onDuplicate,
    isSelected,
    isGlobalMode = false,
    onClickDataTab,
    onClick
}) => {
    const { getDataSource } = useDataStore();
    const { addCrossFilter, removeCrossFilter } = useFilterStore();
    const { getActiveDashboard } = useDashboardStore();

    // Local state for dates (before apply)
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    // Use useEffect to apply filters automatically when dates change
    React.useEffect(() => {
        if (!widget.slicerField) return;

        // Only apply if both are empty (clear) or both/one are set
        // Usually we want either both or at least one.
        if (!startDate && !endDate) {
            removeCrossFilter(widget.id);
            return;
        }

        const filter = {
            id: `date-${widget.id}`,
            field: widget.slicerField,
            operator: 'between' as const,
            value: startDate,
            value2: endDate,
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
    }, [startDate, endDate, widget.id, widget.slicerField, getActiveDashboard, addCrossFilter, removeCrossFilter]);

    const handleClear = () => {
        setStartDate('');
        setEndDate('');
        removeCrossFilter(widget.id);
    };

    const content = (
        <div className={`flex flex-col h-full ${isGlobalMode ? 'p-1' : 'p-1'} space-y-2`}>
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">From</label>
                    <div className="relative">
                        <i className="fas fa-calendar absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-[10px]"></i>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded-lg pl-8 pr-2 py-1.5 text-xs text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>
                <div className="space-y-1">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">To</label>
                    <div className="relative">
                        <i className="fas fa-calendar absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-[10px]"></i>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full bg-slate-950 border border-white/10 rounded-lg pl-8 pr-2 py-1.5 text-xs text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>
            </div>

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
            onAction={(startDate || endDate) ? {
                icon: 'fa-calendar-xmark',
                onClick: handleClear,
                title: 'Clear Dates',
                color: 'text-orange-400 hover:text-orange-300'
            } : undefined}
        >
            {content}
        </BaseWidget>
    );
};

export default DateRangeWidget;
