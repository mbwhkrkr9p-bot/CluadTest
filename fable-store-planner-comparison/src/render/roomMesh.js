// Room presentation: floor + one-foot grid, walls (inner face, mitred thickness shell, attach
// group for wall entities) and decorative exterior context (ground apron, foundation edge,
// entrance path, planters). Everything is derived from the plain workspace object.
import * as THREE from '../../vendor/three/three.module.js';
import { wallFrames, polygonBounds, pointInPolygon, wallLocalToWorld } from '../core/geometry.js';
import { createFloorMaterial, createWallMaterial } from './materials.js';

const FADE_SECONDS = 0.18;
const FADED_OPACITY = 0.08;
const FACE_INSET = 0.01;          // gap between the face plane and the shell (avoids z-fighting)
const GRID_Y = 0.005;
const APRON_Y = -0.02;
const FOUNDATION = { width: 1, height: 0.35, color: '#d8d3ca' };
const APRON = { color: '#e4ded3', minSize: 120, scale: 4 };
const PATH = { width: 8, length: 12, thickness: 0.08, color: '#ede8df' };
const EXTERIOR_COLOR = '#e9e4dc';
const PLANTER_COLORS = { terracotta: '#b9613a', charcoal: '#3a3633', sage: '#7f9270' };

const HIGHLIGHTS = {
  none: { color: 0x000000, intensity: 0 },
  hover: { color: 0xe0a33b, intensity: 0.07 },
  selected: { color: 0xe0a33b, intensity: 0.18 },
  'target-valid': { color: 0x7f9270, intensity: 0.3 },
  'target-invalid': { color: 0xc0392b, intensity: 0.3 },
};

