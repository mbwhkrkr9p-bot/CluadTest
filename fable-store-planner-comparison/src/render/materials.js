// Procedural floor and wall finishes. Every texture is painted on a canvas at build time
// with geometric primitives and seeded noise — no images, no network. Nothing is cached
// globally: each create* call owns its texture and material and returns a dispose().
import * as THREE from '../../vendor/three/three.module.js';

export const PALETTE = {
  charcoal: '#2f2b28',
  brown: '#6b4a2f',
  terracotta: '#b9613a',
  sage: '#7f9270',
  amber: '#e0a33b',
  blue: '#3f6d9c',
  offwhite: '#f4efe7',
};

export const FLOOR_PRESETS = [
  { id: 'polished-concrete', name: 'Polished concrete' },
  { id: 'light-oak', name: 'Light oak' },
  { id: 'dark-walnut', name: 'Dark walnut' },
  { id: 'sand-carpet', name: 'Sand carpet' },
  { id: 'charcoal-carpet', name: 'Charcoal carpet' },
  { id: 'slate-tile', name: 'Slate tile' },
  { id: 'custom-carpet', name: 'Custom carpet', custom: true },
];

export const WALL_PRESETS = [
  { id: 'warm-white', name: 'Warm white' },
  { id: 'lodge-sage', name: 'Lodge sage' },
  { id: 'terracotta', name: 'Terracotta' },
  { id: 'midnight-blue', name: 'Midnight blue' },
  { id: 'linen', name: 'Linen' },
  { id: 'alpine', name: 'Alpine geometric' },
  { id: 'white-brick', name: 'White brick' },
  { id: 'custom', name: 'Custom color', custom: true },
];

const DEFAULT_FLOOR_COLOR = '#b08a5a';
const DEFAULT_WALL_COLOR = '#f1ece3';
const SWATCH_PX = 256;

const WOODS = {
  'light-oak': {
    tones: ['#c9a674', '#c19c69', '#d0ae7e', '#bd9765', '#cba97a', '#c6a371'],
    grain: '#85603a', streak: '#a9834f', seam: '#7a5a3a', highlight: '#efdcb8',
  },
  'dark-walnut': {
    tones: ['#5a3b28', '#523524', '#60402c', '#4c3020', '#5d3e2a', '#563a27'],
    grain: '#20120a', streak: '#3a2316', seam: '#1a0e07', highlight: '#8a6547',
  },
};

// ---------------------------------------------------------------- preset specs
// tileFeet: feet covered by one texture tile. px: canvas size. swatchFeet: crop shown in swatches.

function plasterSpec(hex) {
  return {
    tileFeet: 4, px: 256, roughness: 0.9, metalness: 0, swatchFeet: 2.5,
    paint: (ctx, size, _color, random) => paintPlaster(ctx, size, hex, random),
  };
}

const FLOOR_SPECS = {
  'polished-concrete': { tileFeet: 8, px: 512, roughness: 0.35, metalness: 0.04, swatchFeet: 6, paint: paintConcrete },
  'light-oak': {
    tileFeet: 4, px: 512, roughness: 0.6, metalness: 0, swatchFeet: 2.4,
    paint: (ctx, size, _color, random) => paintPlanks(ctx, size, WOODS['light-oak'], random),
  },
  'dark-walnut': {
    tileFeet: 4, px: 512, roughness: 0.6, metalness: 0, swatchFeet: 2.4,
    paint: (ctx, size, _color, random) => paintPlanks(ctx, size, WOODS['dark-walnut'], random),
  },
  'sand-carpet': {
    tileFeet: 2, px: 256, roughness: 0.95, metalness: 0, swatchFeet: 1.5,
    paint: (ctx, size, _color, random) => paintCarpet(ctx, size, '#cbb894', random),
  },
  'charcoal-carpet': {
    tileFeet: 2, px: 256, roughness: 0.95, metalness: 0, swatchFeet: 1.5,
    paint: (ctx, size, _color, random) => paintCarpet(ctx, size, '#4a4643', random),
  },
  'slate-tile': { tileFeet: 8, px: 512, roughness: 0.5, metalness: 0.02, swatchFeet: 4.6, paint: paintSlate },
  'custom-carpet': {
    tileFeet: 2, px: 256, roughness: 0.95, metalness: 0, swatchFeet: 1.5, custom: true,
    paint: (ctx, size, color, random) => paintCarpet(ctx, size, color, random),
  },
};

