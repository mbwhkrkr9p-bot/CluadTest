// The studio: owns the workspace state, history, persistence and the 3D presentation,
// and exposes every editing operation the UI and the interaction layer need.
// The serializable workspace is the source of truth; the scene is reconciled from it.
import * as THREE from '../../vendor/three/three.module.js';
import { createScene } from '../render/scene.js';
import { createCameraRig } from '../render/cameraRig.js';
import { createRoomView } from '../render/roomMesh.js';
import { createGizmos } from './gizmos.js';
import { createEntityViews } from './entityViews.js';
import { createPicker } from './picking.js';
import { createCutaway } from './cutaway.js';
import { createLabelLayer } from './labels.js';
import * as State from '../core/state.js';
import * as G from '../core/geometry.js';
import { createHistory } from '../core/history.js';
import { createClipboard } from '../core/clipboard.js';
import { saveWorkspace, createAutosaver } from '../core/persistence.js';
import { computeCollisions, clampWallEntity, floorObb, isOpening } from '../core/collisions.js';
import { evaluateGame, newlyCompleted } from '../core/game.js';
import { getDef, defaultEntityFor, WINDOW_STYLES, DOOR_STYLES, isArchitecture } from '../core/catalog.js';

const SNAP_FLOOR = 0.5;
const SNAP_WALL = 0.5;

