import React from 'react';

/**
 * Custom tick renderer for hierarchical axes.
 * Expects a string with '\n' separators.
 * Dynamic: Only shows the parent label when it changes (or centered if possible).
 * Supports drawing separator lines for a table-like look.
 */
export const HierarchicalAxisTick = (props: any) => {
    const { x, y, payload, index, data, fontFamily = 'Outfit' } = props;
    if (!payload.value || !data) return null;

    const lines = String(payload.value).split('\n');
    const isExpandMode = lines.length > 1;
    const dataLength = Array.isArray(data) ? data.length : 0;

    // Reduce visual density for very long hierarchical axes.
    const leafStep =
        dataLength > 180 ? 16 :
            dataLength > 120 ? 12 :
                dataLength > 80 ? 8 :
                    dataLength > 50 ? 6 :
                        dataLength > 30 ? 4 :
                            dataLength > 18 ? 2 : 1;

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

    const isBoundaryAtLevel = (level: number) => {
        const prev = getLabelsAt(index - 1)[level];
        const curr = lines[level];
        const next = getLabelsAt(index + 1)[level];
        return curr !== prev || curr !== next;
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

    const leafY = 14;
    const levelStep = 14;
    const separatorBottom = leafY + Math.max(1, lines.length - 1) * levelStep + 10;
    const shouldRenderLeaf =
        leafStep === 1 ||
        index === 0 ||
        index === dataLength - 1 ||
        index % leafStep === 0 ||
        isBoundaryAtLevel(0);

    const parentLevels = Math.max(0, lines.length - 1);
    const visibleParentLevels =
        dataLength > 120 ? Math.min(1, parentLevels) :
            dataLength > 70 ? Math.min(2, parentLevels) :
                parentLevels;

    return (
        <g transform={`translate(${x},${y})`}>
            {/* Vertical Separator Line */}
            {showSeparator && (
                <line
                    x1={-(tickWidth / 2)}
                    y1={-5}
                    x2={-(tickWidth / 2)}
                    y2={separatorBottom}
                    stroke="rgba(255,255,255,0.15)"
                    strokeDasharray="4 2"
                />
            )}

            {/* Leaf Level: always shown */}
            {shouldRenderLeaf && (
                <text
                    x={0}
                    y={leafY}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize={10}
                    fontFamily={fontFamily}
                >
                    {lines[0]}
                </text>
            )}

            {/* Parent Levels: centered across their children */}
            {lines.slice(1).map((label, i) => {
                const level = i + 1;
                const keepFromLevel = lines.length - visibleParentLevels;
                if (level < keepFromLevel) return null;

                const range = getGroupRange(level);
                const mid = range ? Math.floor((range.start + range.end) / 2) : -1;
                const groupSize = range ? (range.end - range.start + 1) : 1;
                const minGroupToRender = dataLength > 30 ? Math.max(2, Math.floor(leafStep / 2)) : 1;

                if (index !== mid || groupSize < minGroupToRender) return null;

                const isTopLevel = level === lines.length - 1;
                return (
                    <text
                        key={level}
                        x={0}
                        y={leafY + level * levelStep}
                        textAnchor="middle"
                        fill={isTopLevel ? "#f1f5f9" : "#64748b"}
                        fontSize={isTopLevel ? 10 : 9}
                        fontWeight={isTopLevel ? "700" : "500"}
                        fontFamily={fontFamily}
                    >
                        {lines[level]}
                    </text>
                );
            })}
        </g>
    );
};
