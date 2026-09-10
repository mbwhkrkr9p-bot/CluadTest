// Raycast picking. Only objects flagged userData.pickable are considered; faded walls and
// decoration are ignored automatically. Returns a normalized hit description.
import * as THREE from '../../vendor/three/three.module.js';
import { worldToWallLocal } from '../core/geometry.js';

export function createPicker({ camera, canvas, roomView, entityViews, gizmos }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmp = new THREE.Vector3();

  function setRay(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
  }

  function isPickable(obj) {
    let o = obj;
    while (o) {
      if (o.userData && o.userData.pickable === false) return false;
      if (o.visible === false) return false;
      o = o.parent;
    }
    return true;
  }

  function collectTargets(opts) {
    const targets = [];
    if (opts.entities !== false) {
      for (const view of entityViews.all().values()) {
        if (opts.entityFilter && !opts.entityFilter(view.entity)) continue;
        targets.push(view.group);
      }
    }
    if (opts.gizmos !== false && gizmos) targets.push(gizmos.group);
    if (opts.surfaces !== false) {
      if (roomView.floorMesh) targets.push(roomView.floorMesh);
      for (const wall of Object.values(roomView.walls)) targets.push(wall.faceMesh);
    }
    return targets;
  }

  /**
   * Pick at client coordinates. Returns
   * { kind: 'rotate-handle' | 'entity' | 'floor' | 'wall' | 'none', id, wallId, point, u, v, object }
   */
  function pick(clientX, clientY, opts = {}) {
    setRay(clientX, clientY);
    const hits = raycaster.intersectObjects(collectTargets(opts), true);
    for (const hit of hits) {
      const obj = hit.object;
      if (!obj.userData || obj.userData.pickable !== true) continue;
      if (!isPickable(obj)) continue;
      const kind = obj.userData.kind;
      if (kind === 'rotate-handle') return { kind, point: hit.point.clone(), object: obj };
      if (obj.userData.entityId) {
        return { kind: 'entity', id: obj.userData.entityId, point: hit.point.clone(), object: obj };
      }
      if (kind === 'floor') return { kind: 'floor', point: hit.point.clone(), object: obj };
      if (kind === 'wall') {
        const wall = roomView.walls[obj.userData.wallId];
        const local = wall ? worldToWallLocal(wall.frame, { x: hit.point.x, y: hit.point.y, z: hit.point.z }) : { u: 0, v: 0 };
        return { kind: 'wall', wallId: obj.userData.wallId, point: hit.point.clone(), u: local.u, v: local.v, object: obj };
      }
    }
    return { kind: 'none', point: null };
  }

  /** Intersection with the infinite floor plane (y = 0). */
  function floorPoint(clientX, clientY) {
    setRay(clientX, clientY);
    const out = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(floorPlane, out);
    return hit ? out : null;
  }

  /** Intersection with a wall's infinite plane; returns wall-local { u, v } or null. */
  function wallPoint(frame, clientX, clientY) {
    setRay(clientX, clientY);
    const n = new THREE.Vector3(frame.normal.x, 0, frame.normal.z);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, tmp.set(frame.start.x, 0, frame.start.z));
    const out = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, out);
    if (!hit) return null;
    const local = worldToWallLocal(frame, { x: out.x, y: out.y, z: out.z });
    return { u: local.u, v: out.y, point: out };
  }

  /** Which surface is under the pointer, ignoring entities and gizmos (used while placing/dragging). */
  function surfaceAt(clientX, clientY) {
    return pick(clientX, clientY, { entities: false, gizmos: false });
  }

  return { pick, floorPoint, wallPoint, surfaceAt, raycaster };
}
