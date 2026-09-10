// Pointer / wheel dispatcher for the 3D viewport. Unifies mouse, trackpad, touch and pen input
// (Pointer Events) and decides between object manipulation and camera gestures.
//   one pointer on empty space or a surface  -> orbit        one pointer on a fixture -> drag it
//   two pointers                            -> pan + pinch   right / middle / shift-drag -> pan
//   wheel                                   -> zoom          tap -> select / place
const TAP_SLOP = 5; // px
const DRAG_START = 4; // px

export function createInput(studio, { canvas, manipulator, palette, onTap }) {
  const { rig, picker } = studio;
  const pointers = new Map();
  let gesture = null; // { type, pointerId, hit, session, ... }

  function entityFilter() {
    const mode = studio.getMode();
    return (entity) => (mode === 'finish' ? entity.type === 'door' || entity.type === 'window' : true);
  }

  function pickAt(x, y) {
    return picker.pick(x, y, { entityFilter: entityFilter() });
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function viewportHeight() { return canvas.clientHeight || 1; }

  function setCursor(c) { if (canvas.style.cursor !== c) canvas.style.cursor = c; }

  // ------------------------------------------------------------------ pointer down
  function onPointerDown(e) {
    if (e.target !== canvas) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    canvas.focus?.({ preventScroll: true });
    studio.cancelReview();
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, type: e.pointerType, button: e.button, time: performance.now() };
    pointers.set(e.pointerId, p);

    if (pointers.size === 1) {
      if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) {
        gesture = { type: 'pan', pointerId: e.pointerId };
        setCursor('grabbing');
        return;
      }
      const hit = pickAt(e.clientX, e.clientY);
      const withClient = { ...hit, clientX: e.clientX, clientY: e.clientY };
      if (palette.isPlacing()) {
        gesture = { type: 'pending-place', pointerId: e.pointerId, hit: withClient };
        return;
      }
      if (hit.kind === 'rotate-handle' && studio.getSelection().kind === 'entity') {
        const session = manipulator.startRotate(studio.getSelection().id, e.clientX, e.clientY);
        gesture = session ? { type: 'rotate', pointerId: e.pointerId, session } : { type: 'pending-orbit', pointerId: e.pointerId, hit: withClient };
        return;
      }
      if (hit.kind === 'entity' && manipulator.canDrag(hit.id)) {
        gesture = { type: 'pending-drag', pointerId: e.pointerId, hit: withClient };
        return;
      }
      gesture = { type: 'pending-orbit', pointerId: e.pointerId, hit: withClient };
      return;
    }

    if (pointers.size === 2) {
      if (gesture && (gesture.type === 'drag' || gesture.type === 'rotate')) return; // keep manipulating with the first finger
      const [a, b] = [...pointers.values()];
      gesture = {
        type: 'pinch',
        ids: [a.id, b.id],
        lastDist: dist(a, b),
        lastCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      setCursor('grabbing');
    }
  }

  // ------------------------------------------------------------------ pointer move
  function onPointerMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) {
      // hover (mouse / pen without buttons)
      if (e.pointerType === 'touch') return;
      if (palette.isPlacing()) { palette.updateGhost(e.clientX, e.clientY); return; }
      if (pointers.size > 0) return;
      const hit = pickAt(e.clientX, e.clientY);
      studio.setHover(hit);
      if (hit.kind === 'rotate-handle') setCursor('ew-resize');
      else if (hit.kind === 'entity') setCursor(manipulator.canDrag(hit.id) ? 'move' : 'pointer');
      else if (hit.kind === 'floor' || hit.kind === 'wall') setCursor('pointer');
      else setCursor('grab');
      return;
    }
    const prev = { x: p.x, y: p.y };
    p.x = e.clientX; p.y = e.clientY;
    if (!gesture) return;

    switch (gesture.type) {
      case 'pending-drag': {
        if (dist(p, { x: p.startX, y: p.startY }) < DRAG_START) return;
        const session = manipulator.startDrag(gesture.hit.id, gesture.hit);
        if (session) {
          studio.select({ kind: 'entity', id: gesture.hit.id }, { focus: false });
          gesture = { type: 'drag', pointerId: p.id, session };
          session.move(p.x, p.y);
          setCursor('grabbing');
        } else {
          gesture = { type: 'orbit', pointerId: p.id };
        }
        return;
      }
      case 'pending-orbit':
      case 'pending-place': {
        if (dist(p, { x: p.startX, y: p.startY }) < DRAG_START) return;
        gesture = { type: 'orbit', pointerId: p.id };
        setCursor('grabbing');
        return;
      }
      case 'drag':
      case 'rotate': {
        if (gesture.pointerId !== p.id) return;
        gesture.session.move(p.x, p.y);
        return;
      }
      case 'orbit': {
        if (gesture.pointerId !== p.id) return;
        const dx = p.x - prev.x, dy = p.y - prev.y;
        rig.orbit(-dx * 0.0055, -dy * 0.0055);
        studio.requestRender();
        return;
      }
      case 'pan': {
        if (gesture.pointerId !== p.id) return;
        rig.pan(p.x - prev.x, p.y - prev.y, viewportHeight());
        studio.requestRender();
        return;
      }
      case 'pinch': {
        const a = pointers.get(gesture.ids[0]);
        const b = pointers.get(gesture.ids[1]);
        if (!a || !b) return;
        const d = dist(a, b);
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (gesture.lastDist > 0 && d > 0) rig.zoom(gesture.lastDist / d);
        rig.pan(center.x - gesture.lastCenter.x, center.y - gesture.lastCenter.y, viewportHeight());
        gesture.lastDist = d;
        gesture.lastCenter = center;
        studio.requestRender();
        return;
      }
      default:
    }
  }

  // ------------------------------------------------------------------ pointer up / cancel
  function onPointerUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const tapped = dist({ x: e.clientX, y: e.clientY }, { x: p.startX, y: p.startY }) <= TAP_SLOP;
    const g = gesture;

    if (g && (g.type === 'drag' || g.type === 'rotate') && g.pointerId === p.id) {
      // interrupted or finished: keep the last valid placement either way
      g.session.end();
      gesture = pointers.size ? { type: 'dead' } : null;
      setCursor('grab');
      return;
    }
    if (g && g.type === 'pinch') {
      gesture = pointers.size ? { type: 'dead' } : null;
      setCursor('grab');
      return;
    }
    if (g && (g.type === 'pending-place' || g.type === 'pending-drag' || g.type === 'pending-orbit') && g.pointerId === p.id) {
      if (tapped && e.type !== 'pointercancel') onTap(g.hit, g.type, e);
    }
    if (pointers.size === 0) gesture = null;
    else if (g && g.type === 'orbit') gesture = { type: 'dead' };
    setCursor('grab');
  }

  function onWheel(e) {
    e.preventDefault();
    studio.cancelReview();
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16; else if (e.deltaMode === 2) delta *= 400;
    if (e.ctrlKey) delta *= 3; // trackpad pinch gesture arrives as ctrl+wheel
    rig.dolly(delta);
    studio.requestRender();
  }

  function onContextMenu(e) { e.preventDefault(); }

  function onLostCapture() {
    // Pointer capture interrupted (e.g. system gesture): finish any manipulation at its last valid state.
    if (gesture && (gesture.type === 'drag' || gesture.type === 'rotate')) {
      gesture.session.end();
      gesture = null;
      pointers.clear();
      setCursor('grab');
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', (e) => { if (!pointers.has(e.pointerId)) return; onLostCapture(); });
  canvas.addEventListener('pointerleave', () => { if (pointers.size === 0) studio.setHover(null); });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('blur', () => { if (gesture && gesture.session) gesture.session.end(); gesture = null; pointers.clear(); });
  setCursor('grab');

  return {
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
    isBusy: () => !!gesture && gesture.type !== 'dead',
  };
}
