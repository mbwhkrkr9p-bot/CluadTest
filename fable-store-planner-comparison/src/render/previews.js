// 2D canvas card icons for the build kit, the finish panel and the drag ghost.
// Fixtures are drawn with primitives in a small oblique (cabinet) projection so they
// read as 3/4 views; doors and windows are drawn as front elevations. No DOM, no
// three.js and no assets: the only thing touched is the CanvasRenderingContext2D.
import { CATALOG_BY_ID } from '../core/catalog.js';

// App palette (mirrors materials.PALETTE / fixtures.FIXTURE_COLORS without importing THREE).
const C = Object.freeze({
  charcoal: '#2f2b28', brown: '#6b4a2f', wood: '#a57c52', lightWood: '#c9a877', darkWood: '#5a3e2b',
  chrome: '#c4c9cf', metal: '#9aa0a6', darkMetal: '#3a3d40', steel: '#556270',
  cream: '#e9e2d3', white: '#f2efe9', glass: '#bfe0f2', fabric: '#c9b79c',
  terracotta: '#b9613a', sage: '#7f9270', amber: '#e0a33b', blue: '#3f6d9c',
  safetyYellow: '#e8b62c', safetyOrange: '#e07a2f', wall: '#ebe4d8', floor: '#d8d0c2',
});

// Oblique projection: x right, y up, z toward the viewer. Depth is drawn at half length
// along a 30 degree axis, so the back of a fixture sits up and to the right of its front.
const DEPTH_X = 0.5 * Math.cos(Math.PI / 6);
const DEPTH_Y = 0.5 * Math.sin(Math.PI / 6);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** Lighten (t > 0) or darken (t < 0) a hex colour by a fraction of the way to white/black. */
function shade(hex, t) {
  const target = t > 0 ? 255 : 0;
  const a = Math.abs(t);
  return `rgb(${rgb(hex).map((c) => Math.round(c + (target - c) * a)).join(',')})`;
}
const alpha = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;

// ---------------------------------------------------------------------------- view
/**
 * Fits a W × H × D (feet) bounding volume into w × h pixels (keeping aspect) and returns
 * the projection plus a few sizing facts every painter uses.
 */
function createView(ctx, w, h, dims, compact) {
  const { W, H, D } = dims;
  const dx = (D / 2) * DEPTH_X;
  const dy = (D / 2) * DEPTH_Y;
  const shadowRoom = dims.flat ? 1.05 : 1.35; // room for the drop shadow under the front edge
  const b = { x0: -W / 2 - dx, x1: W / 2 + dx, y0: -H - dy, y1: dy * shadowRoom };
  const pad = compact ? 0.05 : 0.08;
  const scale = Math.min((w * (1 - 2 * pad)) / (b.x1 - b.x0), (h * (1 - 2 * pad)) / (b.y1 - b.y0));
  const ox = w / 2 - ((b.x0 + b.x1) / 2) * scale;
  const oy = h / 2 - ((b.y0 + b.y1) / 2) * scale;
  const lw = Math.max(compact ? 1.4 : 1.2, 2 * Math.min(w / 120, h / 84));
  const p = (x, y, z) => [ox + (x - z * DEPTH_X) * scale, oy + (-y + z * DEPTH_Y) * scale];
  return { ctx, p, scale, lw, compact, W, H, D };
}

function tracePath(v, pts, close) {
  const { ctx } = v;
  ctx.beginPath();
  pts.forEach(([x, y, z], i) => {
    const [sx, sy] = v.p(x, y, z);
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  });
  if (close) ctx.closePath();
}

/** Fills and outlines a closed polygon given in 3D feet. */
function fillPoly(v, pts, fill, stroke = C.charcoal, lw = v.lw) {
  tracePath(v, pts, true);
  if (fill) { v.ctx.fillStyle = fill; v.ctx.fill(); }
  if (stroke) { v.ctx.strokeStyle = stroke; v.ctx.lineWidth = lw; v.ctx.stroke(); }
}

/** Strokes an open polyline given in 3D feet. */
function strokeLine(v, pts, stroke = C.charcoal, lw = v.lw) {
  tracePath(v, pts, false);
  v.ctx.strokeStyle = stroke;
  v.ctx.lineWidth = lw;
  v.ctx.stroke();
}

/** Draws the three visible faces (top, right, front) of a box whose base center is (x, y, z). */
function box(v, x, y, z, W, H, D, color, opts = {}) {
  const { stroke = C.charcoal, lw = v.lw, top = shade(color, 0.28), side = shade(color, -0.22), front = color } = opts;
  const x0 = x - W / 2, x1 = x + W / 2, y1 = y + H, z0 = z - D / 2, z1 = z + D / 2;
  fillPoly(v, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], top, stroke, lw);
  fillPoly(v, [[x1, y, z1], [x1, y1, z1], [x1, y1, z0], [x1, y, z0]], side, stroke, lw);
  fillPoly(v, [[x0, y, z1], [x1, y, z1], [x1, y1, z1], [x0, y1, z1]], front, stroke, lw);
}

/** A screen-facing rectangle (garment, screen, sign) lying in the plane z, bottom edge at y. */
function rectXY(v, x, y, z, W, H, fill, stroke = C.charcoal, lw = v.lw * 0.8) {
  fillPoly(v, [[x - W / 2, y, z], [x + W / 2, y, z], [x + W / 2, y + H, z], [x - W / 2, y + H, z]], fill, stroke, lw);
}

/** A screen-space circle centred on the projected point. Radius is in feet. */
function disc(v, x, y, z, r, fill, stroke = C.charcoal, lw = v.lw * 0.8) {
  const [sx, sy] = v.p(x, y, z);
  v.ctx.beginPath();
  v.ctx.arc(sx, sy, r * v.scale, 0, Math.PI * 2);
  if (fill) { v.ctx.fillStyle = fill; v.ctx.fill(); }
  if (stroke) { v.ctx.strokeStyle = stroke; v.ctx.lineWidth = lw; v.ctx.stroke(); }
}

/** Points of a horizontal ellipse (rx along x, rz along z) at height y. */
function floorRing(cx, y, cz, rx, rz, n = 40) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(t), y, cz + rz * Math.sin(t)]);
  }
  return pts;
}

/** A thick ring lying flat (garment rail, spinner tier): dark edge under a chrome core. */
function chromeRing(v, y, r) {
  const pts = floorRing(0, y, 0, r, r);
  pts.push(pts[0]);
  strokeLine(v, pts, C.charcoal, v.lw * 1.9);
  strokeLine(v, pts, C.chrome, v.lw * 0.9);
}

