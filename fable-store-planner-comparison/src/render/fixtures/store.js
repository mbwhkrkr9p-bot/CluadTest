// Procedural builders for the store (retail) fixtures: tables, shelving, garment racks,
// showcases, the mannequin and the service counter.
//
// Every builder returns a THREE.Group created with `newGroup(entity)`. The group origin is the
// bottom centre of the footprint (base at y = 0, front facing +Z) and all geometry fits inside
// [-width/2, width/2] × [0, height] × [-depth/2, depth/2]. Everything is built from primitives
// with fresh materials per fixture (see ./common.js); no external assets.
import * as THREE from '../../../vendor/three/three.module.js';
import { getDef } from '../../core/catalog.js';
import {
  FIXTURE_COLORS as C, mat, metalMat, glassMat, woodMat,
  box, boxAt, cylinder, rodX, rodZ, floorPlane, torus, sphere, canvasTexture, newGroup, shelfHeights,
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

/** A positioned geometry part for `mergeParts`. */
function part(geometry, x, y, z, rx = 0, ry = 0, rz = 0) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  );
  return { geometry, matrix };
}

/** Thin open-ended wire geometry (no end caps: wire ends always meet another member). */
function wireGeometry(length, radius, segments = 6) {
  return new THREE.CylinderGeometry(radius, radius, length, segments, 1, true);
}
/** Wire along X centred at (x, y, z). */
function wireX(l, r, x, y, z) { return part(wireGeometry(l, r), x, y, z, 0, 0, Math.PI / 2); }
/** Vertical wire with its bottom at y. */
function wireY(l, r, x, y, z, segments = 6) { return part(wireGeometry(l, r, segments), x, y + l / 2, z); }
/** Wire along Z centred at (x, y, z). */
function wireZ(l, r, x, y, z) { return part(wireGeometry(l, r), x, y, z, Math.PI / 2, 0, 0); }
/** Flat wire ring centred at (x, y, z). */
function wireRing(radius, tube, x, y, z, tubular = 20) {
  return part(new THREE.TorusGeometry(radius, tube, 4, tubular), x, y, z, Math.PI / 2, 0, 0);
}

/**
 * Merge positioned parts into one non-indexed BufferGeometry (position / normal / uv) so that
 * wire structures (grids, pocket rings) cost a single draw call. Source geometries are disposed.
 */
function mergeParts(parts) {
  const chunks = parts.map(({ geometry, matrix }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    geometry.dispose();
    return g;
  });
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const itemSize = chunks[0].getAttribute(name).itemSize;
    const total = chunks.reduce((n, g) => n + g.getAttribute(name).count, 0);
    const array = new Float32Array(total * itemSize);
    let offset = 0;
    for (const g of chunks) {
      const src = g.getAttribute(name).array;
      array.set(src, offset);
      offset += src.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  for (const g of chunks) g.dispose();
  return merged;
}

/** One pickable mesh made of many wire parts. */
function wireMesh(parts, material) {
  return pickable(new THREE.Mesh(mergeParts(parts), material));
}

/** Evenly spread `count` interior positions strictly between -half and +half. */
function interior(half, pitch) {
  const n = Math.max(1, Math.round((half * 2) / pitch));
  const step = (half * 2) / n;
  const out = [];
  for (let i = 1; i < n; i++) out.push(-half + i * step);
  return out;
}

// ------------------------------------------------------------------ builders

/** Low table: solid top slab, apron, four tapered cylinder legs. */
function buildDisplayTable(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const topT = 0.15, apronH = 0.3, inset = 0.28;
  const top = woodMat(C.lightWood);
  const trim = woodMat(C.wood);
  g.add(box(w, topT, d, top, 0, h - topT, 0));
  g.add(box(w - inset * 2, apronH, d - inset * 2, trim, 0, h - topT - apronH, 0));
  const lx = w / 2 - inset - 0.04, lz = d / 2 - inset - 0.04;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(cylinder(0.09, 0.05, h - topT, trim, sx * lx, 0, sz * lz, 10));
  }
  return g;
}

