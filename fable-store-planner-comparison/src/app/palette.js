// Placement flows from the Build Kit: tap a card then tap a surface, or drag a card into the room.
// Shows a 3D ghost, highlights the target surface and validates the footprint while hovering.
import * as THREE from '../../vendor/three/three.module.js';
import * as G from '../core/geometry.js';
import { getDef, defaultEntityFor, WINDOW_STYLES } from '../core/catalog.js';
import { clampWallEntity, floorObb } from '../core/collisions.js';
import { buildFixture } from '../render/fixtures/index.js';
import { drawGhostIcon, drawWindowPreview } from '../render/previews.js';
import * as State from '../core/state.js';

export function createPalette(studio, { canvas, ghostEl, ghostCanvas, ghostLabel, onStatus }) {
  const { picker, gizmos, roomView } = studio;
  let placing = null;   // { defId, def, entity, source: 'tap' | 'drag', windowStyle }
  let target = null;    // last evaluated target { valid, kind, wallId, position, overlaps }
  let highlightedWall = null;
  let floorHighlighted = false;

  function makeEntity(defId, extra = {}) {
    const def = getDef(defId);
    const entity = defaultEntityFor(def, extra);
    entity.id = 'ghost';
    return entity;
  }

  function clearSurfaceHighlight() {
    if (highlightedWall) { roomView.setWallHighlight(highlightedWall, studio.getSelection().kind === 'wall' && studio.getSelection().id === highlightedWall ? 'selected' : 'none'); highlightedWall = null; }
    if (floorHighlighted) { roomView.setFloorHighlight(studio.getSelection().kind === 'floor' ? 'selected' : 'none'); floorHighlighted = false; }
  }

  function setDomGhost(valid, text) {
    if (!ghostEl) return;
    ghostEl.classList.toggle('is-valid', !!valid);
    ghostEl.classList.toggle('is-invalid', !valid);
    if (ghostLabel) ghostLabel.textContent = text;
  }

  function paintGhostIcon(defId, windowStyle) {
    if (!ghostCanvas) return;
    const ctx = ghostCanvas.getContext('2d');
    ctx.clearRect(0, 0, ghostCanvas.width, ghostCanvas.height);
    if (defId === 'window') drawWindowPreview(ctx, windowStyle || 'picture', ghostCanvas.width, ghostCanvas.height);
    else drawGhostIcon(ctx, defId, ghostCanvas.width);
  }

  /** Evaluate the target under the pointer and move the ghost. Returns the target description. */
  function updateGhost(clientX, clientY) {
    if (!placing) return null;
    const rect = canvas.getBoundingClientRect();
    const overCanvas = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    const ws = studio.getState();
    const entity = placing.entity;
    const def = placing.def;
    target = { valid: false, kind: 'none' };
    if (overCanvas) {
      const hit = picker.surfaceAt(clientX, clientY);
      if (def.anchor === 'floor') {
        const fp = hit.kind === 'floor' ? hit.point : picker.floorPoint(clientX, clientY);
        if (fp) {
          const desired = { x: G.snap(fp.x, studio.SNAP_FLOOR), z: G.snap(fp.z, studio.SNAP_FLOOR) };
          const obb = { ...floorObb(entity), ...desired };
          const pos = G.clampObbToPolygon(obb, ws.room.polygon, null);
          const nearPointer = pos && Math.hypot(pos.x - desired.x, pos.z - desired.z) < Math.max(entity.width, entity.depth) + 2;
          if (pos && (hit.kind === 'floor' || nearPointer)) {
            entity.position = pos;
            const overlaps = !studio.isFreeAt(entity, pos.x, pos.z, null);
            target = { valid: true, kind: 'floor', position: pos, overlaps };
          }
        }
      } else if (hit.kind === 'wall') {
        const frame = studio.getWall(hit.wallId);
        if (frame && entity.width <= frame.length + 1e-6) {
          entity.parent = hit.wallId;
          const v = placing.fixedV !== undefined ? placing.fixedV : G.snap(G.clamp(hit.v - entity.height / 2, 0, ws.room.wallHeight - entity.height), studio.SNAP_WALL);
          const desired = { u: G.snap(hit.u, studio.SNAP_WALL), v };
          const pos = clampWallEntity(ws, entity, desired);
          entity.position = pos;
          const rect2 = { u0: pos.u - entity.width / 2, u1: pos.u + entity.width / 2, v0: pos.v, v1: pos.v + entity.height };
          const overlaps = ws.entities.some((o) => o.anchor === 'wall' && o.parent === hit.wallId &&
            G.rectOverlap(rect2, { u0: o.position.u - o.width / 2, u1: o.position.u + o.width / 2, v0: o.position.v, v1: o.position.v + o.height }));
          target = { valid: true, kind: 'wall', wallId: hit.wallId, position: pos, overlaps };
        }
      }
    }
    // surface highlight
    clearSurfaceHighlight();
    if (target.kind === 'floor') { roomView.setFloorHighlight('target-valid'); floorHighlighted = true; }
    else if (target.kind === 'wall') { roomView.setWallHighlight(target.wallId, 'target-valid'); highlightedWall = target.wallId; }
    else if (overCanvas) {
      const hit = picker.surfaceAt(clientX, clientY);
      if (hit.kind === 'wall' && def.anchor === 'floor') { roomView.setWallHighlight(hit.wallId, 'target-invalid'); highlightedWall = hit.wallId; }
      if (hit.kind === 'floor' && def.anchor === 'wall') { roomView.setFloorHighlight('target-invalid'); floorHighlighted = true; }
    }
    // 3D ghost
    if (target.valid) {
      let ghost = gizmos.getGhost();
      if (!ghost) { ghost = buildFixture(entity, def); gizmos.showGhost(ghost, true); }
      const t = State.entityWorldTransform(ws, entity);
      ghost.position.set(t.position.x, t.position.y, t.position.z);
      ghost.rotation.set(0, t.rotationY, 0);
      ghost.updateMatrixWorld(true);
      gizmos.setGhostValid(true);
      setDomGhost(true, target.overlaps ? 'Drop to place (overlaps)' : 'Drop to place');
    } else {
      gizmos.hideGhost();
      setDomGhost(false, overCanvas ? (def.anchor === 'wall' ? 'Needs a wall' : 'Needs the floor') : 'Move over the room');
    }
    if (ghostEl && placing.source === 'drag') {
      ghostEl.style.transform = `translate(${clientX + 18}px, ${clientY + 18}px)`;
    }
    studio.requestRender();
    return target;
  }

  function begin(defId, source, opts = {}) {
    cancel(false);
    const def = getDef(defId);
    const extra = {};
    let windowStyle = null;
    let fixedV;
    if (defId === 'window') {
      const style = WINDOW_STYLES.find((s) => s.id === (opts.windowStyle || 'picture')) || WINDOW_STYLES[0];
      windowStyle = style.id;
      const wallHeight = studio.getState().room.wallHeight;
      extra.width = style.width;
      extra.height = Math.min(style.height, wallHeight - 0.5);
      extra.meta = { style: style.id };
      fixedV = Math.min(style.sill, wallHeight - extra.height);
    }
    placing = { defId, def, entity: makeEntity(defId, extra), source, windowStyle, fixedV };
    if (ghostEl) {
      paintGhostIcon(defId, windowStyle);
      ghostEl.hidden = source !== 'drag';
      if (source === 'drag') ghostEl.classList.add('is-active');
    }
    canvas.style.cursor = 'crosshair';
    if (onStatus) onStatus({ placing: true, def, source });
    return placing;
  }

  /** Attempt to place at the pointer. Returns the placed entity or null. */
  function placeAt(clientX, clientY) {
    if (!placing) return null;
    const t = updateGhost(clientX, clientY);
    let placed = null;
    if (t && t.valid) {
      const e = placing.entity;
      if (placing.def.anchor === 'floor') placed = studio.placeFloorEntity(placing.defId, t.position.x, t.position.z, {}, { allowOverlap: true });
      else placed = studio.placeWallEntity(placing.defId, t.wallId, t.position.u, t.position.v, { width: e.width, height: e.height, meta: e.meta });
    }
    cancel(true);
    return placed;
  }

  function cancel(notify = true) {
    if (!placing) return;
    placing = null;
    target = null;
    gizmos.hideGhost();
    clearSurfaceHighlight();
    if (ghostEl) { ghostEl.hidden = true; ghostEl.classList.remove('is-active', 'is-valid', 'is-invalid'); }
    canvas.style.cursor = '';
    if (onStatus && notify) onStatus({ placing: false });
    studio.requestRender();
  }

  return {
    begin, cancel, placeAt, updateGhost,
    isPlacing: () => !!placing,
    current: () => placing,
    target: () => target,
  };
}