/** Faint drop shadow under a floor object, nudged toward the viewer for grounding. */
function shadow(v, rx, rz, cx = 0, cz = 0) {
  fillPoly(v, floorRing(cx - rx * 0.06, 0, cz + rz * 0.1, rx, rz), alpha(C.charcoal, v.compact ? 0.1 : 0.14), null);
}

/** Soft shadow a wall panel throws onto its wall (offset down and to the right). */
function wallShadow(v, W, H, z) {
  const o = 0.15;
  fillPoly(v, [[-W / 2 + o, -o, z], [W / 2 + o, -o, z], [W / 2 + o, H - o, z], [-W / 2 + o, H - o, z]], alpha(C.charcoal, 0.12), null);
}

/** Lines of a face grid. o = origin, a/b = the two edge vectors (3D), nu/nv = cell counts. */
function gridFace(v, o, a, b, nu, nv, color, lw) {
  const P = (u, t) => [o[0] + a[0] * u + b[0] * t, o[1] + a[1] * u + b[1] * t, o[2] + a[2] * u + b[2] * t];
  for (let i = 0; i <= nu; i++) strokeLine(v, [P(i / nu, 0), P(i / nu, 1)], color, lw);
  for (let j = 0; j <= nv; j++) strokeLine(v, [P(0, j / nv), P(1, j / nv)], color, lw);
}

/** A chrome hook sticking out of a panel face at (x, y, z) with a small item hanging from it. */
function hookItem(v, x, y, z, color) {
  const tip = [x, y - 0.06, z + 0.55];
  strokeLine(v, [[x, y, z], tip], C.charcoal, v.lw * 1.3);
  strokeLine(v, [[x, y, z], tip], C.chrome, v.lw * 0.6);
  rectXY(v, tip[0], tip[1] - 0.95, tip[2], 0.7, 0.95, color, C.charcoal, v.lw * 0.75);
}

/** Tapered leg: square section narrowing from wt at the top to wb at the bottom. */
function taperedPost(v, x, z, y0, y1, wb, wt, color) {
  const hb = wb / 2, ht = wt / 2, lw = v.lw * 0.8;
  fillPoly(v, [[x + hb, y0, z + hb], [x + hb, y0, z - hb], [x + ht, y1, z - ht], [x + ht, y1, z + ht]], shade(color, -0.22), C.charcoal, lw);
  fillPoly(v, [[x - hb, y0, z + hb], [x + hb, y0, z + hb], [x + ht, y1, z + ht], [x - ht, y1, z + ht]], color, C.charcoal, lw);
}

/** A small display register: dark base with a tilted blue screen. */
function register(v, x, y, z) {
  box(v, x, y, z, 1.6, 0.3, 1.1, C.darkMetal, { lw: v.lw * 0.8 });
  fillPoly(v, [[x - 0.7, y + 0.3, z - 0.4], [x + 0.7, y + 0.3, z - 0.4], [x + 0.7, y + 1.45, z - 0.12], [x - 0.7, y + 1.45, z - 0.12]], C.darkMetal, C.charcoal, v.lw * 0.8);
  fillPoly(v, [[x - 0.55, y + 0.45, z - 0.36], [x + 0.55, y + 0.45, z - 0.36], [x + 0.55, y + 1.3, z - 0.16], [x - 0.55, y + 1.3, z - 0.16]], C.blue, null);
}

// ---------------------------------------------------------------------------- store fixtures
function paintDisplayTable(v, e) {
  const { W, D } = v;
  const H = e.height;
  const inset = 0.35, top = H - 0.3;
  shadow(v, W * 0.55, D * 0.62);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    taperedPost(v, sx * (W / 2 - inset), sz * (D / 2 - inset), 0, top, 0.14, 0.3, C.brown);
  }
  box(v, 0, top, 0, W, 0.3, D, C.brown);
  if (v.compact) return;
  box(v, -W * 0.22, H, D * 0.06, W * 0.3, 0.45, D * 0.42, C.sage, { lw: v.lw * 0.75 });
  box(v, W * 0.22, H, -D * 0.04, W * 0.24, 0.7, D * 0.36, C.terracotta, { lw: v.lw * 0.75 });
}

/** Two small product boxes on a shelf of width W (used by the shelving icons). */
function shelfItems(v, y, W, D, h, color) {
  const lw = v.lw * 0.7;
  box(v, -W * 0.24, y, 0, W * 0.3, h, D * 0.6, color, { lw });
  box(v, W * 0.23, y, 0, W * 0.24, h * 0.72, D * 0.6, shade(color, 0.3), { lw });
}

function paintCustomShelf(v, e) {
  const { W, H, D } = v;
  const levels = clamp(Math.round(e.meta.levels ?? 4), 2, 6);
  const t = 0.15, gap = (H - 0.5) / (levels - 1);
  const items = [C.sage, C.terracotta, C.amber, C.blue];
  shadow(v, W * 0.55, D * 0.75);
  fillPoly(v, [[-W / 2, 0, -D / 2], [W / 2, 0, -D / 2], [W / 2, H, -D / 2], [-W / 2, H, -D / 2]], shade(C.wood, -0.35));
  box(v, -W / 2 + t / 2, 0, 0, t, H, D, C.wood);
  for (let i = 0; i < levels; i++) {
    const y = 0.2 + i * gap;
    box(v, 0, y, 0, W - 2 * t, 0.12, D, C.lightWood, { lw: v.lw * 0.8 });
    if (!v.compact && i < levels - 1) shelfItems(v, y + 0.12, W - 2 * t, D, Math.min(gap - 0.35, 1.1), items[i % items.length]);
  }
  box(v, W / 2 - t / 2, 0, 0, t, H, D, C.wood);
}

