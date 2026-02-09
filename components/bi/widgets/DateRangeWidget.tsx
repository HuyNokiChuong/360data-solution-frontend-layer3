
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

    const startInputRef = React.useRef<HTMLInputElement>(null);
    const endInputRef = React.useRef<HTMLInputElement>(null);

    // Use useEffect to apply filters automatically when dates change
    React.useEffect(() => {
        if (!widget.slicerField) return;

        const timer = setTimeout(() => {
            // Clear filter if both dates are empty
            if (!startDate && !endDate) {
                removeCrossFilter(widget.id);
                return;
            }

            // Determine operator based on which dates are provided
            let operator: 'greaterOrEqual' | 'lessOrEqual' | 'between';
            let value: string;
            let value2: string | undefined;

            if (startDate && endDate) {
                operator = 'between';
                value = startDate;
                value2 = endDate;
            } else if (startDate) {
                operator = 'greaterOrEqual';
                value = startDate;
            } else {
                operator = 'lessOrEqual';
                value = endDate;
            }

            const filter = {
                id: `date-${widget.id}`,
                field: widget.slicerField,
                operator,
                value,
                value2,
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
        }, 500); // Debounce 500ms to allow typing

        return () => clearTimeout(timer);
    }, [startDate, endDate, widget.id, widget.slicerField, getActiveDashboard, addCrossFilter, removeCrossFilter]);

    const handleClear = () => {
        setStartDate('');
        setEndDate('');
        removeCrossFilter(widget.id);
    };

    const handleContainerClick = (ref: React.RefObject<HTMLInputElement>) => {
        if (ref.current) {
            try {
                ref.current.showPicker();
            } catch (e) {
                // Fallback for browsers that don't support showPicker (e.g. Safari < 16, Firefox < 101)
                ref.current.focus();
            }
        }
    };

    const content = (
        <div className={`flex flex-col h-full ${isGlobalMode ? 'p-1' : 'p-1'} space-y-2`}>
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <label className="block text-[10px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-wider">From</label>
                    <div className="relative">
                        <div
                            className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center cursor-pointer z-10"
                            onClick={() => handleContainerClick(startInputRef)}
                        >
                            <i className="fas fa-calendar text-slate-400 dark:text-slate-500 text-[10px]"></i>
                        </div>
                        <input
                            ref={startInputRef}
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg pl-8 pr-2 py-1.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>
                <div className="space-y-1">
                    <label className="block text-[10px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-wider">To</label>
                    <div className="relative">
                        <div
                            className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center cursor-pointer z-10"
                            onClick={() => handleContainerClick(endInputRef)}
                        >
                            <i className="fas fa-calendar text-slate-400 dark:text-slate-500 text-[10px]"></i>
                        </div>
                        <input
                            ref={endInputRef}
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg pl-8 pr-2 py-1.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
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
