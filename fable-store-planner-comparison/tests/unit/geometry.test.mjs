// Tests for src/core/geometry.js (pure math). Run with `node --test tests/unit/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signedArea,
  normalizePolygon,
  polygonBounds,
  polygonCentroid,
  polygonArea,
  pointInPolygon,
  segmentsIntersect,
  distancePointToSegment,
  wallFrames,
  wallLocalToWorld,
  worldToWallLocal,
  obbCorners,
  obbOverlap,
  obbInsidePolygon,
  rectOverlap,
  clampObbToPolygon,
  findNearestValidObb,
  distancesToBoundary,
  snap,
  snapAngle,
  normalizeAngle,
  rotatePoint,
} from '../../src/core/geometry.js';
import { rectanglePolygon, lShapePolygon } from '../../src/core/templates.js';

const RECT = rectanglePolygon(40, 28);
// 40 × 28 room minus a 12 × 8 notch at the front-right corner: the notch is x ∈ [8, 20], z ∈ [6, 14].
const L = lShapePolygon(40, 28, 12, 8, 'front-right');
const NOTCH = { minX: 8, maxX: 20, minZ: 6, maxZ: 14 };

const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} != ${b}`);
const nearPt = (p, q, eps = 1e-9) => {
  near(p.x, q.x, eps, `x: ${p.x} != ${q.x}`);
  near(p.z, q.z, eps, `z: ${p.z} != ${q.z}`);
};
const box = (x, z, width, depth, rotation = 0) => ({ x, z, width, depth, rotation });

// A corner counts as "in the notch" when it penetrates further than obbInsidePolygon's 1e-4 ft tolerance.
function insideNotch(obb, tolerance = 1e-3) {
  const c = obbCorners(obb);
  return c.some((p) => p.x > NOTCH.minX + tolerance && p.x < NOTCH.maxX && p.z > NOTCH.minZ + tolerance && p.z < NOTCH.maxZ);
}

// ---------------------------------------------------------------- polygons

test('rectangle has canonical winding and the expected inward normals', () => {
  assert.equal(RECT.length, 4);
  assert.ok(signedArea(RECT) > 0);
  assert.equal(polygonArea(RECT), 40 * 28);
  const frames = wallFrames(RECT);
  const expected = [
    { dir: { x: 1, z: 0 }, normal: { x: 0, z: 1 }, length: 40 }, // w0 back
    { dir: { x: 0, z: 1 }, normal: { x: -1, z: 0 }, length: 28 }, // w1 right
    { dir: { x: -1, z: 0 }, normal: { x: 0, z: -1 }, length: 40 }, // w2 front
    { dir: { x: 0, z: -1 }, normal: { x: 1, z: 0 }, length: 28 }, // w3 left
  ];
  frames.forEach((f, i) => {
    assert.equal(f.index, i);
    nearPt(f.dir, expected[i].dir);
    nearPt(f.normal, expected[i].normal);
    near(f.length, expected[i].length);
    nearPt(f.midpoint, { x: (f.start.x + f.end.x) / 2, z: (f.start.z + f.end.z) / 2 });
  });
  // Front wall: u increases toward -X, so u = 20 is x = 0.
  nearPt(wallLocalToWorld(frames[2], 20, 0), { x: 0, z: 14 });
});

test('normalizePolygon fixes winding, drops duplicates and rejects degenerate input', () => {
  const reversed = [...RECT].reverse();
  assert.ok(signedArea(reversed) < 0);
  const fixed = normalizePolygon(reversed);
  assert.ok(signedArea(fixed) > 0);
  assert.equal(fixed.length, 4);
  const withDupes = [RECT[0], RECT[0], RECT[1], RECT[2], RECT[2], RECT[3], RECT[0]];
  assert.deepEqual(normalizePolygon(withDupes), RECT);
  assert.deepEqual(normalizePolygon([{ x: '1', z: '0' }, { x: 0, z: 1 }, { x: 0, z: 0 }]).length, 3);
  assert.throws(() => normalizePolygon([{ x: 0, z: 0 }, { x: 1, z: 1 }]), /at least 3/);
  assert.throws(() => normalizePolygon([{ x: 0, z: 0 }, { x: NaN, z: 1 }, { x: 1, z: 0 }]), /finite/);
});

test('L-shape polygon winds canonically and every wall normal points into the room', () => {
  assert.equal(L.length, 6);
  assert.ok(signedArea(L) > 0);
  assert.equal(polygonArea(L), 40 * 28 - 12 * 8);
  for (const f of wallFrames(L)) {
    near(Math.hypot(f.dir.x, f.dir.z), 1);
    near(Math.hypot(f.normal.x, f.normal.z), 1);
    near(f.dir.x * f.normal.x + f.dir.z * f.normal.z, 0);
    const inward = { x: f.midpoint.x + f.normal.x * 0.05, z: f.midpoint.z + f.normal.z * 0.05 };
    const outward = { x: f.midpoint.x - f.normal.x * 0.05, z: f.midpoint.z - f.normal.z * 0.05 };
    assert.ok(pointInPolygon(inward, L), `wall ${f.index} normal must point inward`);
    assert.ok(!pointInPolygon(outward, L), `wall ${f.index} normal must not point outward`);
  }
  for (const corner of ['front-left', 'back-right', 'back-left']) {
    const poly = lShapePolygon(40, 28, 12, 8, corner);
    assert.equal(poly.length, 6);
    assert.ok(signedArea(poly) > 0, corner);
    assert.equal(polygonArea(poly), 40 * 28 - 12 * 8);
  }
});

test('polygon bounds, centroid and area', () => {
  assert.deepEqual(polygonBounds(RECT), { minX: -20, maxX: 20, minZ: -14, maxZ: 14, width: 40, depth: 28 });
  nearPt(polygonCentroid(RECT), { x: 0, z: 0 });
  const c = polygonCentroid(L);
  assert.ok(c.x < 0 && c.z < 0, 'centroid moves away from the removed notch');
  assert.ok(pointInPolygon(c, L));
  assert.equal(polygonArea([...RECT].reverse()), 40 * 28);
});

test('pointInPolygon counts boundary points (within 1e-6) as inside', () => {
  assert.ok(pointInPolygon({ x: 0, z: 0 }, RECT));
  assert.ok(pointInPolygon({ x: 20, z: 0 }, RECT), 'on the right wall');
  assert.ok(pointInPolygon({ x: 20 + 5e-7, z: 0 }, RECT), 'just outside within tolerance');
  assert.ok(pointInPolygon({ x: -20, z: -14 }, RECT), 'vertex');
  assert.ok(!pointInPolygon({ x: 20.01, z: 0 }, RECT));
  assert.ok(!pointInPolygon({ x: 0, z: -14.01 }, RECT));
  assert.ok(!pointInPolygon({ x: 14, z: 10 }, L), 'inside the notch is outside the room');
  assert.ok(pointInPolygon({ x: 8, z: 10 }, L), 'notch boundary counts as inside');
  assert.ok(pointInPolygon({ x: 14, z: 6 }, L), 'notch boundary counts as inside');
  assert.ok(pointInPolygon({ x: 7.9, z: 13.9 }, L));
  assert.ok(!pointInPolygon({ x: 8.1, z: 6.1 }, L));
});

test('segmentsIntersect is a proper intersection test', () => {
  const a = { x: 0, z: 0 }, b = { x: 4, z: 4 };
  assert.ok(segmentsIntersect(a, b, { x: 0, z: 4 }, { x: 4, z: 0 }));
  assert.ok(!segmentsIntersect(a, b, { x: 4, z: 4 }, { x: 8, z: 0 }), 'touching at an endpoint');
  assert.ok(!segmentsIntersect(a, b, { x: 2, z: 2 }, { x: 6, z: 6 }), 'collinear overlap');
  assert.ok(!segmentsIntersect(a, b, { x: 0, z: 1 }, { x: 4, z: 5 }), 'parallel');
  assert.equal(distancePointToSegment({ x: 2, z: 3 }, { x: 0, z: 0 }, { x: 4, z: 0 }), 3);
  assert.equal(distancePointToSegment({ x: 7, z: 0 }, { x: 0, z: 0 }, { x: 4, z: 0 }), 3);
  assert.equal(distancePointToSegment({ x: 1, z: 1 }, { x: 2, z: 2 }, { x: 2, z: 2 }), Math.SQRT2);
});

// ---------------------------------------------------------------- walls

test('wall local <-> world round trips on every wall of both polygons', () => {
  for (const poly of [RECT, L]) {
    for (const frame of wallFrames(poly)) {
      for (const [u, v, n] of [[0, 0, 0], [frame.length / 3, 2.5, 0.75], [frame.length, 8, 3]]) {
        const world = wallLocalToWorld(frame, u, v, n);
        near(world.y, v);
        const local = worldToWallLocal(frame, world);
        near(local.u, u, 1e-9, `u on wall ${frame.index}`);
        near(local.v, v, 1e-9);
        near(local.n, n, 1e-9, `n on wall ${frame.index}`);
        assert.ok(n === 0 || pointInPolygon(world, poly), 'points pushed along the normal land inside the room');
      }
      nearPt(wallLocalToWorld(frame, 0, 0), frame.start);
      nearPt(wallLocalToWorld(frame, frame.length, 0), frame.end);
    }
  }
});

// ---------------------------------------------------------------- angles

test('rotatePoint follows the three.js rotation.y convention', () => {
  nearPt(rotatePoint({ x: 0, z: 1 }, 90), { x: 1, z: 0 }, 1e-12); // +Z turns toward +X
  nearPt(rotatePoint({ x: 1, z: 0 }, 90), { x: 0, z: -1 }, 1e-12);
  nearPt(rotatePoint({ x: 1, z: 0 }, -90), { x: 0, z: 1 }, 1e-12);
  nearPt(rotatePoint({ x: 3, z: 4 }, 360), { x: 3, z: 4 }, 1e-12);
  const p = rotatePoint({ x: 2, z: 5 }, 37);
  near(Math.hypot(p.x, p.z), Math.hypot(2, 5), 1e-12);
  nearPt(rotatePoint(p, -37), { x: 2, z: 5 }, 1e-12);
});

test('snap, snapAngle and normalizeAngle', () => {
  assert.equal(snap(1.24, 0.5), 1);
  assert.equal(snap(1.26, 0.5), 1.5);
  assert.equal(snap(-0.74, 0.5), -0.5);
  assert.equal(snap(3.3, 0), 3.3);
  assert.equal(normalizeAngle(-90), 270);
  assert.equal(normalizeAngle(360), 0);
  assert.equal(normalizeAngle(725), 5);
  assert.equal(snapAngle(97), 90);
  assert.equal(snapAngle(-7), 0);
  assert.equal(snapAngle(352.6), 0);
  assert.equal(snapAngle(44, 45), 45);
});

// ---------------------------------------------------------------- oriented boxes

test('obbCorners are ordered front-left, front-right, back-right, back-left', () => {
  const c = obbCorners(box(1, 2, 4, 2));
  assert.deepEqual(c, [
    { x: -1, z: 3 },
    { x: 3, z: 3 },
    { x: 3, z: 1 },
    { x: -1, z: 1 },
  ]);
  const r = obbCorners(box(0, 0, 4, 2, 90));
  nearPt(r[0], { x: 1, z: 2 }, 1e-12); // front-left corner (-2, 1) rotated 90 -> (1, 2)
  nearPt(r[2], { x: -1, z: -2 }, 1e-12);
});

test('obbOverlap: touching is not overlap, penetration is', () => {
  const a = box(0, 0, 4, 4);
  assert.ok(!obbOverlap(a, box(4, 0, 4, 4)), 'edge contact');
  assert.ok(!obbOverlap(a, box(4, 4, 4, 4)), 'corner contact');
  assert.ok(!obbOverlap(a, box(4.0005, 0, 4, 4)), 'within eps');
  assert.ok(obbOverlap(a, box(3.9, 0, 4, 4)));
  assert.ok(obbOverlap(a, box(0, 0, 1, 1)), 'fully contained');
  assert.ok(obbOverlap(a, box(4.5, 0, 4, 4, 45)), 'rotated corner pokes in');
  assert.ok(!obbOverlap(a, box(5, 0, 4, 4, 45)), 'rotated corner stops short');
  assert.ok(!obbOverlap(box(0, 0, 10, 1, 90), box(3, 0, 10, 1, 90)), 'both rotated, side by side');
  assert.ok(obbOverlap(box(0, 0, 10, 1, 90), box(3, 0, 1, 10, 90)), 'both rotated, crossing');
  assert.ok(obbOverlap(box(0, 0, 10, 1, 90), box(0, 3, 10, 1)), 'a cross');
});

test('rectOverlap is strict', () => {
  const a = { u0: 0, u1: 4, v0: 0, v1: 3 };
  assert.ok(!rectOverlap(a, { u0: 4, u1: 8, v0: 0, v1: 3 }), 'sharing an edge');
  assert.ok(!rectOverlap(a, { u0: 1, u1: 3, v0: 3, v1: 5 }), 'stacked');
  assert.ok(rectOverlap(a, { u0: 3.9, u1: 8, v0: 2, v1: 5 }));
  assert.ok(rectOverlap(a, { u0: 1, u1: 2, v0: 1, v1: 2 }), 'contained');
});

test('obbInsidePolygon handles the L notch and rotated boxes', () => {
  assert.ok(obbInsidePolygon(box(0, 0, 4, 2), L));
  assert.ok(obbInsidePolygon(box(18, 0, 4, 2), RECT), 'flush against the wall counts as inside');
  assert.ok(!obbInsidePolygon(box(18.5, 0, 4, 2), RECT), 'poking through the wall');
  assert.ok(!obbInsidePolygon(box(8, 6, 4, 2), L), 'straddles the notch corner');
  assert.ok(!obbInsidePolygon(box(10, 10, 4, 2), L), 'sits inside the notch');
  assert.ok(!obbInsidePolygon(box(14, 4, 4, 6), L), 'crosses the notch bottom edge');
  assert.ok(obbInsidePolygon(box(6, 10, 4, 2), L), 'right beside the notch');
  assert.ok(obbInsidePolygon(box(14, 5, 4, 2), L), 'right below the notch');
  assert.ok(!obbInsidePolygon(box(8, 10, 30, 30), L), 'the notch corner vertex lies inside the box');
  // Rotation matters: a 30 × 2 box fits along X but not along Z.
  assert.ok(obbInsidePolygon(box(0, 0, 30, 2), RECT));
  assert.ok(!obbInsidePolygon(box(0, 0, 30, 2, 90), RECT));
  assert.ok(obbInsidePolygon(box(0, 0, 10, 2, 90), RECT));
  // A 4 × 4 box near the wall fits unrotated but its 45° diagonal pierces the wall.
  assert.ok(obbInsidePolygon(box(17.5, 0, 4, 4), RECT));
  assert.ok(!obbInsidePolygon(box(17.5, 0, 4, 4, 45), RECT));
  // Rotated box near the notch: the notch corner ends up inside the rotated footprint.
  assert.ok(!obbInsidePolygon(box(7, 7, 4, 2, 45), L));
  assert.ok(obbInsidePolygon(box(4, 10, 4, 2, 30), L));
});

test('clampObbToPolygon slides along a wall and stays out of the L notch', () => {
  // Fast path: pushing through the right wall keeps z and clamps x.
  assert.deepEqual(clampObbToPolygon(box(25, 5, 4, 2), RECT), { x: 18, z: 5 });
  assert.deepEqual(clampObbToPolygon(box(0, 0, 4, 2), RECT), { x: 0, z: 0 });
  const slid = clampObbToPolygon(box(25, 6, 4, 2), RECT, { x: 10, z: 0 });
  assert.ok(obbInsidePolygon({ ...box(0, 0, 4, 2), ...slid }, RECT));
  near(slid.x, 18, 1e-6, 'slides along the right wall');
  near(slid.z, 6, 1e-6, 'keeps the desired z');
  // Rotated box near the wall clamps on its rotated extents.
  const rot = clampObbToPolygon(box(25, 0, 4, 2, 90), RECT);
  near(rot.x, 19, 1e-9);

  // Drag a 4 × 2 box from (0, 0) toward (14, 10), which lies inside the notch.
  const size = box(0, 0, 4, 2);
  let lastValid = { x: 0, z: 0 };
  const target = { x: 14, z: 10 };
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const desired = { x: target.x * t, z: target.z * t };
    const result = clampObbToPolygon({ ...size, ...desired }, L, lastValid);
    assert.ok(result, `step ${i} produced a position`);
    const placed = { ...size, ...result };
    assert.ok(obbInsidePolygon(placed, L), `step ${i}: ${JSON.stringify(result)} must be inside the room`);
    assert.ok(!insideNotch(placed), `step ${i}: ${JSON.stringify(result)} must stay out of the notch`);
    lastValid = result;
  }
  assert.ok(obbInsidePolygon({ ...size, ...lastValid }, L));
  assert.ok(lastValid.x <= 6 + 1e-3 || lastValid.z <= 5 + 1e-3, 'ends against the notch, not inside it');
  near(lastValid.x, 14, 1e-6, 'slid along the notch edge to the desired x');
  near(lastValid.z, 5, 1e-3, 'pressed against the notch bottom edge');

  // Without a last valid position the spiral search finds a spot; impossible sizes yield null.
  const found = clampObbToPolygon(box(14, 10, 4, 2), L);
  assert.ok(found && obbInsidePolygon({ ...box(0, 0, 4, 2), ...found }, L));
  assert.equal(clampObbToPolygon(box(0, 0, 50, 2), RECT), null);
});

test('findNearestValidObb spirals to the closest valid centre', () => {
  const found = findNearestValidObb(box(14, 10, 4, 2), L);
  assert.ok(found);
  assert.ok(obbInsidePolygon({ ...box(0, 0, 4, 2), ...found }, L));
  assert.ok(Math.hypot(found.x - 14, found.z - 10) <= 6);
  const blocked = findNearestValidObb(box(0, 0, 4, 2), RECT, (x, z) => Math.hypot(x, z) > 3);
  assert.ok(blocked && Math.hypot(blocked.x, blocked.z) > 3 && Math.hypot(blocked.x, blocked.z) <= 4);
  assert.equal(findNearestValidObb(box(0, 0, 4, 40), RECT), null);
});

test('distancesToBoundary measures free space from the box edges', () => {
  assert.deepEqual(distancesToBoundary(box(0, 0, 4, 2), RECT), { left: 18, right: 18, front: 13, back: 13 });
  const d = distancesToBoundary(box(0, 10, 4, 2), L);
  near(d.right, 6, 1e-9, 'the notch wall is 6 ft to the right of the box edge');
  near(d.front, 3, 1e-9);
  const r = distancesToBoundary(box(0, 0, 4, 2, 90), RECT);
  near(r.left, 19, 1e-9);
  near(r.front, 12, 1e-9);
});
