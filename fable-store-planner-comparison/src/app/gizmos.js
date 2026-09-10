// Flat, projected editor graphics: selection halos, the rotation control, drag guides,
// the placement ghost and the window snap guide. All decoration lives in its own group
// and is never part of the selectable scene except the rotation handle's touch target.
import * as THREE from '../../vendor/three/three.module.js';

const AMBER = 0xe0a33b;
const RED = 0xc0392b;
const GREEN = 0x7f9270;

function flatMaterial(color, opacity = 1, extra = {}) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide, ...extra,
  });
}

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
    }
  });
}

/** Rounded rectangle outline shape (as a thin band) lying in the XZ plane, centered on origin. */
function roundedFrameGeometry(w, d, thickness, radius) {
  const outer = roundedRectShape(w / 2 + thickness, d / 2 + thickness, radius + thickness);
  const inner = roundedRectShape(w / 2, d / 2, radius);
  outer.holes.push(inner);
  const geo = new THREE.ShapeGeometry(outer, 8);
  geo.rotateX(-Math.PI / 2); // shape (x, y) -> world (x, -z)... fix mirroring below
  geo.scale(1, 1, -1);
  return geo;
}

function roundedRectShape(hw, hd, r) {
  const shape = new THREE.Shape();
  r = Math.min(r, hw, hd);
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(hw, hd - r);
  shape.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-hw + r, hd);
  shape.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-hw, -hd + r);
  shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

/** Curved double-ended arrow (flat) drawn as a THREE.Shape in the XZ plane. */
function curvedArrowGeometry(radius, startAngle, endAngle, band = 0.14, head = 0.42) {
  const shape = new THREE.Shape();
  const r0 = radius - band / 2;
  const r1 = radius + band / 2;
  const a0 = startAngle + head / radius;
  const a1 = endAngle - head / radius;
  const pt = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
  // arrow head at start
  shape.moveTo(...pt(radius, startAngle));
  shape.lineTo(...pt(radius + head * 0.75, a0));
  shape.lineTo(...pt(r1, a0));
  // outer arc
  const steps = 18;
  for (let i = 1; i <= steps; i++) shape.lineTo(...pt(r1, a0 + ((a1 - a0) * i) / steps));
  // arrow head at end
  shape.lineTo(...pt(radius + head * 0.75, a1));
  shape.lineTo(...pt(radius, endAngle));
  shape.lineTo(...pt(radius - head * 0.75, a1));
  shape.lineTo(...pt(r0, a1));
  for (let i = 1; i <= steps; i++) shape.lineTo(...pt(r0, a1 - ((a1 - a0) * i) / steps));
  shape.lineTo(...pt(radius - head * 0.75, a0));
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape, 4);
  geo.rotateX(-Math.PI / 2);
  geo.scale(1, 1, -1);
  return geo;
}