/** Single-sided shelving unit: side panels, back, kick, N boards, top cap. */
function buildCustomShelf(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const levels = metaNumber(entity, def, 'levels', 4);
  const spacing = metaNumber(entity, def, 'spacing', 0);
  const sideT = 0.08, backT = 0.05, kickH = 0.3, boardT = 0.06, topT = 0.08, kickInset = 0.15;
  const carcass = woodMat(C.wood);
  const boards = woodMat(C.lightWood);
  const back = woodMat(C.darkWood);
  const innerW = w - sideT * 2;
  for (const sx of [-1, 1]) g.add(box(sideT, h - topT, d, carcass, sx * (w / 2 - sideT / 2), 0, 0));
  g.add(box(innerW, h - topT, backT, back, 0, 0, -d / 2 + backT / 2));
  g.add(box(innerW, kickH, d - backT - kickInset, carcass, 0, 0, (backT - kickInset) / 2));
  g.add(box(w, topT, d, carcass, 0, h - topT, 0));
  // Bottom board sits on the kick; the highest board leaves headroom under the top cap.
  const top = Math.max(kickH + 0.5, h - topT - 1.0);
  for (const y of shelfHeights(levels, kickH, top, spacing)) {
    g.add(box(innerW, boardT, d - backT, boards, 0, y, backT / 2));
  }
  return g;
}

/** Double-sided gondola: base deck, centre spine, shelves on both faces stepping shorter upward. */
function buildGondola(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const levels = metaNumber(entity, def, 'levels', 4);
  const spacing = metaNumber(entity, def, 'spacing', 0);
  const deckH = 0.35, spineT = 0.12, boardT = 0.06, endT = 0.08, topT = 0.08;
  const frame = mat(C.charcoal, { roughness: 0.6, metalness: 0.3 });
  const shelf = mat(C.cream, { roughness: 0.7 });
  const lip = mat(C.darkMetal, { roughness: 0.5, metalness: 0.4 });
  g.add(box(w, deckH, d, frame));
  g.add(box(w - endT * 2, h - deckH, spineT, frame, 0, deckH, 0));
  for (const sx of [-1, 1]) g.add(box(endT, h, spineT + 0.5, frame, sx * (w / 2 - endT / 2), 0, 0));
  g.add(box(w, topT, spineT + 0.3, frame, 0, h - topT, 0));
  const heights = shelfHeights(levels, deckH, h - 0.5, spacing);
  const maxDepth = d / 2 - spineT / 2;
  const shelfW = w - endT * 2;
  heights.forEach((y, i) => {
    const t = heights.length > 1 ? i / (heights.length - 1) : 0;
    const depth = maxDepth * (1 - 0.45 * t); // deeper at the bottom, shorter toward the top
    for (const sz of [-1, 1]) {
      g.add(box(shelfW, boardT, depth, shelf, 0, y, sz * (spineT / 2 + depth / 2)));
      g.add(box(shelfW, boardT + 0.05, 0.03, lip, 0, y, sz * (spineT / 2 + depth - 0.015)));
    }
  });
  return g;
}

/** Four-sided wire grid tower on a weighted base (single merged wire mesh). */
function buildGridwallTower(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const baseH = 0.12, pitch = 0.5, wire = 0.014, postR = 0.035, capT = 0.05;
  const chrome = metalMat();
  const dark = mat(C.charcoal, { roughness: 0.5, metalness: 0.4 });
  g.add(box(w * 0.9, baseH, d * 0.9, dark));
  const hw = w / 2 - postR, hd = d / 2 - postR;
  const y0 = baseH, y1 = h - capT, span = y1 - y0;
  const parts = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(wireY(span, postR, sx * hw, y0, sz * hd, 8));
  }
  for (const y of interior(span / 2, pitch)) {
    const yy = y0 + span / 2 + y;
    for (const sz of [-1, 1]) parts.push(wireX(hw * 2, wire, 0, yy, sz * hd));
    for (const sx of [-1, 1]) parts.push(wireZ(hd * 2, wire, sx * hw, yy, 0));
  }
  for (const x of interior(hw, pitch)) {
    for (const sz of [-1, 1]) parts.push(wireY(span, wire, x, y0, sz * hd));
  }
  for (const z of interior(hd, pitch)) {
    for (const sx of [-1, 1]) parts.push(wireY(span, wire, sx * hw, y0, z));
  }
  g.add(wireMesh(parts, chrome));
  g.add(box(w, capT, d, dark, 0, h - capT, 0));
  return g;
}

