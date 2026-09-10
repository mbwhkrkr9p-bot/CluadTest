// Procedural builders for the warehouse equipment: pallet rack bay, pallet location marker,
// wire shelving, packing station and the forklift parked inside its striped reserved zone.
//
// Floor-entity origin convention: bottom centre of the footprint, base at y = 0, front facing +Z.
// Everything fits inside [-width/2, width/2] × [0, height] × [-depth/2, depth/2]. Materials are
// fresh per fixture (see ./common.js) and every mesh / texture is disposable via disposeGroup.
import * as THREE from '../../../vendor/three/three.module.js';
import { getDef } from '../../core/catalog.js';
import {
  FIXTURE_COLORS as C, mat, metalMat, woodMat,
  box, cylinder, rodX, rodZ, floorPlane, wallPlane, torus, canvasTexture, newGroup, shelfHeights,
} from './common.js';

// ------------------------------------------------------------------ small local helpers

/** Entity dimensions in feet, falling back to the catalog defaults. */
function dims(entity, def) {
  return {
    w: entity.width ?? def.size.width,
    h: entity.height ?? def.size.height,
    d: entity.depth ?? def.size.depth,
  };
}

/** Numeric meta parameter with catalog default fallback. */
function metaNumber(entity, def, key, fallback) {
  const v = entity.meta ? entity.meta[key] : undefined;
  if (Number.isFinite(v)) return v;
  const p = def.params ? def.params[key] : undefined;
  return p && Number.isFinite(p.default) ? p.default : fallback;
}

/** Same finishing as the helpers in common.js (shadows + pickable) for meshes built here. */
function pickable(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.pickable = true;
  return mesh;
}

/** A positioned geometry for `mergeParts`. */
function part(geometry, x, y, z, rx = 0, ry = 0, rz = 0) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  );
  return { geometry, matrix };
}

/**
 * Merge positioned parts into one non-indexed BufferGeometry (position / normal / uv) so that
 * bracing and shelf wires cost a single draw call. Source geometries are disposed. Kept local
 * so this module has no dependency on the other builder modules.
 */
function mergeParts(parts) {
  const chunks = parts.map(({ geometry, matrix }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    return g.applyMatrix4(matrix);
  });
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const itemSize = chunks[0].getAttribute(name).itemSize;
    const arrays = chunks.map((g) => g.getAttribute(name).array);
    const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
  }
  for (const g of chunks) g.dispose();
  return merged;
}

/** Open-ended thin rod geometry (ends always meet another member). */
function wireGeometry(length, radius, segments = 6) {
  return new THREE.CylinderGeometry(radius, radius, length, segments, 1, true);
}
/** Rod along X centred at (x, y, z). */
function wireX(l, r, x, y, z) { return part(wireGeometry(l, r), x, y, z, 0, 0, Math.PI / 2); }
/** Rod along Z centred at (x, y, z). */
function wireZ(l, r, x, y, z) { return part(wireGeometry(l, r), x, y, z, Math.PI / 2, 0, 0); }

/** `count` positions evenly spread across `span` (centred on 0, ends excluded). */
function spreadCount(span, count) {
  const out = [];
  for (let i = 1; i <= count; i++) out.push(-span / 2 + (span * i) / (count + 1));
  return out;
}

// ------------------------------------------------------------------ pallet rack

/**
 * Beam heights for `levels` beam levels: floor pallets stand on the slab, so the first beam is
 * about 5 ft up; the remaining levels spread evenly to just below the top of the uprights.
 */
function beamLevels(h, levels) {
  const n = Math.max(1, Math.round(levels));
  const top = h - 1;
  const first = Math.max(1, Math.min(5, top - (n - 1)));
  return shelfHeights(n, first, top);
}