export function createStudio({ canvas, labelsEl, workspace, storage = globalThis.localStorage }) {
  // ------------------------------------------------------------------ events
  const listeners = new Map();
  function on(evt, cb) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(cb);
    return () => listeners.get(evt).delete(cb);
  }
  function emit(evt, payload) {
    const set = listeners.get(evt);
    if (!set) return;
    for (const cb of [...set]) cb(payload);
  }

  // ------------------------------------------------------------------ state
  let ws = workspace;
  const history = createHistory({ limit: 200 });
  const clipboard = createClipboard();
  const autosaver = createAutosaver({
    save: (w) => saveWorkspace(w, storage),
    delay: 350,
    onStatus: (s) => emit('save', s),
  });
  let selection = { kind: 'none', id: null };
  let hover = { kind: 'none', id: null };
  let mode = 'build'; // 'build' | 'finish'
  let collisionReport = { colliding: new Set(), outOfBounds: new Set(), pairs: [], count: 0 };
  let gameInfo = null;
  let roomSig = '';
  let finishSig = '';
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ scene
  const sceneCtx = createScene(canvas);
  const { scene, camera } = sceneCtx;
  const rig = createCameraRig(camera, { minDistance: 6, maxDistance: 240 });
  rig.reducedMotion = reducedMotion;
  const roomView = createRoomView(sceneCtx);
  const gizmos = createGizmos(scene);
  const entityViews = createEntityViews(scene, roomView, gizmos);
  const picker = createPicker({ camera, canvas, roomView, entityViews, gizmos });
  const cutaway = createCutaway(roomView, camera);
  const labels = createLabelLayer(labelsEl, camera);

  // ------------------------------------------------------------------ render loop (on demand)
  let rafId = 0;
  let lastTime = 0;
  let renderPending = false;
  let animating = false;
  function requestRender() {
    renderPending = true;
    if (!rafId) rafId = requestAnimationFrame(tick);
  }
  function tick(now) {
    rafId = 0;
    const dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 1 / 60;
    lastTime = now;
    const cameraMoving = rig.update(dt);
    rig.applyToCamera();
    if (cameraMoving) cutaway.update();
    const fading = roomView.update(dt);
    sceneCtx.render();
    labels.update();
    renderPending = false;
    animating = cameraMoving || fading;
    if (animating) rafId = requestAnimationFrame(tick);
    else lastTime = 0;
  }
  rig.onChange(() => { cutaway.update(); emit('camera'); });

  // ------------------------------------------------------------------ helpers
  const getState = () => ws;
  const getEntity = (id) => State.getEntity(ws, id);
  const getWall = (id) => State.getWall(ws, id);
  const wallFrames = () => State.getWallFrames(ws);

  function roomBounds() { return G.polygonBounds(ws.room.polygon); }
  function roomCenter() { const c = G.polygonCentroid(ws.room.polygon); return new THREE.Vector3(c.x, 0, c.z); }

  function computeHome() {
    const b = roomBounds();
    const c = roomCenter();
    const span = Math.max(b.width, b.depth * 1.25);
    return {
      target: new THREE.Vector3(c.x, 1.5, c.z),
      distance: Math.min(230, span * 1.12 + 12),
      theta: 0.38,
      phi: 0.98,
    };
  }

  function wallLabel(wallId) {
    const frame = getWall(wallId);
    if (!frame) return wallId;
    const n = frame.normal;
    let side = 'Angled';
    if (n.z > 0.7) side = 'Back';
    else if (n.z < -0.7) side = 'Front';
    else if (n.x > 0.7) side = 'Left';
    else if (n.x < -0.7) side = 'Right';
    return `Wall ${frame.index + 1} · ${side}`;
  }

  function entityObb(entity) { return floorObb(entity); }

  function entityCenterWorld(entity) {
    const t = State.entityWorldTransform(ws, entity);
    const p = new THREE.Vector3(t.position.x, t.position.y + entity.height / 2, t.position.z);
    if (entity.anchor === 'wall') {
      const frame = getWall(entity.parent);
      if (frame) p.add(new THREE.Vector3(frame.normal.x, 0, frame.normal.z).multiplyScalar(entity.depth / 2));
    }
    return p;
  }

  // ------------------------------------------------------------------ commits & reconcile
  /** Serialized state with the volatile timestamp masked, for change detection. */
  const stripTime = (json) => json.replace(/"updatedAt":"[^"]*"/, '"updatedAt":""');

  function commit(label, mutator, { track = true } = {}) {
    const before = State.serialize(ws);
    mutator(ws);
    State.touch(ws);
    const after = State.serialize(ws);
    if (stripTime(before) === stripTime(after)) return false;
    if (track) history.push({ label, before, after });
    afterChange(label);
    return true;
  }

  /** Begin a multi-event edit (drag). Returns the snapshot to hand to endEdit. */
  function beginEdit() { return State.serialize(ws); }
  function endEdit(label, before, extra = null) {
    if (extra) extra(ws);
    State.touch(ws);
    const after = State.serialize(ws);
    if (stripTime(before) !== stripTime(after)) {
      history.push({ label, before, after });
      afterChange(label);
    } else {
      reconcile();
    }
  }
  function cancelEdit(before) {
    restore(before, false);
  }

  function restore(json, keepGame = true) {
    const game = ws.game;
    const next = State.deserialize(json);
    if (keepGame) next.game = game;
    ws = next;
    afterChange('restore');
  }

  function afterChange(label) {
    reconcile();
    updateCollisions();
    updateGame();
    autosaver.schedule(ws);
    emit('change', { label, ws });
  }

  let heightSig = null;
  function roomSignature() {
    const entrance = ws.entities.find((e) => e.type === 'door' && e.meta?.role === 'entrance');
    return JSON.stringify([ws.room.polygon, ws.room.wallIds, ws.room.wallThickness,
      entrance ? [entrance.parent, entrance.position.u, entrance.width] : null]);
  }
  function finishSignature() { return JSON.stringify(ws.finishes); }

  function reconcile() {
    const rs = roomSignature();
    const roomChanged = rs !== roomSig;
    if (roomChanged) {
      entityViews.detachAll();
      roomView.build(ws);
      roomSig = rs;
      heightSig = ws.room.wallHeight;
      finishSig = finishSignature();
      const b = roomBounds();
      sceneCtx.fitShadowsTo(b);
      rig.setHome(computeHome());
    } else if (ws.room.wallHeight !== heightSig) {
      // Height-only change: cheaper wall rebuild that keeps the floor, exterior and attachments.
      entityViews.detachAll();
      roomView.setWallHeight(ws.room.wallHeight);
      heightSig = ws.room.wallHeight;
      finishSig = finishSignature();
      entityViews.sync(ws);
      entityViews.remountAll(ws);
      cutaway.reset();
      refreshSelectionVisuals();
      requestRender();
      return;
    } else {
      const fs = finishSignature();
      if (fs !== finishSig) { roomView.applyFinishes(ws); finishSig = fs; }
    }
    entityViews.sync(ws);
    if (roomChanged) {
      entityViews.remountAll(ws);
      cutaway.reset();
    }
    // selection may have become stale
    if (selection.kind === 'entity' && !getEntity(selection.id)) select({ kind: 'none' }, { focus: false });
    else if (selection.kind === 'wall' && !roomView.walls[selection.id]) select({ kind: 'none' }, { focus: false });
    else refreshSelectionVisuals();
    if (hover.kind === 'entity' && !getEntity(hover.id)) hover = { kind: 'none', id: null };
    requestRender();
  }

  function updateCollisions() {
    collisionReport = computeCollisions(ws);
    const involved = new Set([...collisionReport.colliding, ...collisionReport.outOfBounds]);
    entityViews.setCollisions(involved);
    labels.removeByPrefix('collision:');
    const box = new THREE.Box3();
    for (const id of involved) {
      const entity = getEntity(id);
      if (!entity) continue;
      const b = entityViews.worldBox(id, box);
      if (!b || b.isEmpty()) continue;
      const top = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
      const text = collisionReport.outOfBounds.has(id) ? 'Outside room' : 'Overlap';
      labels.set(`collision:${id}`, { text, world: top, offsetY: -16, className: 'label--warning' });
    }
    emit('collisions', collisionReport);
  }

  function updateGame() {
    gameInfo = evaluateGame(ws, collisionReport);
    const fresh = newlyCompleted(ws, gameInfo);
    if (fresh.length) {
      ws.game.celebrated = [...(ws.game.celebrated || []), ...fresh];
      autosaver.schedule(ws);
    }
    emit('game', { info: gameInfo, fresh });
  }

  // ------------------------------------------------------------------ selection & hover
  function sameSel(a, b) { return a.kind === b.kind && (a.id || null) === (b.id || null); }

  function clearSelectionVisuals(sel) {
    if (sel.kind === 'entity') { entityViews.setSelected(sel.id, false); gizmos.hideRotation(); }
    if (sel.kind === 'wall') roomView.setWallHighlight(sel.id, hover.kind === 'wall' && hover.id === sel.id ? 'hover' : 'none');
    if (sel.kind === 'floor') roomView.setFloorHighlight(hover.kind === 'floor' ? 'hover' : 'none');
  }

  function refreshSelectionVisuals() {
    const sel = selection;
    if (sel.kind === 'entity') {
      const e = getEntity(sel.id);
      if (!e) return;
      entityViews.setSelected(e.id, true);
      if (e.anchor === 'floor' && mode === 'build') gizmos.showRotation({ ...e.position, width: e.width, depth: e.depth, rotation: e.rotation });
      else gizmos.hideRotation();
    } else if (sel.kind === 'wall') {
      roomView.setWallHighlight(sel.id, 'selected');
    } else if (sel.kind === 'floor') {
      roomView.setFloorHighlight('selected');
    }
  }

  function select(sel, { focus = true } = {}) {
    const next = { kind: sel?.kind || 'none', id: sel?.id ?? null };
    if (next.kind === 'entity' && !getEntity(next.id)) next.kind = 'none';
    if (sameSel(next, selection)) { if (focus) focusSelection(); return; }
    clearSelectionVisuals(selection);
    selection = next;
    refreshSelectionVisuals();
    if (focus) focusSelection();
    emit('selection', selection);
    requestRender();
  }

  function focusSelection() {
    const sel = selection;
    if (sel.kind === 'entity') {
      const e = getEntity(sel.id);
      if (e) rig.focus(entityCenterWorld(e), undefined, true);
    } else if (sel.kind === 'wall') {
      const f = getWall(sel.id);
      if (f) rig.focus(new THREE.Vector3(f.midpoint.x, Math.min(ws.room.wallHeight / 2, 6), f.midpoint.z), undefined, true);
    }
    requestRender();
  }

  function selectionParent() {
    if (selection.kind === 'entity') {
      const e = getEntity(selection.id);
      if (!e) return { kind: 'none' };
      return e.anchor === 'floor' ? { kind: 'floor' } : { kind: 'wall', id: e.parent };
    }
    return { kind: 'none' };
  }
  function stepBack() { select(selectionParent(), { focus: false }); }

  function setHover(hit) {
    const next = { kind: hit?.kind || 'none', id: hit?.id ?? hit?.wallId ?? null };
    if (next.kind === 'rotate-handle') next.kind = 'handle';
    if (sameSel(next, hover)) return;
    // clear previous
    if (hover.kind === 'entity') entityViews.setHover(hover.id, false);
    if (hover.kind === 'wall' && !(selection.kind === 'wall' && selection.id === hover.id)) roomView.setWallHighlight(hover.id, 'none');
    if (hover.kind === 'floor' && selection.kind !== 'floor') roomView.setFloorHighlight('none');
    hover = next;
    if (hover.kind === 'entity') entityViews.setHover(hover.id, true);
    if (hover.kind === 'wall' && !(selection.kind === 'wall' && selection.id === hover.id)) roomView.setWallHighlight(hover.id, 'hover');
    if (hover.kind === 'floor' && selection.kind !== 'floor') roomView.setFloorHighlight('hover');
    emit('hover', hover);
    requestRender();
  }

  // ------------------------------------------------------------------ placement validation
  function otherFloorObbs(ignoreId) {
    return ws.entities.filter((e) => e.anchor === 'floor' && e.id !== ignoreId).map((e) => ({ def: getDef(e.type), obb: entityObb(e) }));
  }
  function isFreeAt(entity, x, z, ignoreId) {
    const def = getDef(entity.type);
    const obb = { ...entityObb(entity), x, z };
    for (const o of otherFloorObbs(ignoreId)) {
      if (o.def.collision !== def.collision) continue;
      if (G.obbOverlap(obb, o.obb)) return false;
    }
    return true;
  }
  /** Best floor position for an entity near (x, z): inside the polygon, preferring collision-free spots. */
  function resolveFloorPosition(entity, x, z, ignoreId = entity.id) {
    const obb = { ...entityObb(entity), x: G.snap(x, SNAP_FLOOR), z: G.snap(z, SNAP_FLOOR) };
    if (G.obbInsidePolygon(obb, ws.room.polygon) && isFreeAt(entity, obb.x, obb.z, ignoreId)) return { x: obb.x, z: obb.z };
    const free = G.findNearestValidObb(obb, ws.room.polygon, (px, pz) => isFreeAt(entity, px, pz, ignoreId), 10, SNAP_FLOOR);
    if (free) return free;
    const any = G.clampObbToPolygon(obb, ws.room.polygon, null);
    return any;
  }

  // ------------------------------------------------------------------ entity operations
  function placeFloorEntity(defId, x, z, extra = {}) {
    const def = getDef(defId);
    const entity = defaultEntityFor(def, { ...extra, position: { x, z } });
    const pos = resolveFloorPosition(entity, x, z, null);
    if (!pos) return null;
    entity.position = pos;
    let placed = null;
    commit(`Place ${def.name}`, (w) => { placed = State.addEntity(w, entity); });
    if (placed) select({ kind: 'entity', id: placed.id }, { focus: false });
    return placed;
  }

  function placeWallEntity(defId, wallId, u, v = undefined, extra = {}) {
    const def = getDef(defId);
    const frame = getWall(wallId);
    if (!frame) return null;
    const entity = defaultEntityFor(def, { ...extra, parent: wallId, position: { u, v: v ?? def.defaultV } });
    if (entity.width > frame.length) return null;
    const desired = { u: G.snap(u, SNAP_WALL), v: G.snap(entity.position.v, SNAP_WALL) };
    entity.position = clampWallEntity(ws, entity, desired);
    let placed = null;
    commit(`Place ${def.name}`, (w) => { placed = State.addEntity(w, entity); });
    if (placed) select({ kind: 'entity', id: placed.id }, { focus: false });
    return placed;
  }

  function moveEntity(id, position) {
    const e = getEntity(id);
    if (!e) return false;
    return commit('Move', (w) => {
      const t = State.getEntity(w, id);
      t.position = { ...t.position, ...position };
      w.game.arranged = true;
    });
  }

  function rotateEntity(id, rotation) {
    const e = getEntity(id);
    if (!e || e.anchor !== 'floor') return false;
    const rot = G.snapAngle(rotation, 15);
    const obb = { ...entityObb(e), rotation: rot };
    // keep the rotated footprint inside the room: nudge the centre if needed, refuse if it cannot fit
    const pos = G.obbInsidePolygon(obb, ws.room.polygon)
      ? { x: e.position.x, z: e.position.z }
      : G.clampObbToPolygon(obb, ws.room.polygon, { x: e.position.x, z: e.position.z });
    if (!pos) return false;
    return commit('Rotate', (w) => {
      const t = State.getEntity(w, id);
      t.rotation = rot;
      t.position = pos;
      w.game.arranged = true;
    });
  }

  /** Resize / reconfigure. patch: { width, height, depth, meta: {...} } */
  function resizeEntity(id, patch) {
    const e = getEntity(id);
    if (!e) return false;
    const def = getDef(e.type);
    const next = { ...e, ...patch, meta: { ...e.meta, ...(patch.meta || {}) }, position: { ...e.position } };
    for (const k of ['width', 'height', 'depth']) {
      if (patch[k] === undefined) continue;
      const range = def.resizable[k];
      if (!range) return false;
      next[k] = G.clamp(Number(patch[k]), range[0], range[1]);
      if (!Number.isFinite(next[k])) return false;
    }
    for (const [k, p] of Object.entries(def.params)) {
      if (patch.meta && patch.meta[k] !== undefined) {
        const val = G.clamp(Number(patch.meta[k]), p.min, p.max);
        next.meta[k] = Math.round(val / p.step) * p.step;
      }
    }
    if (e.anchor === 'floor') {
      const pos = G.clampObbToPolygon(entityObb(next), ws.room.polygon, { x: e.position.x, z: e.position.z });
      if (!pos) return false;
      next.position = pos;
    } else {
      const frame = getWall(e.parent);
      if (!frame || next.width > frame.length + 1e-6 || next.height > ws.room.wallHeight + 1e-6) return false;
      next.position = clampWallEntity(ws, next, { u: e.position.u, v: e.position.v });
    }
    return commit('Resize', (w) => {
      const t = State.getEntity(w, id);
      Object.assign(t, { width: next.width, height: next.height, depth: next.depth, meta: next.meta, position: next.position });
      w.game.arranged = true;
    });
  }

  function removeEntity(id) {
    const e = getEntity(id);
    if (!e) return false;
    const def = getDef(e.type);
    const parentSel = e.anchor === 'floor' ? { kind: 'floor' } : { kind: 'wall', id: e.parent };
    const wasSelected = selection.kind === 'entity' && selection.id === id;
    const ok = commit(`Remove ${def.name}`, (w) => State.removeEntity(w, id));
    if (ok && wasSelected) select(parentSel, { focus: false });
    return ok;
  }

  /** Finish inserting an entity that state.duplicateEntity / clipboard.paste already pushed into ws. */
  function finalizeInserted(copy, label, before) {
    if (copy.anchor === 'floor') {
      const pos = resolveFloorPosition(copy, copy.position.x, copy.position.z, copy.id);
      if (!pos) { cancelEdit(before); return null; }
      copy.position = pos;
    } else {
      const frame = getWall(copy.parent);
      if (!frame) { cancelEdit(before); return null; }
      copy.position = clampWallEntity(ws, copy, { u: copy.position.u, v: copy.position.v });
      // slide along the wall to find a free spot if it overlaps another wall item
      const overlaps = (u) => ws.entities.some((o) => o.anchor === 'wall' && o.parent === copy.parent && o.id !== copy.id &&
        G.rectOverlap({ u0: u - copy.width / 2, u1: u + copy.width / 2, v0: copy.position.v, v1: copy.position.v + copy.height },
          { u0: o.position.u - o.width / 2, u1: o.position.u + o.width / 2, v0: o.position.v, v1: o.position.v + o.height }));
      if (overlaps(copy.position.u)) {
        search: for (let d = SNAP_WALL; d < frame.length; d += SNAP_WALL) {
          for (const u of [copy.position.u + d, copy.position.u - d]) {
            if (u - copy.width / 2 < 0 || u + copy.width / 2 > frame.length) continue;
            const c = clampWallEntity(ws, { ...copy, position: { u, v: copy.position.v } }, { u, v: copy.position.v });
            if (Math.abs(c.u - u) < 1e-6 && !overlaps(u)) { copy.position = c; break search; }
          }
        }
      }
    }
    endEdit(label, before);
    select({ kind: 'entity', id: copy.id }, { focus: false });
    return copy;
  }

  function duplicateEntity(id) {
    const e = getEntity(id);
    if (!e || e.type === 'door') return null;
    const before = beginEdit();
    const copy = State.duplicateEntity(ws, id, e.anchor === 'floor' ? { x: 1, z: 1 } : { u: e.width + 0.5 });
    if (!copy) return null;
    return finalizeInserted(copy, 'Duplicate', before);
  }

  function copySelected() {
    if (selection.kind !== 'entity') return false;
    const e = getEntity(selection.id);
    if (!e || e.type === 'door') return false;
    clipboard.copy(e);
    emit('clipboard', clipboard.hasContent());
    return true;
  }

  function paste() {
    if (!clipboard.hasContent()) return null;
    const before = beginEdit();
    const copy = clipboard.paste(ws);
    if (!copy) return null;
    return finalizeInserted(copy, 'Paste', before);
  }

  function duplicateSelected() { return selection.kind === 'entity' ? duplicateEntity(selection.id) : null; }
  function removeSelected() {
    if (selection.kind !== 'entity') return false;
    const e = getEntity(selection.id);
    if (!e || e.type === 'door') return false;
    return removeEntity(selection.id);
  }

  // ------------------------------------------------------------------ live edits (drags)
  function previewEntity(id, patch) {
    const e = getEntity(id);
    if (!e) return;
    if (patch.position) e.position = { ...e.position, ...patch.position };
    if (patch.rotation !== undefined) e.rotation = patch.rotation;
    if (patch.parent) e.parent = patch.parent;
    entityViews.updateTransform(e);
    if (e.anchor === 'floor' && selection.kind === 'entity' && selection.id === id) {
      gizmos.updateRotation({ ...e.position, width: e.width, depth: e.depth, rotation: e.rotation });
    }
    updateCollisions();
    requestRender();
  }

  // ------------------------------------------------------------------ room & finishes
  function setWallHeight(h) {
    const height = G.clamp(Number(h), 8, 30);
    if (!Number.isFinite(height)) return false;
    return commit('Change wall height', (w) => {
      w.room.wallHeight = height;
      for (const e of w.entities) {
        if (e.anchor !== 'wall') continue;
        if (e.height > height) e.height = Math.max(1, height);
        if (e.position.v + e.height > height) e.position.v = Math.max(0, height - e.height);
      }
    });
  }

  function setFloorFinish(preset, color) {
    return commit('Change floor finish', (w) => {
      w.finishes.floor = { preset, color: color || w.finishes.floor.color };
    });
  }

  function previewFloorFinish(preset, color) {
    ws.finishes.floor = { preset, color };
    roomView.applyFinishes(ws);
    finishSig = finishSignature();
    requestRender();
  }

  /** target: 'all' | wallId */
  function setWallFinish(target, preset, color) {
    return commit('Change wall finish', (w) => applyWallFinish(w, target, preset, color));
  }
  function applyWallFinish(w, target, preset, color) {
    const finish = { preset, color: color || w.finishes.wallDefault.color };
    if (target === 'all') {
      w.finishes.wallDefault = finish;
      w.finishes.wallOverrides = {};
    } else {
      w.finishes.wallOverrides = { ...(w.finishes.wallOverrides || {}), [target]: finish };
    }
  }
  function previewWallFinish(target, preset, color) {
    applyWallFinish(ws, target, preset, color);
    roomView.applyFinishes(ws);
    finishSig = finishSignature();
    requestRender();
  }
  function rememberCustomColor(color) {
    commit('Remember color', (w) => {
      const list = (w.customColors || []).filter((c) => c !== color);
      list.unshift(color);
      w.customColors = list.slice(0, 8);
    }, { track: false });
  }

  function wallFinishFor(wallId) {
    return (ws.finishes.wallOverrides && ws.finishes.wallOverrides[wallId]) || ws.finishes.wallDefault;
  }

  function addWindow(styleId, wallId, u = null) {
    const style = WINDOW_STYLES.find((s) => s.id === styleId);
    const frame = getWall(wallId);
    if (!style || !frame) return null;
    const height = Math.min(style.height, ws.room.wallHeight - 0.5);
    const centerU = u ?? frame.length / 2;
    return placeWallEntity('window', wallId, centerU, Math.min(style.sill, ws.room.wallHeight - height), {
      width: Math.min(style.width, frame.length), height, meta: { style: styleId },
    });
  }

  function setWindowStyle(id, styleId) {
    const style = WINDOW_STYLES.find((s) => s.id === styleId);
    if (!style) return false;
    return commit('Change window style', (w) => { const t = State.getEntity(w, id); if (t) t.meta = { ...t.meta, style: styleId }; });
  }

  /** target: door id | 'all' */
  function setDoorStyle(target, styleId) {
    if (!DOOR_STYLES.some((s) => s.id === styleId)) return false;
    return commit('Change door style', (w) => {
      for (const e of w.entities) {
        if (e.type !== 'door') continue;
        if (target === 'all' || e.id === target) e.meta = { ...e.meta, style: styleId };
      }
    });
  }

  /**
   * Apply a floor plan: { name, polygon, wallHeight, doors: [{ id?, role, wallId, u, width, height?, style? }] }
   */
  function setRoomPlan(plan) {
    return commit('Edit floor plan', (w) => {
      if (plan.name) w.name = String(plan.name).slice(0, 60);
      const polygon = G.normalizePolygon(plan.polygon);
      const wallIds = polygon.map((_, i) => `w${i}`);
      State.setRoom(w, { polygon, wallHeight: plan.wallHeight ?? w.room.wallHeight, wallIds });
      if (plan.doors) {
        const keep = new Set();
        for (const d of plan.doors) {
          const frame = State.getWall(w, d.wallId);
          if (!frame) continue;
          let door = d.id ? State.getEntity(w, d.id) : null;
          if (!door) door = w.entities.find((e) => e.type === 'door' && e.meta?.role === d.role && !keep.has(e.id));
          if (!door) {
            door = State.addEntity(w, defaultEntityFor(getDef('door'), {
              parent: d.wallId, position: { u: d.u, v: 0 }, width: d.width, height: d.height || 7,
              meta: { style: d.style || 'full-glass', role: d.role },
            }));
          }
          keep.add(door.id);
          door.parent = d.wallId;
          door.width = G.clamp(d.width, 2, Math.max(2, frame.length));
          door.height = Math.min(d.height || door.height, w.room.wallHeight);
          door.position = { u: G.clamp(d.u, door.width / 2, frame.length - door.width / 2), v: 0 };
        }
        w.entities = w.entities.filter((e) => e.type !== 'door' || keep.has(e.id));
      }
      // keep floor fixtures inside the new outline when possible
      for (const e of w.entities) {
        if (e.anchor !== 'floor') continue;
        const pos = G.clampObbToPolygon(floorObb(e), polygon, null);
        if (pos) e.position = pos;
      }
    });
  }

  function renameWorkspace(name) {
    return commit('Rename', (w) => { w.name = String(name).trim().slice(0, 60) || w.name; });
  }

  function newSpace(type, name) {
    ws = State.createWorkspace(type, name);
    history.clear();
    clearSelectionVisuals(selection);
    selection = { kind: 'none', id: null };
    hover = { kind: 'none', id: null };
    roomSig = '';
    afterChange('new-space');
    rig.home(false);
    cutaway.reset();
    emit('selection', selection);
    emit('workspace', ws);
    return ws;
  }

  // ------------------------------------------------------------------ history
  function undo() {
    const entry = history.undo();
    if (!entry) return false;
    restore(entry.before);
    emit('history', { action: 'undo', label: entry.label });
    return true;
  }
  function redo() {
    const entry = history.redo();
    if (!entry) return false;
    restore(entry.after);
    emit('history', { action: 'redo', label: entry.label });
    return true;
  }

  // ------------------------------------------------------------------ modes
  function setMode(next) {
    if (mode === next) return;
    mode = next;
    if (mode === 'finish' && selection.kind === 'entity') {
      const e = getEntity(selection.id);
      if (e && !isArchitecture(e.type)) select({ kind: 'none' }, { focus: false });
    }
    refreshSelectionVisuals();
    emit('mode', mode);
    requestRender();
  }

  // ------------------------------------------------------------------ camera
  function home(animate = true) { rig.home(animate); requestRender(); }
  function focusPoint(point) { rig.focus(point, undefined, true); requestRender(); }

  let reviewActive = false;
  function startReview() {
    const b = roomBounds();
    const c = roomCenter();
    const radius = Math.max(b.width, b.depth) * 0.95 + 8;
    reviewActive = true;
    emit('review', { active: true });
    rig.startCinematic({
      center: new THREE.Vector3(c.x, 2, c.z),
      radius,
      height: Math.max(ws.room.wallHeight * 1.4, 16),
      duration: (reducedMotion || rig.reducedMotion) ? 4 : 14,
      onComplete: () => {
        reviewActive = false;
        commit('Review', (w) => { w.game.reviewed = true; }, { track: false });
        emit('review', { active: false, completed: true });
        rig.home(true);
        requestRender();
      },
    });
    requestRender();
  }
  function cancelReview() {
    if (!reviewActive) return false;
    reviewActive = false;
    rig.cancelCinematic();
    emit('review', { active: false, completed: false });
    requestRender();
    return true;
  }

  // ------------------------------------------------------------------ sizing & lifecycle
  function setSize(w, h) {
    sceneCtx.setSize(w, h);
    requestRender();
  }

  function project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height, inFront: v.z < 1 };
  }

  function flushSave() { autosaver.flush(); }

  function dispose() {
    autosaver.cancel();
    if (rafId) cancelAnimationFrame(rafId);
    labels.clear();
    entityViews.dispose();
    gizmos.dispose();
    roomView.dispose();
    sceneCtx.dispose();
  }

  // initial build
  rig.setHome(computeHome());
  rig.home(false);
  afterChange('load');
  cutaway.reset();
  rig.applyToCamera();
  requestRender();

  return {
    // state
    getState, getEntity, getWall, wallFrames, wallLabel, wallFinishFor, roomBounds, roomCenter, entityCenterWorld, entityObb,
    // editing
    commit, beginEdit, endEdit, cancelEdit, previewEntity,
    placeFloorEntity, placeWallEntity, moveEntity, rotateEntity, resizeEntity, removeEntity, duplicateEntity,
    duplicateSelected, removeSelected, copySelected, paste, hasClipboard: () => clipboard.hasContent(),
    resolveFloorPosition, isFreeAt,
    setWallHeight, setFloorFinish, previewFloorFinish, setWallFinish, previewWallFinish, rememberCustomColor,
    addWindow, setWindowStyle, setDoorStyle, setRoomPlan, renameWorkspace, newSpace,
    undo, redo, canUndo: () => history.canUndo(), canRedo: () => history.canRedo(),
    undoLabel: () => history.peekUndoLabel(), redoLabel: () => history.peekRedoLabel(),
    // selection
    select, getSelection: () => selection, stepBack, setHover, getHover: () => hover,
    // modes & camera
    setMode, getMode: () => mode, home, focusPoint, startReview, cancelReview, isReviewing: () => reviewActive,
    // scene access
    sceneCtx, camera, rig, roomView, gizmos, entityViews, picker, labels, cutaway,
    requestRender, setSize, project, flushSave, dispose, isAnimating: () => animating,
    collisions: () => collisionReport, game: () => gameInfo,
    on, emit,
    reducedMotion,
    SNAP_FLOOR, SNAP_WALL,
  };
}