function paintGondola(v, e) {
  const { W, H, D } = v;
  const levels = clamp(Math.round(e.meta.levels ?? 4), 2, 6);
  const spine = 0.3, base = 0.35, lw = v.lw * 0.8;
  const gap = (H - base - 0.8) / (levels - 1);
  const depthAt = (i) => (D / 2 - spine / 2) * (1 - 0.4 * (i / (levels - 1)));
  shadow(v, W * 0.55, D * 0.65);
  box(v, 0, 0, 0, W, base, D, C.darkMetal);
  for (let i = 0; i < levels; i++) {
    const d = depthAt(i);
    box(v, 0, base + 0.15 + i * gap, -(spine / 2 + d / 2), W, 0.1, d, C.cream, { lw });
  }
  box(v, 0, base, 0, W, H - base, spine, C.cream);
  for (let i = 0; i < levels; i++) {
    const d = depthAt(i), y = base + 0.15 + i * gap;
    box(v, 0, y, spine / 2 + d / 2, W, 0.1, d, C.cream, { lw });
    if (!v.compact && i < levels - 1) shelfItems(v, y + 0.1, W, d, Math.min(gap - 0.4, 0.9), i % 2 ? C.blue : C.terracotta);
  }
  box(v, 0, H - 0.25, 0, W, 0.25, spine + 0.3, C.darkMetal);
}

/** Shared body of the two four-sided towers: weighted base plate + a tall box. */
function towerBody(v, faceColors) {
  const { W, H, D } = v;
  shadow(v, W * 0.8, D * 0.85);
  box(v, 0, 0, 0, W * 1.15, 0.15, D * 1.15, C.darkMetal);
  box(v, 0, 0.15, 0, W, H - 0.3, D, C.cream, { ...faceColors, stroke: C.darkMetal });
}

function paintGridwallTower(v) {
  const { W, H, D } = v;
  towerBody(v, { top: alpha(C.white, 0.95), front: alpha(C.white, 0.55), side: alpha(C.charcoal, 0.1) });
  const cell = v.compact ? 0.66 : 0.5, lw = v.lw * 0.55, y0 = 0.15, h = H - 0.3;
  const wire = shade(C.metal, -0.25);
  gridFace(v, [-W / 2, y0, D / 2], [W, 0, 0], [0, h, 0], Math.round(W / cell), Math.round(h / cell), wire, lw);
  gridFace(v, [W / 2, y0, D / 2], [0, 0, -D], [0, h, 0], Math.round(D / cell), Math.round(h / cell), shade(C.metal, -0.4), lw);
  box(v, 0, H - 0.15, 0, W, 0.15, D, C.darkMetal);
  if (!v.compact) hookItem(v, -W * 0.15, H * 0.62, D / 2, C.amber);
}

function paintSlatwallTower(v) {
  const { W, H, D } = v;
  towerBody(v, {});
  for (let y = 0.6; y < H - 0.35; y += 0.5) {
    strokeLine(v, [[-W / 2, y, D / 2], [W / 2, y, D / 2], [W / 2, y, -D / 2]], alpha(C.charcoal, 0.5), v.lw * 0.7);
  }
  box(v, 0, H - 0.15, 0, W + 0.1, 0.15, D + 0.1, C.darkWood);
  if (!v.compact) hookItem(v, -W * 0.15, H * 0.62, D / 2, C.sage);
}

/** A garment hanging in the x/y plane (screen facing) from a rail point. */
function garment(v, x, y, z, w, h, color) {
  strokeLine(v, [[x, y, z], [x, y - 0.2, z]], C.charcoal, v.lw * 0.7);
  rectXY(v, x, y - 0.2 - h, z, w, h, color);
}
/** A garment hanging in the z/y plane (seen edge-on, sliding back into the depth axis). */
function garmentSide(v, x, y, z, w, h, color) {
  strokeLine(v, [[x, y, z], [x, y - 0.2, z]], C.charcoal, v.lw * 0.7);
  fillPoly(v, [[x, y - 0.2 - h, z - w / 2], [x, y - 0.2 - h, z + w / 2], [x, y - 0.2, z + w / 2], [x, y - 0.2, z - w / 2]], color, C.charcoal, v.lw * 0.8);
}

function paintFourWayRack(v) {
  const { W, H, D } = v;
  const top = H - 0.2, arm = 0.1, lw = v.lw * 0.8;
  shadow(v, W * 0.5, D * 0.5);
  box(v, 0, 0, 0, 1.3, 0.1, 1.3, C.chrome);
  box(v, 0, top - arm, -D / 4, arm, arm, D / 2, C.chrome, { lw }); // back arm
  box(v, -W / 4, top - arm, 0, W / 2, arm, arm, C.chrome, { lw }); // left arm
  garmentSide(v, -0.85, top - arm, 0, 1.1, 1.75, C.sage);
  box(v, 0, 0.1, 0, 0.14, top - 0.1, 0.14, C.chrome, { lw });     // post
  box(v, W / 4, top - arm, 0, W / 2, arm, arm, C.chrome, { lw }); // right arm
  box(v, 0, top - arm, D / 4, arm, arm, D / 2, C.chrome, { lw });  // front arm
  const colors = [C.terracotta, C.amber, C.blue];
  [0.45, 0.85, 1.25].forEach((x, i) => garmentSide(v, x, top - arm, 0, 1.1, 1.75, colors[i]));
  [0.45, 0.85, 1.25].forEach((z, i) => garment(v, 0, top - arm, z, 1.1, 1.75, colors[(i + 1) % 3]));
}

function paintRoundRack(v) {
  const { W, H } = v;
  const r = W / 2 - 0.15, top = H - 0.15;
  const colors = [C.sage, C.terracotta, C.amber, C.blue];
  const spots = [];
  for (let i = 0; i < 8; i++) {
    const t = (i + 0.5) * (Math.PI / 4);
    spots.push({ x: r * Math.cos(t), z: r * Math.sin(t), color: colors[i % 4] });
  }
  spots.sort((a, b) => a.z - b.z);
  shadow(v, W * 0.55, W * 0.55);
  fillPoly(v, floorRing(0, 0.06, 0, 0.95, 0.95), C.chrome, C.charcoal, v.lw * 0.8);
  spots.filter((s) => s.z < 0).forEach((s) => garment(v, s.x, top, s.z, 0.85, 1.75, s.color));
  box(v, 0, 0.06, 0, 0.14, top - 0.06, 0.14, C.chrome, { lw: v.lw * 0.8 });
  chromeRing(v, top, r);
  spots.filter((s) => s.z >= 0).forEach((s) => garment(v, s.x, top, s.z, 0.85, 1.75, s.color));
}

function caster(v, x, z) {
  disc(v, x, 0.15, z, 0.16, C.darkMetal, C.charcoal, v.lw * 0.6);
}

