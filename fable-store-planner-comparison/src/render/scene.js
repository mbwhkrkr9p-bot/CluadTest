// Scene bootstrap for 3D Store Studio: renderer, camera, lights, a procedural image-based
// environment and an on-demand render scheduler. This module never runs a continuous loop;
// the integrator drives frames through render() / requestRender().
import * as THREE from '../../vendor/three/three.module.js';

const OFFWHITE = 0xf4efe7;                     // PALETTE.offwhite
const FOG_NEAR = 140;                          // ft — only far-away context fades
const FOG_FAR = 420;
const SUN_DIRECTION = new THREE.Vector3(35, 60, 25).normalize();
const SHADOW_TOP = 30;                         // ft — tallest wall the UI allows
const DEFAULT_BOUNDS = { minX: -40, maxX: 40, minZ: -25, maxZ: 25 };
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Create the renderer, scene, camera and lights for a canvas.
 * @param {HTMLCanvasElement} canvas
 * @returns {SceneContext}
 */
export function createScene(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new Error('createScene needs a canvas element');

  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(OFFWHITE);
  scene.fog = new THREE.Fog(OFFWHITE, FOG_NEAR, FOG_FAR);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.25, 1000);
  camera.position.set(30, 24, 42);
  camera.lookAt(0, 1, 0);

  const { hemi, ambient, sun } = createLights(scene);
  const envTarget = createEnvironment(renderer);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.6;

  // ---------------------------------------------------------------- rendering
  let rafId = 0;

  function render() {
    renderer.render(scene, camera);
  }

  /** Coalesces any number of calls in one tick into a single render on the next frame. */
  function requestRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      render();
    });
  }

  function setSize(w, h) {
    const width = Math.max(1, Math.round(w));
    const height = Math.max(1, Math.round(h));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  /** Point the sun at the room and size its orthographic shadow frustum to the bounds (+ margin). */
  function fitShadowsTo(bounds) {
    const b = readBounds(bounds);
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, b.maxY - b.minY);
    const margin = Math.max(6, span * 0.1);

    sun.target.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(Math.max(90, span * 1.5)).add(sun.target.position);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();

    const ext = lightSpaceExtents(sun, b);
    const cam = sun.shadow.camera;
    cam.left = ext.minX - margin;
    cam.right = ext.maxX + margin;
    cam.bottom = ext.minY - margin;
    cam.top = ext.maxY + margin;
    cam.near = Math.max(0.5, -ext.maxZ - margin);
    cam.far = -ext.minZ + margin;
    cam.updateProjectionMatrix();
  }

  function dispose() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    scene.environment = null;
    envTarget.dispose();
    scene.remove(hemi, ambient, sun, sun.target);
    hemi.dispose();
    ambient.dispose();
    sun.dispose();
    renderer.dispose();
  }

  fitShadowsTo(DEFAULT_BOUNDS);

  return {
    THREE, renderer, scene, camera, sun, hemi, ambient,
    environment: envTarget.texture,
    setSize, render, requestRender, dispose, fitShadowsTo,
  };
}

// ------------------------------------------------------------------ renderer
function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  // three r186 removed PCFSoftShadowMap (WebGLShadowMap warns and swaps to PCFShadowMap on the first
  // shadow pass); PCFShadowMap is its filtered replacement, softened by DirectionalLight.shadow.radius.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

// ------------------------------------------------------------------ lights
function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0xfff6ea, 0xb8ad9e, 0.55);
  hemi.position.set(0, 50, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.12);

  const sun = new THREE.DirectionalLight(0xfff2df, 2.2);
  sun.position.set(35, 60, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;

  scene.add(hemi, ambient, sun, sun.target);
  return { hemi, ambient, sun };
}

