// 3D Store Studio — bootstrap. Restores the saved workspace (or the default store), creates the
// studio, wires the UI and exposes a small test hook on window.__studio.
import { createStudio } from './app/studio.js';
import { createPalette } from './app/palette.js';
import { createManipulator } from './app/manipulate.js';
import { createInput } from './app/input.js';
import { createToasts } from './ui/toasts.js';
import { createHeader } from './ui/header.js';
import { createBuildKit } from './ui/buildKit.js';
import { createDetails } from './ui/details.js';
import { createHud } from './ui/hud.js';
import { createFinishPanel } from './ui/finishPanel.js';
import { createFloorPlanDialog } from './ui/floorPlanDialog.js';
import { createNewSpaceDialog } from './ui/newSpaceDialog.js';
import { createPortraitNotice } from './ui/portrait.js';
import { createKeyboard } from './ui/keyboard.js';
import { loadWorkspace, clearWorkspace } from './core/persistence.js';
import { createWorkspace } from './core/state.js';
import { getDef } from './core/catalog.js';

function boot() {
  const $ = (id) => document.getElementById(id);
  const canvas = $('viewport');
  const labelsEl = $('labels');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- restore
  let workspace = null;
  try { workspace = loadWorkspace(); } catch { workspace = null; }
  if (!workspace) workspace = createWorkspace('store');

  const studio = createStudio({ canvas, labelsEl, workspace });
  const toasts = createToasts({ container: $('toasts'), announcer: $('announcer'), reducedMotion });

  // ---------------------------------------------------------------- interaction
  let buildKit = null;
  const palette = createPalette(studio, {
    canvas,
    ghostEl: $('drag-ghost'),
    ghostCanvas: $('drag-ghost-canvas'),
    ghostLabel: $('drag-ghost-label'),
    onStatus: (status) => { if (buildKit) buildKit.onPlacementStatus(status); if (!status.placing) toasts.clearHint(); },
  });
  const manipulator = createManipulator(studio);

  function onTap(hit, gestureType, e) {
    if (palette.isPlacing()) {
      const placed = palette.placeAt(e.clientX, e.clientY);
      if (!placed) toasts.show(palette.current() ? 'Tap a valid surface to place it.' : 'Nothing was placed there.', { kind: 'info', duration: 2000 });
      return;
    }
    if (hit.kind === 'entity') { studio.select({ kind: 'entity', id: hit.id }); return; }
    if (hit.kind === 'wall') { studio.select({ kind: 'wall', id: hit.wallId }); return; }
    if (hit.kind === 'floor') {
      studio.select({ kind: 'floor' }, { focus: false });
      if (hit.point) studio.focusPoint(hit.point.clone().setY(0.5));
      return;
    }
    studio.select({ kind: 'none' });
  }

  const input = createInput(studio, { canvas, manipulator, palette, onTap });

  // ---------------------------------------------------------------- UI
  const finishPanel = createFinishPanel(studio, { palette, toasts });
  const floorPlan = createFloorPlanDialog(studio, { toasts });
  const newSpace = createNewSpaceDialog(studio, { toasts });
  const header = createHeader(studio, {
    toasts,
    onFinishes: () => { if (studio.getMode() === 'finish') finishPanel.close(); else finishPanel.open(); },
    onFloorPlan: () => floorPlan.open(),
    onNewSpace: () => newSpace.open(),
  });
  buildKit = createBuildKit(studio, { palette, toasts });
  const details = createDetails(studio, { toasts, onFinishes: (tab) => finishPanel.open(tab), onFloorPlan: () => floorPlan.open() });
  const hud = createHud(studio, { toasts });
  const portrait = createPortraitNotice({ notice: $('portrait-notice'), continueBtn: $('portrait-continue') });
  createKeyboard(studio, {
    palette, toasts, input,
    getOpenDialog: () => (floorPlan.isOpen() ? 'floorplan' : newSpace.isOpen() ? 'newspace' : null),
    onEscape: () => {
      if (studio.getMode() === 'finish' && studio.getSelection().kind === 'none') { finishPanel.close(); return true; }
      return false;
    },
  });

  // history buttons
  const btnUndo = $('btn-undo');
  const btnRedo = $('btn-redo');
  function refreshHistory() {
    btnUndo.disabled = !studio.canUndo();
    btnRedo.disabled = !studio.canRedo();
    btnUndo.title = studio.canUndo() ? `Undo ${studio.undoLabel() || ''}`.trim() : 'Nothing to undo';
    btnRedo.title = studio.canRedo() ? `Redo ${studio.redoLabel() || ''}`.trim() : 'Nothing to redo';
  }
  btnUndo.addEventListener('click', () => { if (!input.isBusy()) studio.undo(); });
  btnRedo.addEventListener('click', () => { if (!input.isBusy()) studio.redo(); });
  studio.on('change', refreshHistory);
  studio.on('history', ({ action, label }) => toasts.announce(`${action === 'undo' ? 'Undid' : 'Redid'} ${label || 'edit'}`));
  refreshHistory();

  // ---------------------------------------------------------------- sizing
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    studio.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement || document.body);
  resize();

  // ---------------------------------------------------------------- persistence hooks
  window.addEventListener('beforeunload', () => studio.flushSave());
  document.addEventListener('visibilitychange', () => { if (document.hidden) studio.flushSave(); });

  // ---------------------------------------------------------------- test hook
  window.__studio = {
    studio, palette, manipulator, input, toasts, header, buildKit, details, hud, finishPanel, floorPlan, newSpace, portrait,
    getState: () => studio.getState(),
    getSelection: () => studio.getSelection(),
    select: (sel) => studio.select(sel),
    project: (x, y, z) => studio.project(x, y, z),
    pick: (x, y) => studio.picker.pick(x, y),
    place: (defId, x, z) => studio.placeFloorEntity(defId, x, z),
    placeOnWall: (defId, wallId, u, v) => studio.placeWallEntity(defId, wallId, u, v),
    undo: () => studio.undo(),
    redo: () => studio.redo(),
    collisions: () => studio.collisions(),
    game: () => studio.game(),
    flushSave: () => studio.flushSave(),
    clearSaved: () => clearWorkspace(),
    render: () => studio.requestRender(),
    camera: studio.camera,
    rig: studio.rig,
    getDef,
  };
  document.documentElement.classList.add('is-ready');
  studio.requestRender();
}

boot();
