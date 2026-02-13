import { useEffect, useCallback } from 'react';
import { useDashboardStore } from '../store/dashboardStore';

interface KeyboardShortcutsProps {
    onSave?: () => void;
    onDelete?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onSelectAll?: () => void;
    onGroup?: () => void;
    onUngroup?: () => void;
    onDuplicate?: () => void;
    onCopy?: () => void;
    onPaste?: () => void;
    onCut?: () => void;
    onDeselect?: () => void;
    onEdit?: () => void;
    onMoveSelected?: (deltaX: number, deltaY: number) => void;
    onResizeSelected?: (deltaW: number, deltaH: number) => void;
    onCycleSelection?: (direction: 'next' | 'prev') => void;
}

export const useKeyboardShortcuts = ({
    onSave,
    onDelete,
    onUndo,
    onRedo,
    onSelectAll,
    onGroup,
    onUngroup,
    onDuplicate,
    onCopy,
    onPaste,
    onCut,
    onDeselect,
    onEdit,
    onMoveSelected,
    onResizeSelected,
    onCycleSelection
}: KeyboardShortcutsProps) => {
    const { activeDashboardId, editingWidgetId, selectedWidgetIds, undo, redo, canUndo, canRedo } = useDashboardStore();

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        // Ignore if typing in an input or textarea
        if (
            (event.target as HTMLElement).tagName === 'INPUT' ||
            (event.target as HTMLElement).tagName === 'TEXTAREA' ||
            (event.target as HTMLElement).isContentEditable
        ) {
            return;
        }

        const isCtrlOrCmd = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        // Save: Ctrl/Cmd + S
        if (isCtrlOrCmd && event.key.toLowerCase() === 's') {
            event.preventDefault();
            if (onSave) onSave();
            return;
        }

        // Undo: Ctrl/Cmd + Z
        if (isCtrlOrCmd && !isShift && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            if (onUndo) {
                onUndo();
            } else if (canUndo()) {
                undo();
            }
            return;
        }

        // Redo: Ctrl/Cmd + Shift + Z
        if (isCtrlOrCmd && isShift && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            if (onRedo) {
                onRedo();
            } else if (canRedo()) {
                redo();
            }
            return;
        }

        // Redo (Windows style): Ctrl/Cmd + Y
        if (isCtrlOrCmd && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            if (onRedo) {
                onRedo();
            } else if (canRedo()) {
                redo();
            }
            return;
        }

        // Copy: Ctrl/Cmd + C
        if (isCtrlOrCmd && event.key.toLowerCase() === 'c') {
            // Only copy if something is selected
            if (selectedWidgetIds.length > 0) {
                // Don't prevent default, we want to allow normal copy if needed, 
                // but usually we handle it ourselves
                if (onCopy) onCopy();
            }
            return;
        }

        // Paste: Ctrl/Cmd + V
        if (isCtrlOrCmd && event.key.toLowerCase() === 'v') {
            if (onPaste) {
                event.preventDefault();
                onPaste();
            }
            return;
        }

        // Cut: Ctrl/Cmd + X
        if (isCtrlOrCmd && event.key.toLowerCase() === 'x') {
            if (selectedWidgetIds.length > 0 || editingWidgetId) {
                event.preventDefault();
                if (onCut) onCut();
            }
            return;
        }

        // Delete / Backspace: delete selected widget(s)
        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (selectedWidgetIds.length > 0 || editingWidgetId) {
                event.preventDefault();
                if (onDelete) onDelete();
            }
            return;
        }

        // Select All: Ctrl/Cmd + A
        if (isCtrlOrCmd && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            if (onSelectAll) onSelectAll();
            return;
        }

        // Group: Ctrl/Cmd + G
        if (isCtrlOrCmd && !isShift && event.key.toLowerCase() === 'g') {
            event.preventDefault();
            if (onGroup) onGroup();
            return;
        }

        // Ungroup: Ctrl/Cmd + Shift + G
        if (isCtrlOrCmd && isShift && event.key.toLowerCase() === 'g') {
            event.preventDefault();
            if (onUngroup) onUngroup();
            return;
        }

        // Duplicate: Ctrl/Cmd + D
        if (isCtrlOrCmd && !isShift && event.key.toLowerCase() === 'd') {
            event.preventDefault();
            if (onDuplicate) onDuplicate();
            return;
        }

        // Duplicate Alternative: Ctrl/Cmd + Shift + D
        if (isCtrlOrCmd && isShift && event.key.toLowerCase() === 'd') {
            event.preventDefault();
            if (onDuplicate) onDuplicate();
            return;
        }

        // Edit selected: Enter or Ctrl/Cmd + E
        if (event.key === 'Enter' || (isCtrlOrCmd && event.key.toLowerCase() === 'e')) {
            if (selectedWidgetIds.length > 0 || editingWidgetId) {
                event.preventDefault();
                onEdit?.();
            }
            return;
        }

        // Cycle selection: Tab / Shift+Tab
        if (event.key === 'Tab') {
            if (onCycleSelection) {
                event.preventDefault();
                onCycleSelection(isShift ? 'prev' : 'next');
            }
            return;
        }

        // Move / Resize with arrows
        if (event.key.startsWith('Arrow')) {
            if (selectedWidgetIds.length === 0 && !editingWidgetId) return;

            const moveStep = isShift ? 5 : 1;
            const resizeStep = isShift ? 2 : 1;
            const isResize = event.altKey;
            event.preventDefault();

            const keyMap: Record<string, [number, number]> = {
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0]
            };

            const [dx, dy] = keyMap[event.key] || [0, 0];
            if (dx === 0 && dy === 0) return;

            if (isResize) {
                onResizeSelected?.(dx * resizeStep, dy * resizeStep);
            } else {
                onMoveSelected?.(dx * moveStep, dy * moveStep);
            }
            return;
        }

        // Deselect: Escape
        if (event.key === 'Escape') {
            if (onDeselect) onDeselect();
            return;
        }

    }, [
        activeDashboardId,
        editingWidgetId,
        selectedWidgetIds,
        onSave,
        onDelete,
        onUndo,
        onRedo,
        onSelectAll,
        onGroup,
        onUngroup,
        onDuplicate,
        onCopy,
        onPaste,
        onCut,
        onDeselect,
        onEdit,
        onMoveSelected,
        onResizeSelected,
        onCycleSelection,
        undo,
        redo,
        canUndo,
        canRedo
    ]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [handleKeyDown]);
};
