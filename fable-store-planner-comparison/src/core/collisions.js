// Collision and bounds rules for floor and wall entities. Pure module, no DOM, no three.js.
import { EPS, obbOverlap, obbInsidePolygon, obbExtents, rectOverlap } from './geometry.js';
import { CATALOG_BY_ID } from './catalog.js';
import { getWall } from './state.js';

/** Oriented footprint of a floor entity. */
export function floorObb(entity) {
  return {
    x: entity.position.x,
    z: entity.position.z,
    width: entity.width,
    depth: entity.depth,
    rotation: entity.rotation || 0,
  };
}

/** Wall-plane rectangle of a wall entity in (u, v) feet. */
export function wallRect(entity) {
  const hw = entity.width / 2;
  return {
    u0: entity.position.u - hw,
    u1: entity.position.u + hw,
    v0: entity.position.v,
    v1: entity.position.v + entity.height,
  };
}

export function isOpening(entity) {
  return entity.type === 'door' || entity.type === 'window';
}

/**
 * Overlap pairs and out-of-bounds entities for the whole workspace.
 * Openings are counted like any other wall entity, so a fixture over a door shows up.
 */
export function computeCollisions(ws) {
  const colliding = new Set();
  const outOfBounds = new Set();
  const pairs = [];
  const items = ws.entities.map((entity) => ({ entity, box: entity.anchor === 'floor' ? floorAabb(entity) : null }));
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (isOutOfBounds(ws, a.entity)) outOfBounds.add(a.entity.id);
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (a.box && b.box && !aabbOverlap(a.box, b.box)) continue;
      if (!entitiesOverlap(a.entity, b.entity)) continue;
      pairs.push([a.entity.id, b.entity.id]);
      colliding.add(a.entity.id);
      colliding.add(b.entity.id);
    }
  }
  return { colliding, outOfBounds, pairs, count: pairs.length + outOfBounds.size };
}

/** Floor entity fully inside the room polygon. Overlaps are not considered. */
export function isFloorPlacementValid(ws, entity, _ignoreId) {
  if (entity.anchor !== 'floor') return false;
  return obbInsidePolygon(floorObb(entity), ws.room.polygon);
}

/**
 * Clamps a desired {u, v} to the wall and, for fixtures, pushes it out of door/window openings.
 * When the push cannot produce a valid spot the entity's current position is returned.
 */
export function clampWallEntity(ws, entity, desired) {
  const frame = getWall(ws, entity.parent);
  if (!frame) throw new Error(`Wall "${entity.parent}" does not exist`);
  const wallHeight = ws.room.wallHeight;
  const clampU = (u) => clampCentre(u, entity.width, frame.length);
  const clampV = (v) => (wallHeight < entity.height ? 0 : Math.min(wallHeight - entity.height, Math.max(0, v)));
  const u = clampU(finite(desired?.u, entity.position.u));
  const v = clampV(finite(desired?.v, entity.position.v));
  if (entity.type === 'door') return { u, v }; // doors are positioned by the floor plan; windows avoid other openings

  const openings = ws.entities
    .filter((other) => other.id !== entity.id && other.anchor === 'wall' && other.parent === entity.parent && isOpening(other))
    .map(wallRect);
  const rectAt = (cu, cv) => ({ u0: cu - entity.width / 2, u1: cu + entity.width / 2, v0: cv, v1: cv + entity.height });
  const hit = openings.find((opening) => rectOverlap(rectAt(u, v), opening));
  if (!hit) return { u, v };

  const left = hit.u0 - entity.width / 2;
  const right = hit.u1 + entity.width / 2;
  const side = Math.abs(u - left) <= Math.abs(u - right) ? left : right;
  const pushed = clampU(side);
  const leftTheWall = Math.abs(pushed - side) > EPS;
  const stillBlocked = openings.some((opening) => rectOverlap(rectAt(pushed, v), opening));
  if (leftTheWall || stillBlocked) return { u: entity.position.u, v: entity.position.v };
  return { u: pushed, v };
}

/** Ids of the other workspace entities overlapping `entity` (which need not be in the workspace). */
export function collidingWith(ws, entity) {
  const ids = [];
  for (const other of ws.entities) {
    if (other.id === entity.id) continue;
    if (entitiesOverlap(entity, other)) ids.push(other.id);
  }
  return ids;
}

// ---------------------------------------------------------------- private helpers

function collisionGroup(entity) {
  return CATALOG_BY_ID[entity.type]?.collision === 'flat' ? 'flat' : 'solid';
}

/** Overlap under the rules: same anchor; floor pairs need the same collision group; wall pairs the same wall. */
function entitiesOverlap(a, b) {
  if (a.anchor !== b.anchor) return false;
  if (a.anchor === 'floor') {
    if (collisionGroup(a) !== collisionGroup(b)) return false;
    return obbOverlap(floorObb(a), floorObb(b));
  }
  return a.parent === b.parent && rectOverlap(wallRect(a), wallRect(b));
}

function isOutOfBounds(ws, entity) {
  if (entity.anchor === 'floor') return !obbInsidePolygon(floorObb(entity), ws.room.polygon);
  const frame = getWall(ws, entity.parent);
  if (!frame) return true;
  const r = wallRect(entity);
  return r.u0 < -EPS || r.u1 > frame.length + EPS || r.v0 < -EPS || r.v1 > ws.room.wallHeight + EPS;
}

/** Axis-aligned bounds of a floor entity, used as a cheap pre-filter before the SAT test. */
function floorAabb(entity) {
  const obb = floorObb(entity);
  const { ex, ez } = obbExtents(obb);
  return { minX: obb.x - ex, maxX: obb.x + ex, minZ: obb.z - ez, maxZ: obb.z + ez };
}

function aabbOverlap(a, b) {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

/** Centre `c` of an extent `size` kept inside [0, length]; centred when it cannot fit. */
function clampCentre(c, size, length) {
  const half = size / 2;
  if (length < size) return length / 2;
  return Math.min(length - half, Math.max(half, c));
}

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
