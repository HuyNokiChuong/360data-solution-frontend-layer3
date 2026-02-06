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
    onDeselect?: () => void;
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
    onDeselect
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
        if (isCtrlOrCmd && event.key.toLowerCase() === 'd') {
            event.preventDefault();
            if (onDuplicate) onDuplicate();
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
        onDeselect,
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
