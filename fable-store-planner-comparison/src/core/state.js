// Workspace state: the serializable model, defensive validation/migration and the
// mutation helpers every other module builds on. Pure module: runs in plain Node.
import {
  EPS,
  normalizePolygon,
  polygonArea,
  segmentsIntersect,
  wallFrames,
  wallLocalToWorld,
  normalizeAngle,
} from './geometry.js';
import { CATALOG_BY_ID, DOOR_STYLES, WINDOW_STYLES } from './catalog.js';
import { defaultStore, defaultWarehouse } from './templates.js';

export const SCHEMA_VERSION = 1;

const DEG = Math.PI / 180;
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 8;
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const WALL_ID = /^w\d+$/;
const MAX_CUSTOM_COLORS = 8;
const WALL_HEIGHT_MIN = 4;
const WALL_HEIGHT_MAX = 60;
const FRAME_CACHE_LIMIT = 16;

// ---------------------------------------------------------------- ids & construction

/** `prefix_` + 8 base36 characters. Uses crypto randomness when available. */
export function newId(prefix = 'e') {
  const bytes = new Uint8Array(ID_LENGTH);
  const rng = globalThis.crypto;
  if (rng && typeof rng.getRandomValues === 'function') rng.getRandomValues(bytes);
  else for (let i = 0; i < ID_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256);
  let suffix = '';
  for (const b of bytes) suffix += ID_ALPHABET[b % ID_ALPHABET.length];
  return `${prefix}_${suffix}`;
}

export function createWorkspace(type, name) {
  const ws = templateFor(type);
  if (isText(name)) ws.name = name.trim();
  return ws;
}

export function cloneWorkspace(ws) {
  return deepClone(ws);
}

export function serialize(ws) {
  if (!isObject(ws)) throw new Error('Workspace must be an object');
  return JSON.stringify(ws);
}