function paintRollingRack(v) {
  const { W, H, D } = v;
  const xp = W / 2 - 0.25, rail = H - 0.12, lw = v.lw * 0.8;
  shadow(v, W * 0.5, D * 0.7);
  caster(v, -xp, -D / 2 + 0.2); caster(v, xp, -D / 2 + 0.2);
  for (const x of [-xp, xp]) {
    box(v, x, 0.25, 0, 0.12, 0.1, D, C.chrome, { lw });
    box(v, x, 0.35, 0, 0.12, rail - 0.35, 0.12, C.chrome, { lw });
  }
  caster(v, -xp, D / 2 - 0.2); caster(v, xp, D / 2 - 0.2);
  const colors = [C.terracotta, C.sage, C.amber, C.blue, C.cream];
  const n = clamp(Math.round(W / 1.1), 2, 6), span = W - 1.6;
  for (let i = 0; i < n; i++) garment(v, -span / 2 + (span * i) / (n - 1), rail, 0, 1.05, 2.4, colors[i % colors.length]);
  box(v, 0, rail, 0, W, 0.12, 0.12, C.chrome, { lw });
}

function paintDumpBin(v, e) {
  const { W, D } = v;
  const H = e.height, wb = W * 0.72, db = D * 0.72;
  shadow(v, W * 0.55, D * 0.6);
  fillPoly(v, [[-W / 2, H, D / 2], [W / 2, H, D / 2], [W / 2, H, -D / 2], [-W / 2, H, -D / 2]], shade(C.terracotta, -0.55));
  fillPoly(v, [[wb / 2, 0, db / 2], [wb / 2, 0, -db / 2], [W / 2, H, -D / 2], [W / 2, H, D / 2]], shade(C.terracotta, -0.22));
  fillPoly(v, [[-wb / 2, 0, db / 2], [wb / 2, 0, db / 2], [W / 2, H, D / 2], [-W / 2, H, D / 2]], C.terracotta);
  disc(v, -0.55, H + 0.05, -0.3, 0.33, C.amber);
  disc(v, 0.45, H + 0.1, -0.5, 0.36, C.sage);
  disc(v, 0.05, H, 0.15, 0.3, C.cream);
  if (!v.compact) rectXY(v, 0, H * 0.3, D / 2 + 0.01, 1.0, 0.6, C.amber, C.charcoal, v.lw * 0.7);
}

function paintSpinnerRack(v) {
  const { W, H } = v;
  const r = W / 2 - 0.1, tiers = 4, gap = (H - 1.7) / (tiers - 1);
  shadow(v, W * 0.75, W * 0.75);
  fillPoly(v, floorRing(0, 0.05, 0, r, r), C.darkMetal, C.charcoal, v.lw * 0.8);
  box(v, 0, 0.05, 0, 0.1, H - 0.35, 0.1, C.chrome, { lw: v.lw * 0.8 });
  for (let i = 0; i < tiers; i++) {
    const y = 1.0 + i * gap;
    chromeRing(v, y, r);
    [1.15, 1.4, 1.65, 1.9].forEach((k, j) => {
      const t = k * Math.PI;
      rectXY(v, r * Math.cos(t), y - 0.6, r * Math.sin(t), 0.42, 0.6, j % 2 ? C.amber : C.cream, C.charcoal, v.lw * 0.6);
    });
  }
  disc(v, 0, H - 0.2, 0, 0.17, C.chrome);
}

function paintGlassShowcase(v) {
  const { W, H, D } = v;
  const plinth = H * 0.4, lw = v.lw * 0.6;
  shadow(v, W * 0.55, D * 0.7);
  box(v, 0, 0, 0, W, plinth, D, C.darkWood);
  if (!v.compact) {
    box(v, -W * 0.25, plinth, 0, 0.6, 0.45, 0.5, C.amber, { lw });
    box(v, W * 0.1, plinth, 0.15, 0.5, 0.35, 0.5, C.terracotta, { lw });
    box(v, W * 0.33, plinth, -0.2, 0.4, 0.65, 0.4, C.sage, { lw });
  }
  const frame = shade(C.metal, -0.3);
  box(v, 0, plinth, 0, W, H - plinth, D, C.glass, { top: alpha(C.glass, 0.45), side: alpha(C.glass, 0.75), front: alpha(C.glass, 0.5), stroke: frame, lw: v.lw * 0.9 });
  strokeLine(v, [[-W / 2 + 0.4, plinth + 0.25, D / 2], [-W / 2 + 1.3, H - 0.25, D / 2]], 'rgba(255,255,255,0.75)', v.lw * 0.8);
}

function paintMannequin(v) {
  const { H } = v;
  const body = C.cream, lw = v.lw * 0.9;
  shadow(v, 0.95, 0.95);
  fillPoly(v, floorRing(0, 0.05, 0, 0.7, 0.7), C.chrome, C.charcoal, v.lw * 0.8);
  box(v, 0, 0.05, 0, 0.1, 1.6, 0.1, C.darkMetal, { lw: v.lw * 0.8 });
  fillPoly(v, [[-0.42, 1.6, 0], [0.42, 1.6, 0], [0.38, 2.8, 0], [-0.38, 2.8, 0]], body, C.charcoal, lw);
  fillPoly(v, [[-0.38, 2.8, 0], [0.38, 2.8, 0], [0.55, 4.2, 0], [0.6, 4.85, 0], [-0.6, 4.85, 0], [-0.55, 4.2, 0]], body, C.charcoal, lw);
  fillPoly(v, [[-0.15, 4.8, 0], [0.15, 4.8, 0], [0.15, 5.15, 0], [-0.15, 5.15, 0]], body, C.charcoal, lw);
  disc(v, 0, Math.min(H - 0.45, 5.55), 0, 0.42, body, C.charcoal, lw);
}

function paintServiceCounter(v, e) {
  const { W, D } = v;
  const ch = e.height - 0.45;
  shadow(v, W * 0.55, D * 0.7);
  box(v, 0, 0, 0, W, ch, D, C.brown);
  if (!v.compact) {
    const z = D / 2 + 0.001, dark = alpha(C.charcoal, 0.45), lw = v.lw * 0.7;
    fillPoly(v, [[-W / 2 + 0.5, 0.5, z], [-W / 2 + 2.0, 0.5, z], [-W / 2 + 2.0, ch - 0.7, z], [-W / 2 + 0.5, ch - 0.7, z]], null, dark, lw);
    strokeLine(v, [[-W / 2 + 0.5, (ch - 0.2) / 2, z], [-W / 2 + 2.0, (ch - 0.2) / 2, z]], dark, lw);
  }
  register(v, W * 0.22, ch, -D * 0.15);
  box(v, 0, ch, D / 2 - 0.35, W, 0.45, 0.7, C.lightWood);
}