/** One square foot of wire deck: light steel with 4 × 3 wires per foot. */
function paintDeckTile(ctx, size) {
  ctx.fillStyle = '#b7bcc1';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#5b6167';
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) { const x = ((i + 0.5) * size) / 4; ctx.moveTo(x, 0); ctx.lineTo(x, size); }
  for (let j = 0; j < 3; j++) { const y = ((j + 0.5) * size) / 3; ctx.moveTo(0, y); ctx.lineTo(size, y); }
  ctx.stroke();
}

/** Horizontal + zig-zag diagonal bracing rods between the two columns of one upright frame. */
function frameBracing(x, h, span) {
  const r = 0.03, parts = [];
  const n = Math.max(2, Math.round((h - 1) / 3.5) + 1);
  const ys = shelfHeights(n, 0.5, h - 0.5);
  ys.forEach((y, i) => {
    parts.push(wireZ(span, r, x, y, 0));
    if (i === ys.length - 1) return;
    const dy = ys[i + 1] - y, dir = i % 2 ? -1 : 1;
    // Rotating a Y-axis rod about X by θ points it along (0, cos θ, sin θ).
    parts.push(part(wireGeometry(Math.hypot(dy, span), r), x, y + dy / 2, 0, Math.atan2(dir * span, dy)));
  });
  return parts;
}

/** Selective pallet racking bay: two braced upright frames, orange beam pairs, wire decks. */
function buildPalletRack(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const levels = metaNumber(entity, def, 'levels', 3);
  const up = 0.25, beamH = 0.35, beamT = 0.2;
  const blue = mat(C.blue, { roughness: 0.55, metalness: 0.35 });
  const orange = mat(C.safetyOrange, { roughness: 0.55, metalness: 0.3 });
  const steel = metalMat(C.metal, { roughness: 0.5 });
  const fx = w / 2 - up / 2, fz = d / 2 - up / 2;
  const brace = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(up, h, up, blue, sx * fx, 0, sz * fz));
      g.add(box(0.4, 0.03, 0.4, steel, sx * (w / 2 - 0.2), 0, sz * (d / 2 - 0.2)));
    }
    brace.push(...frameBracing(sx * fx, h, d - up));
  }
  g.add(pickable(new THREE.Mesh(mergeParts(brace), steel)));
  const beamW = w - up * 2, deckD = d - up;
  const deck = mat('#ffffff', { map: canvasTexture(64, paintDeckTile, beamW, deckD), roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
  for (const y of beamLevels(h, levels)) {
    for (const sz of [-1, 1]) g.add(box(beamW, beamH, beamT, orange, 0, y, sz * fz));
    for (const x of spreadCount(beamW, 3)) g.add(box(0.1, 0.06, deckD - beamT, steel, x, y + beamH - 0.06, 0));
    g.add(floorPlane(beamW, deckD, deck, 0, y + beamH + 0.012, 0));
  }
  return g;
}

// ------------------------------------------------------------------ pallet location marker

/** Flat painted floor marking: outline square, corner L-marks and a label block (no volume). */
function buildPalletMarker(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const lift = 0.01, paintH = Math.min(0.02, h * 0.4), line = 0.12, inset = 0.4;
  const yellow = mat(C.safetyYellow, { roughness: 0.9 });
  const dark = mat(C.charcoal, { roughness: 0.9 });
  const white = mat(C.white, { roughness: 0.9 });
  const sw = w - inset * 2, sd = d - inset * 2;
  for (const sz of [-1, 1]) g.add(box(sw, paintH, line, yellow, 0, lift, sz * (sd / 2 - line / 2)));
  for (const sx of [-1, 1]) g.add(box(line, paintH, sd - line * 2, yellow, sx * (sw / 2 - line / 2), lift, 0));
  const arm = Math.min(0.7, w * 0.18), lt = 0.15;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(arm, paintH, lt, yellow, sx * (w / 2 - arm / 2), lift, sz * (d / 2 - lt / 2)));
      g.add(box(lt, paintH, arm - lt, yellow, sx * (w / 2 - lt / 2), lift, sz * (d / 2 - lt - (arm - lt) / 2)));
    }
  }
  const lw = Math.min(0.9, sw * 0.3), ld = Math.min(0.5, sd * 0.18);
  const lx = -sw / 2 + line + 0.1 + lw / 2, lz = sd / 2 - line - 0.1 - ld / 2;
  g.add(box(lw, paintH * 1.4, ld, dark, lx, lift, lz));
  g.add(box(lw * 0.7, 0.006, ld * 0.45, white, lx, lift + paintH * 1.4, lz)); // label face on top of the block
  return g;
}

