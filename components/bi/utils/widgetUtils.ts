import { BIWidget } from '../types';

/**
 * Automatically generates a meaningful title for a widget based on its configuration.
 */
export const getAutoTitle = (widget: BIWidget): string => {
    if (!widget) return 'New Chart';

    // 1. Pivot / Table
    if (widget.type === 'pivot' || widget.type === 'table') {
        const rows = widget.pivotRows?.[0];
        const vals = widget.pivotValues?.map(v => v.field).join(', ');
        if (vals && rows) return `${vals} by ${rows}`;
        if (vals) return `${vals} Summary`;
        return widget.type === 'pivot' ? 'Pivot Table' : 'Table';
    }

    // 2. Card
    if (widget.type === 'card') {
        const m = (widget as any).metric || (widget as any).measure || (widget as any).measures?.[0] || widget.yAxis?.[0];
        return m ? `${m}` : 'New Card';
    }

    // 3. Slicer
    if (widget.type === 'slicer') {
        return (widget as any).slicerField ? `${(widget as any).slicerField} Filter` : 'Slicer';
    }

    // 4. Charts (Bar, Line, Pie, etc.)
    const x = Array.isArray(widget.xAxis) ? widget.xAxis[0] : widget.xAxis;

    // Handle Y-Axis (can be strings or objects)
    let yFields: any[] = [];
    if (Array.isArray(widget.yAxis)) yFields = widget.yAxis;
    else if (widget.yAxis) yFields = [widget.yAxis];

    const yList = yFields.map((y: any) => {
        if (typeof y === 'string') return y;
        return y.field || '';
    }).filter(Boolean);
    const y = yList.join(' & ');

    const leg = widget.legend;
    const isPie = widget.chartType === 'pie' || widget.chartType === 'donut';

    if (y && x) {
        if (isPie) return `${y} by ${x}`;
        return leg ? `${y} by ${x} per ${leg}` : `${y} by ${x}`;
    }

    if (y) return `${y} Chart`;

    return 'New Chart';
};