export function createRoomView(sceneCtx) {
  if (!sceneCtx || !sceneCtx.scene) throw new Error('createRoomView needs a sceneCtx with a scene');
  const { scene } = sceneCtx;
  const requestRender = typeof sceneCtx.requestRender === 'function' ? sceneCtx.requestRender : () => {};

  const group = new THREE.Group();
  group.name = 'room';
  const floorGroup = new THREE.Group();
  floorGroup.name = 'room-floor';
  const wallsGroup = new THREE.Group();
  wallsGroup.name = 'room-walls';
  const exteriorGroup = new THREE.Group();
  exteriorGroup.name = 'room-exterior';
  exteriorGroup.userData = { kind: 'exterior', pickable: false };
  group.add(floorGroup, wallsGroup, exteriorGroup);
  scene.add(group);

  let room = null;            // snapshot of the built workspace (see readRoom)
  let frames = [];            // WallFrame[] for room.polygon
  let floor = null;           // { geometry, gridTexture, gridMaterial, gridMesh, finish, key, highlight }
  const internals = new Map(); // wallId -> { shellMesh, finish, key, highlight, fade }
  const exteriorResources = [];
  const baseline = new WeakMap();   // material -> { opacity, transparent, depthWrite } captured before fading
  const pickBackup = new WeakSet(); // objects whose pickable flag was cleared by a fade
  const shadowBackup = new WeakSet(); // objects whose castShadow was cleared by a fade

  const view = {
    group,
    floorMesh: null,
    walls: {},
    build,
    applyFinishes,
    setWallHeight,
    setWallFade,
    update,
    getWallFrames,
    setFloorHighlight,
    setWallHighlight,
    dispose,
  };

  // ---------------------------------------------------------------- build / rebuild

  function build(ws) {
    const next = readRoom(ws);
    const carried = collectAttachChildren();
    disposeAll();
    room = next;
    frames = wallFrames(room.polygon);
    buildFloor();
    buildWalls();
    buildExterior();
    reattach(carried);
    requestRender();
  }

  function applyFinishes(ws) {
    if (!room) throw new Error('applyFinishes called before build');
    room.finishes = readFinishes(ws);
    const floorFinish = room.finishes.floor;
    const floorKey = finishKey(floorFinish);
    if (floor.key !== floorKey) {
      const previous = floor.finish;
      floor.finish = createFloorMaterial(floorFinish.preset, floorFinish.color);
      floor.key = floorKey;
      view.floorMesh.material = floor.finish.material;
      previous.dispose();
      applyHighlight(view.floorMesh.material, floor.highlight);
    }
    for (const [wallId, wall] of Object.entries(view.walls)) {
      const priv = internals.get(wallId);
      const finish = wallFinish(wallId);
      const key = finishKey(finish);
      if (priv.key === key) continue;
      const previous = priv.finish;
      priv.finish = createWallMaterial(finish.preset, finish.color, wall.frame.length, room.wallHeight);
      priv.key = key;
      wall.faceMesh.material = priv.finish.material;
      previous.dispose();
      applyHighlight(wall.faceMesh.material, priv.highlight);
      if (priv.fade.level < 1) applyFadeLevel(wall, priv.fade.level);
    }
    requestRender();
  }

  function setWallHeight(h) {
    const height = Number(h);
    if (!Number.isFinite(height) || height <= 0) throw new Error('setWallHeight: height must be a positive number');
    if (!room) throw new Error('setWallHeight called before build');
    room.wallHeight = height;
    const carried = collectAttachChildren();
    const states = {};
    for (const [wallId, priv] of internals) states[wallId] = { faded: priv.fade.faded, highlight: priv.highlight };
    disposeWalls();
    buildWalls();
    reattach(carried);
    for (const [wallId, state] of Object.entries(states)) {
      if (!view.walls[wallId]) continue;
      setWallHighlight(wallId, state.highlight);
      if (state.faded) setWallFade(wallId, true, true);
    }
    requestRender();
  }

  function getWallFrames() {
    return frames.map((frame, i) => ({ ...frame, id: room.wallIds[i] }));
  }

  function dispose() {
    disposeAll();
    scene.remove(group);
  }

  // ---------------------------------------------------------------- floor

  function buildFloor() {
    const finish = room.finishes.floor;
    const geometry = floorGeometry(room.polygon);
    const material = createFloorMaterial(finish.preset, finish.color);
    applyHighlight(material.material, 'none');
    const mesh = new THREE.Mesh(geometry, material.material);
    mesh.name = 'floor';
    mesh.receiveShadow = true;
    mesh.userData = { kind: 'floor', pickable: true };

    const gridTexture = createGridTexture();
    const gridMaterial = new THREE.MeshBasicMaterial({
      map: gridTexture, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    const gridMesh = new THREE.Mesh(geometry, gridMaterial);
    gridMesh.name = 'floor-grid';
    gridMesh.position.y = GRID_Y;
    gridMesh.renderOrder = 1;
    gridMesh.userData = { kind: 'floor-grid', pickable: false };

    floorGroup.add(mesh, gridMesh);
    view.floorMesh = mesh;
    floor = { geometry, gridTexture, gridMaterial, gridMesh, finish: material, key: finishKey(finish), highlight: 'none' };
  }

  function disposeFloor() {
    if (!floor) return;
    floorGroup.remove(view.floorMesh, floor.gridMesh);
    floor.geometry.dispose();
    floor.gridTexture.dispose();
    floor.gridMaterial.dispose();
    floor.finish.dispose();
    floor = null;
    view.floorMesh = null;
  }

  // ---------------------------------------------------------------- walls

  function buildWalls() {
    const outer = offsetOutline(frames, room.wallThickness);
    const n = frames.length;
    const walls = {};
    frames.forEach((frame, i) => {
      const wallId = room.wallIds[i];
      walls[wallId] = buildWall(frame, wallId, outer[i], outer[(i + 1) % n]);
    });
    view.walls = walls;
  }

  function buildWall(frame, wallId, outerStart, outerEnd) {
    const height = room.wallHeight;
    const rotY = wallRotation(frame);
    const wallGroup = new THREE.Group();
    wallGroup.name = `wall-${wallId}`;
    wallGroup.userData = { kind: 'wall-group', wallId };

    const finish = wallFinish(wallId);
    const material = createWallMaterial(finish.preset, finish.color, frame.length, height);
    applyHighlight(material.material, 'none');
    const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(frame.length, height), material.material);
    faceMesh.name = `wall-face-${wallId}`;
    faceMesh.position.set(frame.midpoint.x, height / 2, frame.midpoint.z);
    faceMesh.rotation.y = rotY;
    faceMesh.receiveShadow = true;
    faceMesh.userData = { kind: 'wall', wallId, pickable: true };

    const shellMaterial = new THREE.MeshStandardMaterial({ color: EXTERIOR_COLOR, roughness: 0.85, metalness: 0 });
    const shellMesh = new THREE.Mesh(shellGeometry(frame, outerStart, outerEnd, height), shellMaterial);
    shellMesh.name = `wall-shell-${wallId}`;
    shellMesh.castShadow = true;
    shellMesh.receiveShadow = true;
    shellMesh.userData = { kind: 'wall-shell', wallId, pickable: false };

    const attachGroup = new THREE.Group();
    attachGroup.name = `wall-attach-${wallId}`;
    attachGroup.position.set(frame.start.x, 0, frame.start.z);
    attachGroup.rotation.y = rotY;
    attachGroup.userData = { kind: 'wall-attach', wallId, pickable: true };

    wallGroup.add(faceMesh, shellMesh, attachGroup);
    wallsGroup.add(wallGroup);
    internals.set(wallId, { shellMesh, finish: material, key: finishKey(finish), highlight: 'none', fade: newFade() });
    return { group: wallGroup, faceMesh, frame: { ...frame, id: wallId }, attachGroup };
  }

  /** Disposes wall meshes and materials only; attach-group children are never disposed here. */
  function disposeWalls() {
    for (const [wallId, wall] of Object.entries(view.walls)) {
      const priv = internals.get(wallId);
      wallsGroup.remove(wall.group);
      wall.faceMesh.geometry.dispose();
      priv.finish.dispose();
      priv.shellMesh.geometry.dispose();
      priv.shellMesh.material.dispose();
    }
    internals.clear();
    view.walls = {};
  }

  /** Snapshot of every attach-group child per wall id (kept alive across wall rebuilds). */
  function collectAttachChildren() {
    const carried = {};
    for (const [wallId, wall] of Object.entries(view.walls)) {
      if (wall.attachGroup.children.length) carried[wallId] = wall.attachGroup.children.slice();
    }
    return carried;
  }

  function reattach(carried) {
    for (const [wallId, children] of Object.entries(carried)) {
      const wall = view.walls[wallId];
      if (wall && children.length) wall.attachGroup.add(...children);
    }
  }

  function wallFinish(wallId) {
    const f = room.finishes;
    return f.wallOverrides[wallId] || f.wallDefault;
  }

  // ---------------------------------------------------------------- exterior context (decoration only)

  function buildExterior() {
    const bounds = polygonBounds(room.polygon);
    exteriorGroup.add(buildApron(bounds), buildFoundation());
    const entrance = entranceAnchor();
    if (room.entrance) exteriorGroup.add(buildPath(entrance));
    buildPlanters(entrance).forEach((p) => exteriorGroup.add(p));
    exteriorGroup.traverse((o) => { o.userData.pickable = false; });
  }

  function buildApron(bounds) {
    const w = Math.max(bounds.width * APRON.scale, APRON.minSize);
    const d = Math.max(bounds.depth * APRON.scale, APRON.minSize);
    const material = new THREE.MeshStandardMaterial({ color: APRON.color, roughness: 1, metalness: 0 });
    const geometry = new THREE.PlaneGeometry(w, d);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'exterior-apron';
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((bounds.minX + bounds.maxX) / 2, APRON_Y, (bounds.minZ + bounds.maxZ) / 2);
    mesh.receiveShadow = true;
    exteriorResources.push(geometry, material);
    return mesh;
  }

  /** Low concrete ring from the polygon outline out to wallThickness + 1 ft. */
  function buildFoundation() {
    const outer = offsetOutline(frames, room.wallThickness + FOUNDATION.width);
    const shape = floorShape(outer);
    shape.holes.push(floorPath(room.polygon));
    const geometry = layFlat(new THREE.ExtrudeGeometry(shape, { depth: FOUNDATION.height, bevelEnabled: false }));
    const material = new THREE.MeshStandardMaterial({ color: FOUNDATION.color, roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'exterior-foundation';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    exteriorResources.push(geometry, material);
    return mesh;
  }

  /** Wall frame + u position the path and planters are laid out from. */
  function entranceAnchor() {
    if (room.entrance) {
      const frame = frames[room.wallIds.indexOf(room.entrance.wallId)];
      return { frame, u: Math.min(Math.max(room.entrance.u, 0), frame.length) };
    }
    // no entrance: use the wall facing the default camera (largest outward +Z component)
    let best = frames[0];
    for (const f of frames) if (-f.normal.z > -best.normal.z) best = f;
    return { frame: best, u: best.length / 2 };
  }

  function buildPath({ frame, u }) {
    const hidden = room.wallThickness + FOUNDATION.width; // part tucked under the foundation ring
    const length = PATH.length + hidden;
    const c = wallLocalToWorld(frame, u, 0, -length / 2);
    const geometry = new THREE.BoxGeometry(PATH.width, PATH.thickness, length);
    const material = new THREE.MeshStandardMaterial({ color: PATH.color, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'exterior-path';
    mesh.position.set(c.x, APRON_Y + PATH.thickness / 2, c.z);
    mesh.rotation.y = wallRotation(frame);
    mesh.receiveShadow = true;
    exteriorResources.push(geometry, material);
    return mesh;
  }

  function buildPlanters({ frame, u }) {
    const near = room.wallThickness + FOUNDATION.width + 1.6;
    const far = room.wallThickness + FOUNDATION.width + PATH.length - 1.4;
    const side = PATH.width / 2 + 1.6;
    const spots = [
      { du: -side, n: near, kind: 'pot' },
      { du: side, n: near, kind: 'box' },
      { du: -side, n: far, kind: 'box' },
      { du: side, n: far, kind: 'pot' },
    ];
    const materials = {
      terracotta: new THREE.MeshStandardMaterial({ color: PLANTER_COLORS.terracotta, roughness: 0.8, metalness: 0 }),
      charcoal: new THREE.MeshStandardMaterial({ color: PLANTER_COLORS.charcoal, roughness: 0.7, metalness: 0.05 }),
      sage: new THREE.MeshStandardMaterial({ color: PLANTER_COLORS.sage, roughness: 0.9, metalness: 0 }),
    };
    exteriorResources.push(...Object.values(materials));
    const planters = [];
    for (const spot of spots) {
      const p = wallLocalToWorld(frame, u + spot.du, 0, -spot.n);
      if (pointInPolygon({ x: p.x, z: p.z }, room.polygon)) continue;
      const planter = buildPlanter(spot.kind, materials);
      planter.position.set(p.x, APRON_Y, p.z);
      planter.rotation.y = wallRotation(frame);
      planters.push(planter);
    }
    return planters;
  }

  function buildPlanter(kind, materials) {
    const planter = new THREE.Group();
    planter.name = `exterior-planter-${kind}`;
    const add = (geometry, material, y) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = y;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      exteriorResources.push(geometry);
      planter.add(mesh);
    };
    if (kind === 'pot') {
      add(new THREE.CylinderGeometry(0.85, 0.65, 1.1, 20), materials.terracotta, 0.55);
      add(new THREE.SphereGeometry(0.95, 18, 14), materials.sage, 1.1 + 0.75);
    } else {
      add(new THREE.BoxGeometry(2.2, 0.9, 2.2), materials.charcoal, 0.45);
      add(new THREE.ConeGeometry(0.9, 2.1, 18), materials.sage, 0.9 + 1.05);
    }
    return planter;
  }

  function disposeExterior() {
    exteriorGroup.clear();
    for (const r of exteriorResources) r.dispose();
    exteriorResources.length = 0;
  }

  function disposeAll() {
    disposeFloor();
    disposeWalls();
    disposeExterior();
    room = null;
    frames = [];
  }

  // ---------------------------------------------------------------- fade (cutaway)

  function newFade() {
    return { faded: false, level: 1, from: 1, target: 1, elapsed: 0, duration: 0, animating: false };
  }

  function setWallFade(wallId, faded, immediate = false) {
    const wall = view.walls[wallId];
    if (!wall) return false;
    const priv = internals.get(wallId);
    const fade = priv.fade;
    const target = faded ? 0 : 1;
    fade.faded = !!faded;
    setWallPickable(wall, !faded);
    setWallShadows(wall, priv, !faded);
    if (immediate || fade.level === target) {
      fade.level = target;
      fade.animating = false;
      applyFadeLevel(wall, target);
      requestRender();
      return false;
    }
    fade.from = fade.level;
    fade.target = target;
    fade.elapsed = 0;
    fade.duration = FADE_SECONDS * Math.abs(target - fade.level);
    fade.animating = true;
    applyFadeLevel(wall, fade.level);
    requestRender();
    return true;
  }

  /** Advances fade tweens (dt in seconds). Returns true while any tween is active. */
  function update(dt) {
    const step = Math.max(0, Number(dt) || 0);
    let active = false;
    for (const [wallId, priv] of internals) {
      const wall = view.walls[wallId];
      const fade = priv.fade;
      if (fade.animating) {
        fade.elapsed += step;
        const t = fade.duration > 0 ? Math.min(1, fade.elapsed / fade.duration) : 1;
        fade.level = fade.from + (fade.target - fade.from) * smoothstep(t);
        if (t >= 1) {
          fade.level = fade.target;
          fade.animating = false;
        } else {
          active = true;
        }
        applyFadeLevel(wall, fade.level);
      } else if (fade.faded) {
        enforceFaded(wall, priv);
      }
    }
    return active;
  }

  /** Objects mounted under an already-faded wall pick up the faded look on the next tick. */
  function enforceFaded(wall, priv) {
    applyFadeLevel(wall, priv.fade.level);
    setWallPickable(wall, false);
    setWallShadows(wall, priv, false);
  }

  /** level 1 = solid, 0 = fully faded. Opacity scales from each material's own baseline (glass stays proportional). */
  function applyFadeLevel(wall, level) {
    const solid = level >= 1 - 1e-6;
    const factor = FADED_OPACITY + (1 - FADED_OPACITY) * level;
    forEachWallMaterial(wall, (m) => {
      if (solid) {
        restoreMaterial(m);
        return;
      }
      let base = baseline.get(m);
      if (!base) {
        base = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
        baseline.set(m, base);
      }
      m.opacity = base.opacity * factor;
      m.transparent = true;
      m.depthWrite = false;
    });
  }

  function restoreMaterial(m) {
    const base = baseline.get(m);
    if (!base) return;
    m.opacity = base.opacity;
    m.transparent = base.transparent;
    m.depthWrite = base.depthWrite;
    baseline.delete(m);
  }

  function forEachWallMaterial(wall, fn) {
    const priv = internals.get(wall.frame.id);
    fn(wall.faceMesh.material);
    fn(priv.shellMesh.material);
    wall.attachGroup.traverse((o) => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(fn);
    });
  }

  function setWallPickable(wall, pickable) {
    wall.faceMesh.userData.pickable = pickable;
    wall.attachGroup.userData.pickable = pickable;
    wall.attachGroup.traverse((o) => {
      if (o === wall.attachGroup) return;
      if (!pickable) {
        if (o.userData.pickable === true) {
          pickBackup.add(o);
          o.userData.pickable = false;
        }
      } else if (pickBackup.has(o)) {
        o.userData.pickable = true;
        pickBackup.delete(o);
      }
    });
  }

  /** Faded walls (and what hangs on them) stop casting shadows so no phantom shadow bands remain. */
  function setWallShadows(wall, priv, cast) {
    priv.shellMesh.castShadow = cast;
    wall.attachGroup.traverse((o) => {
      if (!o.isMesh) return;
      if (!cast) {
        if (o.castShadow) {
          shadowBackup.add(o);
          o.castShadow = false;
        }
      } else if (shadowBackup.has(o)) {
        o.castShadow = true;
        shadowBackup.delete(o);
      }
    });
  }

  // ---------------------------------------------------------------- highlights

  function setFloorHighlight(mode) {
    assertMode(mode);
    if (!floor) return;
    floor.highlight = mode;
    applyHighlight(view.floorMesh.material, mode);
    requestRender();
  }

  function setWallHighlight(wallId, mode) {
    assertMode(mode);
    const wall = view.walls[wallId];
    if (!wall) return;
    internals.get(wallId).highlight = mode;
    applyHighlight(wall.faceMesh.material, mode);
    requestRender();
  }

  function applyHighlight(material, mode) {
    const h = HIGHLIGHTS[mode];
    material.emissive.setHex(h.color);
    material.emissiveIntensity = h.intensity;
  }

  function assertMode(mode) {
    if (!HIGHLIGHTS[mode]) throw new Error(`Unknown highlight mode: ${mode}`);
  }

  return view;
}

// ---------------------------------------------------------------- workspace snapshot

function readRoom(ws) {
  const r = ws && ws.room;
  if (!r || !Array.isArray(r.polygon) || r.polygon.length < 3) {
    throw new Error('roomMesh.build: workspace needs a room polygon with at least 3 vertices');
  }
  const polygon = r.polygon.map((p) => ({ x: Number(p.x), z: Number(p.z) }));
  const wallIds = Array.isArray(r.wallIds) && r.wallIds.length === polygon.length
    ? r.wallIds.slice()
    : polygon.map((_, i) => `w${i}`);
  return {
    polygon,
    wallIds,
    wallHeight: positive(r.wallHeight, 9),
    wallThickness: positive(r.wallThickness, 0.5),
    finishes: readFinishes(ws),
    entrance: findEntrance(ws, wallIds),
  };
}

function readFinishes(ws) {
  const f = (ws && ws.finishes) || {};
  const floor = f.floor || {};
  const wall = f.wallDefault || {};
  return {
    floor: { preset: floor.preset || 'light-oak', color: floor.color },
    wallDefault: { preset: wall.preset || 'warm-white', color: wall.color },
    wallOverrides: { ...(f.wallOverrides || {}) },
  };
}

function findEntrance(ws, wallIds) {
  const door = ((ws && ws.entities) || []).find((e) => e && e.type === 'door' && e.anchor === 'wall'
    && e.meta && e.meta.role === 'entrance' && wallIds.includes(e.parent));
  if (!door) return null;
  return { wallId: door.parent, u: Number(door.position && door.position.u) || 0, width: Number(door.width) || 6 };
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function finishKey(finish) {
  return `${finish.preset}|${finish.color || ''}`;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- geometry helpers

/** rotation.y for which local +X = frame.dir and local +Z = frame.normal (inward). */
function wallRotation(frame) {
  return Math.atan2(-frame.dir.z, frame.dir.x);
}

/** Shape in the XY plane with y = -z, so layFlat() maps it onto the floor with world z = polygon z. */
function floorShape(points) {
  const shape = new THREE.Shape();
  points.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
  shape.closePath();
  return shape;
}

function floorPath(points) {
  const path = new THREE.Path();
  points.forEach((p, i) => (i ? path.lineTo(p.x, -p.z) : path.moveTo(p.x, -p.z)));
  path.closePath();
  return path;
}

/** Rotates an XY-plane geometry (extruded along +Z) so it lies on the floor facing up, extruding along +Y. */
function layFlat(geometry) {
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** Floor geometry with UVs in feet (u = world x, v = world z) so finishes and the grid line up. */
function floorGeometry(polygon) {
  const geometry = layFlat(new THREE.ShapeGeometry(floorShape(polygon)));
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  uv.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

/** Outward offset of every polygon vertex by d feet with mitred corners (clamped for very sharp angles). */
function offsetOutline(frames, d) {
  const n = frames.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = frames[(i + n - 1) % n];
    const next = frames[i];
    const ax = -prev.normal.x, az = -prev.normal.z;
    const bx = -next.normal.x, bz = -next.normal.z;
    let mx = ax + bx, mz = az + bz;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      out.push({ x: next.start.x + bx * d, z: next.start.z + bz * d });
      continue;
    }
    mx /= ml;
    mz /= ml;
    const cos = Math.max(mx * bx + mz * bz, 1e-3);
    const len = Math.min(d / cos, d * 3);
    out.push({ x: next.start.x + mx * len, z: next.start.z + mz * len });
  }
  return out;
}

/** Thickness shell of one wall: a prism between the (slightly inset) edge and the mitred outer line. */
function shellGeometry(frame, outerStart, outerEnd, height) {
  const ox = -frame.normal.x * FACE_INSET;
  const oz = -frame.normal.z * FACE_INSET;
  const points = [
    { x: frame.start.x + ox, z: frame.start.z + oz },
    { x: frame.end.x + ox, z: frame.end.z + oz },
    outerEnd,
    outerStart,
  ];
  return layFlat(new THREE.ExtrudeGeometry(floorShape(points), { depth: height, bevelEnabled: false }));
}

/** Transparent 5 ft × 5 ft tile: thin lines every foot, slightly stronger every 5 ft. */
function createGridTexture() {
  const size = 320;
  const ft = size / 5;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 5; i++) {
    const major = i === 0;
    ctx.fillStyle = major ? 'rgba(70,64,58,0.24)' : 'rgba(70,64,58,0.14)';
    const w = major ? 2 : 1.5;
    ctx.fillRect(i * ft, 0, w, size);
    ctx.fillRect(0, i * ft, size, w);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / 5, 1 / 5);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