// ------------------------------------------------------------------ wire shelving

/** Chrome wire shelving: four posts with collars, `levels` shelves of a thin deck plus wires. */
function buildWireShelving(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const levels = metaNumber(entity, def, 'levels', 4);
  const postR = 0.035, inset = 0.06, deckT = 0.03, wireR = 0.012;
  const chrome = metalMat();
  const deckMat = metalMat('#d6dadf', { roughness: 0.45 });
  const dark = mat(C.charcoal, { roughness: 0.6 });
  const px = w / 2 - inset, pz = d / 2 - inset;
  const heights = shelfHeights(levels, 0.4, h - 0.12);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(cylinder(postR, postR, h, chrome, sx * px, 0, sz * pz, 10));
      g.add(cylinder(0.05, 0.06, 0.06, dark, sx * px, 0, sz * pz, 10));
      for (const y of heights) g.add(cylinder(0.055, 0.055, 0.14, dark, sx * px, y - 0.05, sz * pz, 10));
    }
  }
  const sw = w - inset * 2 - 0.04, sd = d - inset * 2 - 0.04;
  const wires = [];
  for (const y of heights) {
    g.add(box(sw, deckT, sd, deckMat, 0, y, 0));
    const top = y + deckT + wireR;
    for (const z of spreadCount(sd, Math.max(2, Math.round(sd / 0.25) - 1))) wires.push(wireX(sw, wireR, 0, top, z));
    for (const sz of [-1, 1]) wires.push(wireX(sw, 0.02, 0, top + 0.01, sz * (sd / 2 - 0.02)));
    for (const sx of [-1, 1]) wires.push(wireZ(sd, 0.02, sx * (sw / 2 - 0.02), top + 0.01, 0));
  }
  g.add(pickable(new THREE.Mesh(mergeParts(wires), chrome)));
  return g;
}

// ------------------------------------------------------------------ packing station