// ---------------------------------------------------------------------------- wall panels
function paintSlatwallPanel(v) {
  const { W, H } = v;
  const t = 0.15;
  wallShadow(v, W, H, t / 2);
  box(v, 0, 0, 0, W, H, t, C.cream, { side: shade(C.cream, -0.3) });
  for (let y = 0.45; y < H - 0.25; y += 0.5) strokeLine(v, [[-W / 2, y, t / 2], [W / 2, y, t / 2]], alpha(C.charcoal, 0.5), v.lw * 0.7);
  if (v.compact) return;
  hookItem(v, -W * 0.22, H * 0.7, t / 2, C.sage);
  hookItem(v, W * 0.2, H * 0.47, t / 2, C.terracotta);
}

function paintGridwallPanel(v) {
  const { W, H } = v;
  const z = 0.1, cell = v.compact ? 0.66 : 0.5;
  wallShadow(v, W, H, 0);
  for (const y of [0.2, H - 0.5]) {
    box(v, -W / 2 + 0.4, y, 0, 0.3, 0.3, 0.2, C.darkMetal, { lw: v.lw * 0.6 });
    box(v, W / 2 - 0.4, y, 0, 0.3, 0.3, 0.2, C.darkMetal, { lw: v.lw * 0.6 });
  }
  gridFace(v, [-W / 2, 0, z], [W, 0, 0], [0, H, 0], Math.round(W / cell), Math.round(H / cell), shade(C.metal, -0.25), v.lw * 0.6);
  fillPoly(v, [[-W / 2, 0, z], [W / 2, 0, z], [W / 2, H, z], [-W / 2, H, z]], null, C.darkMetal, v.lw * 1.1);
  if (!v.compact) hookItem(v, W * 0.05, H * 0.66, z, C.amber);
}

function paintPegboardPanel(v) {
  const { W, H } = v;
  const t = 0.1, step = v.compact ? 0.5 : 0.4;
  wallShadow(v, W, H, t / 2);
  box(v, 0, 0, 0, W, H, t, C.cream, { side: shade(C.cream, -0.3) });
  v.ctx.fillStyle = alpha(C.charcoal, 0.55);
  for (let x = -W / 2 + step; x < W / 2 - step / 2; x += step) {
    for (let y = step; y < H - step / 2; y += step) {
      const [sx, sy] = v.p(x, y, t / 2);
      v.ctx.beginPath();
      v.ctx.arc(sx, sy, Math.max(0.8, 0.065 * v.scale), 0, Math.PI * 2);
      v.ctx.fill();
    }
  }
  if (v.compact) return;
  hookItem(v, -W * 0.24, H * 0.72, t / 2, C.blue);
  hookItem(v, W * 0.2, H * 0.55, t / 2, C.amber);
}

// ---------------------------------------------------------------------------- warehouse
/** Zig-zag bracing between the two posts of an upright frame, in the plane x. */
function bracing(v, x, z0, z1, H) {
  const n = Math.max(2, Math.round(H / 2.6));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([x, (H * i) / n, i % 2 ? z1 : z0]);
  strokeLine(v, pts, shade(C.blue, -0.3), v.lw * 0.6);
}

function paintPalletRack(v, e) {
  const { W, H, D } = v;
  const levels = clamp(Math.round(e.meta.levels ?? 3), 2, 6);
  const xf = W / 2 - 0.2, zf = D / 2 - 0.15, post = 0.3, gap = H / (levels + 1);
  const lw = v.lw * 0.8, beamLen = W - 0.7;
  shadow(v, W * 0.52, D * 0.72);
  box(v, -xf, 0, -zf, post, H, post, C.blue, { lw });
  box(v, xf, 0, -zf, post, H, post, C.blue, { lw });
  bracing(v, -xf + post / 2, zf, -zf, H);
  for (let i = 0; i < levels; i++) {
    const y = gap * (i + 1), loadH = Math.min(2.2, gap - 1.4);
    box(v, 0, y, -zf, beamLen, 0.5, 0.25, C.safetyOrange, { lw });
    for (const x of [-W / 4, W / 4]) {
      box(v, x, y + 0.5, 0, W * 0.36, 0.3, D - 0.9, C.wood, { lw: v.lw * 0.6 });
      box(v, x, y + 0.8, 0, W * 0.34, loadH, D - 1.0, C.fabric, { lw: v.lw * 0.7 });
    }
    box(v, 0, y, zf, beamLen, 0.5, 0.25, C.safetyOrange, { lw });
  }
  box(v, -xf, 0, zf, post, H, post, C.blue, { lw });
  box(v, xf, 0, zf, post, H, post, C.blue, { lw });
  bracing(v, xf + post / 2, zf, -zf, H);
}

function paintPalletMarker(v) {
  const { W, D } = v;
  const y = 0.01, m = 0.35, len = 0.9;
  const outer = [[-W / 2, y, D / 2], [W / 2, y, D / 2], [W / 2, y, -D / 2], [-W / 2, y, -D / 2]];
  fillPoly(v, outer, alpha(C.safetyYellow, 0.18), C.charcoal, v.lw * 2.3);
  fillPoly(v, outer, null, C.safetyYellow, v.lw * 1.3);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = sx * (W / 2 - m), cz = sz * (D / 2 - m);
    strokeLine(v, [[cx - sx * len, y, cz], [cx, y, cz], [cx, y, cz - sz * len]], C.charcoal, v.lw * 2.1);
    strokeLine(v, [[cx - sx * len, y, cz], [cx, y, cz], [cx, y, cz - sz * len]], C.safetyYellow, v.lw * 1.1);
  }
  box(v, -W / 2 + 0.95, y, D / 2 - 0.5, 1.3, 0.05, 0.55, C.charcoal, { lw: v.lw * 0.5 });
  strokeLine(v, [[-W / 2 + 0.5, 0.08, D / 2 - 0.5], [-W / 2 + 1.3, 0.08, D / 2 - 0.5]], C.white, v.lw * 0.6);
}

function wireShelf(v, y, W, D) {
  box(v, 0, y, 0, W, 0.15, D, C.chrome, { lw: v.lw * 0.7 });
  if (v.compact) return;
  for (let x = -W / 2 + 0.35; x < W / 2 - 0.2; x += 0.35) {
    strokeLine(v, [[x, y + 0.15, D / 2], [x, y + 0.15, -D / 2]], shade(C.chrome, -0.35), v.lw * 0.45);
  }
}