/** Paints one slat pitch: cream face with a horizontal groove and its highlight. */
function paintSlatTile(ctx, size) {
  ctx.fillStyle = '#e9e2d3';
  ctx.fillRect(0, 0, size, size);
  const y = Math.round(size * 0.66), t = Math.max(2, Math.round(size * 0.12));
  ctx.fillStyle = '#8f8574';
  ctx.fillRect(0, y, size, t);
  ctx.fillStyle = '#57514a';
  ctx.fillRect(0, y, size, Math.ceil(t / 2));
  ctx.fillStyle = '#f7f3ea';
  ctx.fillRect(0, y + t, size, Math.max(1, Math.round(size * 0.03)));
}

/** Square slatwall tower: dark plinth, four grooved panels around a core, wood cap. */
function buildSlatwallTower(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const baseH = 0.2, capT = 0.06, pitch = 0.25, panelT = 0.05, inset = 0.05;
  const bodyH = h - baseH - capT;
  const tex = canvasTexture(64, paintSlatTile, 1, Math.max(1, Math.round(bodyH / pitch)));
  const slat = mat('#ffffff', { map: tex, roughness: 0.8 });
  const core = mat(C.cream);
  const dark = mat(C.charcoal);
  g.add(box(w, baseH, d, dark));
  const pw = w - inset * 2, pd = d - inset * 2;
  g.add(box(pw - panelT * 2, bodyH, pd - panelT * 2, core, 0, baseH, 0));
  for (const s of [-1, 1]) {
    g.add(box(pw, bodyH, panelT, slat, 0, baseH, s * (pd / 2 - panelT / 2)));
    g.add(box(panelT, bodyH, pd - panelT * 2, slat, s * (pw / 2 - panelT / 2), baseH, 0));
  }
  g.add(box(w, capT, d, woodMat(C.wood), 0, h - capT, 0));
  return g;
}

/** Four-way garment rack: cross base, centre post, four arms with rounded end caps. */
function buildFourWayRack(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const chrome = metalMat();
  const dark = mat(C.charcoal, { roughness: 0.4, metalness: 0.5 });
  const baseL = Math.min(w, d) * 0.7, baseT = 0.06, baseW = 0.18;
  g.add(box(baseL, baseT, baseW, dark));
  g.add(box(baseW, baseT, baseL, dark));
  const armY = h - 0.3, capR = 0.07, armR = 0.03;
  g.add(cylinder(0.05, 0.05, armY - baseT, chrome, 0, baseT, 0, 12));
  g.add(cylinder(0.09, 0.09, 0.25, chrome, 0, armY - 0.125, 0, 12));
  g.add(sphere(0.06, chrome, 0, armY + 0.125 + 0.05, 0));
  g.add(rodX(w - capR * 2, armR, chrome, 0, armY, 0));
  g.add(rodZ(d - capR * 2, armR, chrome, 0, armY, 0));
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    g.add(sphere(capR, chrome, x * (w / 2 - capR), armY, z * (d / 2 - capR)));
  }
  return g;
}

/** Round garment rack: base disc, centre post, torus rail with spokes near the top. */
function buildRoundRack(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const chrome = metalMat();
  const dark = mat(C.charcoal, { roughness: 0.4, metalness: 0.5 });
  const r = Math.min(w, d) / 2, tube = 0.03, railR = r - tube, railY = h - 0.25;
  g.add(cylinder(r * 0.45, r * 0.5, 0.08, dark, 0, 0, 0, 24));
  g.add(cylinder(0.05, 0.05, h - 0.2, chrome, 0, 0.08, 0, 12));
  g.add(sphere(0.06, chrome, 0, h - 0.07, 0));
  g.add(torus(railR, tube, chrome, 0, railY, 0));
  g.add(rodX(railR * 2, 0.02, chrome, 0, railY, 0));
  g.add(rodZ(railR * 2, 0.02, chrome, 0, railY, 0));
  return g;
}