/** Packing bench: steel frame, laminate top, lower shelf, riser-mounted supply shelf, roll holder, monitor arm, bins. */
function buildPackingStation(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const steel = mat(C.steel, { roughness: 0.5, metalness: 0.5 });
  const top = woodMat(C.lightWood);
  const grey = mat(C.metal, { roughness: 0.6, metalness: 0.3 });
  const kraft = mat('#b9946a', { roughness: 0.9 });
  const chrome = metalMat();
  const dark = mat(C.charcoal, { roughness: 0.5, metalness: 0.3 });
  const benchY = Math.min(2.9, h * 0.58), topT = 0.12, benchTop = benchY + topT;
  const lx = w / 2 - 0.15, lz = d / 2 - 0.15;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.1, benchY, 0.1, steel, sx * lx, 0, sz * lz));
  g.add(box(w, topT, d, top, 0, benchY, 0));
  for (const sz of [-1, 1]) g.add(box(w - 0.3, 0.1, 0.1, steel, 0, benchY - 0.25, sz * lz));
  g.add(box(w - 0.3, 0.05, d - 0.4, grey, 0, 0.6, 0)); // lower shelf
  // Upper supply shelf on two risers along the back edge.
  const shelfY = h - 0.55, shelfD = Math.min(0.9, d * 0.36), riserZ = -d / 2 + 0.25;
  for (const sx of [-1, 1]) g.add(box(0.1, shelfY - benchTop, 0.1, steel, sx * (w / 2 - 0.2), benchTop, riserZ));
  g.add(box(w, 0.06, shelfD, top, 0, shelfY, -d / 2 + shelfD / 2));
  g.add(box(0.7, 0.42, 0.55, kraft, -w / 2 + 0.6, shelfY + 0.06, -d / 2 + shelfD / 2));
  g.add(box(0.55, 0.36, 0.5, kraft, -w / 2 + 1.35, shelfY + 0.06, -d / 2 + shelfD / 2));
  // Roll holder rod spanning the two risers, carrying a roll of kraft paper.
  const rollY = benchTop + 1.0;
  g.add(rodX(w - 0.4, 0.02, chrome, 0, rollY, riserZ));
  g.add(rodX(w * 0.45, 0.22, kraft, -w * 0.15, rollY, riserZ, 16));
  // Monitor on an arm.
  const mx = w / 2 - 0.7, armZ = -d / 2 + 0.35;
  g.add(cylinder(0.04, 0.04, 1.05, dark, mx, benchTop, armZ, 10));
  g.add(rodZ(0.35, 0.03, dark, mx, benchTop + 1.0, armZ + 0.17));
  g.add(box(1.1, 0.7, 0.05, dark, mx, benchTop + 0.65, armZ + 0.35));
  g.add(wallPlane(1.0, 0.6, mat('#9fc3d9', { roughness: 0.3, metalness: 0.1 }), mx, benchTop + 1.0, armZ + 0.376));
  // Bins and a parcel on the bench.
  g.add(box(0.8, 0.5, 0.6, mat(C.blue, { roughness: 0.6 }), -w / 2 + 0.6, benchTop, d / 2 - 0.5));
  g.add(box(Math.min(0.9, w * 0.18), 0.5, 0.6, kraft, 0, benchTop, 0.15));
  g.add(box(0.7, 0.4, 0.5, mat(C.terracotta, { roughness: 0.6 }), w / 2 - 0.8, benchTop, d / 2 - 0.45));
  return g;
}

// ------------------------------------------------------------------ forklift + reserved zone

