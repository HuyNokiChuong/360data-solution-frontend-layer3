// ============================================
// Table Widget
// ============================================

import React, { useMemo, useState } from 'react';
import { BIWidget } from '../types';
import { useDataStore } from '../store/dataStore';
import { useFilterStore } from '../store/filterStore';
import { applyFilters, sortData } from '../engine/dataProcessing';
import { useWidgetData } from '../hooks/useWidgetData';
import { useDashboardStore } from '../store/dashboardStore';
import BaseWidget from './BaseWidget';
import { getFieldValue, formatBIValue } from '../engine/utils';
import EmptyChartState from './EmptyChartState';

interface TableWidgetProps {
    widget: BIWidget;
    onEdit?: () => void;
    onDelete?: () => void;
    onDuplicate?: () => void;
    isSelected?: boolean;
    onClickDataTab?: () => void;
    isDraggingOrResizing?: boolean;
    onClick?: (e: React.MouseEvent) => void;
}

const TableWidget: React.FC<TableWidgetProps> = ({
    widget,
    onEdit,
    onDelete,
    onDuplicate,
    isSelected,
    onClickDataTab,
    isDraggingOrResizing = false,
    onClick
}) => {
    const { getDataSource } = useDataStore(); // Kept for metadata/schema
    const { crossFilters: allDashboardFilters, getFiltersForWidget, isWidgetFiltered } = useFilterStore();
    const activeDashboard = useDashboardStore(state => state.dashboards.find(d => d.id === state.activeDashboardId));
    const widgetData = useWidgetData(widget);

    const [sortField, setSortField] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [currentPage, setCurrentPage] = useState(1);

    const dataSource = useMemo(() => {
        return widget.dataSourceId ? getDataSource(widget.dataSourceId) : null;
    }, [widget.dataSourceId, getDataSource]);

    // Optimized memo dependencies - only re-calculate if data-relevant fields change
    const dataRelevantProps = JSON.stringify({
        filters: widget.filters,
        enableCrossFilter: widget.enableCrossFilter,
        dataSourceId: widget.dataSourceId,
        columns: widget.columns
    });

    const tableData = useMemo(() => {
        if (!widgetData || widgetData.length === 0) return [];

        let data = widgetData;

        if (widget.filters && widget.filters.length > 0) {
            data = applyFilters(data, widget.filters);
        }

        if (widget.enableCrossFilter !== false) {
            const crossFilters = getFiltersForWidget(widget.id);
            if (crossFilters.length > 0) {
                data = applyFilters(data, crossFilters);
            }
        }

        // Apply global filters
        if (activeDashboard?.globalFilters?.length) {
            const relevantFilters = activeDashboard.globalFilters.filter(gf =>
                !gf.appliedToWidgets || gf.appliedToWidgets.length === 0 || gf.appliedToWidgets.includes(widget.id)
            );
            if (relevantFilters.length > 0) {
                data = applyFilters(data, relevantFilters as any[]);
            }
        }

        if (sortField) {
            data = sortData(data, sortField, sortDirection);
        }

        return data;
    }, [widgetData, dataRelevantProps, allDashboardFilters, activeDashboard?.globalFilters, sortField, sortDirection]);

    const columns = useMemo(() => {
        if (widget.columns && widget.columns.length > 0) {
            return widget.columns;
        }

        if (dataSource && dataSource.schema) {
            return dataSource.schema.map(field => ({
                field: field.name,
                header: field.name,
                sortable: true
            }));
        }

        return [];
    }, [widget.columns, dataSource]);

    const pageSize = widget.pageSize || 10;
    const totalPages = Math.ceil(tableData.length / pageSize);
    const paginatedData = tableData.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const handleSort = (field: string) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const isFiltered = isWidgetFiltered(widget.id);

    if (!dataSource || tableData.length === 0) {
        let errorMsg = 'No data available';
        if (!dataSource) errorMsg = 'Select data source';
        else if (columns.length === 0) errorMsg = 'Configure columns';

        return (
            <BaseWidget widget={widget} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} isSelected={isSelected} onClick={onClick}>
                <EmptyChartState type="table" message={errorMsg} onClickDataTab={onClickDataTab} onClick={onClick} />
            </BaseWidget>
        );
    }

    const loadingProgress = useMemo(() => {
        if (!dataSource || !dataSource.totalRows || dataSource.totalRows === 0) return 0;
        return (dataSource.data?.length || 0) / dataSource.totalRows * 100;
    }, [dataSource]);

    return (
        <BaseWidget
            widget={widget}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            isSelected={isSelected}
            isFiltered={isWidgetFiltered(widget.id)}
            loading={dataSource?.isLoadingPartial}
            loadingProgress={loadingProgress}
            onClick={onClick}
        >
            <div className="flex flex-col h-full">
                {/* Table */}
                <div className="flex-1 overflow-auto">
                    <table
                        className="w-full text-xs"
                        style={{ fontSize: widget.fontSize ? `${widget.fontSize}px` : undefined }}
                    >
                        <thead className="sticky top-0 bg-slate-900 border-b border-white/10">
                            <tr>
                                {columns.map((col) => (
                                    <th
                                        key={col.field}
                                        className={`px-3 py-2 text-left font-bold text-slate-300 ${col.sortable !== false ? 'cursor-pointer hover:text-white' : ''}`}
                                        onClick={() => col.sortable !== false && handleSort(col.field)}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span>{col.header}</span>
                                            {sortField === col.field && (
                                                <i className={`fas fa-sort-${sortDirection === 'asc' ? 'up' : 'down'} text-[10px]`}></i>
                                            )}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedData.map((row, rowIndex) => (
                                <tr key={rowIndex} className="border-b border-white/5 hover:bg-white/5">
                                    {columns.map((col) => {
                                        const val = getFieldValue(row, col.field);
                                        return (
                                            <td key={col.field} className="px-3 py-2 text-slate-300">
                                                {formatBIValue(val, widget.valueFormat || 'standard')}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-3 py-2 border-t border-white/10 bg-slate-900/30">
                        <div className="text-[10px] text-slate-400">
                            Showing {((currentPage - 1) * pageSize + 1).toLocaleString()} to {Math.min(currentPage * pageSize, tableData.length).toLocaleString()} of {tableData.length.toLocaleString()}
                        </div>
                        <div className="flex gap-1">
                            <button
                                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                                disabled={currentPage === 1}
                                className="px-2 py-1 rounded text-[10px] bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <i className="fas fa-chevron-left"></i>
                            </button>
                            <span className="px-2 py-1 text-[10px] text-slate-400">
                                {currentPage} / {totalPages}
                            </span>
                            <button
                                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                                disabled={currentPage === totalPages}
                                className="px-2 py-1 rounded text-[10px] bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                <i className="fas fa-chevron-right"></i>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </BaseWidget>
    );
};

export default TableWidget;
