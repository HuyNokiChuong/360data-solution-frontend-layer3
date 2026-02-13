
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
    const [searchTerm, setSearchTerm] = useState(() => {
        if (widget.filters && widget.filters.length > 0) {
            return widget.filters[0].value || '';
        }
        return '';
    });

    const { updateWidget } = useDashboardStore();

    // Use useEffect to apply filters automatically when searchTerm changes
    React.useEffect(() => {
        if (!widget.slicerField) return;

        const dashboard = getActiveDashboard();
        if (!dashboard) return;

        // If search term is empty, remove filter
        if (!searchTerm) {
            removeCrossFilter(widget.id);
            if (widget.filters && widget.filters.length > 0) {
                updateWidget(dashboard.id, widget.id, { filters: [] });
            }
            return;
        }

        const filter = {
            id: `search-${widget.id}`,
            field: widget.slicerField,
            operator: 'contains' as const,
            value: searchTerm,
            enabled: true
        };

        const activePage = dashboard.pages?.find((p) => p.id === dashboard.activePageId);
        const pageWidgets = activePage ? activePage.widgets : (dashboard.widgets || []);

        const affectedIds = pageWidgets
            .filter(w => w.id !== widget.id)
            .map(w => w.id);

        addCrossFilter(widget.id, [filter], affectedIds);

        // Sync with dashboard store for persistence
        if (widget.filters?.[0]?.value !== searchTerm) {
            updateWidget(dashboard.id, widget.id, { filters: [filter] });
        }
    }, [searchTerm, widget.id, widget.slicerField, getActiveDashboard, addCrossFilter, removeCrossFilter, updateWidget, widget.filters]);

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
                    className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 pl-9 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
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
