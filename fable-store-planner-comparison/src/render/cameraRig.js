// Damped orbit camera rig for 3D Store Studio. Keeps a "goal" and a "current" spherical state
// around a target (theta = azimuth around +Y, phi = polar angle from +Y: small phi looks down from
// above, phi near pi/2 sits at floor level) and eases current toward goal on every update().
// The rig registers no DOM listeners; the input layer feeds it deltas and the app drives update().
import * as THREE from '../../vendor/three/three.module.js';

const DAMPING_TAU = 0.12;        // s, exponential smoothing time constant
const TWEEN_DURATION = 0.6;      // s, focus/home ease-in-out
const MIN_CAMERA_Y = 0.5;        // ft, the eye never dips below this
const SETTLE_EPS = 1e-3;         // ft, residual motion below this counts as settled
const CINEMATIC_RAMP = 0.15;     // fraction of the orbit spent easing in / easing out
const REDUCED_MOTION_SPEEDUP = 4;
const DOLLY_RATE = 0.0015;       // wheel pixels -> log zoom factor
const MAX_STEP = 0.25;           // s, clamp for dt spikes (e.g. after a tab switch)
const TWO_PI = Math.PI * 2;

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {{ minDistance?: number, maxDistance?: number, minPolar?: number, maxPolar?: number }} [opts]
 */