/** Parses and repairs a workspace. Throws on non-JSON input or a non-object payload. */
export function deserialize(json) {
  if (typeof json !== 'string') throw new Error('Workspace JSON must be a string');
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Workspace JSON is not valid: ${err.message}`);
  }
  return validateWorkspace(parsed);
}

// ---------------------------------------------------------------- validation / migration

/** Returns a fully repaired workspace built from `obj`. Only a non-object input throws. */
export function validateWorkspace(obj) {
  if (!isObject(obj)) throw new Error('Workspace must be an object');
  const type = obj.type === 'warehouse' ? 'warehouse' : 'store';
  const template = templateFor(type);
  const room = repairRoom(obj.room, template.room);
  return {
    version: SCHEMA_VERSION,
    id: isText(obj.id) ? obj.id : newId('ws'),
    type,
    name: isText(obj.name) ? obj.name.trim() : template.name,
    room,
    finishes: repairFinishes(obj.finishes, template.finishes, room.wallIds),
    customColors: repairCustomColors(obj.customColors),
    entities: repairEntities(obj.entities, room),
    game: repairGame(obj.game),
    meta: repairMeta(obj.meta),
  };
}

function templateFor(type) {
  if (type === 'store') return defaultStore();
  if (type === 'warehouse') return defaultWarehouse();
  throw new Error(`Unknown workspace type: ${type}`);
}

function repairRoom(raw, fallback) {
  const src = isObject(raw) ? raw : {};
  const polygon = repairPolygon(src.polygon) || fallback.polygon;
  const wallHeight = clampNum(num(src.wallHeight, fallback.wallHeight), WALL_HEIGHT_MIN, WALL_HEIGHT_MAX);
  const thickness = num(src.wallThickness, fallback.wallThickness);
  return {
    polygon,
    wallIds: repairWallIds(src.wallIds, polygon.length),
    wallHeight,
    wallThickness: thickness > 0 ? thickness : fallback.wallThickness,
  };
}

/** Normalized simple polygon or null when the input cannot be repaired. */
function repairPolygon(raw) {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  try {
    const poly = normalizePolygon(raw.map((p) => ({ x: num(p?.x, NaN), z: num(p?.z, NaN) })));
    return isSimplePolygon(poly) ? poly : null;
  } catch {
    return null;
  }
}

/** Keeps valid, unique ids in their slots and fills the gaps with the lowest free `wN`. */
function repairWallIds(raw, count) {
  const ids = new Array(count).fill(null);
  const used = new Set();
  if (Array.isArray(raw)) {
    for (let i = 0; i < count; i++) {
      const id = raw[i];
      if (typeof id === 'string' && WALL_ID.test(id) && !used.has(id)) {
        ids[i] = id;
        used.add(id);
      }
    }
  }
  let next = 0;
  for (let i = 0; i < count; i++) {
    if (ids[i]) continue;
    while (used.has(`w${next}`)) next++;
    ids[i] = `w${next}`;
    used.add(ids[i]);
  }
  return ids;
}

/** Non-zero area and no two non-adjacent edges crossing. */
function isSimplePolygon(poly) {
  const n = poly.length;
  if (n < 3 || polygonArea(poly) <= EPS) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap-around
      if (segmentsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}

function repairFinishes(raw, fallback, wallIds) {
  const src = isObject(raw) ? raw : {};
  const wallOverrides = {};
  if (isObject(src.wallOverrides)) {
    for (const [wallId, finish] of Object.entries(src.wallOverrides)) {
      if (wallIds.includes(wallId) && isObject(finish)) wallOverrides[wallId] = repairFinish(finish, fallback.wallDefault);
    }
  }
  return {
    floor: repairFinish(src.floor, fallback.floor),
    wallDefault: repairFinish(src.wallDefault, fallback.wallDefault),
    wallOverrides,
  };
}

function repairFinish(raw, fallback) {
  const src = isObject(raw) ? raw : {};
  return {
    preset: isText(src.preset) ? src.preset : fallback.preset,
    color: hexColor(src.color, fallback.color),
  };
}

function repairCustomColors(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const value of raw) {
    const hex = hexColor(value, null);
    if (hex && !out.includes(hex)) out.push(hex);
    if (out.length >= MAX_CUSTOM_COLORS) break;
  }
  return out;
}

function repairEntities(raw, room) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const entity = validateEntity(item, room, false);
    if (!entity) continue;
    if (seen.has(entity.id)) entity.id = newId('e');
    seen.add(entity.id);
    out.push(entity);
  }
  return out;
}

function repairGame(raw) {
  const src = isObject(raw) ? raw : {};
  const celebrated = Array.isArray(src.celebrated) ? [...new Set(src.celebrated.filter(isText))] : [];
  return { arranged: Boolean(src.arranged), reviewed: Boolean(src.reviewed), celebrated };
}

function repairMeta(raw) {
  const src = isObject(raw) ? raw : {};
  const now = new Date().toISOString();
  const createdAt = isIsoDate(src.createdAt) ? src.createdAt : now;
  const updatedAt = isIsoDate(src.updatedAt) ? src.updatedAt : createdAt;
  return { createdAt, updatedAt };
}

/**
 * Builds a clean entity from `raw`. In strict mode problems throw (programmer error);
 * otherwise the entity is dropped (returns null).
 */
function validateEntity(raw, room, strict) {
  const fail = (message) => {
    if (strict) throw new Error(message);
    return null;
  };
  if (!isObject(raw)) return fail('Entity must be an object');
  const def = CATALOG_BY_ID[raw.type];
  if (!def) return fail(`Unknown entity type: ${raw.type}`);
  const pos = isObject(raw.position) ? raw.position : {};
  const base = {
    id: isText(raw.id) ? raw.id : newId('e'),
    type: def.id,
    anchor: def.anchor,
    ...repairSize(raw, def),
    meta: repairEntityMeta(raw.meta, def),
  };
  if (def.anchor === 'floor') {
    return {
      ...base,
      parent: 'room',
      position: { x: num(pos.x, 0), z: num(pos.z, 0) },
      rotation: normalizeAngle(num(raw.rotation, 0)),
    };
  }
  if (!room.wallIds.includes(raw.parent)) return fail(`Wall "${raw.parent}" does not exist`);
  return {
    ...base,
    parent: raw.parent,
    position: { u: num(pos.u, 0), v: num(pos.v, def.defaultV) },
    rotation: 0,
  };
}

/** Positive sizes, clamped to the def's resizable range where one exists. */
function repairSize(raw, def) {
  const out = {};
  for (const dim of ['width', 'height', 'depth']) {
    let value = num(raw[dim], NaN);
    if (!(value > 0)) value = def.size[dim];
    const range = def.resizable[dim];
    if (range) value = clampNum(value, range[0], range[1]);
    out[dim] = value;
  }
  return out;
}

/** Keeps primitive metadata, coerces catalog params into range and fixes opening styles. */
function repairEntityMeta(raw, def) {
  const src = isObject(raw) ? raw : {};
  const meta = {};
  for (const [key, value] of Object.entries(src)) {
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      meta[key] = value;
    }
  }
  for (const [key, param] of Object.entries(def.params)) {
    meta[key] = clampNum(num(src[key], param.default), param.min, param.max);
  }
  if (def.id === 'door') {
    meta.style = DOOR_STYLES.some((s) => s.id === src.style) ? src.style : DOOR_STYLES[0].id;
    meta.role = src.role === 'exit' ? 'exit' : 'entrance';
  } else if (def.id === 'window') {
    meta.style = WINDOW_STYLES.some((s) => s.id === src.style) ? src.style : WINDOW_STYLES[0].id;
  }
  return meta;
}

// ---------------------------------------------------------------- walls

const frameCache = new Map();

/** Wall frames with `.id` attached, memoized per polygon (and wall id list). Treat as read-only. */
export function getWallFrames(ws) {
  const { polygon, wallIds } = ws.room;
  const key = `${JSON.stringify(polygon)}|${wallIds.join(',')}`;
  const cached = frameCache.get(key);
  if (cached) return cached;
  const frames = wallFrames(polygon).map((frame, i) => ({ ...frame, id: wallIds[i] }));
  if (frameCache.size >= FRAME_CACHE_LIMIT) frameCache.delete(frameCache.keys().next().value);
  frameCache.set(key, frames);
  return frames;
}

export function getWall(ws, wallId) {
  return getWallFrames(ws).find((frame) => frame.id === wallId);
}

// ---------------------------------------------------------------- entity operations

export function getEntity(ws, id) {
  return ws.entities.find((entity) => entity.id === id);
}

/** Validates (throws on garbage), assigns a missing id, pushes and returns the stored entity. */
export function addEntity(ws, entity) {
  const clean = validateEntity(entity, ws.room, true);
  if (getEntity(ws, clean.id)) throw new Error(`Duplicate entity id: ${clean.id}`);
  if (isObject(entity) && !isText(entity.id)) entity.id = clean.id;
  ws.entities.push(clean);
  touch(ws);
  return clean;
}

/** Removes and returns the entity, or null when it does not exist. */
export function removeEntity(ws, id) {
  const index = ws.entities.findIndex((entity) => entity.id === id);
  if (index < 0) return null;
  const [removed] = ws.entities.splice(index, 1);
  touch(ws);
  return removed;
}

/** Shallow merge; `position` and `meta` merge one level deep. The entity object keeps its identity. */
export function updateEntity(ws, id, patch) {
  const entity = getEntity(ws, id);
  if (!entity) throw new Error(`Unknown entity: ${id}`);
  if (!isObject(patch)) throw new Error('Patch must be an object');
  const merged = { ...entity, ...patch, id: entity.id };
  if (isObject(patch.position)) merged.position = { ...entity.position, ...patch.position };
  if (isObject(patch.meta)) merged.meta = { ...entity.meta, ...patch.meta };
  Object.assign(entity, validateEntity(merged, ws.room, true));
  touch(ws);
  return entity;
}

/**
 * Adds a copy of the entity with a fresh id, shifted by `offset` (default 1 ft on x/z or u).
 * The copy is pushed into the workspace; the caller still validates its placement.
 */
export function duplicateEntity(ws, id, offset) {
  const source = getEntity(ws, id);
  if (!source) throw new Error(`Unknown entity: ${id}`);
  const copy = deepClone(source);
  copy.id = newId('e');
  shiftPosition(copy, offset);
  return addEntity(ws, copy);
}

/** Moves an entity by an offset object; without an offset the shift is 1 ft on x/z (or u). */
function shiftPosition(entity, offset) {
  const isFloor = entity.anchor === 'floor';
  const off = isObject(offset) ? offset : isFloor ? { x: 1, z: 1 } : { u: 1 };
  if (isFloor) {
    entity.position.x += num(off.x, 0);
    entity.position.z += num(off.z, 0);
  } else {
    entity.position.u += num(off.u, 0);
  }
  return entity;
}

// ---------------------------------------------------------------- room

/**
 * Replaces the room. Wall entities whose wall id survives are re-clamped to the new wall;
 * the others are dropped. Floor entities and finishes for surviving walls are kept.
 */
export function setRoom(ws, { polygon, wallHeight, wallIds } = {}) {
  const nextPolygon = polygon === undefined ? ws.room.polygon : normalizePolygon(polygon);
  if (!isSimplePolygon(nextPolygon)) throw new Error('Room polygon must be simple with a non-zero area');
  const nextHeight = clampNum(num(wallHeight, ws.room.wallHeight), WALL_HEIGHT_MIN, WALL_HEIGHT_MAX);
  const nextIds = repairWallIds(wallIds ?? ws.room.wallIds, nextPolygon.length);
  ws.room = { ...ws.room, polygon: nextPolygon, wallIds: nextIds, wallHeight: nextHeight };

  const frames = getWallFrames(ws);
  ws.entities = ws.entities.filter((entity) => {
    if (entity.anchor === 'floor') return true;
    const frame = frames.find((f) => f.id === entity.parent);
    if (!frame) return false;
    clampToWall(entity, frame.length, nextHeight);
    return true;
  });

  const overrides = ws.finishes.wallOverrides;
  ws.finishes.wallOverrides = Object.fromEntries(Object.entries(overrides).filter(([wallId]) => nextIds.includes(wallId)));
  touch(ws);
  return ws;
}

function clampToWall(entity, length, wallHeight) {
  const hw = entity.width / 2;
  entity.position.u = length < entity.width ? length / 2 : clampNum(entity.position.u, hw, length - hw);
  entity.position.v = wallHeight < entity.height ? 0 : clampNum(entity.position.v, 0, wallHeight - entity.height);
}

export function touch(ws) {
  ws.meta.updatedAt = new Date().toISOString();
  return ws;
}

// ---------------------------------------------------------------- transforms

/**
 * World placement of an entity's origin. Wall entities: the bottom-centre contact point and the
 * yaw that maps local +X onto the wall direction and local +Z onto the inward normal.
 */
export function entityWorldTransform(ws, entity) {
  if (entity.anchor === 'floor') {
    return {
      position: { x: entity.position.x, y: 0, z: entity.position.z },
      rotationY: (entity.rotation || 0) * DEG,
    };
  }
  const frame = getWall(ws, entity.parent);
  if (!frame) throw new Error(`Wall "${entity.parent}" does not exist`);
  return {
    position: wallLocalToWorld(frame, entity.position.u, entity.position.v, 0),
    rotationY: Math.atan2(frame.normal.x, frame.normal.z),
  };
}

// ---------------------------------------------------------------- small helpers

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function clampNum(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/** Coerces numbers and numeric strings; anything else (or non-finite) yields the fallback. */
function num(value, fallback) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function hexColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const hex = value.trim().toLowerCase();
  return HEX_COLOR.test(hex) ? hex : fallback;
}

function deepClone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
