// Workspace templates: the two starter spaces plus the polygon helpers the floor plan
// editor builds on. Pure data, no DOM, no three.js.
import { normalizePolygon } from './geometry.js';
import { getDef, defaultEntityFor } from './catalog.js';
import { newId, addEntity, SCHEMA_VERSION } from './state.js';

const DOOR_DEPTH = 0.3;
const WALL_THICKNESS = 0.5;
const NOTCH_CORNERS = ['front-right', 'front-left', 'back-right', 'back-left'];

/** Axis-aligned rectangle centred at the origin in canonical winding. */
export function rectanglePolygon(width, depth) {
  assertPositive(width, 'width');
  assertPositive(depth, 'depth');
  const hw = width / 2;
  const hd = depth / 2;
  return [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ];
}

/**
 * Centred rectangle with a rectangular notch removed at one corner.
 * Front = +Z (nearest the default camera), right = +X. Returns 6 canonical vertices.
 */
export function lShapePolygon(width, depth, notchWidth, notchDepth, corner = 'front-right') {
  assertPositive(width, 'width');
  assertPositive(depth, 'depth');
  if (!(notchWidth > 0 && notchDepth > 0 && notchWidth < width && notchDepth < depth)) {
    throw new Error('Notch must be positive and smaller than the room');
  }
  if (!NOTCH_CORNERS.includes(corner)) throw new Error(`Unknown corner: ${corner}`);
  const hw = width / 2;
  const hd = depth / 2;
  // Build the front-right variant, then mirror it; normalizePolygon restores the winding.
  const sx = corner.endsWith('right') ? 1 : -1;
  const sz = corner.startsWith('front') ? 1 : -1;
  const frontRight = [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd - notchDepth },
    { x: hw - notchWidth, z: hd - notchDepth },
    { x: hw - notchWidth, z: hd },
    { x: -hw, z: hd },
  ];
  // `+ 0` folds a possible -0 into 0 so the vertices serialize and compare cleanly.
  return normalizePolygon(frontRight.map((p) => ({ x: p.x * sx + 0, z: p.z * sz + 0 })));
}

/** 40 × 28 ft retail store, 9 ft walls, glass entrance on the front wall and a steel exit on the right. */
export function defaultStore() {
  const ws = baseWorkspace({
    type: 'store',
    name: 'Lodge Outfitters',
    polygon: rectanglePolygon(40, 28),
    wallHeight: 9,
    floor: { preset: 'light-oak', color: '#b08a5a' },
    wall: { preset: 'warm-white', color: '#f1ece3' },
  });
  addEntity(ws, door({ wallId: 'w2', u: 20, width: 6, height: 7, style: 'full-glass', role: 'entrance' }));
  addEntity(ws, door({ wallId: 'w1', u: 6, width: 4, height: 7, style: 'black-steel', role: 'exit' }));
  return seal(ws);
}

/** 80 × 50 ft warehouse, 24 ft walls, steel doors on the front and right walls. */
export function defaultWarehouse() {
  const ws = baseWorkspace({
    type: 'warehouse',
    name: 'North Dock Warehouse',
    polygon: rectanglePolygon(80, 50),
    wallHeight: 24,
    floor: { preset: 'polished-concrete', color: '#b08a5a' },
    wall: { preset: 'warm-white', color: '#f1ece3' },
  });
  addEntity(ws, door({ wallId: 'w2', u: 40, width: 4, height: 7, style: 'black-steel', role: 'entrance' }));
  addEntity(ws, door({ wallId: 'w1', u: 10, width: 6, height: 8, style: 'black-steel', role: 'exit' }));
  return seal(ws);
}

// ---------------------------------------------------------------- private helpers

function baseWorkspace({ type, name, polygon, wallHeight, floor, wall }) {
  const now = new Date().toISOString();
  return {
    version: SCHEMA_VERSION,
    id: newId('ws'),
    type,
    name,
    room: {
      polygon,
      wallIds: polygon.map((_, i) => `w${i}`),
      wallHeight,
      wallThickness: WALL_THICKNESS,
    },
    finishes: {
      floor: { ...floor },
      wallDefault: { ...wall },
      wallOverrides: {},
    },
    customColors: [],
    entities: [],
    game: { arranged: false, reviewed: false, celebrated: [] },
    meta: { createdAt: now, updatedAt: now },
  };
}

/** A brand-new space has not been edited yet: adding the doors must not age it. */
function seal(ws) {
  ws.meta.updatedAt = ws.meta.createdAt;
  return ws;
}

function door({ wallId, u, width, height, style, role }) {
  const entity = defaultEntityFor(getDef('door'), {
    parent: wallId,
    position: { u, v: 0 },
    width,
    height,
    depth: DOOR_DEPTH,
    meta: { style, role },
  });
  return entity; // addEntity assigns the id and normalises the shape
}

function assertPositive(value, label) {
  if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) {
    throw new Error(`${label} must be a positive number`);
  }
}