/** Rolling garment rack: two posts on caster feet, top rail spanning the width, lower brace. */
function buildRollingRack(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const chrome = metalMat();
  const black = mat(C.safetyBlack, { roughness: 0.8 });
  const wheelR = 0.1, barY = 0.2, px = w / 2 - 0.3, footL = d - 0.25, railR = 0.035;
  for (const sx of [-1, 1]) {
    g.add(rodZ(footL, 0.035, chrome, sx * px, barY, 0));
    g.add(cylinder(0.04, 0.04, h - 0.05 - barY, chrome, sx * px, barY, 0, 12));
    for (const sz of [-1, 1]) g.add(rodX(0.08, wheelR, black, sx * px, wheelR, sz * (footL / 2 - 0.05), 12));
  }
  g.add(rodX(w - 0.2, railR, chrome, 0, h - 0.05, 0));
  for (const sx of [-1, 1]) g.add(sphere(0.045, chrome, sx * (w / 2 - 0.05), h - 0.05, 0));
  g.add(rodX(px * 2, 0.02, chrome, 0, 0.7, 0));
  return g;
}

/**
 * Flat-shaded open tub: four tapered walls of thickness `t` (outer + inner faces, top rim) and an
 * inner floor. Half-extents are given at the top (y1) and the bottom (y0).
 */
function tubGeometry(topHW, topHD, botHW, botHD, y0, y1, t) {
  const ring = (hw, hd, y) => [[hw, y, hd], [-hw, y, hd], [-hw, y, -hd], [hw, y, -hd]];
  const oT = ring(topHW, topHD, y1), oB = ring(botHW, botHD, y0);
  const iT = ring(topHW - t, topHD - t, y1), iB = ring(botHW - t, botHD - t, y0 + t);
  const pos = [], nor = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), n = new THREE.Vector3();
  // Emits quad abcd with a flat normal, flipping the winding so the normal agrees with `hint`.
  const quad = (a, b, c, d, hint) => {
    va.fromArray(a);
    vb.fromArray(b).sub(va);
    vc.fromArray(c).sub(va);
    n.crossVectors(vb, vc).normalize();
    const flip = n.dot(hint) < 0;
    if (flip) n.negate();
    const order = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (const p of order) { pos.push(...p); nor.push(n.x, n.y, n.z); }
  };
  const up = new THREE.Vector3(0, 1, 0), out = new THREE.Vector3();
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    out.set(oT[i][0] + oT[j][0], 0, oT[i][2] + oT[j][2]).normalize();
    quad(oB[i], oB[j], oT[j], oT[i], out);
    quad(iB[i], iB[j], iT[j], iT[i], out.clone().negate());
    quad(oT[i], oT[j], iT[j], iT[i], up);
  }
  quad(iB[0], iB[1], iB[2], iB[3], up);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  return geo;
}

/** Open-top dump bin: dark plinth, tapered thick-walled tub, rolled rim, heap of goods inside. */
function buildDumpBin(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const baseH = 0.2, rimR = 0.035, wallT = 0.06;
  const shell = mat(C.terracotta, { roughness: 0.85 });
  const dark = mat(C.charcoal);
  g.add(box(w * 0.7, baseH, d * 0.7, dark));
  const topHW = w / 2 - rimR, topHD = d / 2 - rimR, taper = 0.78;
  const bodyTop = h - rimR;
  g.add(pickable(new THREE.Mesh(tubGeometry(topHW, topHD, topHW * taper, topHD * taper, baseH, bodyTop, wallT), shell)));
  for (const s of [-1, 1]) {
    g.add(rodX(w, rimR, shell, 0, bodyTop, s * topHD, 8));
    g.add(rodZ(d, rimR, shell, s * topHW, bodyTop, 0, 8));
  }
  // Loose merchandise: a fill level plus a few tumbled boxes and balls in three colours.
  const fillT = 0.55, fillY = baseH + (bodyTop - baseH) * fillT;
  const fillHW = topHW * (taper + (1 - taper) * fillT) - wallT, fillHD = topHD * (taper + (1 - taper) * fillT) - wallT;
  const goods = [mat(C.sage, { roughness: 1 }), mat(C.amber, { roughness: 0.9 }), mat(C.cream, { roughness: 1 })];
  g.add(floorPlane(fillHW * 2, fillHD * 2, goods[0], 0, fillY, 0));
  const items = [
    [-0.4, -0.3, 0.65, 0.3], [0.4, -0.4, 0.55, 1.1], [0.05, 0.45, 0.6, 0.7], [-0.5, 0.4, 0.5, 1.9], [0.55, 0.1, 0.5, 2.4],
  ];
  const itemS = Math.min(fillHW, fillHD, (h - fillY) * 0.9);
  items.forEach(([fx, fz, size, yaw], i) => {
    const s = size * itemS;
    if (i % 2 === 0) {
      const b = box(s, s * 0.7, s * 0.85, goods[(i + 1) % 3], fx * fillHW, fillY, fz * fillHD);
      b.rotation.y = yaw;
      g.add(b);
    } else {
      const ball = pickable(new THREE.Mesh(new THREE.SphereGeometry(s * 0.45, 12, 8), goods[(i + 1) % 3]));
      ball.position.set(fx * fillHW, fillY + s * 0.45, fz * fillHD);
      g.add(ball);
    }
  });
  return g;
}

