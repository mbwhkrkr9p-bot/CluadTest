// Finish Design mode: floors, walls (with custom colours), windows and door styles.
import { FLOOR_PRESETS, WALL_PRESETS, drawFloorSwatch, drawWallSwatch } from '../render/materials.js';
import { DOOR_STYLES, WINDOW_STYLES } from '../core/catalog.js';
import { drawDoorPreview, drawWindowPreview } from '../render/previews.js';
import { createColorWheel, hexToHsv } from './colorWheel.js';

const TABS = [
  { id: 'floors', label: 'Floors' },
  { id: 'walls', label: 'Walls' },
  { id: 'windows', label: 'Windows' },
  { id: 'doors', label: 'Doors' },
];

const HUE_RANGES = [
  [12, 'Red'], [26, 'Rust'], [36, 'Orange'], [54, 'Amber'], [68, 'Yellow'], [85, 'Lime'], [150, 'Green'], [175, 'Teal'],
  [195, 'Cyan'], [205, 'Sky'], [250, 'Blue'], [270, 'Indigo'], [290, 'Violet'], [320, 'Magenta'], [348, 'Rose'], [360, 'Red'],
];
/** Human-friendly name for a hex colour, used for the recent custom colour cards. */
export function nameForColor(hex) {
  const { h, s, v } = hexToHsv(hex);
  if (s < 0.18 || v < 0.16) {
    if (v > 0.85) return 'Soft white';
    if (v > 0.55) return 'Warm grey';
    if (v > 0.3) return 'Slate grey';
    return 'Charcoal';
  }
  let name = (HUE_RANGES.find(([limit]) => h < limit) || HUE_RANGES[HUE_RANGES.length - 1])[1];
  if (h >= 12 && h < 48 && v < 0.6) name = 'Brown'; // dark oranges read as browns
  const tone = v < 0.4 ? 'Deep ' : s < 0.4 ? 'Muted ' : v > 0.85 && s < 0.55 ? 'Light ' : '';
  return `${tone}${name}`;
}

