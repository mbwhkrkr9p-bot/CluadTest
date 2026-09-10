// Pure 2D/3D geometry helpers for the planner. No DOM, no three.js.
// Coordinates on the floor are {x, z}. Angles in degrees unless noted.
// Rotation convention matches three.js Object3D.rotation.y (right hand rule about +Y):
//   x' = x·cos θ + z·sin θ,  z' = −x·sin θ + z·cos θ

export const EPS = 1e-6;

const DEG = Math.PI / 180;

export function signedArea(poly) {
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function polygonArea(poly) {
  return Math.abs(signedArea(poly));
}

/** Returns a copy of the polygon in canonical winding (signedArea > 0) with duplicate points removed. */
export function normalizePolygon(poly) {
  const pts = [];
  for (const p of poly) {
    const q = { x: Number(p.x), z: Number(p.z) };
    if (!Number.isFinite(q.x) || !Number.isFinite(q.z)) throw new Error('Polygon vertex is not finite');
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last.x - q.x, last.z - q.z) > EPS) pts.push(q);
  }
  if (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) <= EPS) pts.pop();
  if (pts.length < 3) throw new Error('Polygon needs at least 3 distinct vertices');
  if (signedArea(pts) < 0) pts.reverse();
  return pts;
}

export function polygonBounds(poly) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

export function polygonCentroid(poly) {
  const n = poly.length;
  let cx = 0, cz = 0, a = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const cross = p.x * q.z - q.x * p.z;
    a += cross;
    cx += (p.x + q.x) * cross;
    cz += (p.z + q.z) * cross;
  }
  if (Math.abs(a) < EPS) {
    const b = polygonBounds(poly);
    return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  }
  a *= 0.5;
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

export function distancePointToSegment(pt, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = 0;
  if (len2 > 0) t = Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.z - a.z) * abz) / len2));
  const px = a.x + abx * t, pz = a.z + abz * t;
  return Math.hypot(pt.x - px, pt.z - pz);
}

/** Point in polygon (even-odd). Points on the boundary count as inside. */
export function pointInPolygon(pt, poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    if (distancePointToSegment(pt, poly[i], poly[(i + 1) % n]) <= 1e-6) return true;
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = poly[i], pj = poly[j];
    const intersect = ((pi.z > pt.z) !== (pj.z > pt.z)) &&
      (pt.x < ((pj.x - pi.x) * (pt.z - pi.z)) / (pj.z - pi.z) + pi.x);
    if (intersect) inside = !inside;
  }
  return inside;
}

function cross(ax, az, bx, bz) {
  return ax * bz - az * bx;
}

/** Proper intersection of segments ab and cd. Touching at an endpoint or collinear overlap does not count. */
export function segmentsIntersect(a, b, c, d) {
  const d1 = cross(d.x - c.x, d.z - c.z, a.x - c.x, a.z - c.z);
  const d2 = cross(d.x - c.x, d.z - c.z, b.x - c.x, b.z - c.z);
  const d3 = cross(b.x - a.x, b.z - a.z, c.x - a.x, c.z - a.z);
  const d4 = cross(b.x - a.x, b.z - a.z, d.x - a.x, d.z - a.z);
  return (d1 * d2 < -EPS * EPS) && (d3 * d4 < -EPS * EPS);
}

/** Ray/segment intersection; returns the ray parameter t (>0) or Infinity. */
export function raySegmentDistance(origin, dir, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z;
  const denom = cross(dir.x, dir.z, vx, vz);
  if (Math.abs(denom) < 1e-12) return Infinity;
  const wx = a.x - origin.x, wz = a.z - origin.z;
  const t = cross(wx, wz, vx, vz) / denom;
  const s = cross(wx, wz, dir.x, dir.z) / denom;
  if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) return t;
  return Infinity;
}

// ---------------------------------------------------------------- walls

export function wallFrames(poly) {
  const n = poly.length;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const start = { x: poly[i].x, z: poly[i].z };
    const end = { x: poly[(i + 1) % n].x, z: poly[(i + 1) % n].z };
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    const dir = length > 0 ? { x: dx / length, z: dz / length } : { x: 1, z: 0 };
    const normal = { x: -dir.z || 0, z: dir.x || 0 };
    frames.push({
      index: i,
      start,
      end,
      length,
      dir,
      normal,
      midpoint: { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 },
    });
  }
  return frames;
}

