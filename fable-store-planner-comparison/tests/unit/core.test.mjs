// Tests for the pure core modules: templates, state, collisions, history, persistence, clipboard, game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotatePoint, wallFrames, pointInPolygon, signedArea } from '../../src/core/geometry.js';
import { getDef, defaultEntityFor } from '../../src/core/catalog.js';
import { defaultStore, defaultWarehouse, rectanglePolygon, lShapePolygon } from '../../src/core/templates.js';
import {
  SCHEMA_VERSION,
  newId,
  createWorkspace,
  cloneWorkspace,
  serialize,
  deserialize,
  validateWorkspace,
  getWallFrames,
  getWall,
  getEntity,
  addEntity,
  removeEntity,
  updateEntity,
  duplicateEntity,
  setRoom,
  touch,
  entityWorldTransform,
} from '../../src/core/state.js';
import {
  floorObb,
  wallRect,
  isOpening,
  computeCollisions,
  isFloorPlacementValid,
  clampWallEntity,
  collidingWith,
} from '../../src/core/collisions.js';
import { createHistory } from '../../src/core/history.js';
import {
  STORAGE_KEY,
  saveWorkspace,
  loadWorkspace,
  clearWorkspace,
  createAutosaver,
} from '../../src/core/persistence.js';
import { createClipboard } from '../../src/core/clipboard.js';
import { STEPS, evaluateGame, newlyCompleted } from '../../src/core/game.js';

