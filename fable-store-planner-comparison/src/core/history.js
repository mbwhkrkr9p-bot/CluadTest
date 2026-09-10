// Undo/redo stack of serialized workspace snapshots. Pure module.

/**
 * Entries are `{ label, before, after }` where before/after are serialized workspace strings.
 * `undo()`/`redo()` return the entry; the caller restores `entry.before` / `entry.after`.
 */
export function createHistory({ limit = 100 } = {}) {
  const max = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 100;
  let undoStack = [];
  let redoStack = [];

  const push = ({ label = '', before, after } = {}) => {
    if (typeof before !== 'string' || typeof after !== 'string') {
      throw new Error('History entries need serialized `before` and `after` strings');
    }
    const entry = { label: String(label), before, after };
    undoStack.push(entry);
    if (undoStack.length > max) undoStack = undoStack.slice(undoStack.length - max);
    redoStack = [];
    return entry;
  };

  const undo = () => {
    const entry = undoStack.pop();
    if (!entry) return null;
    redoStack.push(entry);
    return entry;
  };

  const redo = () => {
    const entry = redoStack.pop();
    if (!entry) return null;
    undoStack.push(entry);
    return entry;
  };

  const clear = () => {
    undoStack = [];
    redoStack = [];
  };

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    peekUndoLabel: () => (undoStack.length ? undoStack[undoStack.length - 1].label : null),
    peekRedoLabel: () => (redoStack.length ? redoStack[redoStack.length - 1].label : null),
    size: () => undoStack.length,
  };
}