/** Spinner rack: round base, centre post, 3–4 tiers of slanted wire pockets. */
function buildSpinnerRack(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const chrome = metalMat();
  const dark = mat(C.charcoal, { roughness: 0.4, metalness: 0.5 });
  const r = Math.min(w, d) / 2, wire = 0.018, pocketH = 0.5, tiers = h >= 6.5 ? 4 : 3;
  g.add(cylinder(r * 0.85, r * 0.9, 0.08, dark, 0, 0, 0, 24));
  g.add(cylinder(0.035, 0.035, h - 0.2, chrome, 0, 0.08, 0, 10));
  g.add(sphere(0.06, chrome, 0, h - 0.07, 0));
  const R = r - wire, Rlow = R * 0.85, firstBottom = 0.9, lastTop = h - 0.4;
  const step = tiers > 1 ? (lastTop - firstBottom - pocketH) / (tiers - 1) : 0;
  const parts = [];
  const rodL = Math.hypot(R - Rlow, pocketH), tilt = Math.atan2(R - Rlow, pocketH);
  for (let t = 0; t < tiers; t++) {
    const yb = firstBottom + t * step, yt = yb + pocketH, ym = (yb + yt) / 2;
    parts.push(wireRing(R, wire, 0, yt, 0), wireRing(Rlow, wire, 0, yb, 0));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI;
      parts.push(part(wireGeometry(R * 2, wire), 0, yt, 0, 0, a, Math.PI / 2));
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, mid = (R + Rlow) / 2;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -tilt));
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(mid * Math.cos(a), ym, -mid * Math.sin(a)), q, new THREE.Vector3(1, 1, 1),
      );
      parts.push({ geometry: wireGeometry(rodL, wire), matrix });
    }
  }
  g.add(wireMesh(parts, chrome));
  return g;
}

/** Glass showcase: solid plinth, glass box with chrome frame, thin top, interior shelf. */
function buildGlassShowcase(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const plinthH = Math.min(0.6, h * 0.18), topT = 0.08, frameT = 0.06;
  const dark = mat(C.charcoal, { roughness: 0.5 });
  const chrome = metalMat();
  const cream = mat(C.cream, { roughness: 0.85 });
  const glass = glassMat();
  g.add(box(w, plinthH, d, dark));
  const gh = h - plinthH - topT;
  g.add(boxAt(w - frameT, gh, d - frameT, glass, 0, plinthH + gh / 2, 0));
  const fx = w / 2 - frameT / 2, fz = d / 2 - frameT / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(box(frameT, gh, frameT, chrome, sx * fx, plinthH, sz * fz));
  }
  for (const y of [plinthH, plinthH + gh - frameT]) {
    for (const s of [-1, 1]) {
      g.add(box(w, frameT, frameT, chrome, 0, y, s * fz));
      g.add(box(frameT, frameT, d - frameT * 2, chrome, s * fx, y, 0));
    }
  }
  g.add(box(w - 0.2, 0.04, d - 0.2, cream, 0, plinthH, 0));
  g.add(box(w - 0.3, 0.03, d - 0.4, cream, 0, plinthH + gh * 0.5, 0));
  g.add(box(w, topT, d, dark, 0, h - topT, 0));
  return g;
}

