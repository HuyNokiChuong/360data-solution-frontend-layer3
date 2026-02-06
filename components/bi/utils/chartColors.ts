// ============================================
// Chart Color Palette Constants
// ============================================

export const CHART_COLORS = [
    '#4f46e5', // Indigo
    '#f59e0b', // Amber
    '#10b981', // Emerald
    '#e11d48', // Rose
    '#06b6d4', // Cyan
    '#8b5cf6', // Violet
    '#f97316', // Orange
    '#84cc16', // Lime
    '#d946ef', // Fuchsia
    '#64748b', // Slate
    '#2563eb', // Blue
    '#db2777', // Pink
    '#059669', // Emerald Deep
    '#ea580c', // Orange Deep
    '#7c3AED', // Violet Deep
    '#0891b2', // Cyan Deep
    '#be185d', // Rose Deep
    '#a855f7', // Purple
    '#14b8a6', // Teal
    '#facc15'  // Yellow
];

export const PIE_PALETTE = [
    '#4f46e5', // Indigo
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#06b6d4', // Cyan
    '#e11d48', // Rose
    '#8b5cf6', // Violet
    '#f97316', // Orange
    '#0ea5e9', // Sky
    '#d946ef', // Fuchsia
    '#84cc16', // Lime
    '#6366f1', // Indigo Light
    '#2dd4bf', // Teal
    '#fb923c', // Orange light
    '#38bdf8', // Sky light
    '#ec4899', // Pink
    '#14b8a6', // Teal dark
    '#facc15', // Yellow
    '#4ade80', // Green light
    '#f472b6', // Pink light
    '#c084fc'  // Purple light
];

export const SEQUENTIAL_PALETTE = [
    '#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a'
];

/**
 * Returns a color for a given index, cycling through the palette if needed.
 */
export const getColor = (index: number, palette: string[] = CHART_COLORS): string => {
    return palette[index % palette.length];
};