function paintWireShelving(v, e) {
  const { W, H, D } = v;
  const levels = clamp(Math.round(e.meta.levels ?? 4), 2, 7);
  const xp = W / 2 - 0.1, zp = D / 2 - 0.1, t = 0.1, lw = v.lw * 0.7;
  const gap = (H - 0.6) / (levels - 1);
  shadow(v, W * 0.55, D * 0.75);
  box(v, -xp, 0, -zp, t, H, t, C.chrome, { lw });
  box(v, xp, 0, -zp, t, H, t, C.chrome, { lw });
  for (let i = 0; i < levels; i++) {
    const y = 0.3 + i * gap;
    wireShelf(v, y, W, D);
    if (v.compact || i === levels - 1 || i % 2) continue;
    const bh = Math.min(1.4, gap - 0.5);
    box(v, -W * 0.22, y + 0.15, 0, W * 0.34, bh, D * 0.7, C.fabric, { lw });
    box(v, W * 0.2, y + 0.15, 0.05, W * 0.28, bh * 0.7, D * 0.6, shade(C.fabric, -0.12), { lw });
  }
  box(v, -xp, 0, zp, t, H, t, C.chrome, { lw });
  box(v, xp, 0, zp, t, H, t, C.chrome, { lw });
}

function paintPackingStation(v) {
  const { W, H, D } = v;
  const bench = 2.9, xp = W / 2 - 0.2, zp = D / 2 - 0.2, lw = v.lw * 0.8;
  shadow(v, W * 0.55, D * 0.72);
  for (const x of [-xp, xp]) {
    box(v, x, 0, -zp, 0.15, bench, 0.15, C.steel, { lw });
    box(v, x, bench, -zp, 0.15, H - bench, 0.15, C.steel, { lw });
  }
  box(v, 0, H - 0.35, -zp + 0.55, W, 0.12, 1.2, C.wood, { lw });
  box(v, 0, H - 1.3, -zp + 0.45, W - 1.2, 0.5, 0.5, C.cream, { lw: v.lw * 0.7 });
  box(v, 0, bench, 0, W, 0.2, D, C.wood);
  box(v, -xp, 0, zp, 0.15, bench, 0.15, C.steel, { lw });
  box(v, xp, 0, zp, 0.15, bench, 0.15, C.steel, { lw });
  const mz = -zp + 0.6, mx = xp - 0.9;
  strokeLine(v, [[xp, bench + 1.7, -zp], [mx, bench + 1.7, mz]], C.darkMetal, v.lw * 0.9);
  fillPoly(v, [[mx - 0.7, bench + 1.15, mz], [mx + 0.7, bench + 1.15, mz], [mx + 0.7, bench + 2.15, mz], [mx - 0.7, bench + 2.15, mz]], C.darkMetal, C.charcoal, lw);
  fillPoly(v, [[mx - 0.58, bench + 1.27, mz], [mx + 0.58, bench + 1.27, mz], [mx + 0.58, bench + 2.03, mz], [mx - 0.58, bench + 2.03, mz]], C.blue, null);
  box(v, -W * 0.22, bench + 0.2, 0.15, 1.4, 1.0, 1.15, C.fabric, { lw: v.lw * 0.7 });
  if (!v.compact) disc(v, W * 0.2, bench + 0.35, 0.4, 0.22, C.amber, C.charcoal, v.lw * 0.6);
}

/** Striped reserved zone: tinted floor rectangle with a yellow/charcoal hatched border. */
function stripedZone(v, W, D) {
  const y = 0.01, band = v.lw * 1.7;
  const rect = [[-W / 2, y, D / 2], [W / 2, y, D / 2], [W / 2, y, -D / 2], [-W / 2, y, -D / 2]];
  fillPoly(v, rect, alpha(C.safetyYellow, 0.16), C.safetyYellow, band);
  v.ctx.lineCap = 'butt';
  v.ctx.setLineDash([band * 1.1, band * 1.1]);
  fillPoly(v, rect, null, C.charcoal, band);
  v.ctx.setLineDash([]);
  v.ctx.lineCap = 'round';
}

function paintForklift(v) {
  const { W, D } = v;
  const lw = v.lw * 0.8, zc = -0.5; // the truck sits slightly back in its zone, forks toward the viewer
  stripedZone(v, W, D);
  shadow(v, 2.6, 4.0, 0, zc + 0.8);
  for (const [x, z] of [[-2.0, zc - 1.9], [2.0, zc - 1.9], [-2.0, zc + 1.7], [2.0, zc + 1.7]]) disc(v, x, 0.6, z, 0.6, C.darkMetal, C.charcoal, lw);
  box(v, 0, 0.55, zc, 4.0, 1.7, 5.2, C.safetyYellow);
  box(v, 0, 2.25, zc - 0.9, 1.2, 0.5, 1.0, C.charcoal, { lw });
  disc(v, 0, 3.0, zc + 0.6, 0.35, null, C.charcoal, lw);
  for (const x of [-1.6, 1.6]) box(v, x, 2.25, zc - 2.2, 0.15, 3.9, 0.15, C.steel, { lw: v.lw * 0.6 });
  box(v, 0, 6.1, zc - 0.6, 3.4, 0.2, 3.4, C.steel, { lw });
  for (const x of [-0.8, 0.8]) box(v, x, 0.3, zc + 2.9, 0.28, 6.2, 0.28, C.darkMetal, { lw });
  box(v, 0, 6.3, zc + 2.9, 1.9, 0.25, 0.28, C.darkMetal, { lw });
  box(v, 0, 0.3, zc + 3.2, 2.6, 1.1, 0.25, C.darkMetal, { lw });
  for (const x of [-0.65, 0.65]) box(v, x, 0.12, zc + 5.1, 0.3, 0.16, 3.6, C.metal, { lw: v.lw * 0.7 });
}

// ---------------------------------------------------------------------------- elevations (doors, windows)
function createElevation(ctx, w, h) {
  return { ctx, w, h, lw: Math.max(1.2, (2 * Math.min(w, h)) / 84) };
}

