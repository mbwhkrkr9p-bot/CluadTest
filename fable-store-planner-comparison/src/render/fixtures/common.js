// Shared helpers for procedural fixture builders. Every builder must create its own
// material instances (never share a material between two fixtures) so the integrator
// can tint `material.emissive` per entity for hover/selection/collision states.
import * as THREE from '../../../vendor/three/three.module.js';

export const FIXTURE_COLORS = {
  wood: '#a57c52',
  lightWood: '#c9a877',
  darkWood: '#5a3e2b',
  metal: '#9aa0a6',
  chrome: '#c4c9cf',
  darkMetal: '#3a3d40',
  white: '#f2efe9',
  cream: '#e9e2d3',
  glass: '#bfe0f2',
  fabric: '#c9b79c',
  steel: '#556270',
  safetyYellow: '#e8b62c',
  safetyOrange: '#e07a2f',
  safetyBlack: '#2b2b2b',
  concrete: '#c8c4bb',
  terracotta: '#b9613a',
  sage: '#7f9270',
  blue: '#3f6d9c',
  charcoal: '#2f2b28',
};

/** Fresh MeshStandardMaterial. `opts` may override roughness/metalness/etc. */
export function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.75, metalness: 0.05, ...opts });
}
export function metalMat(color = FIXTURE_COLORS.chrome, opts = {}) {
  return mat(color, { roughness: 0.35, metalness: 0.85, ...opts });
}
export function glassMat(color = FIXTURE_COLORS.glass, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color), roughness: 0.08, metalness: 0, transmission: 0, transparent: true, opacity: 0.35,
    depthWrite: false, side: THREE.DoubleSide, ...opts,
  });
}
export function woodMat(color = FIXTURE_COLORS.wood, opts = {}) {
  return mat(color, { roughness: 0.65, ...opts });
}

function finishMesh(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.pickable = true;
  return mesh;
}

/** Box with its *bottom* at y, centred on (x, z). */
export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y + h / 2, z);
  return finishMesh(m);
}
/** Box centred at (x, y, z). */
export function boxAt(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return finishMesh(m);
}
/** Vertical cylinder with its bottom at y. */
export function cylinder(radiusTop, radiusBottom, h, material, x = 0, y = 0, z = 0, segments = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments), material);
  m.position.set(x, y + h / 2, z);
  return finishMesh(m);
}
/** Horizontal rod along X (length l) centred at (x, y, z). */
export function rodX(l, radius, material, x = 0, y = 0, z = 0, segments = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, l, segments), material);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return finishMesh(m);
}
/** Horizontal rod along Z (length l) centred at (x, y, z). */
export function rodZ(l, radius, material, x = 0, y = 0, z = 0, segments = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, l, segments), material);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return finishMesh(m);
}
/** Flat plane (facing +Y) with its centre at (x, y, z). */
export function floorPlane(w, d, material, x = 0, y = 0.01, z = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  m.userData.pickable = true;
  return m;
}
/** Vertical plane facing +Z centred at (x, y, z). */
export function wallPlane(w, h, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  m.position.set(x, y, z);
  return finishMesh(m);
}
export function torus(radius, tube, material, x = 0, y = 0, z = 0, flat = true) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 32), material);
  if (flat) m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return finishMesh(m);
}
export function sphere(radius, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
  m.position.set(x, y, z);
  return finishMesh(m);
}

/** Creates a canvas texture painter for small procedural surface patterns (e.g. stripes). */
export function canvasTexture(size, paint, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  paint(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function newGroup(entity) {
  const g = new THREE.Group();
  g.userData = { entityId: entity.id, type: entity.type, kind: 'entity' };
  return g;
}

/** Dispose every geometry, material and texture under a group. */
export function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      for (const key of ['map', 'emissiveMap', 'roughnessMap', 'normalMap', 'alphaMap']) {
        if (m[key] && m[key].dispose) m[key].dispose();
      }
      m.dispose();
    }
  });
}

/** Evenly spaced shelf heights between bottom and top (inclusive of both) for `levels` shelves. */
export function shelfHeights(levels, bottom, top, spacing = 0) {
  const n = Math.max(1, Math.round(levels));
  if (spacing > 0) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const y = bottom + i * spacing;
      if (y > top + 1e-6) break;
      out.push(y);
    }
    return out.length ? out : [bottom];
  }
  if (n === 1) return [bottom];
  const out = [];
  for (let i = 0; i < n; i++) out.push(bottom + ((top - bottom) * i) / (n - 1));
  return out;
}