const WALL_SPECS = {
  'warm-white': plasterSpec('#f1ece3'),
  'lodge-sage': plasterSpec('#8c9a82'),
  terracotta: plasterSpec('#bd6b48'),
  'midnight-blue': plasterSpec('#2e3f5e'),
  linen: { tileFeet: 1, px: 256, roughness: 0.95, metalness: 0, swatchFeet: 0.6, paint: paintLinen },
  alpine: { tileFeet: 4, px: 512, roughness: 0.9, metalness: 0, swatchFeet: 3, paint: paintAlpine },
  'white-brick': { tileFeet: 4, px: 512, roughness: 0.85, metalness: 0, swatchFeet: 2.2, paint: paintBrick },
  custom: {
    tileFeet: 4, px: 256, roughness: 0.9, metalness: 0, swatchFeet: 2.5, custom: true,
    paint: (ctx, size, color, random) => paintPlaster(ctx, size, color, random),
  },
};

function floorSpec(presetId) {
  const spec = FLOOR_SPECS[presetId];
  if (!spec) throw new Error(`Unknown floor preset: ${presetId}`);
  return spec;
}

function wallSpec(presetId) {
  const spec = WALL_SPECS[presetId];
  if (!spec) throw new Error(`Unknown wall preset: ${presetId}`);
  return spec;
}

// ---------------------------------------------------------------- public API

/** Floor finish: the map covers tileFeet × tileFeet and repeats once per foot of UV (ShapeGeometry UVs are in feet). */
export function createFloorMaterial(presetId, customColor) {
  const spec = floorSpec(presetId);
  const color = normalizeColor(customColor, DEFAULT_FLOOR_COLOR);
  const map = makeTexture(spec.px, (ctx, size) => paintFloorTile(ctx, size, presetId, color));
  map.repeat.set(1 / spec.tileFeet, 1 / spec.tileFeet);
  const material = new THREE.MeshStandardMaterial({
    map, color: 0xffffff, roughness: spec.roughness, metalness: spec.metalness,
  });
  return { material, tileFeet: spec.tileFeet, dispose: () => { map.dispose(); material.dispose(); } };
}

/** Wall finish for a plane whose UVs run 0..1 across lengthFeet × heightFeet. */
export function createWallMaterial(presetId, customColor, lengthFeet, heightFeet) {
  const spec = wallSpec(presetId);
  const color = normalizeColor(customColor, DEFAULT_WALL_COLOR);
  const map = makeTexture(spec.px, (ctx, size) => paintWallTile(ctx, size, presetId, color));
  map.repeat.set(repeats(lengthFeet, spec.tileFeet), repeats(heightFeet, spec.tileFeet));
  const material = new THREE.MeshStandardMaterial({
    map, color: 0xffffff, roughness: spec.roughness, metalness: spec.metalness,
  });
  return { material, tileFeet: spec.tileFeet, dispose: () => { map.dispose(); material.dispose(); } };
}

export function drawFloorSwatch(canvas, presetId, customColor) {
  const spec = floorSpec(presetId);
  const color = normalizeColor(customColor, DEFAULT_FLOOR_COLOR);
  drawSwatch(canvas, spec, (ctx, size) => paintFloorTile(ctx, size, presetId, color));
}

export function drawWallSwatch(canvas, presetId, customColor) {
  const spec = wallSpec(presetId);
  const color = normalizeColor(customColor, DEFAULT_WALL_COLOR);
  drawSwatch(canvas, spec, (ctx, size) => paintWallTile(ctx, size, presetId, color));
}

/** Paints one size × size tile of a floor preset (deterministic per preset/colour). */
export function paintFloorTile(ctx, size, presetId, customColor) {
  const spec = floorSpec(presetId);
  const color = normalizeColor(customColor, DEFAULT_FLOOR_COLOR);
  spec.paint(ctx, size, color, makeRandom(`floor:${presetId}:${spec.custom ? color : ''}`));
}

