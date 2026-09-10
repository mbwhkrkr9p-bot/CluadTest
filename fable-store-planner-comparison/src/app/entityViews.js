// Keeps three.js groups in sync with workspace entities (state -> scene reconciliation).
// Floor entities live in `floorGroup`; wall entities are children of their wall's attachGroup.
import * as THREE from '../../vendor/three/three.module.js';
import { buildFixture, disposeFixture } from '../render/fixtures/index.js';
import { getDef } from '../core/catalog.js';

const TINT = {
  none: { color: 0x000000, intensity: 0 },
  hover: { color: 0xe0a33b, intensity: 0.12 },
  selected: { color: 0xe0a33b, intensity: 0.22 },
  collision: { color: 0xc0392b, intensity: 0.45 },
};

function geometrySignature(entity) {
  return JSON.stringify([entity.type, entity.width, entity.height, entity.depth, entity.meta || {}]);
}

export function createEntityViews(scene, roomView, gizmos) {
  const floorGroup = new THREE.Group();
  floorGroup.name = 'floor-entities';
  scene.add(floorGroup);

  const views = new Map(); // id -> { group, geomSig, parent, entity, tint, collision, selected, hover }

  function parentFor(entity) {
    if (entity.anchor === 'floor') return floorGroup;
    const wall = roomView.walls[entity.parent];
    return wall ? wall.attachGroup : null;
  }

  function applyTransform(view, entity) {
    const g = view.group;
    if (entity.anchor === 'floor') {
      g.position.set(entity.position.x, 0, entity.position.z);
      g.rotation.set(0, THREE.MathUtils.degToRad(entity.rotation || 0), 0);
    } else {
      g.position.set(entity.position.u, entity.position.v, 0);
      g.rotation.set(0, 0, 0);
    }
    g.updateMatrixWorld(true);
  }

  function applyTint(view) {
    let mode = 'none';
    if (view.collision) mode = 'collision';
    else if (view.selected) mode = 'selected';
    else if (view.hover) mode = 'hover';
    if (view.tint === mode) return;
    view.tint = mode;
    const t = TINT[mode];
    view.group.traverse((o) => {
      if (o.userData?.kind === 'halo') return;
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (!m.emissive) continue;
        m.emissive.setHex(t.color);
        m.emissiveIntensity = t.intensity;
      }
    });
  }

  function build(entity) {
    const def = getDef(entity.type);
    const group = buildFixture(entity, def);
    group.userData.entityId = entity.id;
    group.userData.kind = 'entity';
    group.traverse((o) => { if (o !== group) o.userData.entityId = entity.id; });
    return group;
  }

  function mount(view, entity) {
    const parent = parentFor(entity);
    if (!parent) return false;
    if (view.group.parent !== parent) parent.add(view.group);
    view.parent = parent;
    applyTransform(view, entity);
    return true;
  }

  /** Full reconcile: create / update / remove views so they match ws.entities. */
  function sync(ws) {
    const seen = new Set();
    for (const entity of ws.entities) {
      seen.add(entity.id);
      let view = views.get(entity.id);
      const sig = geometrySignature(entity);
      if (!view) {
        view = { group: build(entity), geomSig: sig, parent: null, entity, tint: 'none', collision: false, selected: false, hover: false };
        views.set(entity.id, view);
      } else if (view.geomSig !== sig) {
        const wasSelected = view.selected;
        gizmos.clearHalo(entity.id);
        view.group.parent?.remove(view.group);
        disposeFixture(view.group);
        view.group = build(entity);
        view.geomSig = sig;
        view.tint = 'none';
        view.selected = wasSelected;
      }
      view.entity = entity;
      mount(view, entity);
      applyTint(view);
    }
    for (const [id, view] of [...views.entries()]) {
      if (!seen.has(id)) {
        gizmos.clearHalo(id);
        view.group.parent?.remove(view.group);
        disposeFixture(view.group);
        views.delete(id);
      }
    }
  }

  /** Detach every view from the scene graph (before the room is rebuilt) without disposing it. */
  function detachAll() {
    for (const view of views.values()) {
      view.group.parent?.remove(view.group);
      view.parent = null;
    }
  }

  /** Re-parent every wall entity after the room was rebuilt (attach groups are new objects). */
  function remountAll(ws) {
    for (const entity of ws.entities) {
      const view = views.get(entity.id);
      if (view) mount(view, entity);
    }
  }

  /** Fast path during drags: only the transform changed. */
  function updateTransform(entity) {
    const view = views.get(entity.id);
    if (!view) return;
    view.entity = entity;
    if (entity.anchor === 'wall' && view.parent !== parentFor(entity)) mount(view, entity);
    else applyTransform(view, entity);
  }

  function setHover(id, hover) {
    const view = views.get(id);
    if (!view) return;
    view.hover = hover;
    applyTint(view);
  }

  function setSelected(id, selected) {
    const view = views.get(id);
    if (!view) return;
    view.selected = selected;
    applyTint(view);
    refreshHalo(view);
  }

  function setCollisions(ids) {
    for (const view of views.values()) {
      const colliding = ids.has(view.entity.id);
      if (colliding === view.collision) continue;
      view.collision = colliding;
      applyTint(view);
      refreshHalo(view);
    }
  }

  function refreshHalo(view) {
    let mode = null;
    if (view.collision) mode = 'collision';
    else if (view.selected) mode = 'selected';
    gizmos.setHalo(view.group, view.entity, mode);
  }

  function get(id) { return views.get(id); }
  function groupOf(id) { return views.get(id)?.group || null; }

  /** World-space bounding box of an entity view. */
  function worldBox(id, target = new THREE.Box3()) {
    const view = views.get(id);
    if (!view) return null;
    view.group.updateMatrixWorld(true);
    target.makeEmpty();
    view.group.traverse((o) => {
      if (o.userData?.kind === 'halo' || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      target.union(b);
    });
    return target;
  }

  function dispose() {
    for (const [id, view] of views) {
      gizmos.clearHalo(id);
      view.group.parent?.remove(view.group);
      disposeFixture(view.group);
    }
    views.clear();
    scene.remove(floorGroup);
  }

  return { floorGroup, sync, detachAll, remountAll, updateTransform, setHover, setSelected, setCollisions, get, groupOf, worldBox, dispose, all: () => views };
}
