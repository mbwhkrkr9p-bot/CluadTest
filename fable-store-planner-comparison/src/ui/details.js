// Details panel: describes the selected floor / wall / door / window / fixture and offers editing controls.
import { getDef, DOOR_STYLES, WINDOW_STYLES, isArchitecture } from '../core/catalog.js';
import { FLOOR_PRESETS, WALL_PRESETS } from '../render/materials.js';
import { polygonArea, polygonBounds } from '../core/geometry.js';

function fmt(n, digits = 2) {
  const v = Math.round(n * 10 ** digits) / 10 ** digits;
  return Number.isInteger(v) ? String(v) : String(v);
}

export function createDetails(studio, { toasts, onFinishes, onFloorPlan }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('details');
  const title = $('details-title');
  const subtitle = $('details-subtitle');
  const body = $('details-body');
  const actions = $('details-actions');
  const back = $('details-back');
  const close = $('details-close');
  const btnDuplicate = $('btn-duplicate');
  const btnRemove = $('btn-remove');
  let collapsed = false;

  function presetName(list, id) { return (list.find((p) => p.id === id) || {}).name || id; }

  function numberField(label, key, value, { min, max, step = 0.5, unit = 'ft', onCommit }) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const span = document.createElement('span');
    span.className = 'field__label';
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'field__input';
    input.dataset.key = key;
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.step = String(step);
    input.value = fmt(value);
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) { input.value = fmt(value); return; }
      onCommit(v);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    const unitEl = document.createElement('span');
    unitEl.className = 'field__unit';
    unitEl.textContent = unit;
    wrap.append(span, input, unitEl);
    return wrap;
  }

  function selectField(label, key, value, options, onCommit) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const span = document.createElement('span');
    span.className = 'field__label';
    span.textContent = label;
    const select = document.createElement('select');
    select.className = 'field__input';
    select.dataset.key = key;
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.name;
      if (o.id === value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => onCommit(select.value));
    wrap.append(span, select);
    return wrap;
  }

  function section(titleText) {
    const h = document.createElement('h3');
    h.className = 'details__section';
    h.textContent = titleText;
    return h;
  }

  function paragraph(text, className = 'details__text') {
    const p = document.createElement('p');
    p.className = className;
    p.textContent = text;
    return p;
  }

  function button(text, onClick, className = 'secondary') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${className}`;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderFloor(ws) {
    const b = polygonBounds(ws.room.polygon);
    title.textContent = 'Floor';
    subtitle.textContent = `${fmt(b.width)} × ${fmt(b.depth)} ft · ${Math.round(polygonArea(ws.room.polygon)).toLocaleString()} sq ft`;
    body.append(
      paragraph(ws.room.polygon.length === 4 ? 'Rectangular room outline.' : `${ws.room.polygon.length}-sided room outline.`),
      section('Finish'),
      paragraph(presetName(FLOOR_PRESETS, ws.finishes.floor.preset)),
      button('Design finishes', () => onFinishes('floors')),
      section('Plan'),
      paragraph(`Wall height ${fmt(ws.room.wallHeight)} ft · ${ws.room.polygon.length} walls`),
      button('Edit floor plan', () => onFloorPlan()),
    );
    actions.hidden = true;
  }

  function renderWall(ws, wallId) {
    const frame = studio.getWall(wallId);
    if (!frame) return;
    const attached = ws.entities.filter((e) => e.anchor === 'wall' && e.parent === wallId);
    const fixtures = attached.filter((e) => !isArchitecture(e.type));
    const openings = attached.filter((e) => isArchitecture(e.type));
    title.textContent = studio.wallLabel(wallId);
    subtitle.textContent = `${fmt(frame.length)} ft long × ${fmt(ws.room.wallHeight)} ft high`;
    const finish = studio.wallFinishFor(wallId);
    body.append(
      paragraph(`${fixtures.length} wall fixture${fixtures.length === 1 ? '' : 's'} · ${openings.length} opening${openings.length === 1 ? '' : 's'}`),
      section('Finish'),
      paragraph(presetName(WALL_PRESETS, finish.preset)),
      button('Design finishes', () => onFinishes('walls')),
    );
    if (studio.getMode() === 'finish') {
      body.append(section('Tip'), paragraph('Use the Walls tab to style this wall, or the Windows tab to add a window to it.'));
    } else {
      body.append(section('Tip'), paragraph('The Build Kit now shows wall fixtures. Tap one to mount it on this wall, or drag it onto the wall.'));
    }
    actions.hidden = true;
  }

  function renderEntity(ws, entity) {
    const def = getDef(entity.type);
    const report = studio.collisions();
    const colliding = report.colliding.has(entity.id);
    const outside = report.outOfBounds.has(entity.id);
    title.textContent = entity.type === 'door' ? `${entity.meta?.role === 'exit' ? 'Exit' : 'Entrance'} door`
      : entity.type === 'window' ? `${presetName(WINDOW_STYLES, entity.meta?.style)}` : def.name;
    subtitle.textContent = `${fmt(entity.width)} × ${fmt(entity.height)} × ${fmt(entity.depth)} ft`;
    body.append(paragraph(def.description));
    if (colliding || outside) {
      const warn = paragraph(outside ? '⚠ Outside the room outline. Move it back inside.' : '⚠ Overlapping another item. Move it to clear the overlap.', 'details__warning');
      warn.setAttribute('role', 'alert');
      body.append(warn);
    }

    // position
    body.append(section('Position'));
    if (entity.anchor === 'floor') {
      body.append(
        numberField('X', 'x', entity.position.x, { step: 0.5, onCommit: (v) => {
          const pos = studio.resolveFloorPosition(entity, v, entity.position.z);
          if (pos) studio.moveEntity(entity.id, pos); else toasts.show('That position does not fit inside the room.', { kind: 'warning' });
        } }),
        numberField('Z', 'z', entity.position.z, { step: 0.5, onCommit: (v) => {
          const pos = studio.resolveFloorPosition(entity, entity.position.x, v);
          if (pos) studio.moveEntity(entity.id, pos); else toasts.show('That position does not fit inside the room.', { kind: 'warning' });
        } }),
        numberField('Rotation', 'rotation', entity.rotation || 0, { min: 0, max: 345, step: 15, unit: '°', onCommit: (v) => studio.rotateEntity(entity.id, v) }),
      );
    } else {
      body.append(paragraph(`On ${studio.wallLabel(entity.parent)}`));
      body.append(
        numberField('Along wall', 'u', entity.position.u, { step: 0.5, onCommit: (v) => studio.moveEntity(entity.id, { u: v }) }),
      );
      if (entity.type !== 'door') {
        body.append(numberField(entity.type === 'window' ? 'Sill height' : 'Height above floor', 'v', entity.position.v, { step: 0.5, onCommit: (v) => studio.moveEntity(entity.id, { v }) }));
      }
    }

    // size / configuration
    const resizable = Object.keys(def.resizable);
    const params = Object.entries(def.params);
    if (resizable.length || params.length) body.append(section(params.length ? 'Size & configuration' : 'Size'));
    const labels = { width: entity.type === 'service-counter' || entity.type === 'rolling-rack' ? 'Length' : 'Width', height: 'Height', depth: 'Depth' };
    for (const key of resizable) {
      const [min, max] = def.resizable[key];
      body.append(numberField(labels[key], key, entity[key], { min, max, step: 0.5, onCommit: (v) => {
        if (!studio.resizeEntity(entity.id, { [key]: v })) toasts.show('That size does not fit here.', { kind: 'warning' });
      } }));
    }
    for (const [key, p] of params) {
      body.append(numberField(p.label, `meta.${key}`, entity.meta?.[key] ?? p.default, { min: p.min, max: p.max, step: p.step, unit: key === 'spacing' ? 'ft (0 = even)' : '', onCommit: (v) => {
        if (!studio.resizeEntity(entity.id, { meta: { [key]: v } })) toasts.show('That configuration does not fit.', { kind: 'warning' });
      } }));
    }

    if (entity.type === 'door') {
      body.append(section('Style'));
      body.append(selectField('Door style', 'style', entity.meta?.style, DOOR_STYLES, (v) => studio.setDoorStyle(entity.id, v)));
      body.append(paragraph('Door locations are edited in the floor plan.'));
    }
    if (entity.type === 'window') {
      body.append(section('Style'));
      body.append(selectField('Window style', 'style', entity.meta?.style, WINDOW_STYLES, (v) => studio.setWindowStyle(entity.id, v)));
    }
    if (entity.type === 'forklift') body.append(paragraph('Planning reference: the striped 6 × 13 ft zone is the collision footprint. It does not count toward equipment progress.'));

    actions.hidden = false;
    btnDuplicate.disabled = entity.type === 'door';
    btnRemove.disabled = entity.type === 'door';
  }

  function render() {
    const sel = studio.getSelection();
    const ws = studio.getState();
    const focusedKey = body.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    body.innerHTML = '';
    if (sel.kind === 'none') {
      panel.classList.add('is-hidden');
      panel.setAttribute('aria-hidden', 'true');
      return;
    }
    panel.classList.remove('is-hidden');
    panel.setAttribute('aria-hidden', 'false');
    panel.classList.toggle('is-collapsed', collapsed);
    if (sel.kind === 'floor') renderFloor(ws);
    else if (sel.kind === 'wall') renderWall(ws, sel.id);
    else if (sel.kind === 'entity') {
      const e = studio.getEntity(sel.id);
      if (e) renderEntity(ws, e);
    }
    back.hidden = sel.kind !== 'entity';
    if (focusedKey) {
      const again = body.querySelector(`[data-key="${focusedKey}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  }

  back.addEventListener('click', () => studio.stepBack());
  close.addEventListener('click', () => {
    collapsed = !collapsed;
    panel.classList.toggle('is-collapsed', collapsed);
    close.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
  btnDuplicate.addEventListener('click', () => { if (!studio.duplicateSelected()) toasts.show('No room to duplicate here.', { kind: 'warning' }); });
  btnRemove.addEventListener('click', () => studio.removeSelected());

  let lastWarn = null;
  studio.on('selection', () => { lastWarn = null; render(); });
  studio.on('change', render);
  studio.on('collisions', (report) => {
    const sel = studio.getSelection();
    if (sel.kind !== 'entity') return;
    const warn = report.colliding.has(sel.id) || report.outOfBounds.has(sel.id);
    if (warn !== lastWarn) { lastWarn = warn; render(); }
  });
  render();
  return { render };
}
