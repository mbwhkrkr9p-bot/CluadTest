// Procedural builders for wall-mounted fixtures (slatwall / gridwall / pegboard panels) and the
// architectural door and window overlays that dress wall openings.
//
// Wall-entity origin convention: bottom centre of the wall contact. Local +X runs along the wall,
// +Y is up and +Z points into the room. Everything fits inside
// [-width/2, width/2] × [0, height] × [0, depth] with the back face flush at z = 0 (the wall).
// Materials are fresh per fixture (see ./common.js) and every mesh is disposable via disposeGroup.
import * as THREE from '../../../vendor/three/three.module.js';
import { getDef } from '../../core/catalog.js';
import {
  FIXTURE_COLORS as C, mat, metalMat, glassMat, woodMat,
  box, cylinder, rodX, rodZ, wallPlane, canvasTexture, newGroup,
} from './common.js';

const DOOR_STYLE_IDS = ['full-glass', 'double-glass', 'french-oak', 'natural-oak', 'double-oak', 'dark-wood', 'black-steel'];
const WINDOW_STYLE_IDS = ['picture', 'double', 'storefront'];

// ------------------------------------------------------------------ small local helpers

/** Entity dimensions in feet, falling back to the catalog defaults. */
function dims(entity, def) {
  return {
    w: entity.width ?? def.size.width,
    h: entity.height ?? def.size.height,
    d: entity.depth ?? def.size.depth,
  };
}