/** Abstract mannequin: round base, thin pole, dress-form torso, neck, featureless head. */
function buildMannequin(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const s = Math.min(w, d), flat = 0.65;
  const body = mat(C.white, { roughness: 0.9 });
  const dark = mat(C.charcoal, { roughness: 0.5, metalness: 0.4 });
  const headR = h * 0.062, headY = h - headR, shoulderY = h * 0.8, waistY = h * 0.55, hipY = h * 0.42;
  const chestR = s * 0.38, waistR = s * 0.24, hipR = s * 0.33;
  g.add(cylinder(s * 0.42, s * 0.45, 0.06, dark, 0, 0, 0, 24));
  g.add(cylinder(0.03, 0.03, hipY - 0.06, dark, 0, 0.06, 0, 8));
  const hips = sphere(hipR, body, 0, hipY, 0);
  hips.scale.set(1, 0.35, flat);
  g.add(hips);
  const lower = cylinder(waistR, hipR, waistY - hipY, body, 0, hipY, 0, 20);
  lower.scale.z = flat;
  g.add(lower);
  const upper = cylinder(chestR, waistR, shoulderY - waistY, body, 0, waistY, 0, 20);
  upper.scale.z = flat;
  g.add(upper);
  const shoulders = sphere(chestR, body, 0, shoulderY, 0);
  shoulders.scale.set(1, 0.42, flat);
  g.add(shoulders);
  g.add(cylinder(headR * 0.42, headR * 0.5, headY - shoulderY, body, 0, shoulderY, 0, 12));
  const head = sphere(headR, body, 0, headY, 0);
  head.scale.set(0.85, 1, 0.9);
  g.add(head);
  return g;
}

/** Cash-wrap counter: kick recess, cabinet, charcoal top, raised back ledge, register + screen. */
function buildServiceCounter(entity, def) {
  const g = newGroup(entity);
  const { w, h, d } = dims(entity, def);
  const kickH = 0.25, kickInset = 0.15, topT = 0.1, ledgeT = 0.08, ledgeD = Math.min(0.6, d * 0.28);
  const counterH = h - 0.75;
  const wood = woodMat(C.wood);
  const light = woodMat(C.lightWood);
  const dark = mat(C.charcoal, { roughness: 0.5 });
  const screen = mat('#1d2b3a', { roughness: 0.3, metalness: 0.2 });
  g.add(box(w - kickInset * 2, kickH, d - kickInset * 2, dark));
  const cabH = counterH - topT - kickH;
  g.add(box(w, cabH, d - 0.06, wood, 0, kickH, -0.03));
  g.add(box(w - 0.3, cabH - 0.3, 0.05, light, 0, kickH + 0.15, d / 2 - 0.035));
  g.add(box(w, topT, d, dark, 0, counterH - topT, 0));
  const riserD = ledgeD - 0.1;
  g.add(box(w, h - counterH - ledgeT, riserD, wood, 0, counterH, -d / 2 + riserD / 2));
  g.add(box(w, ledgeT, ledgeD, dark, 0, h - ledgeT, -d / 2 + ledgeD / 2));
  const regW = 0.9, regD = 0.7, regH = 0.2;
  const regX = Math.min(w / 2 - regW / 2 - 0.3, w * 0.25), regZ = -d / 2 + ledgeD + regD / 2 + 0.1;
  g.add(box(regW, regH, regD, dark, regX, counterH, regZ));
  const monitor = boxAt(0.8, 0.45, 0.04, screen, regX, counterH + regH + 0.2, regZ - regD / 2 + 0.12);
  monitor.rotation.x = -0.35; // leans back toward the cashier
  g.add(monitor);
  g.add(box(0.6, 0.04, 0.25, dark, regX, counterH, regZ + regD / 2 + 0.2));
  return g;
}

// ------------------------------------------------------------------ public API

export const STORE_BUILDERS = {
  'display-table': buildDisplayTable,
  'custom-shelf': buildCustomShelf,
  'gondola': buildGondola,
  'gridwall-tower': buildGridwallTower,
  'slatwall-tower': buildSlatwallTower,
  'four-way-rack': buildFourWayRack,
  'round-rack': buildRoundRack,
  'rolling-rack': buildRollingRack,
  'dump-bin': buildDumpBin,
  'spinner-rack': buildSpinnerRack,
  'glass-showcase': buildGlassShowcase,
  'mannequin': buildMannequin,
  'service-counter': buildServiceCounter,
};

/** Build the group for a store fixture entity (dispatches on entity.type). */
export function buildStoreFixture(entity, def = getDef(entity.type)) {
  const builder = STORE_BUILDERS[entity.type];
  if (!builder) throw new Error(`No store builder for fixture type ${entity.type}`);
  return builder(entity, def);
}