function rect2(el, x, y, w, h, fill, stroke = C.charcoal, lw = el.lw) {
  const { ctx } = el;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

/** A diagonal light reflection inside a glass pane. */
function paneHighlight(el, x, y, w, h) {
  const { ctx } = el;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, y + h * 0.85);
  ctx.lineTo(x + w * 0.55, y + h * 0.15);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = el.lw * 0.8;
  ctx.stroke();
}

/** Wall tile with a floor band along the bottom; returns the floor line y. */
function backdrop(el) {
  const floorY = el.h * 0.86;
  rect2(el, 0, 0, el.w, el.h, C.wall, null);
  rect2(el, 0, floorY, el.w, el.h - floorY, C.floor, null);
  return floorY;
}

function glassLeaf(el, x, y, w, h, latch) {
  rect2(el, x, y, w, h, C.glass, shade(C.metal, -0.3), el.lw);
  paneHighlight(el, x, y, w, h);
  const hx = latch === 'right' ? x + w * 0.82 : x + w * 0.18;
  rect2(el, hx - el.lw * 0.6, y + h * 0.3, el.lw * 1.2, h * 0.36, C.charcoal, null);
}

function oakLeaf(el, x, y, w, h, latch, color = C.lightWood) {
  rect2(el, x, y, w, h, color, C.brown, el.lw);
  const inset = shade(color, -0.12), edge = shade(color, -0.5);
  rect2(el, x + w * 0.18, y + h * 0.09, w * 0.64, h * 0.34, inset, edge, el.lw * 0.7);
  rect2(el, x + w * 0.18, y + h * 0.53, w * 0.64, h * 0.38, inset, edge, el.lw * 0.7);
  const kx = latch === 'right' ? x + w * 0.85 : x + w * 0.15;
  el.ctx.beginPath();
  el.ctx.arc(kx, y + h * 0.5, el.lw * 1.1, 0, Math.PI * 2);
  el.ctx.fillStyle = C.charcoal;
  el.ctx.fill();
}

function frenchLeaf(el, x, y, w, h, latch) {
  rect2(el, x, y, w, h, C.lightWood, C.brown, el.lw);
  const gx = x + w * 0.15, gy = y + h * 0.08, gw = w * 0.7, gh = h * 0.66;
  rect2(el, gx, gy, gw, gh, C.glass, C.brown, el.lw * 0.9);
  for (let i = 1; i < 2; i++) rect2(el, gx + (gw * i) / 2 - el.lw * 0.35, gy, el.lw * 0.7, gh, C.brown, null);
  for (let j = 1; j < 4; j++) rect2(el, gx, gy + (gh * j) / 4 - el.lw * 0.35, gw, el.lw * 0.7, C.brown, null);
  const kx = latch === 'right' ? x + w * 0.88 : x + w * 0.12;
  el.ctx.beginPath();
  el.ctx.arc(kx, y + h * 0.5, el.lw * 1.0, 0, Math.PI * 2);
  el.ctx.fillStyle = C.charcoal;
  el.ctx.fill();
}

function darkWoodLeaf(el, x, y, w, h, latch) {
  rect2(el, x, y, w, h, C.darkWood, C.charcoal, el.lw);
  const lx = latch === 'right' ? x + w * 0.62 : x + w * 0.22;
  rect2(el, lx, y + h * 0.1, w * 0.16, h * 0.45, C.glass, shade(C.metal, -0.4), el.lw * 0.7);
  const hx = latch === 'right' ? x + w * 0.6 : x + w * 0.16;
  rect2(el, hx, y + h * 0.6 - el.lw * 0.5, w * 0.24, el.lw * 1.0, C.chrome, null);
}

function steelLeaf(el, x, y, w, h, latch) {
  rect2(el, x, y, w, h, '#2b2b2b', C.charcoal, el.lw);
  const m = el.lw * 0.8;
  rect2(el, x + m, y + h * 0.78, w - 2 * m, h * 0.2 - m, C.chrome, shade(C.metal, -0.4), el.lw * 0.6);
  const hx = latch === 'right' ? x + w * 0.8 : x + w * 0.2;
  rect2(el, hx - el.lw * 0.65, y + h * 0.28, el.lw * 1.3, h * 0.36, C.chrome, shade(C.metal, -0.4), el.lw * 0.5);
}

const DOOR_STYLE_SPECS = {
  'full-glass': { leaves: 1, aspect: 0.78, leaf: glassLeaf, frame: shade(C.metal, -0.35) },
  'double-glass': { leaves: 2, aspect: 0.95, leaf: glassLeaf, frame: shade(C.metal, -0.35) },
  'french-oak': { leaves: 2, aspect: 0.95, leaf: frenchLeaf, frame: C.brown },
  'natural-oak': { leaves: 1, aspect: 0.52, leaf: oakLeaf, frame: C.brown },
  'double-oak': { leaves: 2, aspect: 0.95, leaf: oakLeaf, frame: C.brown },
  'dark-wood': { leaves: 1, aspect: 0.52, leaf: darkWoodLeaf, frame: C.darkWood },
  'black-steel': { leaves: 1, aspect: 0.52, leaf: steelLeaf, frame: C.charcoal },
};

function paintDoorElevation(ctx, styleId, w, h) {
  const spec = DOOR_STYLE_SPECS[styleId];
  if (!spec) throw new Error(`Unknown door style: ${styleId}`);
  const el = createElevation(ctx, w, h);
  const floorY = backdrop(el);
  const dh = Math.min(h * 0.74, (w * 0.8) / spec.aspect);
  const dw = dh * spec.aspect, x = (w - dw) / 2, y = floorY - dh, f = el.lw * 1.6;
  rect2(el, x - f, y - f, dw + 2 * f, dh + f, spec.frame, C.charcoal, el.lw * 0.6);
  if (spec.leaves === 1) {
    spec.leaf(el, x, y, dw, dh, 'right');
  } else {
    spec.leaf(el, x, y, dw / 2, dh, 'right');
    spec.leaf(el, x + dw / 2, y, dw / 2, dh, 'left');
    rect2(el, x + dw / 2 - el.lw * 0.4, y, el.lw * 0.8, dh, spec.frame, null);
  }
}

const WINDOW_STYLE_SPECS = {
  picture: { aspect: 4 / 3, cols: 1, rows: 1, heightFrac: 0.48, sill: true },
  double: { aspect: 6 / 3.5, cols: 2, rows: 1, heightFrac: 0.44, sill: true },
  storefront: { aspect: 8 / 7, cols: 3, rows: 2, heightFrac: 0.8, bulkhead: true },
};

