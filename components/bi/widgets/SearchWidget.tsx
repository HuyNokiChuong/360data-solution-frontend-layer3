
// ============================================
// Search Widget - For Text Filtering
// ============================================

import React, { useState } from 'react';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';

interface SearchWidgetProps {
    widget: BIWidget;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    isSelected?: boolean;
    isGlobalMode?: boolean;
    onClickDataTab?: () => void;
    onClick?: (e: React.MouseEvent) => void;
}

const SearchWidget: React.FC<SearchWidgetProps> = ({
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

    // Local state
    const [searchTerm, setSearchTerm] = useState('');

    // Use useEffect to apply filters automatically when searchTerm changes
    React.useEffect(() => {
        if (!widget.slicerField) return;

        // If search term is empty, remove filter
        if (!searchTerm) {
            removeCrossFilter(widget.id);
            return;
        }

        const filter = {
            id: `search-${widget.id}`,
            field: widget.slicerField,
            operator: 'contains' as const,
            value: searchTerm,
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
    }, [searchTerm, widget.id, widget.slicerField, getActiveDashboard, addCrossFilter, removeCrossFilter]);

    const handleClear = () => {
        setSearchTerm('');
        removeCrossFilter(widget.id);
    };

    const content = (
        <div className={`flex flex-col h-full ${isGlobalMode ? 'p-1' : 'p-1'} space-y-2`}>
            <div className="relative">
                <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 text-xs"></i>
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={`Search ${widget.slicerField || 'field'}...`}
                    className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 pl-9 text-xs text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
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
            onAction={searchTerm ? {
                icon: 'fa-circle-xmark',
                onClick: handleClear,
                title: 'Clear Search',
                color: 'text-orange-400 hover:text-orange-300'
            } : undefined}
        >
            {content}
        </BaseWidget>
    );
};

export default SearchWidget;
