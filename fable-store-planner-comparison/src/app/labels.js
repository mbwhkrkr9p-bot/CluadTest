// HTML label layer: small chips positioned over projected 3D points.
// Used for drag measurements, rotation angles, collision badges and snap hints.
import * as THREE from '../../vendor/three/three.module.js';

export function createLabelLayer(container, camera) {
  const labels = new Map(); // id -> { el, world: Vector3, offsetY, className }
  const tmp = new THREE.Vector3();

  function set(id, { text, world, offsetY = -18, className = '' }) {
    let entry = labels.get(id);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'label';
      container.appendChild(el);
      entry = { el, world: new THREE.Vector3(), offsetY, className: '' };
      labels.set(id, entry);
    }
    if (entry.el.textContent !== text) entry.el.textContent = text;
    entry.world.copy(world);
    entry.offsetY = offsetY;
    if (entry.className !== className) {
      entry.el.className = `label ${className}`.trim();
      entry.className = className;
    }
    return entry;
  }

  function remove(id) {
    const entry = labels.get(id);
    if (!entry) return;
    entry.el.remove();
    labels.delete(id);
  }

  function removeByPrefix(prefix) {
    for (const id of [...labels.keys()]) if (id.startsWith(prefix)) remove(id);
  }

  function clear() {
    for (const id of [...labels.keys()]) remove(id);
  }

  function update() {
    if (labels.size === 0) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    for (const entry of labels.values()) {
      tmp.copy(entry.world).project(camera);
      const visible = tmp.z > -1 && tmp.z < 1;
      if (!visible) { entry.el.style.display = 'none'; continue; }
      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * h + entry.offsetY;
      entry.el.style.display = '';
      entry.el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  return { set, remove, removeByPrefix, clear, update, has: (id) => labels.has(id), size: () => labels.size };
}

export function formatFeet(v) {
  const ft = Math.round(v * 100) / 100;
  if (Math.abs(ft - Math.round(ft)) < 1e-6) return `${Math.round(ft)} ft`;
  return `${ft.toFixed(ft * 10 % 1 === 0 ? 1 : 2)} ft`;
}

export function formatFeetInches(v) {
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  let ft = Math.floor(abs + 1e-9);
  let inches = Math.round((abs - ft) * 12);
  if (inches === 12) { ft += 1; inches = 0; }
  if (inches === 0) return `${sign}${ft}'`;
  return `${sign}${ft}' ${inches}"`;
}