export function createGizmos(scene) {
  const group = new THREE.Group();
  group.name = 'gizmos';
  scene.add(group);

  // ------------------------------------------------------------ rotation control
  const rotation = new THREE.Group();
  rotation.visible = false;
  group.add(rotation);
  let ring = null;
  let arrow = null;
  let touchTarget = null;
  let rotationRadius = 0;

  let touchBand = 0.9;
  let handleRadius = 0;
  let handleSpan = 0;

  function buildTouchTarget() {
    if (touchTarget) { rotation.remove(touchTarget); disposeObject(touchTarget); touchTarget = null; }
    const center = Math.PI / 2;
    const inner = Math.max(rotationRadius + 0.05, handleRadius - touchBand); // never inside the footprint ring
    const sector = new THREE.RingGeometry(inner, handleRadius + touchBand, 24, 1, center - handleSpan - 0.25, handleSpan * 2 + 0.5);
    touchTarget = new THREE.Mesh(sector, flatMaterial(AMBER, 0.0));
    touchTarget.rotation.x = -Math.PI / 2;
    touchTarget.scale.set(1, -1, 1); // ring geometry angles are CCW in XY; after rotateX they mirror in Z
    touchTarget.userData = { kind: 'rotate-handle', pickable: true };
    touchTarget.renderOrder = 22;
    rotation.add(touchTarget);
    rotation.updateMatrixWorld(true);
  }

  /** Radial half-width (feet) of the invisible touch band; callers size it so it stays fingertip-sized on screen. */
  function setTouchBand(band) {
    const next = Math.max(0.9, band);
    if (!rotation.visible || Math.abs(next - touchBand) < 0.15) { touchBand = next; return; }
    touchBand = next;
    buildTouchTarget();
  }

  function showRotation(entityLike, band = touchBand) {
    hideRotation();
    touchBand = Math.max(0.9, band);
    const { x, z, width, depth, rotation: deg } = entityLike;
    const r = Math.hypot(width, depth) / 2 + 0.55;
    rotationRadius = r;
    ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.035, r + 0.035, 96), flatMaterial(AMBER, 0.95));
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 20;
    // handle sits in front of the fixture (+Z local), spanning ±28°
    const handleR = r + 0.75;
    const span = Math.PI / 6.4;
    // In the XZ plane, angle a maps to (cos a, sin a); local +Z (front) is at a = +90°.
    const center = Math.PI / 2;
    arrow = new THREE.Mesh(curvedArrowGeometry(handleR, center - span, center + span), flatMaterial(AMBER, 1));
    arrow.renderOrder = 21;
    rotation.add(ring, arrow);
    handleRadius = handleR;
    handleSpan = span;
    rotation.position.set(x, 0.03, z);
    rotation.rotation.y = THREE.MathUtils.degToRad(deg || 0);
    rotation.visible = true;
    // generous invisible touch target (an annulus sector) around the arrow
    buildTouchTarget();
  }

  function updateRotation(entityLike) {
    if (!rotation.visible) return;
    rotation.position.set(entityLike.x, 0.03, entityLike.z);
    rotation.rotation.y = THREE.MathUtils.degToRad(entityLike.rotation || 0);
    rotation.updateMatrixWorld(true);
  }

  function setRotationActive(active) {
    if (!ring) return;
    ring.material.opacity = active ? 1 : 0.95;
    arrow.material.color.setHex(active ? 0xf3b74d : AMBER);
    ring.scale.setScalar(active ? 1.02 : 1);
  }

  function hideRotation() {
    if (ring) { rotation.remove(ring, arrow, touchTarget); disposeObject(ring); disposeObject(arrow); disposeObject(touchTarget); }
    ring = arrow = touchTarget = null;
    rotation.visible = false;
  }

  // ------------------------------------------------------------ halos (selection / collision)
  const halos = new Map(); // entityId -> mesh (child of the entity group)

  /**
   * Adds or updates a halo under/around an entity group.
   * mode: 'selected' | 'collision' | 'selected-collision' | null
   */
  function setHalo(entityGroup, entity, mode) {
    const id = entity.id;
    const existing = halos.get(id);
    if (!mode) {
      if (existing) { existing.parent?.remove(existing); disposeObject(existing); halos.delete(id); }
      return;
    }
    const color = mode === 'selected' ? AMBER : RED;
    const key = `${entity.anchor}:${entity.width}:${entity.height}:${entity.depth}`;
    if (existing && existing.userData.key === key) {
      existing.material.color.setHex(color);
      existing.material.opacity = mode === 'selected' ? 0.9 : 0.85;
      return;
    }
    if (existing) { existing.parent?.remove(existing); disposeObject(existing); }
    let mesh;
    if (entity.anchor === 'floor') {
      mesh = new THREE.Mesh(roundedFrameGeometry(entity.width, entity.depth, 0.12, 0.25), flatMaterial(color, 0.9));
      mesh.position.y = 0.02;
    } else {
      // frame around the wall rectangle, lying on the wall face plane (XY), slightly proud
      const shape = roundedRectShape(entity.width / 2 + 0.12, entity.height / 2 + 0.12, 0.2);
      shape.holes.push(roundedRectShape(entity.width / 2, entity.height / 2, 0.1));
      mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), flatMaterial(color, 0.9));
      mesh.position.set(0, entity.height / 2, entity.depth + 0.03);
    }
    mesh.renderOrder = 19;
    mesh.userData = { kind: 'halo', pickable: false, key };
    entityGroup.add(mesh);
    halos.set(id, mesh);
  }

  function clearHalo(id) {
    const existing = halos.get(id);
    if (existing) { existing.parent?.remove(existing); disposeObject(existing); halos.delete(id); }
  }

  // ------------------------------------------------------------ drag guides (measurement lines)
  const guides = new THREE.Group();
  guides.visible = false;
  group.add(guides);
  const guideMat = new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9, depthTest: false });
  const guideLines = [];
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, guideMat);
    line.renderOrder = 18;
    guides.add(line);
    guideLines.push(line);
  }

  /** segments: array of [Vector3 a, Vector3 b] (max 4). */
  function showGuides(segments) {
    guides.visible = true;
    guideLines.forEach((line, i) => {
      const seg = segments[i];
      line.visible = !!seg;
      if (seg) {
        const pos = line.geometry.attributes.position;
        pos.setXYZ(0, seg[0].x, seg[0].y, seg[0].z);
        pos.setXYZ(1, seg[1].x, seg[1].y, seg[1].z);
        pos.needsUpdate = true;
        line.geometry.computeBoundingSphere();
      }
    });
  }
  function hideGuides() { guides.visible = false; }

  // ------------------------------------------------------------ selected wall frame (amber outline on the wall face)
  let wallFrameMesh = null;
  function showWallFrame(attachGroup, length, height) {
    hideWallFrame();
    const shape = roundedRectShape(length / 2 + 0.08, height / 2 + 0.08, 0.2);
    shape.holes.push(roundedRectShape(length / 2 - 0.06, height / 2 - 0.06, 0.12));
    wallFrameMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), flatMaterial(AMBER, 0.95, { depthTest: true }));
    wallFrameMesh.position.set(length / 2, height / 2, 0.05);
    wallFrameMesh.renderOrder = 19;
    wallFrameMesh.userData = { kind: 'wall-frame', pickable: false };
    attachGroup.add(wallFrameMesh);
  }
  function hideWallFrame() {
    if (wallFrameMesh) { wallFrameMesh.parent?.remove(wallFrameMesh); disposeObject(wallFrameMesh); wallFrameMesh = null; }
  }

  // ------------------------------------------------------------ window snap guide (amber line on a wall)
  let snapGuide = null;
  function showSnapGuide(attachGroup, u0, u1, v) {
    hideSnapGuide();
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(u0, v, 0.08), new THREE.Vector3(u1, v, 0.08)]);
    snapGuide = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: AMBER, depthTest: false, transparent: true, opacity: 0.95 }));
    snapGuide.renderOrder = 23;
    snapGuide.userData.pickable = false;
    attachGroup.add(snapGuide);
  }
  function hideSnapGuide() {
    if (snapGuide) { snapGuide.parent?.remove(snapGuide); disposeObject(snapGuide); snapGuide = null; }
  }

  // ------------------------------------------------------------ placement ghost
  let ghost = null;
  function showGhost(fixtureGroup, valid) {
    hideGhost();
    ghost = fixtureGroup;
    ghost.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m.transparent = true;
          m.opacity = 0.55;
          m.depthWrite = false;
          if (m.emissive) { m.emissive.setHex(valid ? GREEN : RED); m.emissiveIntensity = 0.55; }
        }
      }
      o.castShadow = false;
      o.userData.pickable = false;
    });
    group.add(ghost);
  }
  function setGhostValid(valid) {
    if (!ghost) return;
    ghost.traverse((o) => {
      if (o.material && o.material.emissive) o.material.emissive.setHex(valid ? GREEN : RED);
    });
  }
  function hideGhost() {
    if (ghost) { ghost.parent?.remove(ghost); disposeObject(ghost); ghost = null; }
  }
  function getGhost() { return ghost; }

  function dispose() {
    hideRotation(); hideGhost(); hideSnapGuide(); hideWallFrame();
    for (const id of [...halos.keys()]) clearHalo(id);
    guideLines.forEach((l) => l.geometry.dispose());
    guideMat.dispose();
    scene.remove(group);
  }

  return {
    group,
    showRotation, updateRotation, hideRotation, setRotationActive, setTouchBand, getRotationRadius: () => rotationRadius, getTouchBand: () => touchBand,
    setHalo, clearHalo,
    showGuides, hideGuides,
    showSnapGuide, hideSnapGuide,
    showWallFrame, hideWallFrame, hasWallFrame: () => !!wallFrameMesh,
    showGhost, setGhostValid, hideGhost, getGhost,
    dispose,
  };
}