/** Validate a bounds object; y range defaults to the floor and the tallest wall. */
function readBounds(bounds) {
  const b = {
    minX: bounds && bounds.minX, maxX: bounds && bounds.maxX,
    minZ: bounds && bounds.minZ, maxZ: bounds && bounds.maxZ,
    minY: bounds && Number.isFinite(bounds.minY) ? bounds.minY : 0,
    maxY: bounds && Number.isFinite(bounds.maxY) ? bounds.maxY : SHADOW_TOP,
  };
  for (const [k, v] of Object.entries(b)) {
    if (!Number.isFinite(v)) throw new Error(`fitShadowsTo: bounds.${k} must be a finite number`);
  }
  if (b.maxX < b.minX || b.maxZ < b.minZ || b.maxY < b.minY) throw new Error('fitShadowsTo: inverted bounds');
  return b;
}

/** Extents of the bounds box in the sun's view space (camera looks down -Z, so z values are negative). */
function lightSpaceExtents(sun, b) {
  const toLight = new THREE.Matrix4().lookAt(sun.position, sun.target.position, UP).transpose();
  const v = new THREE.Vector3();
  const ext = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const x of [b.minX, b.maxX]) {
    for (const y of [b.minY, b.maxY]) {
      for (const z of [b.minZ, b.maxZ]) {
        v.set(x, y, z).sub(sun.position).applyMatrix4(toLight);
        ext.minX = Math.min(ext.minX, v.x); ext.maxX = Math.max(ext.maxX, v.x);
        ext.minY = Math.min(ext.minY, v.y); ext.maxY = Math.max(ext.maxY, v.y);
        ext.minZ = Math.min(ext.minZ, v.z); ext.maxZ = Math.max(ext.maxZ, v.z);
      }
    }
  }
  return ext;
}

// ------------------------------------------------------------------ environment (image-based light)
// A small procedural "showroom": a box room with a few unlit light panels of different warmth and a
// bright soft window. Pre-filtered through PMREM, it gives materials soft reflections and ambient fill.
function createEnvironment(renderer) {
  const envScene = buildEnvScene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0.04, 0.1, 100);
  pmrem.dispose();
  disposeEnvScene(envScene);
  return target;
}

const ENV_ROOM_FACES = [0x8f877c, 0x8a8378, 0xbcb5a8, 0x5a554e, 0x8f877c, 0x958d81]; // +x -x +y -y +z -z
const ENV_PANELS = [
  { x: -5.5, z: -5.5, w: 5, d: 3, color: 0xfff0d6, intensity: 3.2 }, // warm
  { x: 5.5, z: -5.5, w: 5, d: 3, color: 0xffffff, intensity: 2.6 },  // neutral
  { x: -5.5, z: 5.5, w: 5, d: 3, color: 0xe6f0ff, intensity: 2.4 },  // cool
  { x: 5.5, z: 5.5, w: 5, d: 3, color: 0xffe9c9, intensity: 3.0 },   // warm amber
];

function unlitMaterial(hex, intensity, side = THREE.FrontSide) {
  const material = new THREE.MeshBasicMaterial({ color: hex, side });
  material.color.multiplyScalar(intensity); // HDR radiance; PMREM renders to a half-float target
  return material;
}

function buildEnvScene() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(24, 14, 24),
    ENV_ROOM_FACES.map((hex) => unlitMaterial(hex, 1, THREE.BackSide)),
  );
  env.add(room);

  for (const p of ENV_PANELS) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.1, p.d), unlitMaterial(p.color, p.intensity));
    panel.position.set(p.x, 6.9, p.z);
    env.add(panel);
  }

  const window_ = new THREE.Mesh(new THREE.PlaneGeometry(11, 7), unlitMaterial(0xfff8ee, 4.2, THREE.DoubleSide));
  window_.position.set(0, 1, -11.9);
  env.add(window_);

  const sideWindow = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), unlitMaterial(0xeef2ff, 1.8, THREE.DoubleSide));
  sideWindow.position.set(11.9, 1.5, 3);
  sideWindow.rotation.y = -Math.PI / 2;
  env.add(sideWindow);
  return env;
}

function disposeEnvScene(env) {
  env.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) m.dispose();
  });
  env.clear();
}
