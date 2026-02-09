import React from 'react';

/**
 * Custom tick renderer for hierarchical axes.
 * Expects a string with '\n' separators.
 * Dynamic: Only shows the parent label when it changes (or centered if possible).
 * Supports drawing separator lines for a table-like look.
 */
export const HierarchicalAxisTick = (props: any) => {
    const { x, y, payload, index, data } = props;
    if (!payload.value || !data) return null;

    const lines = String(payload.value).split('\n');
    const isExpandMode = lines.length > 1;

    // Helper to get labels for a specific index
    const getLabelsAt = (idx: number) => {
        if (idx < 0 || idx >= data.length) return [];
        const val = data[idx]._combinedAxis || data[idx]._formattedAxis || '';
        return String(val).split('\n');
    };

    // Find the range of the same label at a given level
    const getGroupRange = (level: number) => {
        const targetLabel = lines[level];
        if (!targetLabel) return null;

        let start = index;
        while (start > 0 && getLabelsAt(start - 1)[level] === targetLabel) {
            start--;
        }
        let end = index;
        while (end < data.length - 1 && getLabelsAt(end + 1)[level] === targetLabel) {
            end++;
        }
        return { start, end };
    };

    // Separator logic: show line if top parent changes
    let showSeparator = false;
    let tickWidth = 0;
    if (isExpandMode && index > 0) {
        tickWidth = x / index;
        const topLevel = lines.length - 1;
        const currentTop = lines[topLevel];
        const prevTop = getLabelsAt(index - 1)[topLevel];
        if (currentTop !== prevTop) {
            showSeparator = true;
        }
    }

    // Determine vertical positions based on total lines
    // Hierachy: [Leaf (0), Sub-Parent (1), Parent (2)]
    // In image: [Qtr, H1/H2, Year]

    return (
        <g transform={`translate(${x},${y})`}>
            {/* Vertical Separator Line */}
            {showSeparator && (
                <line
                    x1={-(tickWidth / 2)}
                    y1={-5}
                    x2={-(tickWidth / 2)}
                    y2={60}
                    stroke="rgba(255,255,255,0.15)"
                    strokeDasharray="4 2"
                />
            )}

            {/* Leaf Level: always shown */}
            <text
                x={0}
                y={15}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize={10}
                fontFamily="Outfit"
            >
                {lines[0]}
            </text>

            {/* Parent Levels: centered across their children */}
            {lines.slice(1).map((label, i) => {
                const level = i + 1;
                const range = getGroupRange(level);
                const mid = range ? Math.floor((range.start + range.end) / 2) : -1;

                if (index !== mid) return null;

                const isTopLevel = level === lines.length - 1;
                return (
                    <text
                        key={level}
                        x={0}
                        y={15 + level * 17}
                        textAnchor="middle"
                        fill={isTopLevel ? "#f1f5f9" : "#64748b"}
                        fontSize={isTopLevel ? 10 : 9}
                        fontWeight={isTopLevel ? "700" : "500"}
                        fontFamily="Outfit"
                    >
                        {lines[level]}
                    </text>
                );
            })}
        </g>
    );
};