/** Paints one size × size tile of a wall preset (deterministic per preset/colour). */
export function paintWallTile(ctx, size, presetId, customColor) {
  const spec = wallSpec(presetId);
  const color = normalizeColor(customColor, DEFAULT_WALL_COLOR);
  spec.paint(ctx, size, color, makeRandom(`wall:${presetId}:${spec.custom ? color : ''}`));
}

// ---------------------------------------------------------------- textures & swatches

function repeats(feet, tileFeet) {
  return Number.isFinite(feet) && feet > 0 ? feet / tileFeet : 1;
}

function makeTexture(size, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Paints a representative crop of the tile into `canvas` (any size), clipped to rounded corners. */
function drawSwatch(canvas, spec, paint) {
  const w = canvas.width;
  const h = canvas.height;
  if (!(w > 0 && h > 0)) return;
  const size = Math.min(spec.px, SWATCH_PX);
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  paint(tile.getContext('2d'), size);

  // Crop `swatchFeet` of pattern (keeping the canvas aspect), anchored away from the tile edge.
  let cw = size * Math.min(1, spec.swatchFeet / spec.tileFeet);
  let ch = (cw * h) / w;
  if (ch > size) { cw *= size / ch; ch = size; }
  const sx = (size - cw) * 0.2;
  const sy = (size - ch) * 0.2;

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  roundedRect(ctx, 0, 0, w, h, Math.min(w, h) * 0.1);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tile, sx, sy, cw, ch, 0, 0, w, h);
  ctx.restore();
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------- deterministic randomness

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic PRNG returning [0, 1). */
function makeRandom(seedText) {
  let a = hashString(seedText) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length) % list.length];
}