export function wallLocalToWorld(frame, u, v, n = 0) {
  return {
    x: frame.start.x + frame.dir.x * u + frame.normal.x * n,
    y: v,
    z: frame.start.z + frame.dir.z * u + frame.normal.z * n,
  };
}

export function worldToWallLocal(frame, p) {
  const rx = p.x - frame.start.x;
  const rz = p.z - frame.start.z;
  return {
    u: rx * frame.dir.x + rz * frame.dir.z,
    v: p.y ?? 0,
    n: rx * frame.normal.x + rz * frame.normal.z,
  };
}

// ---------------------------------------------------------------- angles & snapping

export function snap(value, step) {
  if (!step) return value;
  return Math.round(value / step) * step;
}

export function normalizeAngle(deg) {
  let a = deg % 360;
  if (a < 0) a += 360;
  if (Math.abs(a - 360) < 1e-9 || Math.abs(a) < 1e-9) a = 0;
  return a;
}

export function snapAngle(deg, step = 15) {
  return normalizeAngle(Math.round(deg / step) * step);
}

export function rotatePoint(pt, deg) {
  const r = deg * DEG;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: pt.x * c + pt.z * s, z: -pt.x * s + pt.z * c };
}

// ---------------------------------------------------------------- oriented boxes

/** Corners in order: front-left, front-right, back-right, back-left (front = +Z before rotation). */
export function obbCorners(obb) {
  const hw = obb.width / 2, hd = obb.depth / 2;
  const local = [
    { x: -hw, z: hd },
    { x: hw, z: hd },
    { x: hw, z: -hd },
    { x: -hw, z: -hd },
  ];
  return local.map((p) => {
    const r = rotatePoint(p, obb.rotation || 0);
    return { x: obb.x + r.x, z: obb.z + r.z };
  });
}

function projectInterval(corners, ax, az) {
  let min = Infinity, max = -Infinity;
  for (const c of corners) {
    const d = c.x * ax + c.z * az;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** Separating axis test. Edge/corner contact is not overlap. */
export function obbOverlap(a, b, eps = 1e-3) {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes = [];
  for (const cs of [ca, cb]) {
    for (let i = 0; i < 2; i++) {
      const p = cs[i], q = cs[i + 1];
      const ex = q.x - p.x, ez = q.z - p.z;
      const len = Math.hypot(ex, ez) || 1;
      axes.push([-ez / len, ex / len]);
    }
  }
  for (const [ax, az] of axes) {
    const [amin, amax] = projectInterval(ca, ax, az);
    const [bmin, bmax] = projectInterval(cb, ax, az);
    if (amax <= bmin + eps || bmax <= amin + eps) return false;
  }
  return true;
}

/** True when a polygon vertex lies strictly inside the obb. */
function anyVertexInsideObb(obb, poly, eps) {
  const hw = obb.width / 2 - eps, hd = obb.depth / 2 - eps;
  if (hw <= 0 || hd <= 0) return false;
  for (const v of poly) {
    const local = rotatePoint({ x: v.x - obb.x, z: v.z - obb.z }, -(obb.rotation || 0));
    if (Math.abs(local.x) < hw && Math.abs(local.z) < hd) return true;
  }
  return false;
}

/** All corners inside the polygon and no polygon edge crosses an obb edge. */
export function obbInsidePolygon(obb, poly, eps = 1e-4) {
  const shrunk = { ...obb, width: Math.max(0, obb.width - 2 * eps), depth: Math.max(0, obb.depth - 2 * eps) };
  const corners = obbCorners(shrunk);
  for (const c of corners) if (!pointInPolygon(c, poly)) return false;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let k = 0; k < 4; k++) {
      if (segmentsIntersect(a, b, corners[k], corners[(k + 1) % 4])) return false;
    }
  }
  if (anyVertexInsideObb(obb, poly, eps)) return false;
  return true;
}

export function rectOverlap(a, b, eps = 1e-3) {
  return a.u0 < b.u1 - eps && b.u0 < a.u1 - eps && a.v0 < b.v1 - eps && b.v0 < a.v1 - eps;
}

/** Axis-aligned half extents of a rotated obb. */
export function obbExtents(obb) {
  const r = (obb.rotation || 0) * DEG;
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return { ex: (obb.width * c + obb.depth * s) / 2, ez: (obb.width * s + obb.depth * c) / 2 };
}

