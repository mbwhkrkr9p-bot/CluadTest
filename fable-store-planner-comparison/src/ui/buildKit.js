// Build Kit panel: search, category tabs, visual cards with procedural previews,
// tap-to-place and drag-to-place.
import { defsForWorkspace, CATEGORIES } from '../core/catalog.js';
import { drawPreview } from '../render/previews.js';

const DRAG_START = 6;

export function createBuildKit(studio, { palette, toasts }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('build-kit');
  const search = $('kit-search');
  const tabs = $('kit-tabs');
  const cards = $('kit-cards');
  const empty = $('kit-empty');
  const toggle = $('kit-toggle');
  let category = 'all';
  let wallFilter = null; // wallId when a wall is selected
  let cardEls = new Map();
  let activeDrag = null;

  function fmt(n) { return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100); }

  function renderTabs() {
    const ws = studio.getState();
    tabs.innerHTML = '';
    for (const cat of CATEGORIES[ws.type]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', cat.id === category ? 'true' : 'false');
      b.dataset.category = cat.id;
      b.textContent = cat.label;
      b.addEventListener('click', () => { category = cat.id; wallFilter = null; renderTabs(); renderCards(); });
      tabs.appendChild(b);
    }
  }

  function matches(def, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    return def.name.toLowerCase().includes(q) || def.tags.some((t) => t.includes(q)) || def.description.toLowerCase().includes(q);
  }

  function renderCards() {
    const ws = studio.getState();
    const query = search.value.trim();
    let defs = defsForWorkspace(ws.type);
    if (wallFilter) defs = defs.filter((d) => d.anchor === 'wall');
    else if (category !== 'all') defs = defs.filter((d) => d.category === category);
    defs = defs.filter((d) => matches(d, query));
    cards.innerHTML = '';
    cardEls = new Map();
    let note = panel.querySelector('.kit-note');
    if (wallFilter) {
      if (!note) { note = document.createElement('div'); note.className = 'kit-note'; cards.parentElement.insertBefore(note, cards); }
      note.innerHTML = '';
      const text = document.createElement('span');
      text.textContent = `Wall fixtures for ${studio.wallLabel(wallFilter)}`;
      const showAll = document.createElement('button');
      showAll.type = 'button';
      showAll.className = 'link';
      showAll.textContent = 'Show all';
      showAll.addEventListener('click', () => { wallFilter = null; renderCards(); });
      note.append(text, showAll);
    } else if (note) note.remove();
    for (const def of defs) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `kit-card${def.anchor === 'wall' ? ' kit-card--wall' : ''}`;
      card.setAttribute('role', 'listitem');
      card.draggable = false;
      card.dataset.def = def.id;
      card.setAttribute('aria-label', `${def.name}. ${def.anchor === 'wall' ? 'Wall fixture' : 'Floor fixture'}, ${fmt(def.size.width)} by ${fmt(def.size.height)} by ${fmt(def.size.depth)} feet. Tap to place, or drag into the room.`);
      const canvas = document.createElement('canvas');
      canvas.className = 'kit-card__preview';
      canvas.width = 120; canvas.height = 84;
      drawPreview(canvas.getContext('2d'), def.id, canvas.width, canvas.height);
      const name = document.createElement('span');
      name.className = 'kit-card__name';
      name.textContent = def.name;
      const dims = document.createElement('span');
      dims.className = 'kit-card__dims';
      dims.textContent = `${fmt(def.size.width)} × ${fmt(def.size.height)} × ${fmt(def.size.depth)} ft`;
      card.append(canvas, name, dims);
      card.title = def.description;
      wireCard(card, def);
      cards.appendChild(card);
      cardEls.set(def.id, card);
    }
    empty.hidden = defs.length > 0;
  }

  function wireCard(card, def) {
    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      activeDrag = { def, id: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false, card };
      try { card.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    card.addEventListener('pointermove', (e) => {
      if (!activeDrag || activeDrag.id !== e.pointerId) return;
      if (!activeDrag.dragging) {
        if (Math.hypot(e.clientX - activeDrag.startX, e.clientY - activeDrag.startY) < DRAG_START) return;
        activeDrag.dragging = true;
        card.classList.add('is-dragging');
        palette.begin(def.id, 'drag');
      }
      palette.updateGhost(e.clientX, e.clientY);
    });
    const finish = (e) => {
      if (!activeDrag || activeDrag.id !== e.pointerId) return;
      const drag = activeDrag;
      activeDrag = null;
      card.classList.remove('is-dragging');
      try { card.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (drag.dragging) {
        card.dataset.skipClick = '1';
        if (e.type === 'pointercancel') { palette.cancel(); return; }
        const placed = palette.placeAt(e.clientX, e.clientY);
        if (!placed) toasts.show(def.anchor === 'wall' ? 'Drop it on a wall to place it.' : 'Drop it on the floor to place it.', { kind: 'info', duration: 2200 });
      }
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
    card.addEventListener('click', () => {
      // A click that followed a drag is ignored (the drag already handled placement).
      if (card.dataset.skipClick) { delete card.dataset.skipClick; return; }
      tapPlace(def);
    });
  }

  function tapPlace(def) {
    if (palette.isPlacing() && palette.current().defId === def.id) { palette.cancel(); return; }
    palette.begin(def.id, 'tap');
    cardEls.forEach((el, id) => el.classList.toggle('is-armed', id === def.id));
    const sel = studio.getSelection();
    // Convenience: a wall fixture tapped while a wall is selected goes straight onto that wall.
    if (def.anchor === 'wall' && sel.kind === 'wall') {
      const frame = studio.getWall(sel.id);
      if (frame) {
        const placed = studio.placeWallEntity(def.id, sel.id, frame.length / 2);
        palette.cancel();
        if (placed) { toasts.announce(`${def.name} placed on ${studio.wallLabel(sel.id)}`); return; }
      }
    }
    toasts.hint(def.anchor === 'wall' ? `Tap a wall to place the ${def.name} · Esc to cancel` : `Tap the floor to place the ${def.name} · Esc to cancel`);
  }

  function onPlacementStatus(status) {
    if (!status.placing) {
      toasts.clearHint();
      cardEls.forEach((el) => el.classList.remove('is-armed'));
    }
  }

  search.addEventListener('input', renderCards);
  toggle.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('is-collapsed');
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  studio.on('selection', (sel) => {
    const next = sel.kind === 'wall' ? sel.id : null;
    if (next !== wallFilter) { wallFilter = next; renderCards(); }
  });
  studio.on('workspace', () => { category = 'all'; wallFilter = null; renderTabs(); renderCards(); });
  studio.on('mode', (mode) => { panel.hidden = mode === 'finish'; });

  renderTabs();
  renderCards();
  return { renderCards, renderTabs, onPlacementStatus, setCollapsed(v) { panel.classList.toggle('is-collapsed', v); } };
}
