// Direct manipulation sessions: drag floor fixtures across the floor, drag wall fixtures /
// windows / doors along their wall, and rotate floor fixtures with the projected handle.
import * as THREE from '../../vendor/three/three.module.js';
import * as G from '../core/geometry.js';
import { clampWallEntity, floorObb, isOpening } from '../core/collisions.js';
import { formatFeetInches } from './labels.js';

const SNAP_TOLERANCE = 0.5; // ft (6 in), window snap-to-guide distance

export function createManipulator(studio) {
  const { picker, gizmos, labels, roomView } = studio;

  function canDrag(entityId) {
    const e = studio.getEntity(entityId);
    if (!e) return false;
    const mode = studio.getMode();
    if (mode === 'finish') return isOpening(e);
    return e.type !== 'door' && e.type !== 'window';
  }

  // ------------------------------------------------------------------ floor drag
  function startFloorDrag(entity, hit) {
    const before = studio.beginEdit();
    const ws = studio.getState();
    const poly = ws.room.polygon;
    // Drag on the horizontal plane through the grab point: no parallax jump when grabbing above the base.
    const grabY = hit.point ? Math.max(0, Math.min(hit.point.y, entity.height)) : 0;
    const hitFloor = hit.point ? { x: hit.point.x, z: hit.point.z } : { x: entity.position.x, z: entity.position.z };
    const offset = { x: entity.position.x - hitFloor.x, z: entity.position.z - hitFloor.z };
    let lastValid = { x: entity.position.x, z: entity.position.z };
    let moved = false;
    const id = entity.id;
    const start = { ...entity.position };

    function showMeasurements(e) {
      const obb = floorObb(e);
      const d = G.distancesToBoundary(obb, poly);
      const { ex, ez } = G.obbExtents(obb);
      const y = 0.05;
      const segs = [];
      const cx = e.position.x, cz = e.position.z;
      const add = (key, a, b, text) => {
        segs.push([a, b]);
        labels.set(`drag:${key}`, { text, world: a.clone().lerp(b, 0.5).setY(0.2), offsetY: 0, className: 'label--dimension' });
      };
      if (Number.isFinite(d.left) && d.left > 0.01) add('left', new THREE.Vector3(cx - ex, y, cz), new THREE.Vector3(cx - ex - d.left, y, cz), formatFeetInches(d.left));
      else labels.remove('drag:left');
      if (Number.isFinite(d.right) && d.right > 0.01) add('right', new THREE.Vector3(cx + ex, y, cz), new THREE.Vector3(cx + ex + d.right, y, cz), formatFeetInches(d.right));
      else labels.remove('drag:right');
      if (Number.isFinite(d.front) && d.front > 0.01) add('front', new THREE.Vector3(cx, y, cz + ez), new THREE.Vector3(cx, y, cz + ez + d.front), formatFeetInches(d.front));
      else labels.remove('drag:front');
      if (Number.isFinite(d.back) && d.back > 0.01) add('back', new THREE.Vector3(cx, y, cz - ez), new THREE.Vector3(cx, y, cz - ez - d.back), formatFeetInches(d.back));
      else labels.remove('drag:back');
      gizmos.showGuides(segs);
      labels.set('drag:pos', {
        text: `${formatFeetInches(cx)}, ${formatFeetInches(cz)}`,
        world: new THREE.Vector3(cx, e.height + 0.4, cz), offsetY: -14, className: 'label--dimension',
      });
    }

    function move(clientX, clientY) {
      const fp = picker.planePoint(grabY, clientX, clientY);
      if (!fp) return;
      const e = studio.getEntity(id);
      if (!e) return;
      const desired = { x: G.snap(fp.x + offset.x, studio.SNAP_FLOOR), z: G.snap(fp.z + offset.z, studio.SNAP_FLOOR) };
      const obb = { ...floorObb(e), x: desired.x, z: desired.z };
      let pos = G.clampObbToPolygon(obb, poly, lastValid) || lastValid;
      pos = { x: G.snap(pos.x, 0.01), z: G.snap(pos.z, 0.01) };
      if (!G.obbInsidePolygon({ ...obb, x: pos.x, z: pos.z }, poly)) pos = lastValid;
      lastValid = pos;
      if (pos.x !== e.position.x || pos.z !== e.position.z) {
        moved = true;
        studio.previewEntity(id, { position: pos });
      }
      showMeasurements(studio.getEntity(id));
    }

    function finish() {
      labels.removeByPrefix('drag:');
      gizmos.hideGuides();
      const e = studio.getEntity(id);
      const changed = e && (e.position.x !== start.x || e.position.z !== start.z);
      studio.endEdit('Move', before, changed ? (w) => { w.game.arranged = true; } : null);
    }

    showMeasurements(entity);
    return { move, end: finish, cancel: finish, kind: 'floor-drag', entityId: id, moved: () => moved };
  }

  // ------------------------------------------------------------------ wall drag (fixture, window, door)
  function wallGuides(ws, entity) {
    // Architectural heights other objects use: sills and heads of windows, door heads, wall height.
    const set = new Set();
    for (const o of ws.entities) {
      if (o.anchor !== 'wall' || o.id === entity.id) continue;
      if (o.type === 'window') { set.add(o.position.v); set.add(o.position.v + o.height); }
      if (o.type === 'door') set.add(o.height);
    }
    set.add(ws.room.wallHeight);
    return [...set];
  }

  function startWallDrag(entity, hit) {
    const before = studio.beginEdit();
    const ws = studio.getState();
    const frame = studio.getWall(entity.parent);
    const id = entity.id;
    const start = { ...entity.position };
    let moved = false;
    if (!frame) return null;
    const hitLocal = hit.point ? picker.wallPoint(frame, hit.clientX, hit.clientY) : null;
    const hitU = hitLocal ? hitLocal.u : entity.position.u;
    const hitV = hitLocal ? hitLocal.v : entity.position.v;
    const offset = { u: entity.position.u - hitU, v: entity.position.v - hitV };
    const guides = entity.type === 'window' ? wallGuides(ws, entity) : [];
    const wall = roomView.walls[entity.parent];

    function label(e) {
      const world = G.wallLocalToWorld(frame, e.position.u, e.position.v + e.height + 0.3, e.depth / 2);
      const text = e.type === 'window'
        ? `${formatFeetInches(e.position.u)} along · sill ${formatFeetInches(e.position.v)} · head ${formatFeetInches(e.position.v + e.height)}`
        : `${formatFeetInches(e.position.u)} along · ${formatFeetInches(e.position.v)} up`;
      labels.set('drag:pos', { text, world: new THREE.Vector3(world.x, world.y, world.z), offsetY: -10, className: 'label--dimension' });
    }

    function move(clientX, clientY) {
      const wp = picker.wallPoint(frame, clientX, clientY);
      if (!wp) return;
      const e = studio.getEntity(id);
      if (!e) return;
      const desired = { u: G.snap(wp.u + offset.u, studio.SNAP_WALL), v: e.type === 'door' ? 0 : G.snap(wp.v + offset.v, studio.SNAP_WALL) };
      let snappedGuide = null;
      if (e.type === 'window') {
        // unsnapped candidate, then snap the bottom or top to nearby guides
        const rawV = wp.v + offset.v;
        let best = null;
        for (const g of guides) {
          const dBottom = Math.abs(rawV - g);
          const dTop = Math.abs(rawV + e.height - g);
          if (dBottom < SNAP_TOLERANCE && (!best || dBottom < best.d)) best = { d: dBottom, v: g, guide: g };
          if (dTop < SNAP_TOLERANCE && (!best || dTop < best.d)) best = { d: dTop, v: g - e.height, guide: g };
        }
        if (best) { desired.v = best.v; snappedGuide = best.guide; }
      }
      const pos = clampWallEntity(ws, e, desired);
      if (snappedGuide !== null && Math.abs(pos.v - desired.v) < 1e-6 && wall) {
        gizmos.showSnapGuide(wall.attachGroup, 0, frame.length, snappedGuide);
      } else {
        gizmos.hideSnapGuide();
      }
      if (pos.u !== e.position.u || pos.v !== e.position.v) {
        moved = true;
        studio.previewEntity(id, { position: pos });
      }
      label(studio.getEntity(id));
    }

    function finish() {
      labels.removeByPrefix('drag:');
      gizmos.hideSnapGuide();
      const e = studio.getEntity(id);
      const changed = e && (e.position.u !== start.u || e.position.v !== start.v);
      const isFixture = e && !isOpening(e);
      studio.endEdit(e?.type === 'window' ? 'Move window' : e?.type === 'door' ? 'Move door' : 'Move', before,
        changed && isFixture ? (w) => { w.game.arranged = true; } : null);
    }

    label(entity);
    return { move, end: finish, cancel: finish, kind: 'wall-drag', entityId: id, moved: () => moved };
  }

  function startDrag(entityId, hit) {
    const entity = studio.getEntity(entityId);
    if (!entity || !canDrag(entityId)) return null;
    if (entity.anchor === 'floor') return startFloorDrag(entity, hit);
    return startWallDrag(entity, hit);
  }

  // ------------------------------------------------------------------ rotation
  function startRotate(entityId, clientX, clientY) {
    const entity = studio.getEntity(entityId);
    if (!entity || entity.anchor !== 'floor') return null;
    const before = studio.beginEdit();
    const id = entity.id;
    const poly = studio.getState().room.polygon;
    const center = { x: entity.position.x, z: entity.position.z };
    const fp = picker.floorPoint(clientX, clientY);
    const angleOf = (p) => (Math.atan2(p.x - center.x, p.z - center.z) * 180) / Math.PI;
    const startAngle = fp ? angleOf(fp) : 0;
    const startRotation = entity.rotation || 0;
    let current = startRotation;
    gizmos.setRotationActive(true);

    function showLabel(e) {
      labels.set('drag:rot', {
        text: `${Math.round(G.normalizeAngle(e.rotation))}°`,
        world: new THREE.Vector3(e.position.x, e.height + 0.4, e.position.z), offsetY: -14, className: 'label--dimension',
      });
    }

    function move(cx, cy) {
      const p = picker.floorPoint(cx, cy);
      if (!p) return;
      const e = studio.getEntity(id);
      if (!e) return;
      const delta = angleOf(p) - startAngle;
      const rot = G.snapAngle(startRotation + delta, 15);
      if (rot === current) return;
      const obb = { ...floorObb(e), rotation: rot };
      if (!G.obbInsidePolygon(obb, poly)) {
        // try to nudge the centre so the rotated footprint fits
        const pos = G.clampObbToPolygon(obb, poly, { x: e.position.x, z: e.position.z });
        if (!pos) return;
        studio.previewEntity(id, { rotation: rot, position: pos });
      } else {
        studio.previewEntity(id, { rotation: rot });
      }
      current = rot;
      showLabel(studio.getEntity(id));
    }

    function finish() {
      labels.removeByPrefix('drag:');
      gizmos.setRotationActive(false);
      const e = studio.getEntity(id);
      const changed = e && G.normalizeAngle(e.rotation) !== G.normalizeAngle(startRotation);
      studio.endEdit('Rotate', before, changed ? (w) => { w.game.arranged = true; } : null);
    }

    showLabel(entity);
    return { move, end: finish, cancel: finish, kind: 'rotate', entityId: id, moved: () => current !== startRotation };
  }

  return { canDrag, startDrag, startRotate };
}