export function createFinishPanel(studio, { palette, toasts }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('finish-panel');
  const tabsEl = $('finish-tabs');
  const bodyEl = $('finish-body');
  const doneBtn = $('finish-done');
  let tab = 'floors';
  let wallTarget = 'all'; // 'all' | 'selected'
  let doorTarget = 'selected'; // 'selected' | 'all'
  let wheel = null;
  let scrubBefore = null;
  let previewRaf = 0;

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', t.id === tab ? 'true' : 'false');
      b.textContent = t.label;
      b.addEventListener('click', () => { tab = t.id; renderTabs(); renderBody(); });
      tabsEl.appendChild(b);
    }
  }

  function swatch(name, selected, paint, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `swatch${selected ? ' is-selected' : ''}`;
    b.setAttribute('aria-pressed', selected ? 'true' : 'false');
    const c = document.createElement('canvas');
    c.className = 'swatch__preview';
    c.width = 72; c.height = 72;
    paint(c);
    const label = document.createElement('span');
    label.className = 'swatch__name';
    label.textContent = name;
    b.append(c, label);
    b.addEventListener('click', onClick);
    return b;
  }

  function grid() { const g = document.createElement('div'); g.className = 'swatch-grid'; return g; }
  function heading(text) { const h = document.createElement('h3'); h.className = 'details__section'; h.textContent = text; return h; }
  function note(text) { const p = document.createElement('p'); p.className = 'details__text'; p.textContent = text; return p; }

  let suppressRefresh = false;
  /** A scrub interrupted by a re-render (Escape, tab change, mode exit) still becomes exactly one undo entry. */
  function finishPendingScrub() {
    if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = 0; }
    if (!scrubBefore) return;
    const before = scrubBefore;
    scrubBefore = null;
    suppressRefresh = true;
    try { studio.endEdit('Change colour', before); } finally { suppressRefresh = false; }
  }
  function destroyWheel() { finishPendingScrub(); if (wheel) { wheel.destroy(); wheel = null; } }

  function schedulePreview(fn) {
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => { previewRaf = 0; fn(); });
  }

  // ------------------------------------------------------------------ floors
  function renderFloors(ws) {
    const current = ws.finishes.floor;
    bodyEl.append(heading('Floor finish'));
    const g = grid();
    for (const p of FLOOR_PRESETS) {
      g.appendChild(swatch(p.name, current.preset === p.id, (c) => drawFloorSwatch(c, p.id, current.color), () => {
        studio.setFloorFinish(p.id, current.color);
      }));
    }
    bodyEl.append(g);
    if (current.preset === 'custom-carpet') {
      bodyEl.append(heading('Custom carpet colour'));
      const host = document.createElement('div');
      host.className = 'color-wheel-host';
      wheel = createColorWheel({
        size: 170, color: current.color || '#8a7a66', label: 'Custom carpet colour',
        onInput: (hex) => {
          if (!scrubBefore) scrubBefore = studio.beginEdit();
          schedulePreview(() => studio.previewFloorFinish('custom-carpet', hex));
        },
        onChange: (hex) => {
          if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = 0; }
          studio.previewFloorFinish('custom-carpet', hex);
          if (scrubBefore) { studio.endEdit('Change floor colour', scrubBefore); scrubBefore = null; } else studio.setFloorFinish('custom-carpet', hex);
        },
      });
      host.appendChild(wheel.element);
      bodyEl.append(host);
    }
  }

  // ------------------------------------------------------------------ walls
  function renderWalls(ws) {
    const sel = studio.getSelection();
    const selectedWall = sel.kind === 'wall' ? sel.id : null;
    if (!selectedWall) wallTarget = 'all';
    bodyEl.append(heading('Apply to'));
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Apply wall finish to');
    const mk = (id, label, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.disabled = disabled;
      b.setAttribute('aria-pressed', wallTarget === id ? 'true' : 'false');
      b.addEventListener('click', () => { wallTarget = id; renderBody(); });
      return b;
    };
    seg.append(mk('selected', selectedWall ? studio.wallLabel(selectedWall) : 'Selected wall', !selectedWall), mk('all', 'All walls', false));
    bodyEl.append(seg);
    if (!selectedWall) bodyEl.append(note('Tap a wall in the room to style just that wall.'));
    const target = wallTarget === 'selected' && selectedWall ? selectedWall : 'all';
    const current = target === 'all' ? ws.finishes.wallDefault : studio.wallFinishFor(target);

    bodyEl.append(heading('Wall finish'));
    const g = grid();
    for (const p of WALL_PRESETS) {
      g.appendChild(swatch(p.name, current.preset === p.id, (c) => drawWallSwatch(c, p.id, current.color), () => {
        studio.setWallFinish(target, p.id, current.color);
      }));
    }
    bodyEl.append(g);

    if (current.preset === 'custom') {
      bodyEl.append(heading('Custom wall colour'));
      const host = document.createElement('div');
      host.className = 'color-wheel-host';
      wheel = createColorWheel({
        size: 170, color: current.color || '#b9613a', label: 'Custom wall colour',
        onInput: (hex) => {
          if (!scrubBefore) scrubBefore = studio.beginEdit();
          schedulePreview(() => studio.previewWallFinish(target, 'custom', hex));
        },
        onChange: (hex) => {
          if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = 0; }
          studio.previewWallFinish(target, 'custom', hex);
          if (scrubBefore) { studio.endEdit('Change wall colour', scrubBefore); scrubBefore = null; } else studio.setWallFinish(target, 'custom', hex);
          studio.rememberCustomColor(hex);
          renderRecent();
        },
      });
      host.appendChild(wheel.element);
      bodyEl.append(host);
    }
    const recentHost = document.createElement('div');
    recentHost.className = 'recent-colors-host';
    bodyEl.append(recentHost);
    function renderRecent() {
      const colors = studio.getState().customColors || [];
      recentHost.innerHTML = '';
      if (!colors.length) return;
      recentHost.append(heading('Recent custom colours'));
      const row = document.createElement('div');
      row.className = 'recent-colors';
      colors.forEach((hex, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `recent-color${current.preset === 'custom' && current.color === hex ? ' is-selected' : ''}`;
        b.setAttribute('aria-label', `${nameForColor(hex)} ${hex}`);
        b.title = hex;
        const chip = document.createElement('span');
        chip.className = 'recent-color__chip';
        chip.style.background = hex;
        const name = document.createElement('span');
        name.className = 'recent-color__name';
        name.textContent = `${nameForColor(hex)}`;
        b.append(chip, name);
        b.addEventListener('click', () => { studio.setWallFinish(target, 'custom', hex); });
        row.appendChild(b);
      });
      recentHost.append(row);
    }
    renderRecent();
  }

  // ------------------------------------------------------------------ windows
  function renderWindows(ws) {
    const sel = studio.getSelection();
    const selectedWall = sel.kind === 'wall' ? sel.id : sel.kind === 'entity' ? studio.getEntity(sel.id)?.parent : null;
    bodyEl.append(heading('Add a window'));
    bodyEl.append(note(selectedWall ? `Tap a style to add it to ${studio.wallLabel(selectedWall)}, or drag it onto any wall.` : 'Select a wall first, or drag a style onto a wall.'));
    const g = grid();
    for (const s of WINDOW_STYLES) {
      const b = swatch(s.name, false, (c) => drawWindowPreview(c.getContext('2d'), s.id, c.width, c.height), () => {
        if (selectedWall) {
          const placed = studio.addWindow(s.id, selectedWall);
          if (!placed) toasts.show('That window does not fit on this wall.', { kind: 'warning' });
        } else {
          palette.begin('window', 'tap', { windowStyle: s.id });
          toasts.hint(`Tap a wall to place the ${s.name} · Esc to cancel`);
        }
      });
      b.classList.add('swatch--wide');
      b.setAttribute('aria-label', `${s.name}: ${s.width} by ${s.height} feet. ${s.description}`);
      wireSwatchDrag(b, () => palette.begin('window', 'drag', { windowStyle: s.id }));
      g.appendChild(b);
    }
    bodyEl.append(g);
    const windows = ws.entities.filter((e) => e.type === 'window');
    if (windows.length) {
      bodyEl.append(heading(`Windows in this space (${windows.length})`));
      const list = document.createElement('div');
      list.className = 'chip-list';
      for (const w of windows) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `chip${sel.kind === 'entity' && sel.id === w.id ? ' is-selected' : ''}`;
        chip.textContent = `${WINDOW_STYLES.find((s) => s.id === w.meta?.style)?.name || 'Window'} · ${studio.wallLabel(w.parent)}`;
        chip.addEventListener('click', () => studio.select({ kind: 'entity', id: w.id }));
        list.appendChild(chip);
      }
      bodyEl.append(list);
      bodyEl.append(note('Select a window to drag it along its wall, resize it, duplicate it or remove it.'));
    }
  }

  function wireSwatchDrag(el, onStart) {
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, started: false };
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.started) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
        drag.started = true;
        onStart();
      }
      palette.updateGhost(e.clientX, e.clientY);
    });
    const finish = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag; drag = null;
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (d.started) {
        el.dataset.skipUntil = String(performance.now() + 400);
        if (e.type === 'pointercancel') palette.cancel();
        else if (!palette.placeAt(e.clientX, e.clientY)) toasts.show('Drop it on a wall to place it.', { kind: 'info', duration: 2200 });
      }
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('click', (e) => {
      const skip = Number(el.dataset.skipUntil || 0) > performance.now();
      delete el.dataset.skipUntil;
      if (skip) e.stopImmediatePropagation();
    }, true);
  }

  // ------------------------------------------------------------------ doors
  function renderDoors(ws) {
    const doors = ws.entities.filter((e) => e.type === 'door');
    const sel = studio.getSelection();
    const selectedDoor = sel.kind === 'entity' && doors.some((d) => d.id === sel.id) ? sel.id : null;
    bodyEl.append(heading('Doors'));
    const list = document.createElement('div');
    list.className = 'chip-list';
    for (const d of doors) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `chip${selectedDoor === d.id ? ' is-selected' : ''}`;
      const style = DOOR_STYLES.find((s) => s.id === d.meta?.style);
      chip.textContent = `${d.meta?.role === 'exit' ? 'Exit' : 'Entrance'} · ${studio.wallLabel(d.parent)} · ${style ? style.name : ''}`;
      chip.addEventListener('click', () => { doorTarget = 'selected'; studio.select({ kind: 'entity', id: d.id }); });
      list.appendChild(chip);
    }
    bodyEl.append(list);
    if (!doors.length) bodyEl.append(note('No doors yet. Add them in the floor plan.'));
    bodyEl.append(heading('Apply style to'));
    const seg = document.createElement('div');
    seg.className = 'seg';
    const target = selectedDoor && doorTarget === 'selected' ? 'selected' : 'all';
    const mk = (id, label, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.disabled = disabled;
      b.setAttribute('aria-pressed', target === id ? 'true' : 'false');
      b.addEventListener('click', () => { doorTarget = id; renderBody(); });
      return b;
    };
    seg.append(mk('selected', 'Selected door', !selectedDoor), mk('all', 'All doors', false));
    bodyEl.append(seg);
    const currentStyle = target === 'selected' ? studio.getEntity(selectedDoor)?.meta?.style : (doors.length && doors.every((d) => d.meta?.style === doors[0].meta?.style) ? doors[0].meta?.style : null);
    bodyEl.append(heading('Door style'));
    const g = grid();
    for (const s of DOOR_STYLES) {
      const b = swatch(s.name, currentStyle === s.id, (c) => drawDoorPreview(c.getContext('2d'), s.id, c.width, c.height), () => {
        studio.setDoorStyle(target === 'selected' ? selectedDoor : 'all', s.id);
      });
      b.title = s.description;
      g.appendChild(b);
    }
    bodyEl.append(g);
    bodyEl.append(note('Door positions and sizes are edited in the floor plan.'));
  }

  function renderBody() {
    destroyWheel();
    bodyEl.innerHTML = '';
    const ws = studio.getState();
    if (tab === 'floors') renderFloors(ws);
    else if (tab === 'walls') renderWalls(ws);
    else if (tab === 'windows') renderWindows(ws);
    else renderDoors(ws);
  }

  function open(initialTab) {
    if (initialTab) tab = initialTab;
    studio.setMode('finish');
  }
  function close() { studio.setMode('build'); }

  doneBtn.addEventListener('click', close);
  studio.on('mode', (mode) => {
    panel.hidden = mode !== 'finish';
    if (mode === 'finish') { renderTabs(); renderBody(); } else { destroyWheel(); palette.cancel(); }
  });
  studio.on('selection', () => { if (studio.getMode() === 'finish') renderBody(); });
  studio.on('change', () => { if (suppressRefresh) return; if (studio.getMode() === 'finish' && !scrubBefore && !wheelActive()) renderBody(); });

  function wheelActive() { return wheel && wheel.element.contains(document.activeElement) && document.activeElement !== doneBtn; }

  panel.hidden = true;
  return { open, close, setTab(t) { tab = t; if (studio.getMode() === 'finish') { renderTabs(); renderBody(); } } };
}
