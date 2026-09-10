// Floor plan editor dialog: name, shape (rectangle / L-shape), size, wall height and door locations,
// with a live 2D preview drawn on a canvas.
import { rectanglePolygon, lShapePolygon } from '../core/templates.js';
import { wallFrames, polygonBounds, normalizePolygon } from '../core/geometry.js';

const CORNERS = ['front-right', 'front-left', 'back-right', 'back-left'];

function wallLabelFor(frame) {
  const n = frame.normal;
  let side = 'Angled';
  if (n.z > 0.7) side = 'Back';
  else if (n.z < -0.7) side = 'Front';
  else if (n.x > 0.7) side = 'Left';
  else if (n.x < -0.7) side = 'Right';
  return `Wall ${frame.index + 1} · ${side} (${Math.round(frame.length * 10) / 10} ft)`;
}

/** Derive L-shape parameters from a 6-vertex polygon (or null when not an L). */
function deriveL(polygon) {
  if (polygon.length !== 6) return null;
  const b = polygonBounds(polygon);
  const onEdge = (p) => Math.abs(p.x - b.minX) < 1e-6 || Math.abs(p.x - b.maxX) < 1e-6 || Math.abs(p.z - b.minZ) < 1e-6 || Math.abs(p.z - b.maxZ) < 1e-6;
  const inner = polygon.find((p) => !onEdge(p));
  if (!inner) return null;
  const right = Math.abs(inner.x - b.maxX) < Math.abs(inner.x - b.minX);
  const front = Math.abs(inner.z - b.maxZ) < Math.abs(inner.z - b.minZ);
  return {
    width: b.width, depth: b.depth,
    notchWidth: right ? b.maxX - inner.x : inner.x - b.minX,
    notchDepth: front ? b.maxZ - inner.z : inner.z - b.minZ,
    corner: `${front ? 'front' : 'back'}-${right ? 'right' : 'left'}`,
  };
}

