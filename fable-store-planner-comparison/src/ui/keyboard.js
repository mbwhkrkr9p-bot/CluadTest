// Hardware keyboard shortcuts. Ignored while a dialog is open, while the focus is in a form
// control or another keyboard-driven widget, and while a pointer gesture or colour scrub is open.

// Roles whose widget consumes arrow keys itself (the colour wheel canvas is role="slider").
const ARROW_WIDGET_ROLES = new Set(['slider', 'spinbutton', 'listbox', 'combobox', 'menu', 'menuitem', 'tree', 'grid']);

export function createKeyboard(studio, { palette, toasts, onEscape, getOpenDialog, input }) {
  /** Text entry: every editor shortcut steps aside. */
  function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  /** A focused widget that owns the arrow keys (but not the editor's other shortcuts). */
  function ownsArrowKeys(target) {
    const role = target && target.getAttribute ? target.getAttribute('role') : null;
    return !!role && ARROW_WIDGET_ROLES.has(role);
  }

  /** True while a drag, rotation or colour scrub is running: never mutate history behind it. */
  function isBusy() {
    return (input && input.isBusy()) || studio.isEditing();
  }

  function onKeyDown(e) {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const dialog = getOpenDialog ? getOpenDialog() : null;

    if (e.key === 'Escape') {
      if (dialog) return; // the dialog handles its own escape
      // Typing: leave the field, never touch the 3D selection.
      if (isTyping(e.target)) { if (e.target.blur) e.target.blur(); return; }
      e.preventDefault();
      if (palette.isPlacing()) { palette.cancel(); return; }
      if (studio.cancelReview()) return;
      if (onEscape && onEscape()) return;
      studio.stepBack();
      return;
    }
    if (dialog || isTyping(e.target)) return;
    if (isBusy()) return; // never mutate history mid-gesture

    if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); if (!studio.undo()) toasts.announce('Nothing to undo'); return; }
    if ((mod && key === 'z' && e.shiftKey) || (mod && key === 'y')) { e.preventDefault(); if (!studio.redo()) toasts.announce('Nothing to redo'); return; }
    if (mod && key === 'c') { e.preventDefault(); if (studio.copySelected()) toasts.announce('Copied'); return; }
    if (mod && key === 'v') {
      e.preventDefault();
      const placed = studio.paste();
      if (placed) toasts.announce('Pasted'); else if (!studio.hasClipboard()) toasts.announce('Nothing to paste');
      return;
    }
    if (mod && key === 'd') { e.preventDefault(); studio.duplicateSelected(); return; }
    if (mod) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (studio.getSelection().kind === 'entity') { e.preventDefault(); studio.removeSelected(); }
      return;
    }
    if (key === 'r') { e.preventDefault(); studio.cancelReview(); studio.home(true); return; }
    if (e.key === '[' || e.key === ']') {
      const sel = studio.getSelection();
      if (sel.kind !== 'entity') return;
      const ent = studio.getEntity(sel.id);
      if (!ent || ent.anchor !== 'floor') return;
      e.preventDefault();
      studio.rotateEntity(sel.id, (ent.rotation || 0) + (e.key === ']' ? 15 : -15));
      return;
    }
    if (e.key.startsWith('Arrow')) {
      if (ownsArrowKeys(e.target)) return; // the focused slider nudges itself
      const sel = studio.getSelection();
      if (sel.kind !== 'entity') return;
      const ent = studio.getEntity(sel.id);
      if (!ent) return;
      e.preventDefault();
      const step = e.shiftKey ? 1 : 0.5;
      if (ent.anchor === 'floor') {
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dz = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const pos = studio.resolveFloorPosition(ent, ent.position.x + dx, ent.position.z + dz);
        if (pos) studio.moveEntity(sel.id, pos);
      } else {
        const du = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dv = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
        studio.moveEntity(sel.id, { u: ent.position.u + du, v: ent.position.v + dv });
      }
    }
  }

  window.addEventListener('keydown', onKeyDown);
  return { dispose: () => window.removeEventListener('keydown', onKeyDown) };
}