const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} != ${b}`);
const fixture = (type, overrides = {}) => defaultEntityFor(getDef(type), overrides);
const floorIds = (ws) => ws.entities.filter((e) => e.anchor === 'floor').map((e) => e.id);
const doorOf = (ws, role) => ws.entities.find((e) => e.type === 'door' && e.meta.role === role);

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    size: () => map.size,
  };
}

// ---------------------------------------------------------------- templates

test('defaultStore matches the contract', () => {
  const ws = defaultStore();
  assert.equal(ws.version, SCHEMA_VERSION);
  assert.match(ws.id, /^ws_[0-9a-z]{8}$/);
  assert.equal(ws.type, 'store');
  assert.equal(ws.name, 'Lodge Outfitters');
  assert.deepEqual(ws.room.polygon, [
    { x: -20, z: -14 },
    { x: 20, z: -14 },
    { x: 20, z: 14 },
    { x: -20, z: 14 },
  ]);
  assert.deepEqual(ws.room.wallIds, ['w0', 'w1', 'w2', 'w3']);
  assert.equal(ws.room.wallHeight, 9);
  assert.equal(ws.room.wallThickness, 0.5);
  assert.deepEqual(ws.finishes, {
    floor: { preset: 'light-oak', color: '#b08a5a' },
    wallDefault: { preset: 'warm-white', color: '#f1ece3' },
    wallOverrides: {},
  });
  assert.deepEqual(ws.customColors, []);
  assert.deepEqual(ws.game, { arranged: false, reviewed: false, celebrated: [] });
  assert.ok(Number.isFinite(Date.parse(ws.meta.createdAt)) && ws.meta.updatedAt === ws.meta.createdAt);

  assert.equal(ws.entities.length, 2);
  const entrance = doorOf(ws, 'entrance');
  const exit = doorOf(ws, 'exit');
  assert.match(entrance.id, /^e_[0-9a-z]{8}$/);
  assert.notEqual(entrance.id, exit.id);
  assert.deepEqual(
    { ...entrance, id: undefined },
    {
      id: undefined, type: 'door', anchor: 'wall', parent: 'w2', position: { u: 20, v: 0 }, rotation: 0,
      width: 6, height: 7, depth: 0.3, meta: { style: 'full-glass', role: 'entrance' },
    },
  );
  assert.equal(exit.parent, 'w1');
  assert.deepEqual(exit.position, { u: 6, v: 0 });
  assert.equal(exit.width, 4);
  assert.equal(exit.height, 7);
  assert.equal(exit.depth, 0.3);
  assert.deepEqual(exit.meta, { style: 'black-steel', role: 'exit' });
  // The entrance sits centred on the front wall, the exit near the back of the right wall.
  const t = entityWorldTransform(ws, entrance);
  near(t.position.x, 0);
  near(t.position.z, 14);
  const e = entityWorldTransform(ws, exit);
  near(e.position.x, 20);
  near(e.position.z, -8);
});

test('defaultWarehouse matches the contract', () => {
  const ws = defaultWarehouse();
  assert.equal(ws.type, 'warehouse');
  assert.equal(ws.name, 'North Dock Warehouse');
  assert.deepEqual(ws.room.polygon, rectanglePolygon(80, 50));
  assert.equal(ws.room.wallHeight, 24);
  assert.equal(ws.finishes.floor.preset, 'polished-concrete');
  assert.equal(ws.finishes.wallDefault.preset, 'warm-white');
  const entrance = doorOf(ws, 'entrance');
  const exit = doorOf(ws, 'exit');
  assert.equal(entrance.parent, 'w2');
  assert.deepEqual(entrance.position, { u: 40, v: 0 });
  assert.deepEqual([entrance.width, entrance.height, entrance.depth], [4, 7, 0.3]);
  assert.equal(entrance.meta.style, 'black-steel');
  assert.equal(exit.parent, 'w1');
  assert.deepEqual(exit.position, { u: 10, v: 0 });
  assert.deepEqual([exit.width, exit.height, exit.depth], [6, 8, 0.3]);
  assert.equal(exit.meta.style, 'black-steel');
  assert.notEqual(ws.id, defaultWarehouse().id, 'every template gets a fresh id');
});

test('polygon helpers validate their input', () => {
  assert.deepEqual(rectanglePolygon(10, 6), [{ x: -5, z: -3 }, { x: 5, z: -3 }, { x: 5, z: 3 }, { x: -5, z: 3 }]);
  assert.throws(() => rectanglePolygon(0, 6), /positive/);
  assert.throws(() => lShapePolygon(40, 28, 40, 8, 'front-right'), /smaller/);
  assert.throws(() => lShapePolygon(40, 28, 12, 8, 'middle'), /corner/);
  const corners = {
    'front-right': { x: 20, z: 14 },
    'front-left': { x: -20, z: 14 },
    'back-right': { x: 20, z: -14 },
    'back-left': { x: -20, z: -14 },
  };
  for (const [corner, removed] of Object.entries(corners)) {
    const poly = lShapePolygon(40, 28, 12, 8, corner);
    assert.equal(poly.length, 6);
    assert.ok(signedArea(poly) > 0);
    assert.ok(!poly.some((p) => p.x === removed.x && p.z === removed.z), `${corner} corner removed`);
    assert.ok(!pointInPolygon({ x: removed.x * 0.9, z: removed.z * 0.9 }, poly), `${corner} notch is outside`);
    assert.ok(pointInPolygon({ x: -removed.x * 0.9, z: -removed.z * 0.9 }, poly), 'opposite corner stays');
    assert.ok(poly.every((p) => !Object.is(p.x, -0) && !Object.is(p.z, -0)), 'no negative zeros');
  }
});

// ---------------------------------------------------------------- state: ids, creation, serialization

test('newId produces unique prefixed base36 ids', () => {
  const ids = new Set(Array.from({ length: 500 }, () => newId()));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^e_[0-9a-z]{8}$/);
  assert.match(newId('ws'), /^ws_[0-9a-z]{8}$/);
});

test('createWorkspace uses the templates and an optional name', () => {
  const store = createWorkspace('store');
  assert.equal(store.name, 'Lodge Outfitters');
  const named = createWorkspace('warehouse', '  Dock 9  ');
  assert.equal(named.type, 'warehouse');
  assert.equal(named.name, 'Dock 9');
  assert.equal(createWorkspace('store', '   ').name, 'Lodge Outfitters');
  assert.throws(() => createWorkspace('garage'), /Unknown workspace type/);
});

test('cloneWorkspace is a deep copy', () => {
  const ws = defaultStore();
  const copy = cloneWorkspace(ws);
  assert.deepEqual(copy, ws);
  copy.entities[0].position.u = 1;
  copy.room.polygon[0].x = -99;
  assert.equal(ws.entities[0].position.u, 20);
  assert.equal(ws.room.polygon[0].x, -20);
});

test('serialize/deserialize round trip is deep-equal for both workspace types', () => {
  for (const ws of [defaultStore(), defaultWarehouse()]) {
    const shelfType = ws.type === 'store' ? 'custom-shelf' : 'wire-shelving';
    addEntity(ws, fixture(shelfType, { position: { x: 3, z: -2 }, rotation: 45, meta: { levels: 5 } }));
    addEntity(ws, fixture('slatwall-panel', { parent: 'w0', position: { u: 10, v: 1 } }));
    ws.finishes.wallOverrides.w1 = { preset: 'terracotta', color: '#b9613a' };
    ws.customColors = ['#123abc'];
    ws.game.arranged = true;
    ws.game.celebrated = ['place'];
    const json = serialize(ws);
    assert.equal(typeof json, 'string');
    const back = deserialize(json);
    assert.deepEqual(back, ws);
    assert.deepEqual(deserialize(serialize(back)), back, 'repair is idempotent');
  }
});

test('deserialize throws on non-JSON and non-object payloads', () => {
  assert.throws(() => deserialize('not json'), /not valid/);
  assert.throws(() => deserialize(''), /not valid/);
  assert.throws(() => deserialize('null'), /object/);
  assert.throws(() => deserialize('[1, 2]'), /object/);
  assert.throws(() => deserialize('"text"'), /object/);
  assert.throws(() => deserialize(42), /string/);
  assert.throws(() => validateWorkspace(null), /object/);
  assert.throws(() => serialize('x'), /object/);
});

test('validateWorkspace repairs garbage defensively', () => {
  const garbage = {
    version: 'x',
    id: 42,
    type: 'spaceship',
    name: '   ',
    room: {
      polygon: [{ x: '-10', z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }, { x: -10, z: 10 }],
      wallIds: ['w0'],
      wallHeight: '12',
      wallThickness: -1,
    },
    finishes: {
      floor: { preset: '', color: '#ZZZ' },
      wallOverrides: { w9: { preset: 'terracotta' }, w1: { preset: 'lodge-sage', color: '#ABCDEF' }, w2: 'nope' },
    },
    customColors: ['#ABCDEF', 'red', '#abcdef', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888'],
    entities: [
      { type: 'nope' },
      'junk',
      null,
      { id: 'e_dup', type: 'display-table', position: { x: '3', z: 'bad' }, rotation: '450', width: '100', meta: { nested: {} } },
      { id: 'e_dup', type: 'gondola', anchor: 'wall', parent: 'w0' },
      { type: 'slatwall-panel', parent: 'w7' },
      { type: 'door', parent: 'w1', meta: { style: 'nope', role: 'weird' }, depth: 0 },
      { type: 'custom-shelf', meta: { levels: 99, spacing: -3, note: 'keep me' } },
      { type: 'window', parent: 'w0', position: { u: 5 } },
    ],
    game: { arranged: 1, reviewed: 0, celebrated: ['place', 'place', 5] },
    meta: { createdAt: 'yesterday', updatedAt: '2024-01-02T03:04:05.000Z' },
  };
  const ws = validateWorkspace(garbage);
  assert.equal(ws.version, 1);
  assert.match(ws.id, /^ws_/);
  assert.equal(ws.type, 'store');
  assert.equal(ws.name, 'Lodge Outfitters');
  assert.deepEqual(ws.room.polygon, [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }]);
  assert.deepEqual(ws.room.wallIds, ['w0', 'w1', 'w2', 'w3']);
  assert.equal(ws.room.wallHeight, 12);
  assert.equal(ws.room.wallThickness, 0.5);
  assert.deepEqual(ws.finishes.floor, { preset: 'light-oak', color: '#b08a5a' });
  assert.deepEqual(ws.finishes.wallDefault, { preset: 'warm-white', color: '#f1ece3' });
  assert.deepEqual(ws.finishes.wallOverrides, { w1: { preset: 'lodge-sage', color: '#abcdef' } });
  assert.deepEqual(ws.customColors, ['#abcdef', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777']);
  assert.deepEqual(ws.game, { arranged: true, reviewed: false, celebrated: ['place'] });
  assert.ok(Number.isFinite(Date.parse(ws.meta.createdAt)));
  assert.equal(ws.meta.updatedAt, '2024-01-02T03:04:05.000Z');

  assert.deepEqual(ws.entities.map((e) => e.type), ['display-table', 'gondola', 'door', 'custom-shelf', 'window']);
  const [table, gondola, door, shelf, win] = ws.entities;
  assert.equal(table.id, 'e_dup');
  assert.deepEqual(table.position, { x: 3, z: 0 });
  assert.equal(table.rotation, 90);
  assert.equal(table.width, 8, 'clamped to the resizable range');
  assert.equal(table.depth, 2.5);
  assert.deepEqual(table.meta, {});
  assert.notEqual(gondola.id, 'e_dup', 'duplicate ids are re-issued');
  assert.equal(gondola.anchor, 'floor');
  assert.equal(gondola.parent, 'room');
  assert.deepEqual(gondola.meta, { levels: 4 });
  assert.deepEqual(door.meta, { style: 'full-glass', role: 'entrance' });
  assert.deepEqual([door.width, door.height, door.depth], [6, 7, 0.3]);
  assert.deepEqual(door.position, { u: 0, v: 0 });
  assert.deepEqual(shelf.meta, { levels: 8, spacing: 0, note: 'keep me' });
  assert.deepEqual(win.position, { u: 5, v: 3 });
  assert.equal(win.meta.style, 'picture');
  assert.equal(win.rotation, 0);

  // Whole sections missing fall back to the template of the (repaired) type.
  const bare = validateWorkspace({ type: 'warehouse' });
  assert.deepEqual(bare.room.polygon, rectanglePolygon(80, 50));
  assert.equal(bare.room.wallHeight, 24);
  assert.equal(bare.finishes.floor.preset, 'polished-concrete');
  assert.deepEqual(bare.entities, []);
  // Self-intersecting polygons are replaced by the template polygon.
  const bowtie = validateWorkspace({ room: { polygon: [{ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 10, z: 0 }, { x: 0, z: 10 }] } });
  assert.deepEqual(bowtie.room.polygon, rectanglePolygon(40, 28));
  // Wall entities on the template polygon keep working after a polygon fallback.
  const kept = validateWorkspace({ room: { polygon: 'nope' }, entities: [{ type: 'pegboard-panel', parent: 'w3' }] });
  assert.equal(kept.entities.length, 1);
});

// ---------------------------------------------------------------- state: walls & transforms

test('getWallFrames memoizes per polygon and attaches ids', () => {
  const ws = defaultStore();
  const frames = getWallFrames(ws);
  assert.deepEqual(frames.map((f) => f.id), ['w0', 'w1', 'w2', 'w3']);
  assert.equal(getWallFrames(ws), frames, 'same polygon → same cached array');
  assert.equal(getWallFrames(cloneWorkspace(ws)), frames, 'a structurally equal polygon hits the cache');
  assert.equal(getWall(ws, 'w2').length, 40);
  assert.equal(getWall(ws, 'w9'), undefined);
  setRoom(ws, { polygon: rectanglePolygon(30, 20) });
  const next = getWallFrames(ws);
  assert.notEqual(next, frames);
  assert.equal(next[1].length, 20);
  ws.room.wallIds = ['w0', 'w1', 'w2', 'w9'];
  assert.equal(getWall(ws, 'w9').index, 3, 'changed wall ids are picked up');
  assert.deepEqual(wallFrames(ws.room.polygon).map((f) => f.length), next.map((f) => f.length));
});

test('entityWorldTransform: floor entities and wall yaw', () => {
  const store = defaultStore();
  const table = addEntity(store, fixture('display-table', { position: { x: 3, z: -4 }, rotation: 90 }));
  assert.deepEqual(entityWorldTransform(store, table), { position: { x: 3, y: 0, z: -4 }, rotationY: Math.PI / 2 });

  // On every wall of a rectangle and an L, the yaw maps local +X onto dir and local +Z onto the inward normal
  // under the same convention as geometry.rotatePoint (three.js rotation.y).
  const shaped = defaultStore();
  setRoom(shaped, { polygon: lShapePolygon(40, 28, 12, 8, 'back-left') });
  for (const ws of [store, shaped]) {
    for (const frame of getWallFrames(ws)) {
      const panel = { type: 'gridwall-panel', parent: frame.id, position: { u: 3, v: 1.5 } };
      const { position, rotationY } = entityWorldTransform(ws, panel);
      const deg = (rotationY * 180) / Math.PI;
      const xAxis = rotatePoint({ x: 1, z: 0 }, deg);
      const zAxis = rotatePoint({ x: 0, z: 1 }, deg);
      near(xAxis.x, frame.dir.x, 1e-9, `${frame.id} +X → dir.x`);
      near(xAxis.z, frame.dir.z, 1e-9, `${frame.id} +X → dir.z`);
      near(zAxis.x, frame.normal.x, 1e-9, `${frame.id} +Z → normal.x`);
      near(zAxis.z, frame.normal.z, 1e-9, `${frame.id} +Z → normal.z`);
      near(position.x, frame.start.x + frame.dir.x * 3);
      near(position.z, frame.start.z + frame.dir.z * 3);
      assert.equal(position.y, 1.5);
    }
  }
  assert.throws(() => entityWorldTransform(store, { anchor: 'wall', parent: 'w9', position: { u: 0, v: 0 } }), /w9/);
});

// ---------------------------------------------------------------- state: entity ops

test('addEntity assigns ids, validates and rejects programmer errors', () => {
  const ws = defaultStore();
  const before = ws.meta.updatedAt;
  const raw = fixture('display-table', { position: { x: 2, z: 3 } });
  const added = addEntity(ws, raw);
  assert.match(added.id, /^e_/);
  assert.equal(raw.id, added.id, 'the id is written back to the input');
  assert.equal(getEntity(ws, added.id), added);
  assert.equal(ws.entities.length, 3);
  assert.ok(ws.meta.updatedAt >= before);

  const coerced = addEntity(ws, { type: 'gondola', position: { x: '1', z: '2' }, rotation: -90, width: 50 });
  assert.deepEqual(coerced.position, { x: 1, z: 2 });
  assert.equal(coerced.rotation, 270);
  assert.equal(coerced.width, 12);
  assert.deepEqual(coerced.meta, { levels: 4 });

  const panel = addEntity(ws, { type: 'slatwall-panel', parent: 'w3' });
  assert.deepEqual(panel.position, { u: 0, v: 1 });
  assert.equal(panel.anchor, 'wall');

  assert.throws(() => addEntity(ws, { type: 'hovercraft' }), /Unknown entity type/);
  assert.throws(() => addEntity(ws, { type: 'slatwall-panel', parent: 'w8' }), /w8/);
  assert.throws(() => addEntity(ws, { id: added.id, type: 'display-table' }), /Duplicate/);
  assert.throws(() => addEntity(ws, 'nope'), /object/);
});

test('removeEntity and updateEntity', () => {
  const ws = defaultStore();
  const table = addEntity(ws, fixture('custom-shelf', { position: { x: 1, z: 1 } }));
  const updated = updateEntity(ws, table.id, { position: { x: 5 }, meta: { levels: 6 }, rotation: 30, width: '6' });
  assert.equal(updated, table, 'keeps the object identity');
  assert.deepEqual(table.position, { x: 5, z: 1 }, 'position merges one level deep');
  assert.deepEqual(table.meta, { levels: 6, spacing: 0 }, 'meta merges one level deep');
  assert.equal(table.rotation, 30);
  assert.equal(table.width, 6);
  updateEntity(ws, table.id, { id: 'hijack', meta: { levels: 0 } });
  assert.equal(table.id, updated.id, 'ids cannot be changed');
  assert.equal(table.meta.levels, 2, 'params are clamped');
  assert.throws(() => updateEntity(ws, 'missing', {}), /Unknown entity/);
  assert.throws(() => updateEntity(ws, table.id, null), /object/);

  const panel = addEntity(ws, { type: 'pegboard-panel', parent: 'w0', position: { u: 4, v: 1 } });
  updateEntity(ws, panel.id, { parent: 'w1', position: { u: 9 } });
  assert.deepEqual([panel.parent, panel.position], ['w1', { u: 9, v: 1 }]);
  assert.throws(() => updateEntity(ws, panel.id, { parent: 'w42' }), /w42/);

  assert.equal(removeEntity(ws, table.id), table);
  assert.equal(getEntity(ws, table.id), undefined);
  assert.equal(removeEntity(ws, table.id), null);
  assert.equal(ws.entities.length, 3);
});

test('duplicateEntity gets a fresh id and a shifted position', () => {
  const ws = defaultStore();
  const table = addEntity(ws, fixture('display-table', { position: { x: 2, z: 3 }, rotation: 15 }));
  const dup = duplicateEntity(ws, table.id);
  assert.notEqual(dup.id, table.id);
  assert.match(dup.id, /^e_/);
  assert.deepEqual(dup.position, { x: 3, z: 4 });
  assert.equal(dup.rotation, 15);
  assert.equal(dup.type, 'display-table');
  assert.equal(getEntity(ws, dup.id), dup, 'the copy is added to the workspace');
  assert.deepEqual(duplicateEntity(ws, table.id, { x: -2, z: 0.5 }).position, { x: 0, z: 3.5 });
  const entrance = doorOf(ws, 'entrance');
  const dupDoor = duplicateEntity(ws, entrance.id);
  assert.deepEqual(dupDoor.position, { u: 21, v: 0 });
  assert.deepEqual(duplicateEntity(ws, entrance.id, { u: -3 }).position, { u: 17, v: 0 });
  assert.notEqual(dupDoor.meta, entrance.meta, 'nested objects are copied');
  assert.throws(() => duplicateEntity(ws, 'nope'), /Unknown entity/);
});

test('setRoom re-anchors surviving wall entities and drops the rest', () => {
  const ws = defaultStore();
  const table = addEntity(ws, fixture('display-table', { position: { x: 5, z: 5 } }));
  const panel = addEntity(ws, { type: 'slatwall-panel', parent: 'w1', position: { u: 26, v: 4 } });
  const leftPanel = addEntity(ws, { type: 'pegboard-panel', parent: 'w3', position: { u: 10, v: 1 } });
  ws.finishes.wallOverrides = { w1: { preset: 'terracotta', color: '#b9613a' }, w3: { preset: 'linen', color: '#f1ece3' } };
  const entrance = doorOf(ws, 'entrance');
  const exit = doorOf(ws, 'exit');

  // 22 × 20: the front/back walls are 22 ft, the side walls 20 ft.
  setRoom(ws, { polygon: [...rectanglePolygon(22, 20)].reverse(), wallHeight: 7 });
  assert.ok(signedArea(ws.room.polygon) > 0, 'the polygon is normalized');
  assert.deepEqual(ws.room.wallIds, ['w0', 'w1', 'w2', 'w3']);
  assert.equal(ws.room.wallHeight, 7);
  assert.equal(getEntity(ws, table.id), table, 'floor entities stay untouched');
  assert.deepEqual(table.position, { x: 5, z: 5 });
  assert.deepEqual(panel.position, { u: 18, v: 3 }, 'u and v are clamped to the new wall');
  assert.deepEqual(leftPanel.position, { u: 10, v: 1 });
  assert.deepEqual(entrance.position, { u: 19, v: 0 }, 'the entrance is pulled back inside the shorter front wall');
  assert.deepEqual(exit.position, { u: 6, v: 0 });
  assert.equal(entrance.height, 7);

  // A triangle only has w0..w2: everything on w3 vanishes, including its finish override.
  setRoom(ws, { polygon: [{ x: -20, z: -14 }, { x: 20, z: -14 }, { x: 0, z: 14 }] });
  assert.deepEqual(ws.room.wallIds, ['w0', 'w1', 'w2']);
  assert.equal(getEntity(ws, leftPanel.id), undefined);
  assert.ok(getEntity(ws, panel.id));
  assert.deepEqual(Object.keys(ws.finishes.wallOverrides), ['w1']);
  assert.ok(getEntity(ws, table.id));

  // Explicit wall ids are honoured and repaired; wall entities follow their ids.
  setRoom(ws, { polygon: rectanglePolygon(40, 28), wallIds: ['w2', 'w1', 'w0', 'w1'] });
  assert.deepEqual(ws.room.wallIds, ['w2', 'w1', 'w0', 'w3']);
  assert.equal(getWall(ws, 'w2').index, 0);
  assert.equal(getEntity(ws, panel.id).parent, 'w1');

  // Height only.
  setRoom(ws, { wallHeight: 5 });
  assert.equal(ws.room.wallHeight, 5);
  assert.equal(panel.position.v, 1, 'v clamps to the lowered wall');
  assert.equal(ws.room.polygon.length, 4);
  assert.throws(() => setRoom(ws, { polygon: [{ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 10, z: 0 }, { x: 0, z: 10 }] }), /simple/);
  assert.throws(() => setRoom(ws, { polygon: [{ x: 0, z: 0 }, { x: 1, z: 1 }] }), /at least 3/);
});

test('touch bumps updatedAt', () => {
  const ws = defaultStore();
  ws.meta.updatedAt = '2020-01-01T00:00:00.000Z';
  touch(ws);
  assert.ok(Date.parse(ws.meta.updatedAt) > Date.parse('2020-01-01T00:00:00.000Z'));
});

// ---------------------------------------------------------------- collisions

test('floorObb, wallRect and isOpening', () => {
  const table = fixture('display-table', { position: { x: 1, z: 2 }, rotation: 30 });
  assert.deepEqual(floorObb(table), { x: 1, z: 2, width: 4, depth: 2.5, rotation: 30 });
  const panel = fixture('slatwall-panel', { parent: 'w0', position: { u: 10, v: 1 } });
  assert.deepEqual(wallRect(panel), { u0: 8, u1: 12, v0: 1, v1: 5 });
  assert.ok(isOpening(fixture('door', { parent: 'w0' })));
  assert.ok(isOpening(fixture('window', { parent: 'w0' })));
  assert.ok(!isOpening(panel));
  assert.ok(!isOpening(table));
});

test('computeCollisions applies the floor and wall rules', () => {
  const ws = defaultWarehouse();
  const [entrance, exit] = [doorOf(ws, 'entrance'), doorOf(ws, 'exit')];
  assert.equal(computeCollisions(ws).count, 0, 'the template is clean');

  const rackA = addEntity(ws, fixture('pallet-rack', { position: { x: 0, z: 0 } }));
  const rackB = addEntity(ws, fixture('pallet-rack', { position: { x: 9, z: 0 } })); // touching, not overlapping
  const rackC = addEntity(ws, fixture('pallet-rack', { position: { x: 4, z: 2 } })); // overlaps A and B
  const markerA = addEntity(ws, fixture('pallet-marker', { position: { x: 0, z: 0 } })); // flat over solid: fine
  const markerB = addEntity(ws, fixture('pallet-marker', { position: { x: 2, z: 2 } })); // flat over flat: overlap
  const outside = addEntity(ws, fixture('wire-shelving', { position: { x: 39, z: 0 } })); // pokes through the wall
  const rotated = addEntity(ws, fixture('packing-station', { position: { x: -20, z: -20 }, rotation: 90 })); // rotated fits

  const panelA = addEntity(ws, { type: 'slatwall-panel', parent: 'w0', position: { u: 10, v: 1 } });
  const panelB = addEntity(ws, { type: 'gridwall-panel', parent: 'w0', position: { u: 12, v: 2 } }); // same wall overlap
  const panelC = addEntity(ws, { type: 'gridwall-panel', parent: 'w1', position: { u: 30, v: 2 } }); // other wall, clear of the exit
  const overDoor = addEntity(ws, { type: 'pegboard-panel', parent: 'w2', position: { u: 41, v: 0.5 } }); // over the entrance
  const lowPanel = addEntity(ws, { type: 'pegboard-panel', parent: 'w3', position: { u: 1, v: 0 } }); // u0 < 0
  const highPanel = addEntity(ws, { type: 'pegboard-panel', parent: 'w3', position: { u: 20, v: 21 } }); // v1 > 24
  const win = addEntity(ws, { type: 'window', parent: 'w1', position: { u: 10, v: 3 } }); // over the exit door

  const report = computeCollisions(ws);
  const pairKeys = new Set(report.pairs.map((p) => [...p].sort().join('+')));
  const pair = (a, b) => [a.id, b.id].sort().join('+');
  assert.ok(pairKeys.has(pair(rackA, rackC)));
  assert.ok(pairKeys.has(pair(rackB, rackC)));
  assert.ok(!pairKeys.has(pair(rackA, rackB)), 'touching racks do not collide');
  assert.ok(!pairKeys.has(pair(rackA, markerA)), 'flat vs solid never collides');
  assert.ok(pairKeys.has(pair(markerA, markerB)), 'flat vs flat collides');
  assert.ok(pairKeys.has(pair(panelA, panelB)));
  assert.ok(!pairKeys.has(pair(panelB, panelC)), 'different walls never collide');
  assert.ok(pairKeys.has(pair(overDoor, entrance)), 'fixture over a door counts');
  assert.ok(pairKeys.has(pair(win, exit)), 'opening over opening is a soft collision');
  assert.equal(report.pairs.length, 6);
  assert.deepEqual([...report.colliding].sort(), [rackA, rackB, rackC, markerA, markerB, panelA, panelB, overDoor, entrance, win, exit].map((e) => e.id).sort());
  assert.deepEqual([...report.outOfBounds].sort(), [outside.id, lowPanel.id, highPanel.id].sort());
  assert.ok(!report.outOfBounds.has(rotated.id));
  assert.equal(report.count, report.pairs.length + report.outOfBounds.size);

  const stray = { id: 'e_stray', type: 'wire-shelving', anchor: 'wall', parent: 'w9', position: { u: 1, v: 1 }, width: 4, height: 6, depth: 1.5, rotation: 0, meta: {} };
  ws.entities.push(stray);
  assert.ok(computeCollisions(ws).outOfBounds.has('e_stray'), 'a missing wall is out of bounds');
});

test('isFloorPlacementValid and collidingWith', () => {
  const ws = defaultStore();
  const table = addEntity(ws, fixture('display-table', { position: { x: 0, z: 0 } }));
  assert.ok(isFloorPlacementValid(ws, table));
  assert.ok(isFloorPlacementValid(ws, fixture('display-table', { position: { x: 18, z: 0 } })), 'flush with the wall');
  assert.ok(!isFloorPlacementValid(ws, fixture('display-table', { position: { x: 18.5, z: 0 } })));
  assert.ok(!isFloorPlacementValid(ws, fixture('display-table', { position: { x: 18, z: 0 }, rotation: 45 })));
  assert.ok(!isFloorPlacementValid(ws, fixture('slatwall-panel', { parent: 'w0' })), 'wall entities are not floor placements');

  const ghost = fixture('gondola', { position: { x: 1, z: 1 } });
  assert.deepEqual(collidingWith(ws, ghost), [table.id]);
  assert.deepEqual(collidingWith(ws, fixture('gondola', { position: { x: 10, z: 10 } })), []);
  assert.deepEqual(collidingWith(ws, table), [], 'an entity never collides with itself');
  const marker = { ...fixture('pallet-marker', { position: { x: 0, z: 0 } }), id: 'e_marker' };
  assert.deepEqual(collidingWith(ws, marker), [], 'flat ghost over a solid table');
  const entrance = doorOf(ws, 'entrance');
  const panel = fixture('slatwall-panel', { parent: 'w2', position: { u: 21, v: 1 } });
  assert.deepEqual(collidingWith(ws, panel), [entrance.id]);
  assert.deepEqual(collidingWith(ws, fixture('slatwall-panel', { parent: 'w0', position: { u: 21, v: 1 } })), []);
});

test('clampWallEntity clamps to the wall and pushes fixtures out of openings', () => {
  const ws = defaultStore(); // entrance on w2: u ∈ [17, 23], v ∈ [0, 7]; wall height 9
  const panel = addEntity(ws, { type: 'slatwall-panel', parent: 'w2', position: { u: 30, v: 1 } }); // 4 × 4
  assert.deepEqual(clampWallEntity(ws, panel, { u: -5, v: -2 }), { u: 2, v: 0 }, 'wall bounds');
  assert.deepEqual(clampWallEntity(ws, panel, { u: 45, v: 20 }), { u: 38, v: 5 }, 'wall bounds (far end, top)');
  assert.deepEqual(clampWallEntity(ws, panel, { u: 10, v: 3 }), { u: 10, v: 3 }, 'free spot is untouched');
  assert.deepEqual(clampWallEntity(ws, panel, { u: 19, v: 1 }), { u: 15, v: 1 }, 'pushed to the nearer (left) side');
  assert.deepEqual(clampWallEntity(ws, panel, { u: 22, v: 1 }), { u: 25, v: 1 }, 'pushed to the nearer (right) side');
  assert.deepEqual(clampWallEntity(ws, panel, { u: 21 }), { u: 25, v: 1 }, 'missing v keeps the current v');

  // A window higher up only blocks fixtures whose v-range overlaps it.
  addEntity(ws, { type: 'window', parent: 'w0', position: { u: 10, v: 5 } }); // u ∈ [8, 12], v ∈ [5, 8]
  const low = addEntity(ws, { type: 'gridwall-panel', parent: 'w0', position: { u: 30, v: 0 }, height: 4 }); // 2 × 4
  assert.deepEqual(clampWallEntity(ws, low, { u: 10, v: 0 }), { u: 10, v: 0 }, 'below the sill');
  assert.deepEqual(clampWallEntity(ws, low, { u: 10, v: 2 }), { u: 7, v: 2 }, 'overlapping the window: pushed left');
  assert.deepEqual(clampWallEntity(ws, low, { u: 11.5, v: 4 }), { u: 13, v: 4 }, 'pushed right');

  // Doors only clamp to the wall (the floor plan positions them); windows are pushed out of door openings.
  const entrance = doorOf(ws, 'entrance');
  assert.deepEqual(clampWallEntity(ws, entrance, { u: -1, v: 3 }), { u: 3, v: 2 });
  const win = addEntity(ws, { type: 'window', parent: 'w2', position: { u: 30, v: 3 } });
  assert.deepEqual(clampWallEntity(ws, win, { u: 20, v: 3 }), { u: 15, v: 3 }, 'a window is pushed out of the entrance opening');
  assert.deepEqual(clampWallEntity(ws, win, { u: 30, v: 3 }), { u: 30, v: 3 }, 'a window clear of openings stays put');

  // Fallback: the door hugs the wall start, so the pushed panel would leave the wall.
  const dock = defaultStore();
  addEntity(dock, { type: 'door', parent: 'w0', position: { u: 3, v: 0 }, meta: { style: 'black-steel', role: 'exit' } }); // u ∈ [0, 6]
  const parked = addEntity(dock, { type: 'slatwall-panel', parent: 'w0', position: { u: 30, v: 1 } });
  assert.deepEqual(clampWallEntity(dock, parked, { u: 2, v: 1 }), { u: 30, v: 1 }, 'falls back to the current position');
  // Two adjacent openings: pushing out of one lands in the other → fallback as well.
  addEntity(dock, { type: 'window', parent: 'w0', position: { u: 9, v: 0.5 }, width: 6, height: 5 }); // u ∈ [6, 12]
  assert.deepEqual(clampWallEntity(dock, parked, { u: 5, v: 1 }), { u: 30, v: 1 });
  assert.deepEqual(clampWallEntity(dock, parked, { u: 11, v: 1 }), { u: 14, v: 1 }, 'the far side of the window is free');
  assert.throws(() => clampWallEntity(dock, { ...parked, parent: 'w7' }, { u: 1, v: 1 }), /w7/);
});

// A fresh template must have the exact shape a loaded workspace has, so a save/load round trip
// is byte-identical from the very first frame (doors used to be built outside the canonical path).
test('templates serialize identically to their save/load round trip', () => {
  for (const [label, ws] of [['store', defaultStore()], ['warehouse', defaultWarehouse()], ['createWorkspace', createWorkspace('store')]]) {
    const once = serialize(ws);
    assert.equal(once, serialize(deserialize(once)), `${label} round trip is byte-identical`);
    for (const entity of JSON.parse(once).entities) {
      assert.deepEqual(
        Object.keys(entity),
        ['id', 'type', 'anchor', 'width', 'height', 'depth', 'meta', 'parent', 'position', 'rotation'],
        `${label}: ${entity.type} uses the canonical entity shape`,
      );
    }
  }
  // the doors themselves are unchanged by the canonical path
  const store = defaultStore();
  const entrance = store.entities.find((e) => e.meta.role === 'entrance');
  const exit = store.entities.find((e) => e.meta.role === 'exit');
  assert.deepEqual(
    [entrance.parent, entrance.position.u, entrance.width, entrance.height, entrance.meta.style],
    ['w2', 20, 6, 7, 'full-glass'],
  );
  assert.deepEqual(
    [exit.parent, exit.position.u, exit.width, exit.height, exit.meta.style],
    ['w1', 6, 4, 7, 'black-steel'],
  );
  assert.equal(new Set(store.entities.map((e) => e.id)).size, store.entities.length, 'ids are unique');
});

// ---------------------------------------------------------------- history

test('history undo/redo semantics, redo clearing and the limit', () => {
  const h = createHistory({ limit: 3 });
  assert.ok(!h.canUndo() && !h.canRedo());
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), null);
  assert.equal(h.peekUndoLabel(), null);
  assert.equal(h.size(), 0);

  h.push({ label: 'A', before: 's0', after: 's1' });
  h.push({ label: 'B', before: 's1', after: 's2' });
  assert.equal(h.size(), 2);
  assert.equal(h.peekUndoLabel(), 'B');
  assert.ok(h.canUndo() && !h.canRedo());

  const undone = h.undo();
  assert.deepEqual(undone, { label: 'B', before: 's1', after: 's2' });
  assert.equal(h.peekUndoLabel(), 'A');
  assert.equal(h.peekRedoLabel(), 'B');
  assert.ok(h.canRedo());
  assert.deepEqual(h.redo(), undone);
  assert.ok(!h.canRedo());
  assert.equal(h.peekUndoLabel(), 'B');

  h.undo();
  h.push({ label: 'C', before: 's1', after: 's3' });
  assert.ok(!h.canRedo(), 'a new push drops the redo stack');
  assert.equal(h.peekRedoLabel(), null);
  assert.deepEqual([h.peekUndoLabel(), h.size()], ['C', 2]);

  h.push({ label: 'D', before: 's3', after: 's4' });
  h.push({ label: 'E', before: 's4', after: 's5' });
  assert.equal(h.size(), 3, 'the limit drops the oldest entries');
  assert.equal(h.undo().label, 'E');
  assert.equal(h.undo().label, 'D');
  assert.equal(h.undo().label, 'C');
  assert.equal(h.undo(), null, 'A was evicted');
  assert.equal(h.redo().label, 'C');

  h.clear();
  assert.ok(!h.canUndo() && !h.canRedo() && h.size() === 0);
  assert.throws(() => h.push({ label: 'bad', before: {}, after: 'x' }), /serialized/);
  assert.equal(createHistory().size(), 0);
});

// ---------------------------------------------------------------- persistence

test('persistence round trip with a fake storage', () => {
  const storage = fakeStorage();
  assert.equal(loadWorkspace(storage), null);
  const ws = defaultStore();
  addEntity(ws, fixture('round-rack', { position: { x: -5, z: 2 } }));
  assert.deepEqual(saveWorkspace(ws, storage), { ok: true });
  assert.equal(typeof storage.getItem(STORAGE_KEY), 'string');
  assert.deepEqual(loadWorkspace(storage), ws);

  storage.setItem(STORAGE_KEY, '{ broken json');
  assert.equal(loadWorkspace(storage), null, 'unreadable payloads load as null');
  storage.setItem(STORAGE_KEY, '{"type":"warehouse"}');
  assert.equal(loadWorkspace(storage).type, 'warehouse', 'partial payloads are repaired');
  clearWorkspace(storage);
  assert.equal(storage.size(), 0);
  assert.equal(loadWorkspace(storage), null);
  clearWorkspace(storage);

  const quota = {
    getItem: () => null,
    setItem: () => {
      const err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      throw err;
    },
    removeItem: () => {
      throw new Error('nope');
    },
  };
  const failed = saveWorkspace(ws, quota);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.name, 'QuotaExceededError');
  assert.doesNotThrow(() => clearWorkspace(quota));
  assert.equal(saveWorkspace(ws, undefined).ok, false, 'no storage in Node → graceful failure');
  assert.equal(loadWorkspace(undefined), null);
  assert.doesNotThrow(() => clearWorkspace(undefined));
});

test('autosaver debounces, reports status, flushes and cancels', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ws = defaultStore();
  const statuses = [];
  const saved = [];
  const saver = createAutosaver({
    save: (w) => {
      saved.push(w);
      return { ok: true };
    },
    delay: 400,
    onStatus: (s) => statuses.push(s),
  });
  saver.schedule(ws);
  saver.schedule(ws);
  assert.deepEqual(statuses, ['saving', 'saving']);
  assert.equal(saved.length, 0);
  t.mock.timers.tick(399);
  assert.equal(saved.length, 0, 'still debouncing');
  t.mock.timers.tick(1);
  assert.equal(saved.length, 1, 'one save for two schedules');
  assert.equal(saved[0], ws);
  assert.deepEqual(statuses, ['saving', 'saving', 'saved']);

  assert.equal(saver.flush(), null, 'nothing pending');
  saver.schedule(ws);
  assert.deepEqual(saver.flush(), { ok: true });
  assert.equal(saved.length, 2);
  t.mock.timers.tick(1000);
  assert.equal(saved.length, 2, 'flush cleared the timer');

  saver.schedule(ws);
  saver.cancel();
  t.mock.timers.tick(1000);
  assert.equal(saved.length, 2, 'cancel drops the pending save');
  assert.equal(statuses.at(-1), 'saving', 'cancel reports nothing');

  const errors = [];
  const failing = createAutosaver({ save: () => ({ ok: false, error: new Error('full') }), delay: 10, onStatus: (s) => errors.push(s) });
  failing.schedule(ws);
  t.mock.timers.tick(10);
  assert.deepEqual(errors, ['saving', 'error']);
  const throwing = createAutosaver({ save: () => { throw new Error('boom'); }, delay: 10, onStatus: (s) => errors.push(s) });
  throwing.schedule(ws);
  const result = throwing.flush();
  assert.equal(result.ok, false);
  assert.equal(result.error.message, 'boom');
  assert.equal(errors.at(-1), 'error');
  assert.throws(() => createAutosaver({}), /save/);
  const quiet = createAutosaver({ save: () => undefined });
  quiet.schedule(ws);
  assert.deepEqual(quiet.flush(), { ok: true }, 'a save that returns nothing counts as success');
});

// ---------------------------------------------------------------- clipboard

test('clipboard pastes fresh ids with a growing offset', () => {
  const ws = defaultStore();
  const clip = createClipboard();
  assert.ok(!clip.hasContent());
  assert.equal(clip.peek(), null);
  assert.equal(clip.paste(ws), null);

  const table = addEntity(ws, fixture('display-table', { position: { x: 2, z: 3 }, rotation: 45 }));
  clip.copy(table);
  assert.ok(clip.hasContent());
  assert.deepEqual(clip.peek(), table);
  assert.notEqual(clip.peek(), table, 'peek returns a copy');
  table.position.x = 99;
  const first = clip.paste(ws);
  assert.match(first.id, /^e_/);
  assert.notEqual(first.id, table.id);
  assert.deepEqual(first.position, { x: 3, z: 4 }, 'copy() snapshots the entity');
  assert.equal(first.rotation, 45);
  assert.equal(getEntity(ws, first.id), first, 'pasted into the workspace');
  const second = clip.paste(ws);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(second.position, { x: 4, z: 5 }, 'each paste shifts one more foot');

  const panel = addEntity(ws, { type: 'slatwall-panel', parent: 'w1', position: { u: 10, v: 1 } });
  clip.copy(panel);
  const pastedPanel = clip.paste(ws);
  assert.deepEqual([pastedPanel.parent, pastedPanel.position], ['w1', { u: 11, v: 1 }]);
  assert.notEqual(pastedPanel.id, panel.id);

  // Entities that cannot live in the target workspace are refused.
  const warehouse = defaultWarehouse();
  clip.copy(fixture('pallet-rack', { position: { x: 0, z: 0 } }));
  assert.equal(clip.paste(ws), null, 'warehouse gear cannot be pasted into a store');
  assert.ok(clip.paste(warehouse));
  clip.copy(panel);
  const triangle = createWorkspace('store');
  setRoom(triangle, { polygon: [{ x: -20, z: -14 }, { x: 20, z: -14 }, { x: 0, z: 14 }] });
  clip.copy({ ...panel, parent: 'w3' });
  assert.equal(clip.paste(triangle), null, 'a vanished wall refuses the paste');
  clip.copy(doorOf(ws, 'entrance'));
  assert.ok(clip.paste(warehouse), 'architecture pastes anywhere');
  assert.throws(() => clip.copy(null), /entity/);
});

// ---------------------------------------------------------------- game

test('STEPS lists five steps per workspace type', () => {
  for (const type of ['store', 'warehouse']) {
    assert.equal(STEPS[type].length, 5);
    for (const step of STEPS[type]) {
      for (const key of ['id', 'title', 'objective', 'hint']) assert.equal(typeof step[key], 'string');
    }
  }
  assert.deepEqual(STEPS.store.map((s) => s.id), ['place', 'arrange', 'mix', 'zone', 'review']);
  assert.deepEqual(STEPS.warehouse.map((s) => s.id), ['first', 'adjust', 'locate', 'flow', 'review']);
});

test('store game steps evaluate in order, with the overlap override', () => {
  const ws = defaultStore();
  const none = { colliding: new Set(), outOfBounds: new Set(), pairs: [], count: 0 };
  const done = (ev) => ev.steps.filter((s) => s.done).map((s) => s.id);

  let ev = evaluateGame(ws, none);
  assert.deepEqual(done(ev), []);
  assert.equal(ev.fixtureCount, 0, 'doors are not fixtures');
  assert.equal(ev.currentStep.id, 'place');
  assert.equal(ev.objectiveText, STEPS.store[0].objective);
  assert.deepEqual([ev.percent, ev.coreComplete, ev.complete, ev.collisionCount], [0, false, false, 0]);
  assert.equal(evaluateGame(ws).collisionCount, 0, 'a missing report counts as no collisions');

  const table = addEntity(ws, fixture('display-table', { position: { x: 0, z: 0 } }));
  ev = evaluateGame(ws, none);
  assert.deepEqual(done(ev), ['place']);
  assert.equal(ev.fixtureCount, 1);
  assert.equal(ev.percent, 20);
  assert.equal(ev.currentStep.id, 'arrange');

  addEntity(ws, fixture('display-table', { position: { x: 10, z: 0 } }));
  ev = evaluateGame(ws, none);
  assert.deepEqual(done(ev), ['place'], 'two of the same type is not a mix');
  assert.equal(ev.currentStep.id, 'arrange', 'the first undone step is current even when later ones are done');

  ws.game.arranged = true;
  addEntity(ws, fixture('gondola', { position: { x: -10, z: 0 } }));
  ev = evaluateGame(ws, none);
  assert.deepEqual(done(ev), ['place', 'arrange', 'mix']);
  assert.equal(ev.currentStep.id, 'zone');

  addEntity(ws, { type: 'window', parent: 'w0', position: { u: 5, v: 3 } });
  ev = evaluateGame(ws, none);
  assert.ok(!done(ev).includes('zone'), 'windows are not wall fixtures');
  addEntity(ws, { type: 'slatwall-panel', parent: 'w0', position: { u: 20, v: 1 } });
  ev = evaluateGame(ws, none);
  assert.deepEqual(done(ev), ['place', 'arrange', 'mix', 'zone']);
  assert.ok(ev.coreComplete && !ev.complete);
  assert.equal(ev.percent, 80);
  assert.equal(ev.currentStep.id, 'review');
  assert.equal(ev.objectiveText, STEPS.store[4].objective);

  const overlap = { ...none, count: 2, pairs: [[table.id, 'x'], ['y', 'z']] };
  const blocked = evaluateGame(ws, overlap);
  assert.equal(blocked.objectiveText, 'Clear the overlap');
  assert.equal(blocked.collisionCount, 2);
  const outside = { ...none, count: 1, outOfBounds: new Set([table.id]) };
  assert.equal(evaluateGame(ws, outside).objectiveText, 'Move it back inside the room', 'out of bounds is not an overlap');
  assert.deepEqual([evaluateGame(ws, outside).overlapCount, evaluateGame(ws, outside).outsideCount], [0, 1]);
  assert.equal(blocked.currentStep.id, 'review', 'the override does not change the step');

  ws.game.reviewed = true;
  ev = evaluateGame(ws, none);
  assert.ok(ev.complete && ev.coreComplete);
  assert.equal(ev.currentStep, null);
  assert.equal(ev.percent, 100);
  assert.equal(ev.objectiveText, 'Layout complete');
  assert.equal(evaluateGame(ws, overlap).objectiveText, 'Clear the overlap', 'overlaps override even a complete layout');

  assert.deepEqual(newlyCompleted(ws, ev), ['place', 'arrange', 'mix', 'zone', 'review']);
  ws.game.celebrated = ['place', 'mix'];
  assert.deepEqual(newlyCompleted(ws, ev), ['arrange', 'zone', 'review']);
  removeEntity(ws, table.id);
  ev = evaluateGame(ws, none);
  assert.deepEqual(done(ev), ['place', 'arrange', 'mix', 'zone', 'review'], 'two floor fixtures remain');
});

test('warehouse game steps exclude the forklift and count markers', () => {
  const ws = defaultWarehouse();
  const none = { colliding: new Set(), outOfBounds: new Set(), pairs: [], count: 0 };
  const done = (ev) => ev.steps.filter((s) => s.done).map((s) => s.id);

  addEntity(ws, fixture('forklift', { position: { x: 0, z: 0 } }));
  let ev = evaluateGame(ws, none);
  assert.deepEqual(done(ev), [], 'the forklift is not equipment');
  assert.equal(ev.fixtureCount, 1, 'it is still a placed fixture the HUD counts');
  assert.equal(ev.equipmentCount, 0, 'but it never counts toward equipment progress');
  assert.equal(ev.objectiveText, STEPS.warehouse[0].objective);

  addEntity(ws, fixture('pallet-rack', { position: { x: 20, z: 0 } }));
  ev = evaluateGame(ws, none);
  assert.deepEqual(done(ev), ['first']);
  assert.equal(ev.fixtureCount, 2, 'forklift + rack are both placed');
  assert.equal(ev.equipmentCount, 1);
  assert.equal(ev.currentStep.id, 'adjust');

  ws.game.arranged = true;
  addEntity(ws, fixture('pallet-marker', { position: { x: -20, z: 0 } }));
  ev = evaluateGame(ws, none);
  assert.deepEqual(done(ev), ['first', 'adjust', 'locate']);
  assert.equal(ev.currentStep.id, 'flow');
  assert.equal(ev.fixtureCount, 3);
  assert.equal(ev.equipmentCount, 2, 'markers count as equipment');
  assert.equal(ev.percent, 60);

  addEntity(ws, fixture('pallet-rack', { position: { x: 20, z: 10 } }));
  ev = evaluateGame(ws, none);
  assert.ok(!done(ev).includes('flow'), 'rack + marker + forklift is not a mix of equipment');

  addEntity(ws, fixture('packing-station', { position: { x: -20, z: 15 } }));
  ev = evaluateGame(ws, none);
  assert.deepEqual(done(ev), ['first', 'adjust', 'locate', 'flow']);
  assert.ok(ev.coreComplete && !ev.complete);
  assert.equal(evaluateGame(ws, { ...none, count: 1 }).objectiveText, 'Clear the overlap');
  assert.equal(ev.objectiveText, STEPS.warehouse[4].objective);

  ws.game.reviewed = true;
  ev = evaluateGame(ws, none);
  assert.ok(ev.complete);
  assert.equal(ev.percent, 100);
  assert.equal(ev.objectiveText, 'Layout complete');
  assert.deepEqual(newlyCompleted(ws, ev), ['first', 'adjust', 'locate', 'flow', 'review']);
  ws.game.celebrated = ['first', 'adjust', 'locate', 'flow', 'review'];
  assert.deepEqual(newlyCompleted(ws, ev), []);
  assert.deepEqual(floorIds(ws).length, 5);
});