export function createFloorPlanDialog(studio, { toasts }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('floorplan-dialog');
  const form = dialog.querySelector('form');
  const f = {
    name: $('fp-name'), shape: $('fp-shape'), width: $('fp-width'), depth: $('fp-depth'), wallHeight: $('fp-wall-height'),
    notchWidth: $('fp-notch-width'), notchDepth: $('fp-notch-depth'), notchCorner: $('fp-notch-corner'), notchFields: $('fp-notch-fields'),
    entranceWall: $('fp-entrance-wall'), entranceU: $('fp-entrance-u'), entranceWidth: $('fp-entrance-width'),
    exitWall: $('fp-exit-wall'), exitU: $('fp-exit-u'), exitWidth: $('fp-exit-width'),
    preview: $('fp-preview'), apply: $('fp-apply'), cancel: $('fp-cancel'),
  };
  let customPolygon = null; // used when the current room is neither a rectangle nor an L

  function num(input, fallback) { const v = Number(input.value); return Number.isFinite(v) ? v : fallback; }

  function currentPolygon() {
    const shape = f.shape.value;
    const w = Math.min(250, Math.max(8, num(f.width, 40)));
    const d = Math.min(250, Math.max(8, num(f.depth, 28)));
    if (shape === 'l-shape') {
      const nw = Math.min(w - 4, Math.max(2, num(f.notchWidth, 12)));
      const nd = Math.min(d - 4, Math.max(2, num(f.notchDepth, 8)));
      return lShapePolygon(w, d, nw, nd, f.notchCorner.value);
    }
    if (shape === 'custom' && customPolygon) return customPolygon;
    return rectanglePolygon(w, d);
  }

  function fillWallOptions(select, frames, selected) {
    const prev = select.value;
    select.innerHTML = '';
    frames.forEach((fr) => {
      const opt = document.createElement('option');
      opt.value = `w${fr.index}`;
      opt.textContent = wallLabelFor(fr);
      select.appendChild(opt);
    });
    const want = selected || prev;
    if ([...select.options].some((o) => o.value === want)) select.value = want;
  }

  function doorSpecs(frames) {
    const specs = [];
    const mk = (role, wallSel, uInput, widthInput) => {
      const wallId = wallSel.value;
      const frame = frames.find((fr) => `w${fr.index}` === wallId);
      if (!frame) return;
      const width = Math.min(Math.max(2, num(widthInput, 4)), frame.length);
      const u = Math.min(Math.max(width / 2, num(uInput, frame.length / 2)), frame.length - width / 2);
      specs.push({ role, wallId, u, width });
    };
    mk('entrance', f.entranceWall, f.entranceU, f.entranceWidth);
    mk('exit', f.exitWall, f.exitU, f.exitWidth);
    return specs;
  }

  function drawPreview() {
    const poly = currentPolygon();
    const frames = wallFrames(poly);
    fillWallOptions(f.entranceWall, frames);
    fillWallOptions(f.exitWall, frames);
    const doors = doorSpecs(frames);
    const ctx = f.preview.getContext('2d');
    const W = f.preview.width, H = f.preview.height;
    ctx.clearRect(0, 0, W, H);
    const b = polygonBounds(poly);
    const pad = 28;
    const scale = Math.min((W - pad * 2) / b.width, (H - pad * 2) / b.depth);
    const ox = W / 2 - ((b.minX + b.maxX) / 2) * scale;
    const oz = H / 2 - ((b.minZ + b.maxZ) / 2) * scale;
    const P = (p) => [ox + p.x * scale, oz + p.z * scale];
    // floor
    ctx.beginPath();
    poly.forEach((p, i) => { const [x, y] = P(p); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = '#f7f1e6';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2f2b28';
    ctx.stroke();
    // 5 ft grid
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(47,43,40,0.08)';
    ctx.lineWidth = 1;
    for (let x = Math.ceil(b.minX / 5) * 5; x <= b.maxX; x += 5) { const [px] = P({ x, z: 0 }); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke(); }
    for (let z = Math.ceil(b.minZ / 5) * 5; z <= b.maxZ; z += 5) { const [, pz] = P({ x: 0, z }); ctx.beginPath(); ctx.moveTo(0, pz); ctx.lineTo(W, pz); ctx.stroke(); }
    ctx.restore();
    // wall numbers
    ctx.fillStyle = '#6b4a2f';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const fr of frames) {
      const mx = fr.midpoint.x - fr.normal.x * (12 / scale);
      const mz = fr.midpoint.z - fr.normal.z * (12 / scale);
      const [x, y] = P({ x: mx, z: mz });
      ctx.fillText(String(fr.index + 1), x, y);
    }
    // doors
    for (const d of doors) {
      const fr = frames.find((q) => `w${q.index}` === d.wallId);
      if (!fr) continue;
      const a = { x: fr.start.x + fr.dir.x * (d.u - d.width / 2), z: fr.start.z + fr.dir.z * (d.u - d.width / 2) };
      const c = { x: fr.start.x + fr.dir.x * (d.u + d.width / 2), z: fr.start.z + fr.dir.z * (d.u + d.width / 2) };
      ctx.beginPath();
      ctx.moveTo(...P(a));
      ctx.lineTo(...P(c));
      ctx.lineWidth = 6;
      ctx.strokeStyle = d.role === 'entrance' ? '#e0a33b' : '#3f6d9c';
      ctx.stroke();
      const [lx, ly] = P({ x: (a.x + c.x) / 2 + fr.normal.x * (14 / scale), z: (a.z + c.z) / 2 + fr.normal.z * (14 / scale) });
      ctx.fillStyle = d.role === 'entrance' ? '#a3701c' : '#3f6d9c';
      ctx.fillText(d.role === 'entrance' ? 'Entrance' : 'Exit', lx, ly);
    }
    ctx.fillStyle = '#2f2b28';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(b.width * 10) / 10} × ${Math.round(b.depth * 10) / 10} ft`, 8, 12);
    f.notchFields.hidden = f.shape.value !== 'l-shape';
  }

  function open() {
    const ws = studio.getState();
    const poly = ws.room.polygon;
    const b = polygonBounds(poly);
    f.name.value = ws.name;
    const l = deriveL(poly);
    customPolygon = null;
    if (poly.length === 4) f.shape.value = 'rectangle';
    else if (l) f.shape.value = 'l-shape';
    else { f.shape.value = 'custom'; customPolygon = poly.map((p) => ({ ...p })); }
    let customOpt = [...f.shape.options].find((o) => o.value === 'custom');
    if (!customOpt) { customOpt = document.createElement('option'); customOpt.value = 'custom'; customOpt.textContent = 'Custom outline (keep)'; f.shape.appendChild(customOpt); }
    customOpt.hidden = !customPolygon;
    f.width.value = String(Math.round(b.width * 100) / 100);
    f.depth.value = String(Math.round(b.depth * 100) / 100);
    f.wallHeight.value = String(ws.room.wallHeight);
    f.notchWidth.value = String(l ? Math.round(l.notchWidth * 100) / 100 : Math.max(2, Math.round(b.width * 0.3)));
    f.notchDepth.value = String(l ? Math.round(l.notchDepth * 100) / 100 : Math.max(2, Math.round(b.depth * 0.3)));
    f.notchCorner.value = l ? l.corner : 'front-right';
    const frames = wallFrames(poly);
    const entrance = ws.entities.find((e) => e.type === 'door' && e.meta?.role === 'entrance');
    const exit = ws.entities.find((e) => e.type === 'door' && e.meta?.role === 'exit');
    fillWallOptions(f.entranceWall, frames, entrance ? entrance.parent : 'w2');
    fillWallOptions(f.exitWall, frames, exit ? exit.parent : 'w1');
    f.entranceU.value = String(entrance ? entrance.position.u : 20);
    f.entranceWidth.value = String(entrance ? entrance.width : 6);
    f.exitU.value = String(exit ? exit.position.u : 6);
    f.exitWidth.value = String(exit ? exit.width : 4);
    drawPreview();
    dialog.showModal();
    f.name.focus();
  }

  function apply(e) {
    e.preventDefault();
    const polygon = normalizePolygon(currentPolygon());
    const frames = wallFrames(polygon);
    const ws = studio.getState();
    const entrance = ws.entities.find((d) => d.type === 'door' && d.meta?.role === 'entrance');
    const exit = ws.entities.find((d) => d.type === 'door' && d.meta?.role === 'exit');
    const doors = doorSpecs(frames).map((d) => ({
      ...d,
      id: d.role === 'entrance' ? entrance?.id : exit?.id,
      style: d.role === 'entrance' ? entrance?.meta?.style : exit?.meta?.style,
      height: d.role === 'entrance' ? entrance?.height : exit?.height,
    }));
    const wallHeight = Math.min(30, Math.max(8, num(f.wallHeight, ws.room.wallHeight)));
    const ok = studio.setRoomPlan({ name: f.name.value, polygon, wallHeight, doors });
    dialog.close();
    if (ok) { toasts.show('Floor plan updated.', { kind: 'success', duration: 2200 }); studio.home(true); }
  }

  for (const el of [f.shape, f.width, f.depth, f.notchWidth, f.notchDepth, f.notchCorner, f.entranceWall, f.entranceU, f.entranceWidth, f.exitWall, f.exitU, f.exitWidth]) {
    el.addEventListener('input', drawPreview);
    el.addEventListener('change', drawPreview);
  }
  form.addEventListener('submit', apply);
  f.cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); dialog.close(); });
  return { open, isOpen: () => dialog.open };
}