function clampToBounds(obb, poly) {
  const b = polygonBounds(poly);
  const { ex, ez } = obbExtents(obb);
  if (b.minX + ex > b.maxX - ex + 1e-9 || b.minZ + ez > b.maxZ - ez + 1e-9) return null;
  return {
    x: Math.min(Math.max(obb.x, b.minX + ex), b.maxX - ex),
    z: Math.min(Math.max(obb.z, b.minZ + ez), b.maxZ - ez),
  };
}

function furthestValidAlong(obb, poly, from, to) {
  // binary search t in [0,1] such that from + t*(to-from) is valid; `from` is assumed valid
  let lo = 0, hi = 1;
  const test = (t) => obbInsidePolygon({ ...obb, x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t }, poly);
  if (test(1)) return { x: to.x, z: to.z };
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (test(mid)) lo = mid; else hi = mid;
  }
  return { x: from.x + (to.x - from.x) * lo, z: from.z + (to.z - from.z) * lo };
}

/**
 * Sliding clamp of an obb centre into the polygon.
 * Returns the best valid centre or null when the object cannot fit at all.
 */
export function clampObbToPolygon(obb, poly, lastValid = null) {
  const desired = { x: obb.x, z: obb.z };
  if (obbInsidePolygon(obb, poly)) return desired;
  const boxed = clampToBounds(obb, poly);
  if (boxed && obbInsidePolygon({ ...obb, x: boxed.x, z: boxed.z }, poly)) return boxed;

  if (lastValid && obbInsidePolygon({ ...obb, x: lastValid.x, z: lastValid.z }, poly)) {
    const candidates = [];
    const target = boxed || desired;
    const xs = { x: target.x, z: lastValid.z };
    const zs = { x: lastValid.x, z: target.z };
    for (const t of [target, xs, zs]) {
      candidates.push(furthestValidAlong(obb, poly, lastValid, t));
    }
    // From the axis-slid points, also slide along the other axis (lets the object turn a corner).
    for (const t of [xs, zs]) {
      const p = furthestValidAlong(obb, poly, lastValid, t);
      const second = t === xs ? { x: p.x, z: target.z } : { x: target.x, z: p.z };
      candidates.push(furthestValidAlong(obb, poly, p, second));
    }
    let best = null, bestD = Infinity;
    for (const c of candidates) {
      const d = Math.hypot(c.x - desired.x, c.z - desired.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
  return findNearestValidObb(obb, poly);
}

/** Spiral search (0.5 ft rings) for the nearest valid centre. `isFree(x, z)` may add extra constraints. */
export function findNearestValidObb(obb, poly, isFree = null, maxRadius = 12, step = 0.5) {
  const valid = (x, z) => obbInsidePolygon({ ...obb, x, z }, poly) && (!isFree || isFree(x, z));
  const start = clampToBounds(obb, poly) || { x: obb.x, z: obb.z };
  if (valid(start.x, start.z)) return { x: start.x, z: start.z };
  for (let r = step; r <= maxRadius; r += step) {
    const samples = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
    const ring = [];
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const x = snap(start.x + Math.cos(a) * r, step);
      const z = snap(start.z + Math.sin(a) * r, step);
      ring.push({ x, z, d: Math.hypot(x - obb.x, z - obb.z) });
    }
    ring.sort((p, q) => p.d - q.d);
    for (const p of ring) if (valid(p.x, p.z)) return { x: p.x, z: p.z };
  }
  return null;
}

/** Distances from the obb's axis-aligned extents to the polygon boundary along −X, +X, +Z, −Z. */
export function distancesToBoundary(obb, poly) {
  const { ex, ez } = obbExtents(obb);
  const origin = { x: obb.x, z: obb.z };
  const n = poly.length;
  const cast = (dir) => {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const t = raySegmentDistance(origin, dir, poly[i], poly[(i + 1) % n]);
      if (t < best) best = t;
    }
    return best;
  };
  const left = cast({ x: -1, z: 0 });
  const right = cast({ x: 1, z: 0 });
  const front = cast({ x: 0, z: 1 });
  const back = cast({ x: 0, z: -1 });
  const fix = (t, e) => (Number.isFinite(t) ? Math.max(0, t - e) : Infinity);
  return { left: fix(left, ex), right: fix(right, ex), front: fix(front, ez), back: fix(back, ez) };
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
