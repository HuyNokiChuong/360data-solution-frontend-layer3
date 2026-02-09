import { BIWidget } from '../types';

/**
 * Automatically generates a meaningful title for a widget based on its configuration.
 */
export const getAutoTitle = (widget: BIWidget): string => {
    if (!widget) return 'New Chart';

    // 1. Pivot / Table
    if (widget.type === 'pivot' || widget.type === 'table') {
        const rows = widget.pivotRows?.join(', ') || '';
        const vals = widget.pivotValues?.map(v => v.field).join(', ') || '';

        if (vals && rows) return `${vals} by ${rows}`;
        if (vals) return `${vals} Summary`;
        if (rows) return `${rows} Breakdown`;
        return widget.type === 'pivot' ? 'Pivot Table' : 'Table';
    }

    // 2. Card
    if (widget.type === 'card' || widget.type === 'gauge') {
        const m = widget.yAxis?.[0] || (widget as any).metric || (widget as any).measure || (widget as any).measures?.[0];
        const fieldName = typeof m === 'object' ? (m.field || m.label) : m;
        return fieldName ? `${fieldName}` : (widget.type === 'card' ? 'New Card' : 'Gauge');
    }

    // 3. Filters
    if (widget.type === 'slicer' || widget.type === 'date-range' || widget.type === 'search') {
        const field = widget.slicerField || (widget as any).field;
        if (widget.type === 'date-range') return field ? `${field} Period` : 'Date Range';
        if (widget.type === 'search') return field ? `Search ${field}` : 'Search';
        return field ? `${field} Filter` : 'Filter';
    }

    // 4. Charts (Bar, Line, Pie, etc.)
    const xRaw = Array.isArray(widget.xAxis) ? widget.xAxis[0] : widget.xAxis;
    const x = typeof xRaw === 'object' ? (xRaw.field || xRaw.label) : xRaw;

    // Handle Y-Axis (can be strings or objects)
    let yFields: any[] = [];
    if (Array.isArray(widget.yAxis)) yFields = widget.yAxis;
    else if (widget.yAxis) yFields = [widget.yAxis];

    const yList = yFields.map((y: any) => {
        if (typeof y === 'string') return y;
        return y.field || y.label || '';
    }).filter(Boolean);
    const y = yList.join(' & ');

    const leg = widget.legend;
    const isPie = widget.chartType === 'pie' || widget.chartType === 'donut';

    if (y && x) {
        if (isPie) return `${y} by ${x}`;
        return leg ? `${y} by ${x} per ${leg}` : `${y} by ${x}`;
    }

    if (y) return `${y} Chart`;
    if (x) return `${x} Analysis`;

    // Generic fallbacks based on chart type if no fields yet
    if (widget.chartType === 'bar' || widget.chartType === 'stackedBar') return 'Bar Chart';
    if (widget.chartType === 'line') return 'Line Chart';
    if (widget.chartType === 'pie') return 'Pie Chart';

    return 'New Chart';
};