function paintWindowElevation(ctx, styleId, w, h) {
  const spec = WINDOW_STYLE_SPECS[styleId];
  if (!spec) throw new Error(`Unknown window style: ${styleId}`);
  const el = createElevation(ctx, w, h);
  const floorY = backdrop(el);
  const wh = Math.min(h * spec.heightFrac, (w * 0.84) / spec.aspect);
  const ww = wh * spec.aspect, x = (w - ww) / 2;
  const y = spec.bulkhead ? floorY - wh : floorY * 0.62 - wh / 2;
  const f = Math.max(el.lw * 1.4, ww * 0.045);
  rect2(el, x, y, ww, wh, C.white, C.charcoal, el.lw);
  const bulk = spec.bulkhead ? wh * 0.16 : 0;
  const gx = x + f, gy = y + f, gw = ww - 2 * f, gh = wh - 2 * f - bulk;
  rect2(el, gx, gy, gw, gh, C.glass, null);
  const rowSplit = spec.rows > 1 ? [0, gh * 0.28, gh] : [0, gh];
  for (let c = 0; c < spec.cols; c++) {
    for (let r = 0; r < rowSplit.length - 1; r++) {
      const px = gx + (gw * c) / spec.cols, pw = gw / spec.cols;
      const py = gy + rowSplit[r], ph = rowSplit[r + 1] - rowSplit[r];
      rect2(el, px, py, pw, ph, null, C.white, f * 0.7);
      paneHighlight(el, px, py, pw, ph);
    }
  }
  rect2(el, gx, gy, gw, gh, null, C.charcoal, el.lw * 0.6);
  if (spec.bulkhead) rect2(el, x + f, gy + gh, ww - 2 * f, bulk, C.darkMetal, C.charcoal, el.lw * 0.6);
  if (spec.sill) rect2(el, x - f, y + wh - el.lw * 0.3, ww + 2 * f, f, shade(C.cream, -0.2), C.charcoal, el.lw * 0.7);
}

// ---------------------------------------------------------------------------- registry + public API
/** Wraps a fixture painter: fits its bounding volume and hands it a view. */
const fixture = (dims, paint) => (ctx, w, h, e, compact) => paint(createView(ctx, w, h, dims(e, compact), compact), e);
const plain = (e) => ({ W: e.width, H: e.height, D: e.depth });
const panel = (e, compact) => ({ W: e.width, H: e.height, D: compact ? 0.3 : 0.75 });

const PAINTERS = {
  'display-table': fixture((e, c) => ({ W: e.width, H: e.height + (c ? 0.1 : 0.8), D: e.depth }), paintDisplayTable),
  'custom-shelf': fixture(plain, paintCustomShelf),
  'gondola': fixture(plain, paintGondola),
  'gridwall-tower': fixture(plain, paintGridwallTower),
  'slatwall-tower': fixture(plain, paintSlatwallTower),
  'four-way-rack': fixture(plain, paintFourWayRack),
  'round-rack': fixture(plain, paintRoundRack),
  'rolling-rack': fixture(plain, paintRollingRack),
  'dump-bin': fixture((e) => ({ W: e.width, H: e.height + 0.5, D: e.depth }), paintDumpBin),
  'spinner-rack': fixture(plain, paintSpinnerRack),
  'glass-showcase': fixture(plain, paintGlassShowcase),
  'mannequin': fixture(plain, paintMannequin),
  'service-counter': fixture((e) => ({ W: e.width, H: e.height + 1.05, D: e.depth }), paintServiceCounter),
  'slatwall-panel': fixture(panel, paintSlatwallPanel),
  'gridwall-panel': fixture(panel, paintGridwallPanel),
  'pegboard-panel': fixture(panel, paintPegboardPanel),
  'pallet-rack': fixture(plain, paintPalletRack),
  'pallet-marker': fixture((e) => ({ W: e.width, H: 0.12, D: e.depth, flat: true }), paintPalletMarker),
  'wire-shelving': fixture(plain, paintWireShelving),
  'packing-station': fixture(plain, paintPackingStation),
  'forklift': fixture(plain, paintForklift),
  'door': (ctx, w, h, e) => paintDoorElevation(ctx, e.meta.style ?? 'natural-oak', w, h),
  'window': (ctx, w, h, e) => paintWindowElevation(ctx, e.meta.style ?? 'picture', w, h),
};

/** Every id drawPreview accepts (all catalog defs). */
export const PREVIEW_IDS = Object.freeze(Object.keys(PAINTERS));

/** Sizes/meta for the icon: catalog defaults, tweaked (within limits) by an optional entity. */
function resolveEntity(defId, entity) {
  const def = CATALOG_BY_ID[defId];
  const size = def ? def.size : { width: 4, height: 4, depth: 2 };
  const pick = (key) => {
    const value = Number(entity?.[key]);
    return Number.isFinite(value) && value > 0 ? clamp(value, size[key] * 0.5, size[key] * 2.2) : size[key];
  };
  const meta = {};
  for (const [k, p] of Object.entries(def?.params ?? {})) meta[k] = p.default;
  return { width: pick('width'), height: pick('height'), depth: pick('depth'), meta: { ...meta, ...(entity?.meta ?? {}) } };
}

function withContext(ctx, w, h, paint) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  try { paint(); } finally { ctx.restore(); }
}

/**
 * Draws the catalog card icon for `defId` into a w × h area (cleared to transparent first).
 * opts.entity (width/height/depth/meta) only tweaks proportions; opts.compact draws the
 * denser ghost variant.
 */
export function drawPreview(ctx, defId, w, h, opts = {}) {
  const painter = PAINTERS[defId];
  if (!painter) throw new Error(`Unknown preview id: ${defId}`);
  withContext(ctx, w, h, () => painter(ctx, w, h, resolveEntity(defId, opts.entity), !!opts.compact));
}

/** Front elevation of a door leaf set for the finish panel swatches. */
export function drawDoorPreview(ctx, styleId, w, h) {
  withContext(ctx, w, h, () => paintDoorElevation(ctx, styleId, w, h));
}

/** Front elevation of a window style for the finish panel swatches. */
export function drawWindowPreview(ctx, styleId, w, h) {
  withContext(ctx, w, h, () => paintWindowElevation(ctx, styleId, w, h));
}

/** Compact square icon for the floating drag miniature. */
export function drawGhostIcon(ctx, defId, size) {
  drawPreview(ctx, defId, size, size, { compact: true });
}