/** `meta.style` when it is one of `allowed`, otherwise `fallback` (unknown styles degrade gracefully). */
function styleOf(entity, allowed, fallback) {
  const s = entity.meta ? entity.meta.style : undefined;
  return allowed.includes(s) ? s : fallback;
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
 * Merge positioned parts into one non-indexed BufferGeometry (position / normal / uv) so that a
 * wire grid costs a single draw call. Source geometries are disposed. Kept local so this module
 * has no dependency on the other builder modules.
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

/** Open-ended thin wire geometry (ends always meet another member). */
function wireGeometry(length, radius, segments = 6) {
  return new THREE.CylinderGeometry(radius, radius, length, segments, 1, true);
}
/** Wire along X centred at (x, y, z). */
function wireX(l, r, x, y, z) { return part(wireGeometry(l, r), x, y, z, 0, 0, Math.PI / 2); }
/** Vertical wire with its bottom at y. */
function wireY(l, r, x, y, z) { return part(wireGeometry(l, r), x, y + l / 2, z); }

/** Interior positions (ends excluded) across `span`, centred on 0, spaced about `pitch` apart. */
function spread(span, pitch) {
  const n = Math.max(1, Math.round(span / pitch));
  const step = span / n;
  const out = [];
  for (let i = 1; i < n; i++) out.push(-span / 2 + i * step);
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ------------------------------------------------------------------ wall panels

/** One slat pitch (3 in): maple face with a shadowed groove along its lower edge. */
function paintSlatTile(ctx, size) {
  ctx.fillStyle = C.lightWood;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(0, 0, size, Math.round(size * 0.08));
  const groove = Math.round(size * 0.22);
  const grad = ctx.createLinearGradient(0, size - groove, 0, size);
  grad.addColorStop(0, '#261c15');
  grad.addColorStop(0.55, '#4a392b');
  grad.addColorStop(1, '#8b715a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, size - groove, size, groove);
}

/** Slatwall: a flush board whose front face carries horizontal grooves every 3 in. */
function buildSlatwallPanel(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const pitch = 0.25, faceGap = 0.03; // textured face floats just ahead of the board (no z-fighting at distance)
  g.add(box(w, h, d - faceGap, woodMat(C.lightWood), 0, 0, (d - faceGap) / 2));
  const tex = canvasTexture(64, paintSlatTile, w / pitch, h / pitch);
  g.add(wallPlane(w, h, mat('#ffffff', { map: tex, roughness: 0.7 }), 0, h / 2, d - faceGap / 2));
  return g;
}

/** Gridwall: chrome wire grid (3 in pitch, heavier perimeter) held off the wall on four standoffs. */
function buildGridwallPanel(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const pitch = 0.25, frameR = 0.02, wireR = 0.011, standR = 0.03;
  const chrome = metalMat();
  const gz = d - frameR; // plane of the grid
  const bx = w / 2 - 0.3, by = Math.min(0.3, h * 0.15);
  for (const sx of [-1, 1]) {
    for (const y of [by, h - by]) {
      g.add(box(0.22, 0.22, 0.02, chrome, sx * bx, y - 0.11, 0.01)); // wall plate
      g.add(rodZ(gz, standR, chrome, sx * bx, y, gz / 2)); // standoff
    }
  }
  const parts = [];
  for (const sx of [-1, 1]) parts.push(wireY(h, frameR, sx * (w / 2 - frameR), 0, gz));
  for (const y of [frameR, h - frameR]) parts.push(wireX(w - frameR * 2, frameR, 0, y, gz));
  for (const x of spread(w - frameR * 2, pitch)) parts.push(wireY(h - frameR * 2, wireR, x, frameR, gz));
  for (const y of spread(h - frameR * 2, pitch)) parts.push(wireX(w - frameR * 2, wireR, 0, h / 2 + y, gz));
  g.add(pickable(new THREE.Mesh(mergeParts(parts), chrome)));
  return g;
}

/** One square foot of pegboard: 6 × 6 holes (2 in spacing) on a white face. */
function paintPegTile(ctx, size) {
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, size, size);
  const n = 6, step = size / n, r = size * 0.03;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cx = (i + 0.5) * step, cy = (j + 0.5) * step;
      ctx.fillStyle = '#6a635c';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#24201d';
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.25, r * 0.7, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/** Pegboard: perforated white board recessed inside a thin dark-wood frame. */
function buildPegboardPanel(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const frameT = 0.08, recess = 0.04;
  const frame = woodMat(C.darkWood);
  for (const sx of [-1, 1]) g.add(box(frameT, h, d, frame, sx * (w / 2 - frameT / 2), 0, d / 2));
  for (const y of [0, h - frameT]) g.add(box(w - frameT * 2, frameT, d, frame, 0, y, d / 2));
  const bw = w - frameT * 2, bh = h - frameT * 2, bt = Math.max(0.02, d - recess - 0.01);
  g.add(box(bw, bh, bt, mat(C.white, { roughness: 0.85 }), 0, frameT, bt / 2));
  const tex = canvasTexture(96, paintPegTile, bw, bh);
  g.add(wallPlane(bw, bh, mat('#ffffff', { map: tex, roughness: 0.85 }), 0, frameT + bh / 2, bt + 0.015));
  return g;
}

export const WALL_BUILDERS = {
  'slatwall-panel': buildSlatwallPanel,
  'gridwall-panel': buildGridwallPanel,
  'pegboard-panel': buildPegboardPanel,
};

/** Build a wall-mounted fixture group (dispatches on `def.id`). */
export function buildWallFixture(entity, def = getDef(entity.type)) {
  const builder = WALL_BUILDERS[def.id];
  if (!builder) throw new Error(`No wall builder for fixture type ${def.id}`);
  return builder(entity, def);
}

// ------------------------------------------------------------------ doors

/**
 * Shared door envelope: frame sizes and the leaf extent. `zh` is the plane where hardware
 * (levers, pull bars, push bars) sits; it stays inside the entity depth.
 */
function doorSpec(w, h, d) {
  const jambT = 0.2, headT = 0.25, sillT = 0.04, gap = 0.03;
  const leafT = clamp(d * 0.35, 0.05, 0.1), z0 = d * 0.27;
  return {
    w, h, d, jambT, headT, sillT, leafT,
    x0: -w / 2 + jambT + gap, x1: w / 2 - jambT - gap, // leaf x extent
    y0: sillT + 0.02, y1: h - headT - gap, // leaf y extent
    z0, z1: z0 + leafT, // leaf z extent
    zh: Math.min(z0 + leafT + 0.07, d - 0.035), // hardware plane
  };
}

/** Rectangle of one leaf spanning [xa, xb] (centre, size and slab centre z). */
function leafRect(f, xa, xb) {
  return { xc: (xa + xb) / 2, w: xb - xa, yc: (f.y0 + f.y1) / 2, h: f.y1 - f.y0, zc: (f.z0 + f.z1) / 2 };
}

/** Jambs, head and a metal threshold strip between the jambs. */
function addDoorFrame(g, f, frameMat) {
  const { w, h, d, jambT, headT, sillT } = f;
  for (const sx of [-1, 1]) g.add(box(jambT, h, d, frameMat, sx * (w / 2 - jambT / 2), 0, d / 2));
  g.add(box(w - jambT * 2, headT, d, frameMat, 0, h - headT, d / 2));
  g.add(box(w - jambT * 2, sillT, d, metalMat(C.metal, { roughness: 0.5 }), 0, 0, d / 2));
}

/** Solid slab leaf. */
function addSlab(g, f, r, material) {
  g.add(box(r.w, r.h, f.leafT, material, r.xc, f.y0, r.zc));
}

/** Slab built from four boards around a rectangular opening `o` = { x, y, w, h } (centre + size). */
function addSlabWithOpening(g, f, r, o, material) {
  const left = o.x - o.w / 2 - (r.xc - r.w / 2), right = r.xc + r.w / 2 - (o.x + o.w / 2);
  const below = o.y - o.h / 2 - f.y0, above = f.y1 - (o.y + o.h / 2);
  g.add(box(left, r.h, f.leafT, material, r.xc - r.w / 2 + left / 2, f.y0, r.zc));
  g.add(box(right, r.h, f.leafT, material, r.xc + r.w / 2 - right / 2, f.y0, r.zc));
  g.add(box(o.w, below, f.leafT, material, o.x, f.y0, r.zc));
  g.add(box(o.w, above, f.leafT, material, o.x, o.y + o.h / 2, r.zc));
}

/** Frameless-looking glass leaf: full pane with slim aluminium stiles and rails. */
function addGlassLeaf(g, f, r, glass, alu) {
  const stile = 0.09, bottomRail = 0.4, topRail = 0.09;
  g.add(wallPlane(r.w, r.h, glass, r.xc, r.yc, r.zc));
  for (const sx of [-1, 1]) g.add(box(stile, r.h, f.leafT, alu, r.xc + sx * (r.w / 2 - stile / 2), f.y0, r.zc));
  g.add(box(r.w - stile * 2, bottomRail, f.leafT, alu, r.xc, f.y0, r.zc));
  g.add(box(r.w - stile * 2, topRail, f.leafT, alu, r.xc, f.y1 - topRail, r.zc));
}

/** Oak leaf with a grid of divided glass lites (stiles + rails, glass pane, muntins). */
function addDividedLiteLeaf(g, f, r, oak, glass) {
  const stile = Math.min(0.28, r.w * 0.12), topRail = 0.28, bottomRail = 0.7;
  for (const sx of [-1, 1]) g.add(box(stile, r.h, f.leafT, oak, r.xc + sx * (r.w / 2 - stile / 2), f.y0, r.zc));
  g.add(box(r.w - stile * 2, bottomRail, f.leafT, oak, r.xc, f.y0, r.zc));
  g.add(box(r.w - stile * 2, topRail, f.leafT, oak, r.xc, f.y1 - topRail, r.zc));
  const gw = r.w - stile * 2, gh = r.h - bottomRail - topRail, gy = f.y0 + bottomRail + gh / 2;
  g.add(wallPlane(gw, gh, glass, r.xc, gy, r.zc));
  const cols = gw > 1.6 ? 2 : 1, rows = Math.max(2, Math.round(gh / 1.1));
  const mt = 0.05, mz = f.leafT * 0.6;
  for (let i = 1; i < cols; i++) g.add(box(mt, gh, mz, oak, r.xc - gw / 2 + (gw * i) / cols, gy - gh / 2, r.zc));
  for (let j = 1; j < rows; j++) g.add(box(gw, mt, mz, oak, r.xc, gy - gh / 2 + (gh * j) / rows - mt / 2, r.zc));
}

/** Two raised panels (thin boxes proud of the slab face). */
function addRaisedPanels(g, f, r, material) {
  const inset = Math.min(0.4, r.w * 0.16);
  const pw = r.w - inset * 2, upperH = r.h * 0.42, lowerH = r.h * 0.22;
  g.add(box(pw, upperH, 0.02, material, r.xc, f.y1 - inset - upperH, f.z1 + 0.01));
  g.add(box(pw, lowerH, 0.02, material, r.xc, f.y0 + inset, f.z1 + 0.01));
}

/** Narrow vertical vision lite on the latch side of a slab (opening + glass + slim trim). */
function addVisionLite(g, f, r, slabMat, glass, trim) {
  const lw = 0.4, lh = Math.min(2.4, r.h * 0.4), t = 0.04;
  const o = { x: r.xc + r.w / 2 - 0.55, y: f.y0 + r.h * 0.5 + lh / 2, w: lw, h: lh };
  addSlabWithOpening(g, f, r, o, slabMat);
  g.add(wallPlane(lw, lh, glass, o.x, o.y, r.zc));
  for (const sx of [-1, 1]) g.add(box(t, lh + t * 2, 0.02, trim, o.x + sx * (lw / 2 + t / 2), o.y - lh / 2 - t, f.z1 + 0.01));
  for (const y of [o.y - lh / 2 - t, o.y + lh / 2]) g.add(box(lw, t, 0.02, trim, o.x, y, f.z1 + 0.01));
}

/** Lever handle: rosette, spindle and a lever pointing toward `side` (-1 = -X, +1 = +X). */
function addLever(g, f, x, side, material) {
  const y = Math.min(3.1, f.y0 + (f.y1 - f.y0) * 0.45);
  g.add(rodZ(0.03, 0.06, material, x, y, f.z1 + 0.015, 16));
  g.add(rodZ(f.zh - f.z1 - 0.03, 0.018, material, x, y, (f.z1 + 0.03 + f.zh) / 2));
  g.add(rodX(0.32, 0.018, material, x + side * 0.14, y, f.zh));
}

/** Vertical pull bar on two standoffs (glass doors). */
function addPullBar(g, f, x, material) {
  const len = Math.min(2.2, (f.y1 - f.y0) * 0.4), yc = Math.min(3.4, f.y0 + (f.y1 - f.y0) * 0.5);
  g.add(cylinder(0.02, 0.02, len, material, x, yc - len / 2, f.zh, 12));
  for (const y of [yc - len / 2 + 0.1, yc + len / 2 - 0.1]) g.add(rodZ(f.zh - f.z1, 0.014, material, x, y, (f.z1 + f.zh) / 2));
}

/** Horizontal push bar on two end brackets (steel doors). */
function addPushBar(g, f, r, material) {
  const y = Math.min(3.3, f.y0 + r.h * 0.47), depth = f.zh - f.z1;
  g.add(rodX(r.w - 0.6, 0.035, material, r.xc, y, f.zh, 12));
  for (const sx of [-1, 1]) g.add(box(0.12, 0.14, depth, material, r.xc + sx * (r.w / 2 - 0.35), y - 0.07, f.z1 + depth / 2));
}

/** Two leaves split at the centre with a stile/astragal of width `cs` between them. */
function splitLeaves(f, cs) {
  return [leafRect(f, f.x0, -cs / 2 - 0.02), leafRect(f, cs / 2 + 0.02, f.x1)];
}

const DOOR_LEAVES = {
  'full-glass'(g, f) {
    const glass = glassMat(), alu = metalMat(C.metal, { roughness: 0.4 });
    addGlassLeaf(g, f, leafRect(f, f.x0, f.x1), glass, alu);
    addPullBar(g, f, f.x1 - 0.3, alu);
  },
  'double-glass'(g, f) {
    const glass = glassMat(), alu = metalMat(C.metal, { roughness: 0.4 });
    const cs = 0.1;
    for (const r of splitLeaves(f, cs)) addGlassLeaf(g, f, r, glass, alu);
    g.add(box(cs, f.y1 - f.y0, f.leafT, alu, 0, f.y0, (f.z0 + f.z1) / 2));
    for (const sx of [-1, 1]) addPullBar(g, f, sx * 0.3, alu);
  },
  'french-oak'(g, f) {
    const oak = woodMat(C.wood), glass = glassMat(), brass = metalMat('#b08d57', { roughness: 0.4 });
    if (f.w >= 5) {
      for (const r of splitLeaves(f, 0.08)) addDividedLiteLeaf(g, f, r, oak, glass);
      g.add(box(0.08, f.y1 - f.y0, f.leafT + 0.02, oak, 0, f.y0, (f.z0 + f.z1) / 2 + 0.01));
      for (const sx of [-1, 1]) addLever(g, f, sx * 0.32, sx, brass);
    } else {
      addDividedLiteLeaf(g, f, leafRect(f, f.x0, f.x1), oak, glass);
      addLever(g, f, f.x1 - 0.3, -1, brass);
    }
  },
  'natural-oak'(g, f) {
    const leaf = woodMat(C.lightWood), panel = woodMat(C.wood), brass = metalMat('#b08d57', { roughness: 0.4 });
    const r = leafRect(f, f.x0, f.x1);
    addSlab(g, f, r, leaf);
    addRaisedPanels(g, f, r, panel);
    addLever(g, f, f.x1 - 0.3, -1, brass);
  },
  'double-oak'(g, f) {
    const leaf = woodMat(C.wood), panel = woodMat(C.darkWood), brass = metalMat('#b08d57', { roughness: 0.4 });
    for (const r of splitLeaves(f, 0.08)) {
      addSlab(g, f, r, leaf);
      addRaisedPanels(g, f, r, panel);
    }
    g.add(box(0.08, f.y1 - f.y0, f.leafT + 0.02, panel, 0, f.y0, (f.z0 + f.z1) / 2 + 0.01));
    for (const sx of [-1, 1]) addLever(g, f, sx * 0.32, sx, brass);
  },
  'dark-wood'(g, f) {
    const walnut = woodMat(C.darkWood), glass = glassMat(), dark = metalMat(C.darkMetal, { roughness: 0.45 });
    const r = leafRect(f, f.x0, f.x1);
    addVisionLite(g, f, r, walnut, glass, dark);
    addLever(g, f, f.x1 - 0.3, -1, dark);
  },
  'black-steel'(g, f) {
    const steel = mat(C.safetyBlack, { roughness: 0.5, metalness: 0.45 });
    const stainless = mat(C.chrome, { roughness: 0.4, metalness: 0.6 }); // brushed: reads light even without an environment
    const r = leafRect(f, f.x0, f.x1);
    addSlab(g, f, r, steel);
    g.add(box(r.w - 0.1, 0.8, 0.012, stainless, r.xc, f.y0 + 0.03, f.z1 + 0.006)); // kick plate
    addPushBar(g, f, r, stainless);
  },
};

/** Frame material per door style. */
function doorFrameMaterial(style) {
  switch (style) {
    case 'full-glass':
    case 'double-glass': return metalMat(C.metal, { roughness: 0.4 });
    case 'natural-oak':
    case 'double-oak':
    case 'french-oak': return woodMat(C.wood);
    case 'dark-wood': return woodMat(C.darkWood);
    default: return mat(C.safetyBlack, { roughness: 0.5, metalness: 0.45 });
  }
}

/** Door overlay: frame + threshold + leaf/leaves per `meta.style` (shallow, back flush at z = 0). */
export function buildDoor(entity, def = getDef('door')) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const style = styleOf(entity, DOOR_STYLE_IDS, 'full-glass');
  const f = doorSpec(w, h, d);
  addDoorFrame(g, f, doorFrameMaterial(style));
  DOOR_LEAVES[style](g, f);
  return g;
}

// ------------------------------------------------------------------ windows

/**
 * Glass pane: the shared glass material, a lighter tinted pane just behind it and a soft diagonal
 * glint strip in front, so the pane reads as glass even against a pale wall (from both sides).
 */
function addGlazing(g, x0, x1, y0, y1, z, glass, tint, glint) {
  const gw = x1 - x0, gh = y1 - y0, xc = (x0 + x1) / 2, yc = (y0 + y1) / 2;
  g.add(wallPlane(gw, gh, glass, xc, yc, z));
  g.add(wallPlane(gw, gh, tint, xc, yc, z - 0.012));
  const angle = Math.PI / 3, len = Math.min(gw / Math.cos(angle), gh / Math.sin(angle)) * 0.8;
  const strip = wallPlane(len, Math.min(0.18, len * 0.08), glint, xc - gw * 0.08, yc + gh * 0.08, z + 0.012);
  strip.rotation.z = angle;
  g.add(strip);
}

/** Materials shared by every pane of one window. */
function glazingMaterials() {
  const side = THREE.DoubleSide;
  return {
    glass: glassMat(),
    tint: mat('#cfe3f0', { transparent: true, opacity: 0.42, roughness: 0.2, metalness: 0.1, side, depthWrite: false }),
    glint: mat('#ffffff', { transparent: true, opacity: 0.22, roughness: 0.3, side, depthWrite: false }),
  };
}

/** Painted frame with a sill and `panes` panes divided by centre mullions (picture / double). */
function buildFramedWindow(g, w, h, d, panes) {
  const ft = 0.12, sillT = 0.16, mull = 0.1;
  const frame = mat(C.white, { roughness: 0.6 });
  const { glass, tint, glint } = glazingMaterials();
  for (const sx of [-1, 1]) g.add(box(ft, h, d, frame, sx * (w / 2 - ft / 2), 0, d / 2));
  g.add(box(w - ft * 2, ft, d, frame, 0, h - ft, d / 2));
  g.add(box(w - ft * 2, sillT, d, frame, 0, 0, d / 2));
  const x0 = -w / 2 + ft, x1 = w / 2 - ft, y0 = sillT, y1 = h - ft;
  const span = (x1 - x0) / panes;
  for (let i = 0; i < panes; i++) {
    addGlazing(g, x0 + span * i, x0 + span * (i + 1), y0, y1, d * 0.5, glass, tint, glint);
    if (i > 0) g.add(box(mull, y1 - y0, d * 0.8, frame, x0 + span * i, y0, d * 0.4));
  }
}

/** Storefront glazing: charcoal bulkhead + slim frame with 2–3 tall panes on thin mullions. */
function buildStorefront(g, w, h, d) {
  const bulkH = 0.3, ft = 0.1, headT = 0.12, mull = 0.06;
  const dark = mat(C.charcoal, { roughness: 0.5, metalness: 0.4 });
  const { glass, tint, glint } = glazingMaterials();
  g.add(box(w, bulkH, d, dark, 0, 0, d / 2));
  for (const sx of [-1, 1]) g.add(box(ft, h - bulkH, d, dark, sx * (w / 2 - ft / 2), bulkH, d / 2));
  g.add(box(w - ft * 2, headT, d, dark, 0, h - headT, d / 2));
  const x0 = -w / 2 + ft, x1 = w / 2 - ft, y0 = bulkH, y1 = h - headT;
  const panes = w >= 6 ? 3 : 2, span = (x1 - x0) / panes;
  for (let i = 0; i < panes; i++) {
    addGlazing(g, x0 + span * i, x0 + span * (i + 1), y0, y1, d * 0.5, glass, tint, glint);
    if (i > 0) g.add(box(mull, y1 - y0, d * 0.9, dark, x0 + span * i, y0, d * 0.45));
  }
}

/** Window overlay: frame + glass pane(s) per `meta.style` (shallow, back flush at z = 0). */
export function buildWindow(entity, def = getDef('window')) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const style = styleOf(entity, WINDOW_STYLE_IDS, 'picture');
  if (style === 'storefront') buildStorefront(g, w, h, d);
  else buildFramedWindow(g, w, h, d, style === 'double' ? 2 : 1);
  return g;
}
