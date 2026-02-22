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
    '#1f4fd6', // Cobalt blue
    '#0f766e', // Deep teal
    '#0ea5e9', // Sky blue
    '#d97706', // Amber
    '#be123c', // Ruby
    '#6d28d9', // Royal violet
    '#2563eb', // Sapphire
    '#059669', // Emerald
    '#9333ea', // Purple
    '#475569', // Slate
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
    '#1f4fd6', // Cobalt blue
    '#0f766e', // Deep teal
    '#0ea5e9', // Sky blue
    '#d97706', // Amber
    '#be123c', // Ruby
    '#6d28d9', // Royal violet
    '#2563eb', // Sapphire
    '#059669', // Emerald
    '#9333ea', // Purple
    '#475569', // Slate
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