/** Whole reserved-zone pad: lighter inner area with a 0.5 ft black/yellow hazard-striped border. */
function zoneTexture(w, d) {
  const ppf = 40;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * ppf);
  canvas.height = Math.round(d * ppf);
  const ctx = canvas.getContext('2d');
  const border = 0.5 * ppf, stripe = 0.35 * ppf;
  ctx.fillStyle = '#efe8d6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.rect(border, border, canvas.width - border * 2, canvas.height - border * 2);
  ctx.clip('evenodd');
  ctx.fillStyle = C.safetyBlack;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = C.safetyYellow;
  ctx.lineWidth = stripe;
  ctx.beginPath();
  for (let s = -canvas.height; s < canvas.width + canvas.height; s += stripe * 2 * Math.SQRT2) {
    ctx.moveTo(s, 0);
    ctx.lineTo(s + canvas.height, canvas.height);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = C.safetyYellow;
  ctx.lineWidth = 0.08 * ppf;
  const o = border + 0.1 * ppf;
  ctx.strokeRect(o, o, canvas.width - o * 2, canvas.height - o * 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Schematic counterbalance forklift (~4 ft wide × 8 ft long, forks toward +Z). */
function addForkliftBody(t) {
  const yellow = mat(C.safetyYellow, { roughness: 0.55, metalness: 0.15 });
  const black = mat(C.safetyBlack, { roughness: 0.6, metalness: 0.3 });
  const dark = metalMat(C.darkMetal, { roughness: 0.45 });
  const tyre = mat('#232323', { roughness: 0.95 });
  const hub = metalMat(C.metal);
  const seat = mat(C.charcoal, { roughness: 0.9 });
  // Chassis, counterweight, hood and operator floor.
  t.add(box(3.2, 0.5, 5.4, black, 0, 0.35, -1.3));
  t.add(box(3.6, 1.7, 1.5, yellow, 0, 0.6, -3.35));
  t.add(box(3.4, 0.12, 1.3, black, 0, 2.3, -3.35));
  t.add(box(3.3, 1.2, 1.9, yellow, 0, 0.8, -1.65));
  t.add(box(1.5, 0.35, 1.1, seat, 0, 2.0, -1.5));
  t.add(box(1.5, 1.1, 0.25, seat, 0, 2.35, -2.35));
  t.add(box(3.2, 0.25, 1.6, yellow, 0, 0.85, 0.1));
  t.add(box(3.0, 1.0, 0.5, yellow, 0, 1.1, 0.75));
  // Steering column and wheel, tilted toward the driver.
  const tilt = -0.55;
  const column = cylinder(0.04, 0.04, 0.8, dark, 0, 2.1, 0.55, 10);
  column.rotation.x = tilt;
  t.add(column);
  const wheel = torus(0.28, 0.035, dark, 0, 2.84, 0.34, false);
  wheel.rotation.x = Math.PI / 2 + tilt;
  t.add(wheel);
  // Overhead guard: four posts, side rails and cross slats.
  for (const sx of [-1, 1]) for (const z of [-2.45, 0.85]) t.add(box(0.1, 5.8, 0.1, black, sx * 1.55, 0.85, z));
  for (const sx of [-1, 1]) t.add(box(0.1, 0.08, 3.6, black, sx * 1.55, 6.65, -0.8));
  for (const z of spreadCount(3.6, 4)) t.add(box(3.2, 0.06, 0.2, black, 0, 6.66, -0.8 + z));
  // Mast with cross members, carriage and forks.
  for (const sx of [-1, 1]) t.add(box(0.18, 6.8, 0.3, dark, sx * 0.85, 0.1, 1.15));
  for (const y of [0.6, 3.6, 6.6]) t.add(box(1.9, 0.15, 0.28, dark, 0, y, 1.15));
  t.add(box(2.4, 1.1, 0.12, black, 0, 0.35, 1.36));
  for (const sx of [-1, 1]) {
    t.add(box(0.35, 0.1, 3.4, dark, sx * 0.6, 0.3, 3.15));
    t.add(box(0.35, 1.05, 0.1, dark, sx * 0.6, 0.3, 1.47));
  }
  // Wheels (axles along X) with lighter hubs.
  for (const sx of [-1, 1]) {
    t.add(rodX(0.55, 0.6, tyre, sx * 1.5, 0.6, 0.55, 20));
    t.add(rodX(0.58, 0.25, hub, sx * 1.5, 0.6, 0.55, 12));
    t.add(rodX(0.45, 0.5, tyre, sx * 1.45, 0.5, -3.0, 20));
    t.add(rodX(0.48, 0.2, hub, sx * 1.45, 0.5, -3.0, 12));
  }
}

/** Forklift + reserved zone: flat hazard-striped pad on the floor with the truck parked inside. */
function buildForklift(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  g.add(floorPlane(w, d, mat('#ffffff', { map: zoneTexture(w, d), roughness: 0.9 }), 0, 0.02, 0));
  const truck = new THREE.Group();
  const s = Math.min(1, (w - 0.8) / 4, (d - 1.5) / 9, (h - 0.1) / 7);
  if (s < 1) truck.scale.setScalar(s);
  addForkliftBody(truck);
  g.add(truck);
  return g;
}

export const WAREHOUSE_BUILDERS = {
  'pallet-rack': buildPalletRack,
  'pallet-marker': buildPalletMarker,
  'wire-shelving': buildWireShelving,
  'packing-station': buildPackingStation,
  'forklift': buildForklift,
};

/** Build a warehouse fixture group (dispatches on `def.id`). */
export function buildWarehouseFixture(entity, def = getDef(entity.type)) {
  const builder = WAREHOUSE_BUILDERS[def.id];
  if (!builder) throw new Error(`No warehouse builder for fixture type ${def.id}`);
  return builder(entity, def);
}