export function createCameraRig(camera, {
  minDistance = 6, maxDistance = 220, minPolar = 0.08, maxPolar = 1.45,
} = {}) {
  if (!camera || !camera.isPerspectiveCamera) throw new Error('createCameraRig needs a THREE.PerspectiveCamera');
  const limits = validateLimits({ minDistance, maxDistance, minPolar, maxPolar });

  const cur = clampState(makeState(new THREE.Vector3(0, 1, 0), 40, 0.4, 1.0), limits);
  const goal = cloneState(cur);
  let homeState = null;
  let tween = null;      // { from, to, t, duration }
  let cinematic = null;  // { from, orbit, t, duration, onComplete }
  const listeners = new Set();
  const applied = { position: new THREE.Vector3(NaN, NaN, NaN), target: new THREE.Vector3(NaN, NaN, NaN) };
  const eye = new THREE.Vector3();

  // ---------------------------------------------------------------- manual input (writes goals)
  function orbit(dTheta, dPhi) {
    num(dTheta, 'dTheta'); num(dPhi, 'dPhi');
    tween = null;
    goal.theta += dTheta;
    goal.phi += dPhi;
    clampState(goal, limits);
  }

  /** Slide the target parallel to the screen (projected onto the floor plane, so target.y is kept). */
  function pan(dxPixels, dyPixels, viewportHeight) {
    num(dxPixels, 'dxPixels'); num(dyPixels, 'dyPixels');
    if (!(viewportHeight > 0)) throw new Error('pan needs a positive viewportHeight');
    tween = null;
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const k = (2 * goal.distance * Math.tan(halfFov)) / viewportHeight; // world feet per pixel at the target
    const sin = Math.sin(goal.theta);
    const cos = Math.cos(goal.theta);
    // camera right = (cos, 0, -sin); screen-up projected on the floor = (-sin, 0, -cos); the world follows the pointer
    goal.target.x -= k * (dxPixels * cos + dyPixels * sin);
    goal.target.z += k * (dxPixels * sin - dyPixels * cos);
    clampState(goal, limits);
  }

  function zoom(factor) {
    num(factor, 'factor');
    if (!(factor > 0)) throw new Error('zoom factor must be > 0');
    tween = null;
    goal.distance *= factor;
    clampState(goal, limits);
  }

  function dolly(delta) {
    num(delta, 'delta');
    zoom(Math.exp(delta * DOLLY_RATE));
  }

  // ---------------------------------------------------------------- destinations (tweens)
  function setHome(view) {
    homeState = readState(view, goal, limits);
  }

  function home(animate = true) {
    if (!homeState) return;
    tweenTo(homeState, animate);
  }

  function focus(point, distance, animate = true) {
    const to = cloneState(goal);
    to.target.copy(readVector(point, 'point'));
    if (distance !== undefined && distance !== null) to.distance = num(distance, 'distance');
    tweenTo(to, animate);
  }

  /** Ease the goal toward `state`; snaps both goal and current when not animating or under reduced motion. */
  function tweenTo(state, animate) {
    cinematic = null; // an explicit destination wins over a running cinematic
    const to = clampState(cloneState(state), limits);
    to.theta = nearestTurn(to.theta, goal.theta);
    if (!animate || rig.reducedMotion) {
      tween = null;
      copyState(goal, to);
      copyState(cur, to);
      return;
    }
    tween = { from: cloneState(goal), to, t: 0, duration: TWEEN_DURATION };
  }

  function advanceTween(step) {
    tween.t += step;
    const u = Math.min(1, tween.t / tween.duration);
    lerpState(goal, tween.from, tween.to, easeInOutCubic(u));
    clampState(goal, limits);
    if (u >= 1) tween = null;
  }

  // ---------------------------------------------------------------- cinematic 360° orbit
  function startCinematic({ center, radius, height, duration, onComplete } = {}) {
    const c = readVector(center, 'center');
    num(radius, 'radius'); num(height, 'height'); num(duration, 'duration');
    if (!(radius > 0) || !(duration > 0)) throw new Error('startCinematic needs a positive radius and duration');
    tween = null;
    const rise = height - c.y;
    const orbit = clampState(makeState(c, Math.hypot(radius, rise), goal.theta, Math.atan2(radius, rise)), limits);
    cinematic = { from: cloneState(goal), orbit, t: 0, duration, onComplete: typeof onComplete === 'function' ? onComplete : null };
    advanceCinematic(0);
  }

  function advanceCinematic(step) {
    const c = cinematic;
    const reduced = rig.reducedMotion;
    c.t += step * (reduced ? REDUCED_MOTION_SPEEDUP : 1);
    const u = Math.min(1, c.t / c.duration);
    const progress = reduced ? u : rampedProgress(u, CINEMATIC_RAMP);
    const blend = reduced ? 1 : smoothstep(Math.min(1, u / CINEMATIC_RAMP)); // glide onto the orbit path
    lerpState(goal, c.from, c.orbit, blend);
    goal.theta = c.from.theta + TWO_PI * progress;
    clampState(goal, limits);
    if (u < 1) return;
    cinematic = null;
    if (c.onComplete) c.onComplete();
  }

  function cancelCinematic() {
    if (!cinematic) return;
    cinematic = null;
    copyState(goal, cur);
  }

  const isCinematic = () => cinematic !== null;

  // ---------------------------------------------------------------- per-frame
  /** Advance tweens and damping. Returns true while anything is still moving. */
  function update(dt) {
    const step = Number.isFinite(dt) ? clamp(dt, 0, MAX_STEP) : 0;
    if (cinematic) advanceCinematic(step);
    else if (tween) advanceTween(step);
    if (step > 0) {
      const k = 1 - Math.exp(-step / DAMPING_TAU);
      cur.target.lerp(goal.target, k);
      cur.distance += (goal.distance - cur.distance) * k;
      cur.theta += (goal.theta - cur.theta) * k;
      cur.phi += (goal.phi - cur.phi) * k;
      clampState(cur, limits);
    }
    const settled = stateDelta(cur, goal) < SETTLE_EPS;
    if (settled) copyState(cur, goal);
    return !settled || cinematic !== null || tween !== null;
  }

  /** Write the current state to the camera; notifies onChange listeners only when it moved. */
  function applyToCamera() {
    eyePosition(cur, eye);
    eye.y = Math.max(eye.y, MIN_CAMERA_Y);
    if (eye.equals(applied.position) && cur.target.equals(applied.target)) return false;
    camera.position.copy(eye);
    camera.lookAt(cur.target);
    camera.updateMatrixWorld();
    applied.position.copy(eye);
    applied.target.copy(cur.target);
    for (const cb of listeners) cb(rig);
    return true;
  }

  function onChange(cb) {
    if (typeof cb !== 'function') throw new Error('onChange needs a function');
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  // ---------------------------------------------------------------- inspection (tests)
  function getState() {
    return { target: cur.target.clone(), distance: cur.distance, theta: cur.theta, phi: cur.phi };
  }

  function setState(view) {
    tween = null;
    cinematic = null;
    const s = readState(view, goal, limits);
    copyState(goal, s);
    copyState(cur, s);
  }

  const rig = {
    target: cur.target,
    get distance() { return cur.distance; },
    get theta() { return cur.theta; },
    get phi() { return cur.phi; },
    limits: { ...limits },
    reducedMotion: false,
    setHome, home, orbit, pan, zoom, dolly, focus, update,
    startCinematic, cancelCinematic, isCinematic,
    applyToCamera, onChange, getState, setState,
  };
  return rig;
}

// ------------------------------------------------------------------ spherical state helpers
function makeState(target, distance, theta, phi) {
  return { target: target.clone(), distance, theta, phi };
}

function cloneState(s) {
  return makeState(s.target, s.distance, s.theta, s.phi);
}

function copyState(dst, src) {
  dst.target.copy(src.target);
  dst.distance = src.distance;
  dst.theta = src.theta;
  dst.phi = src.phi;
  return dst;
}

function lerpState(out, a, b, t) {
  out.target.lerpVectors(a.target, b.target, t);
  out.distance = a.distance + (b.distance - a.distance) * t;
  out.theta = a.theta + (b.theta - a.theta) * t;
  out.phi = a.phi + (b.phi - a.phi) * t;
  return out;
}

/** Largest difference between two states, in feet (angles scaled by distance). */
function stateDelta(a, b) {
  const d = Math.max(a.distance, b.distance);
  return Math.max(
    Math.abs(a.distance - b.distance),
    a.target.distanceTo(b.target),
    Math.abs(a.theta - b.theta) * d,
    Math.abs(a.phi - b.phi) * d,
  );
}

/** Enforce distance/polar limits, target above the floor and the eye at least MIN_CAMERA_Y high. */
function clampState(s, limits) {
  s.target.y = Math.max(0, s.target.y);
  s.distance = clamp(s.distance, limits.minDistance, limits.maxDistance);
  s.phi = clamp(s.phi, limits.minPolar, limits.maxPolar);
  // eye.y = target.y + distance * cos(phi) >= MIN_CAMERA_Y  <=>  phi <= acos((MIN_CAMERA_Y - target.y) / distance)
  const cosMin = clamp((MIN_CAMERA_Y - s.target.y) / s.distance, -1, 1);
  s.phi = Math.min(s.phi, Math.acos(cosMin));
  return s;
}

function eyePosition(s, out) {
  const r = s.distance * Math.sin(s.phi);
  return out.set(
    s.target.x + r * Math.sin(s.theta),
    s.target.y + s.distance * Math.cos(s.phi),
    s.target.z + r * Math.cos(s.theta),
  );
}

/** Build a clamped state from a partial `{ target, distance, theta, phi }` view, defaulting to `base`. */
function readState(view, base, limits) {
  if (!view || typeof view !== 'object') throw new Error('expected a { target, distance, theta, phi } object');
  const s = cloneState(base);
  if (view.target !== undefined) s.target.copy(readVector(view.target, 'target'));
  if (view.distance !== undefined) s.distance = num(view.distance, 'distance');
  if (view.theta !== undefined) s.theta = num(view.theta, 'theta');
  if (view.phi !== undefined) s.phi = num(view.phi, 'phi');
  return clampState(s, limits);
}

function readVector(v, name) {
  if (!v || ![v.x, v.y, v.z].every(Number.isFinite)) throw new Error(`${name} must be a Vector3-like {x, y, z}`);
  return new THREE.Vector3(v.x, v.y, v.z);
}

function validateLimits(l) {
  if (!(l.minDistance > 0) || !(l.maxDistance >= l.minDistance)) throw new Error('invalid distance limits');
  if (!(l.minPolar > 0) || !(l.maxPolar >= l.minPolar) || !(l.maxPolar < Math.PI)) throw new Error('invalid polar limits');
  return l;
}

// ------------------------------------------------------------------ small math
function num(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a finite number`);
  return v;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Equivalent angle to `theta` nearest to `ref` (shortest turn). */
const nearestTurn = (theta, ref) => theta + Math.round((ref - theta) / TWO_PI) * TWO_PI;

const smoothstep = (x) => x * x * (3 - 2 * x);

const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2);

/**
 * Distance travelled (0..1) along a unit path whose speed smoothly ramps up over the first `r`
 * of the time, holds constant, then ramps down over the last `r`.
 */
function rampedProgress(u, r) {
  const rampArea = (x) => r * (x * x * x - (x * x * x * x) / 2); // integral of smoothstep over a ramp of length r
  let area;
  if (u < r) area = rampArea(u / r);
  else if (u <= 1 - r) area = r / 2 + (u - r);
  else area = (1 - r) - rampArea((1 - u) / r);
  return area / (1 - r);
}
