// ============================================
// Chart Color Palette Constants
// ============================================

import { useThemeStore } from '../../../store/themeStore';

// Dark Mode Palette (Standard / Original)
export const CHART_COLORS_DARK = [
    '#6366f1', // Indigo 500 (Brighter for dark bg)
    '#facc15', // Yellow 400
    '#34d399', // Emerald 400
    '#fb7185', // Rose 400
    '#22d3ee', // Cyan 400
    '#a78bfa', // Violet 400
    '#fb923c', // Orange 400
    '#a3e635', // Lime 400
    '#e879f9', // Fuchsia 400
    '#94a3b8', // Slate 400
];

// Light Mode Palette (Modern SaaS - Refined and Vibrant)
export const CHART_COLORS_LIGHT = [
    '#6366f1', // Indigo 500 (Clean indigo)
    '#0ea5e9', // Sky 500 (Fresh blue)
    '#10b981', // Emerald 500 (Vibrant green)
    '#f43f5e', // Rose 500 (Modern pink/red)
    '#f59e0b', // Amber 500 (Warm orange)
    '#8b5cf6', // Violet 500 (Rich purple)
    '#06b6d4', // Cyan 500 (Tech cyan)
    '#ec4899', // Pink 500
    '#84cc16', // Lime 500
    '#64748b', // Slate 500
];

// Fallback for non-hook usage (defaulting to Dark to match original)
export const CHART_COLORS = CHART_COLORS_DARK;


// Dark Mode Pie Palette
export const PIE_PALETTE_DARK = [
    '#6366f1', // Indigo 500
    '#34d399', // Emerald 400
    '#facc15', // Yellow 400
    '#22d3ee', // Cyan 400
    '#fb7185', // Rose 400
    '#a78bfa', // Violet 400
    '#fb923c', // Orange 400
    '#38bdf8', // Sky 400
    '#e879f9', // Fuchsia 400
    '#a3e635', // Lime 400
];

// Light Mode Pie Palette (Vibrant and Professional)
export const PIE_PALETTE_LIGHT = [
    '#6366f1', // Indigo 500
    '#10b981', // Emerald 500
    '#0ea5e9', // Sky 500
    '#f59e0b', // Amber 500
    '#f43f5e', // Rose 500
    '#8b5cf6', // Violet 500
    '#ec4899', // Pink 500
    '#06b6d4', // Cyan 500
    '#84cc16', // Lime 500
    '#f97316', // Orange 500
];

export const PIE_PALETTE = PIE_PALETTE_DARK;


export const SEQUENTIAL_PALETTE = [
    '#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a'
];

/**
 * Returns a color for a given index, cycling through the palette if needed.
 */
export const getColor = (index: number, palette: string[] = CHART_COLORS): string => {
    return palette[index % palette.length];
};

export const useChartColors = () => {
    const { theme } = useThemeStore();
    return {
        chartColors: theme === 'dark' ? CHART_COLORS_DARK : CHART_COLORS_LIGHT,
        piePalette: theme === 'dark' ? PIE_PALETTE_DARK : PIE_PALETTE_LIGHT,
        isDark: theme === 'dark'
    };
};