// ---------------------------------------------------------------- colour helpers

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeColor(hex, fallback) {
  if (typeof hex !== 'string' || !HEX_RE.test(hex.trim())) return fallback;
  let h = hex.trim().slice(1).toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h}`;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function parseHex(hex) {
  const h = normalizeColor(hex, '#000000').slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

function rgba(hex, alpha) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/** Shift a hex colour's HSL lightness (and optionally saturation) by the given amounts. */
function shade(hex, dl, ds = 0) {
  const [r, g, b] = parseHex(hex);
  const [h, s, l] = rgbToHsl(r / 255, g / 255, b / 255);
  const [R, G, B] = hslToRgb(h, clamp(s + ds, 0, 1), clamp(l + dl, 0, 1));
  return toHex(R * 255, G * 255, B * 255);
}

function hsl(h, s, l) {
  return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

// ---------------------------------------------------------------- drawing helpers

function fill(ctx, size, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
}

/** Invokes draw(x, y) for every wrapped copy of a shape of radius r that touches the tile — keeps tiles seamless. */
function wrapped(size, x, y, r, draw) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const px = x + ox * size;
      const py = y + oy * size;
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
      draw(px, py);
    }
  }
}

/** Soft radial blotch. */
function blotch(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Soft elliptical blotch (rx along x, ry along y). */
function softEllipse(ctx, cx, cy, rx, ry, color, alpha) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function mottle(ctx, size, random, count, light, dark, alpha, minR, maxR) {
  for (let i = 0; i < count; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = size * (minR + random() * (maxR - minR));
    const color = random() < 0.5 ? light : dark;
    wrapped(size, x, y, r, (px, py) => blotch(ctx, px, py, r, color, alpha));
  }
}

/** Per-pixel luminance noise; seamless by construction. */
function pixelNoise(ctx, size, amplitude, random) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (random() * 2 - 1) * amplitude;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

function speckle(ctx, size, count, color, alpha, random, radius) {
  ctx.fillStyle = rgba(color, alpha);
  for (let i = 0; i < count; i++) {
    const r = radius * (0.5 + random());
    ctx.beginPath();
    ctx.arc(random() * size, random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- floor painters

function paintConcrete(ctx, size, _color, random) {
  const s = size / 512;
  fill(ctx, size, '#c1beb8');
  mottle(ctx, size, random, 36, '#d6d3cd', '#a9a6a0', 0.17, 0.12, 0.34);
  // faint trowel arcs
  ctx.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const x = random() * size;
    const y = random() * size;
    const r = size * (0.25 + random() * 0.6);
    const a0 = random() * Math.PI * 2;
    const span = 0.5 + random() * 1.4;
    ctx.strokeStyle = rgba(random() < 0.5 ? '#ffffff' : '#8a8780', 0.05 + random() * 0.04);
    ctx.lineWidth = (1 + random() * 1.5) * s;
    wrapped(size, x, y, r, (px, py) => {
      ctx.beginPath();
      ctx.arc(px, py, r, a0, a0 + span);
      ctx.stroke();
    });
  }
  speckle(ctx, size, Math.round(size * size * 0.0035), '#6f6c66', 0.16, random, 1.1 * s);
  pixelNoise(ctx, size, 4, random);
}

/** Staggered 6-inch planks across a 4 ft tile: 8 rows, each a circular sequence of planks of varying length. */
function paintPlanks(ctx, size, wood, random) {
  const rows = 8;
  const rowH = size / rows;
  const ft = size / 4;
  fill(ctx, size, wood.tones[0]);
  for (let r = 0; r < rows; r++) {
    const planks = planRow(size, ft, rowH, wood, random);
    for (const p of planks) {
      const x = p.x0 % size;
      renderPlank(ctx, p, x, r * rowH, size, wood);
      if (x + p.len > size) renderPlank(ctx, p, x - size, r * rowH, size, wood);
    }
  }
  pixelNoise(ctx, size, 6, random);
}

/** Planks covering exactly `size` px starting at a random offset (the last plank wraps around). */
function planRow(size, ft, h, wood, random) {
  const start = random() * size;
  const planks = [];
  let covered = 0;
  while (covered < size) {
    const len = Math.min(ft * (2 + random() * 2), size - covered);
    planks.push({ x0: start + covered, len });
    covered += len;
  }
  const last = planks[planks.length - 1];
  if (planks.length > 1 && last.len < ft * 0.9) {
    planks.pop();
    planks[planks.length - 1].len += last.len;
  }
  return planks.map((p) => ({ ...p, ...planPlank(p.len, h, wood, random, size / 512) }));
}

function planPlank(len, h, wood, random, scale) {
  const grain = [];
  const n = 8 + Math.floor(random() * 6);
  for (let i = 0; i < n; i++) {
    grain.push({
      y: (i + 0.5 + (random() - 0.5) * 0.8) * (h / n),
      amp: h * (0.02 + random() * 0.07),
      freq: (Math.PI * 2) / (len * (0.35 + random() * 0.9)),
      phase: random() * Math.PI * 2,
      alpha: 0.1 + random() * 0.18,
      width: (0.7 + random() * 1.2) * scale,
    });
  }
  // soft streaks: low-frequency light/dark bands running along the plank
  const streaks = [];
  const m = 2 + Math.floor(random() * 3);
  for (let i = 0; i < m; i++) {
    streaks.push({ x: len * random(), y: h * random(), rx: len * (0.2 + random() * 0.35), ry: h * (0.12 + random() * 0.2), light: random() < 0.4, alpha: 0.12 + random() * 0.12 });
  }
  const arcs = random() < 0.5
    ? { x: len * (0.15 + random() * 0.7), count: 2 + Math.floor(random() * 3), spread: h * (0.5 + random() * 0.6), alpha: 0.08 + random() * 0.08 }
    : null;
  return { h, tone: pick(random, wood.tones), grain, streaks, arcs };
}

function renderPlank(ctx, p, x, y, size, wood) {
  const s = size / 512;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, p.len, p.h);
  ctx.clip();
  ctx.fillStyle = p.tone;
  ctx.fillRect(x, y, p.len, p.h);
  for (const st of p.streaks) {
    softEllipse(ctx, x + st.x, y + st.y, st.rx, st.ry, st.light ? wood.highlight : wood.streak, st.alpha);
  }
  ctx.lineCap = 'round';
  for (const g of p.grain) {
    ctx.strokeStyle = rgba(wood.grain, g.alpha);
    ctx.lineWidth = g.width;
    ctx.beginPath();
    const step = 3 * s + 1;
    for (let px = 0; px <= p.len + step; px += step) {
      const yy = y + g.y + Math.sin(px * g.freq + g.phase) * g.amp + Math.sin(px * g.freq * 2.7 + g.phase * 1.7) * g.amp * 0.35;
      if (px === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x + px, yy);
    }
    ctx.stroke();
  }
  if (p.arcs) {
    // cathedral figure: nested elongated ellipses clipped by the plank
    ctx.strokeStyle = rgba(wood.grain, p.arcs.alpha);
    ctx.lineWidth = 1 * s;
    for (let i = 1; i <= p.arcs.count; i++) {
      ctx.beginPath();
      ctx.ellipse(x + p.arcs.x, y + p.h / 2, p.arcs.spread * i, (p.h * 0.42 * i) / p.arcs.count, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // seams: top highlight, bottom shadow, end joint
  ctx.fillStyle = rgba(wood.highlight, 0.12);
  ctx.fillRect(x, y, p.len, 1 * s);
  ctx.fillStyle = rgba(wood.seam, 0.5);
  ctx.fillRect(x, y + p.h - 1.3 * s, p.len, 1.3 * s);
  ctx.fillStyle = rgba(wood.seam, 0.55);
  ctx.fillRect(x, y, 1.4 * s, p.h);
  ctx.fillStyle = rgba(wood.highlight, 0.1);
  ctx.fillRect(x + 1.4 * s, y, 1 * s, p.h);
  ctx.restore();
}

/** Fine noise speckle with short fibre strokes; light/dark tones derived from the base colour. */
function paintCarpet(ctx, size, baseHex, random) {
  const s = size / 256;
  const light = shade(baseHex, 0.09);
  const dark = shade(baseHex, -0.09);
  fill(ctx, size, baseHex);
  mottle(ctx, size, random, 8, light, dark, 0.06, 0.2, 0.45);
  ctx.lineCap = 'round';
  ctx.lineWidth = 1 * s;
  const strokes = Math.round((size * size) / 40);
  for (let i = 0; i < strokes; i++) {
    const x = random() * size;
    const y = random() * size;
    const a = random() * Math.PI * 2;
    const len = (2 + random() * 4) * s;
    ctx.strokeStyle = rgba(random() < 0.5 ? light : dark, 0.1 + random() * 0.12);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  pixelNoise(ctx, size, 9, random);
}

/** 4 × 4 two-foot slate tiles per 8 ft tile, with grout and per-tile blue-grey variation. */
function paintSlate(ctx, size, _color, random) {
  const s = size / 512;
  const tiles = 4;
  const T = size / tiles;
  const grout = Math.max(2, 3 * s);
  fill(ctx, size, '#9c9d9b');
  for (let j = 0; j < tiles; j++) {
    for (let i = 0; i < tiles; i++) {
      const x = i * T + grout / 2;
      const y = j * T + grout / 2;
      const w = T - grout;
      const base = hsl(206 + random() * 12, 6 + random() * 9, 45 + random() * 7);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, w);
      ctx.clip();
      ctx.fillStyle = base;
      ctx.fillRect(x, y, w, w);
      for (let k = 0; k < 4; k++) {
        blotch(ctx, x + random() * w, y + random() * w, w * (0.25 + random() * 0.3), random() < 0.5 ? '#e8ecef' : '#2f3a44', 0.13);
      }
      // faint cleft lines
      const clefts = 2 + Math.floor(random() * 2);
      for (let k = 0; k < clefts; k++) {
        const cy = y + random() * w;
        const tilt = (random() - 0.5) * w * 0.25;
        ctx.strokeStyle = rgba(random() < 0.5 ? '#f0f3f5' : '#222a33', 0.08 + random() * 0.07);
        ctx.lineWidth = (0.8 + random()) * s;
        ctx.beginPath();
        ctx.moveTo(x, cy);
        ctx.lineTo(x + w, cy + tilt);
        ctx.stroke();
      }
      // bevel: light top/left, dark bottom/right
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x, y, w, 1.5 * s);
      ctx.fillRect(x, y, 1.5 * s, w);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y + w - 1.5 * s, w, 1.5 * s);
      ctx.fillRect(x + w - 1.5 * s, y, 1.5 * s, w);
      ctx.restore();
    }
  }
  pixelNoise(ctx, size, 5, random);
}

// ---------------------------------------------------------------- wall painters

function paintPlaster(ctx, size, hex, random) {
  fill(ctx, size, hex);
  mottle(ctx, size, random, 10, shade(hex, 0.04), shade(hex, -0.04), 0.07, 0.2, 0.45);
  pixelNoise(ctx, size, 3.5, random);
}

/** Fine woven crosshatch on a warm cream: alternating vertical and horizontal threads with an over/under checker. */
function paintLinen(ctx, size, _color, random) {
  const base = '#e8e0d0';
  const light = shade(base, 0.05);
  const dark = shade(base, -0.06);
  const threads = 48;
  const cell = size / threads;
  fill(ctx, size, base);
  for (let i = 0; i < threads; i++) {
    ctx.fillStyle = rgba(i % 2 ? light : dark, 0.1);
    ctx.fillRect(i * cell, 0, cell, size);
  }
  for (let j = 0; j < threads; j++) {
    ctx.fillStyle = rgba(j % 2 ? light : dark, 0.1);
    ctx.fillRect(0, j * cell, size, cell);
  }
  ctx.fillStyle = rgba(dark, 0.07);
  for (let j = 0; j < threads; j++) {
    for (let i = 0; i < threads; i++) {
      if ((i + j) % 2) continue;
      ctx.fillRect(i * cell + cell * 0.2, j * cell + cell * 0.2, cell * 0.6, cell * 0.6);
    }
  }
  pixelNoise(ctx, size, 3, random);
}

/** Alpine geometric: 2 ft bands of mountain chevrons with snow caps and diamond accents in two muted sage tones. */
function paintAlpine(ctx, size, _color, random) {
  const cream = '#ece5d7';
  const sage = '#93a288';
  const pale = '#b9c2ad';
  const bands = 2;
  const band = size / bands;
  fill(ctx, size, cream);
  const triangle = (cx, baseY, halfW, height, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - halfW, baseY);
    ctx.lineTo(cx, baseY - height);
    ctx.lineTo(cx + halfW, baseY);
    ctx.closePath();
    ctx.fill();
  };
  const diamond = (cx, cy, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  };
  for (let b = 0; b < bands; b++) {
    const baseY = (b + 1) * band;
    const offset = b % 2 ? band / 2 : 0;
    for (let k = 0; k < bands; k++) {
      const cx = k * band + offset + band / 2;
      wrapped(size, cx, baseY, band / 2, (px) => {
        triangle(px, baseY, band * 0.5, band * 0.58, sage);
        triangle(px, baseY - band * 0.36, band * 0.5 * 0.38, band * 0.58 * 0.38, pale);
        diamond(px + band / 2, baseY - band * 0.78, band * 0.05, sage);
      });
    }
    ctx.fillStyle = rgba(sage, 0.35);
    ctx.fillRect(0, baseY - band, size, 1.5 * (size / 512));
  }
  pixelNoise(ctx, size, 3, random);
}

/** Running-bond white brick: 6 bricks × 18 courses per 4 ft (8 in × 2.67 in incl. mortar). */
function paintBrick(ctx, size, _color, random) {
  const s = size / 512;
  const courses = 18;
  const perRow = 6;
  const ch = size / courses;
  const bw = size / perRow;
  const mortar = 3.8 * s;
  const tones = ['#ece8e1', '#e6e1d9', '#f0ece6', '#e2ddd4', '#e9e4dc'];
  fill(ctx, size, '#cfcac1');
  for (let r = 0; r < courses; r++) {
    const offset = r % 2 ? bw / 2 : 0;
    for (let k = 0; k < perRow; k++) {
      const x = k * bw + offset;
      const y = r * ch;
      const tone = pick(random, tones);
      const flaw = random() < 0.35 ? { x: random(), y: random() } : null;
      const draw = (bx) => {
        roundedRect(ctx, bx + mortar / 2, y + mortar / 2, bw - mortar, ch - mortar, 1.5 * s);
        ctx.fillStyle = tone;
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        ctx.fillRect(bx + mortar / 2, y + ch - mortar / 2 - 1.5 * s, bw - mortar, 1.5 * s);
        if (flaw) {
          ctx.fillStyle = 'rgba(90,80,70,0.08)';
          ctx.beginPath();
          ctx.arc(bx + mortar + flaw.x * (bw - mortar * 2), y + mortar + flaw.y * (ch - mortar * 2), 1.5 * s, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      draw(x);
      if (x + bw > size) draw(x - size);
    }
  }
  pixelNoise(ctx, size, 3.5, random);
}
