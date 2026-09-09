/*
 * aero.js — quasi-steady panel aerodynamics + rigid-body dynamics.
 *
 * Every object is a rigid body built from thin panels (subdivided into
 * sub-panels), spheres and point masses. Each sub-panel sees its own local
 * relative wind (translation + rotation), so rotational damping, autorotation,
 * flutter and tumbling all fall out of the same model. The chordwise pressure
 * distribution is weighted so the centre of pressure sits at the quarter chord
 * when the flow is attached and at mid-chord when stalled — that shift is what
 * makes a card flutter and what makes a glider need a tail (or reflex) to fly.
 *
 * Body frame: +x forward (nose), +y up, +z starboard.  World: y up.
 * Units: metres, kilograms, seconds.  No dependency on three.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AERO = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RHO = 1.225;      // air density kg/m³ (sea level, 15 °C)
  const G = 9.81;
  const DEG = Math.PI / 180;

  // ---------- small vector / quaternion toolkit (plain arrays) ----------
  const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.sqrt(dot(a, a));
  const norm = (a) => { const l = len(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; };
  const addTo = (a, b) => { a[0] += b[0]; a[1] += b[1]; a[2] += b[2]; return a; };

  // quaternion [x,y,z,w]
  const qIdentity = () => [0, 0, 0, 1];
  const qMul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qNorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
  const qAxisAngle = (axis, ang) => { const a = norm(axis), s = Math.sin(ang / 2); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(ang / 2)]; };
  const qRot = (q, v) => { // rotate vector by quaternion
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const ix = w * v[0] + y * v[2] - z * v[1];
    const iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0];
    const iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y,
      iy * w + iw * -y + iz * -x - ix * -z,
      iz * w + iw * -z + ix * -y - iy * -x];
  };
  const qInvRot = (q, v) => qRot([-q[0], -q[1], -q[2], q[3]], v);
  // quaternion from euler (yaw about y, pitch about z, roll about x) applied roll→pitch→yaw
  const qEuler = (rollDeg, pitchDeg, yawDeg) =>
    qNorm(qMul(qAxisAngle([0, 1, 0], yawDeg * DEG), qMul(qAxisAngle([0, 0, 1], pitchDeg * DEG), qAxisAngle([1, 0, 0], rollDeg * DEG))));

  // 3x3 matrices as flat row-major arrays
  const m3zero = () => [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const m3mulv = (m, v) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const m3inv = (m) => {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    const s = 1 / det;
    return [A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
      B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
      C * s, -(a * h - b * g) * s, (a * e - b * d) * s];
  };

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---------- smooth pseudo-random noise (sum of sines) for gusts ----------
  function makeNoise(seed) {
    let s = seed || 1;
    const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    const comps = [];
    for (let k = 0; k < 5; k++) comps.push({ f: 0.15 + 0.9 * rnd() * (k + 1), p: rnd() * 6.283, a: 1 / (k + 1) });
    const fn = (t) => { let v = 0, w = 0; for (const c of comps) { v += c.a * Math.sin(c.f * t * 6.283 + c.p); w += c.a; } return v / w; };
    fn.rnd = rnd;
    return fn;
  }

  // ---------- panel construction ----------
  /**
   * rectPanel: a thin rectangular plate.
   *   c  : centre [x,y,z]
   *   u  : chord axis, unit-ish, pointing toward the leading edge (forward)
   *   w  : span axis; normal n = w × u (so a level wing with u=+x, w=+z has n=+y)
   *   hu, hw : half extents along u and w
   *   nu, nw : subdivisions
   *   shape  : 'rect' | 'ellipse'
   *   rho    : areal density kg/m²
   *   oneSided : only the +n face sees air (closed bodies)
   *   cd90   : normal-force coefficient at 90° (flat plate ≈ 1.17–1.3, porous less)
   *   cf     : skin-friction / profile drag coefficient
   *   camber : { a0Deg: zero-lift angle offset, cm0: pitching moment coefficient }
   *   stallDeg : onset of stall
   *   suction : 0 = sharp flat plate (resultant normal to the plate), 1 = airfoil with full
   *             leading-edge suction (attached-flow lift perpendicular to the local flow)
   *   wake   : gain of the unsteady wake torque on separated flow (default 0.3, 0 = off)
   *   AR     : aspect ratio override (whole-wing value for strips); null = derive from the plate
   *   lifting : counts toward the neutral-point estimate
   */
  function rectPanel(o) {
    const u = norm(o.u), w0 = o.w;
    const w = norm(sub(w0, scale(u, dot(w0, u))));     // orthogonalise
    const n = norm(cross(w, u));
    return Object.assign({
      type: 'panel', shape: 'rect', nu: 3, nw: 3, rho: 0.1, oneSided: false,
      cd90: 1.2, cf: 0.012, stallDeg: 13, camber: null, lifting: false, name: '', suction: 0, AR: null, wake: 0.3,
    }, o, { u, w, n });
  }

  /** A wing built from strips so sweep, taper, dihedral and incidence are honoured. */
  function wing(o) {
    const {
      span, rootChord, tipChord = rootChord, sweepDeg = 0, dihedralDeg = 0, incidenceDeg = 0,
      pos = [0, 0, 0], strips = 5, subChord = 3, rho = 0.2, camber = null, stallDeg = 13,
      cd90 = 1.2, sides = [1, -1], name = 'wing', lifting = true, cf = 0.02, suction = 0.85,
    } = o;
    const out = [];
    const half = span / 2;
    const tanS = Math.tan(sweepDeg * DEG);
    const AR = span * span / (span * (rootChord + tipChord) / 2);
    for (const side of sides) {
      const dih = qAxisAngle([1, 0, 0], -side * dihedralDeg * DEG);   // rotate wing plane up at the tip
      for (let i = 0; i < strips; i++) {
        const y0 = (i / strips) * half, y1 = ((i + 1) / strips) * half, ym = (y0 + y1) / 2;
        const f = ym / half;
        const chord = rootChord + (tipChord - rootChord) * f;
        // quarter-chord line swept back: centre of strip at x = pos.x - ym*tanS (measured at the quarter chord)
        const xqc = -ym * tanS;
        const cx = xqc - chord / 4;                         // strip centre is a quarter chord behind the qc line
        const local = [cx, 0, side * ym];
        const c = add(pos, qRot(dih, local));
        const inc = qAxisAngle([0, 0, 1], incidenceDeg * DEG);  // nose-up incidence
        const u = qRot(dih, qRot(inc, [1, 0, 0]));
        const w = qRot(dih, [0, 0, 1]);                     // same span axis both sides so n points up
        out.push(rectPanel({
          c, u, w, hu: chord / 2, hw: (y1 - y0) / 2, nu: subChord, nw: 1, rho, camber, stallDeg, cd90, cf, suction, AR,
          lifting, name: name + (side > 0 ? 'R' : 'L') + i,
        }));
      }
    }
    return out;
  }

  /** Vertical fin (n = +z or -z). */
  function fin(o) {
    const { pos, chord, height, rho = 0.2, up = true, sweepDeg = 0, name = 'fin' } = o;
    const dir = up ? 1 : -1;
    const tanS = Math.tan(sweepDeg * DEG);
    return rectPanel({
      c: add(pos, [-(height / 2) * tanS * dir * 0, dir * height / 2, 0]), u: [1, 0, 0], w: [0, dir, 0],
      hu: chord / 2, hw: height / 2, nu: 2, nw: 2, rho, name, cd90: 1.2,
    });
  }

  /** Fuselage rod approximated as two crossed thin plates (drag-only, low lift slope). */
  function rod(o) {
    const { from, to, dia, rho = 0.3, name = 'rod' } = o;
    const c = scale(add(from, to), 0.5), axis = sub(to, from), L = len(axis), a = norm(axis);
    // pick two perpendicular directions
    let p = Math.abs(a[1]) < 0.9 ? cross(a, [0, 1, 0]) : cross(a, [1, 0, 0]);
    p = norm(p);
    const q = norm(cross(a, p));
    const common = { rho: rho / 2, cd90: 1.0, stallDeg: 90, cf: 0.02, nu: 4, nw: 1, name };
    return [
      rectPanel(Object.assign({ c, u: a, w: p, hu: L / 2, hw: dia / 2 }, common)),
      rectPanel(Object.assign({ c, u: a, w: q, hu: L / 2, hw: dia / 2 }, common)),
    ];
  }

  /** Closed box: six one-sided faces. */
  function box(o) {
    const { size, c = [0, 0, 0], rho = 0.5, sub = 3, cd90 = 1.05, name = 'box' } = o;
    const [sx, sy, sz] = size;
    const faces = [
      { n: [1, 0, 0], u: [0, 1, 0], w: [0, 0, 1], hu: sy / 2, hw: sz / 2, off: [sx / 2, 0, 0] },
      { n: [-1, 0, 0], u: [0, 1, 0], w: [0, 0, -1], hu: sy / 2, hw: sz / 2, off: [-sx / 2, 0, 0] },
      { n: [0, 1, 0], u: [1, 0, 0], w: [0, 0, 1], hu: sx / 2, hw: sz / 2, off: [0, sy / 2, 0] },
      { n: [0, -1, 0], u: [1, 0, 0], w: [0, 0, -1], hu: sx / 2, hw: sz / 2, off: [0, -sy / 2, 0] },
      { n: [0, 0, 1], u: [1, 0, 0], w: [0, -1, 0], hu: sx / 2, hw: sy / 2, off: [0, 0, sz / 2] },
      { n: [0, 0, -1], u: [1, 0, 0], w: [0, 1, 0], hu: sx / 2, hw: sy / 2, off: [0, 0, -sz / 2] },
    ];
    return faces.map((f) => {
      // ensure n = w × u matches the outward normal
      let u = f.u, w = f.w;
      if (dot(cross(w, u), f.n) < 0) w = scale(w, -1);
      return rectPanel({ c: add(c, f.off), u, w, hu: f.hu, hw: f.hw, nu: sub, nw: sub, rho, oneSided: true, cd90, stallDeg: 90, name });
    });
  }

  // ---------- body assembly ----------
  /**
   * buildBody(spec): spec = { name, panels:[...], spheres:[{c,r,cd,m}], masses:[{p,m}],
   *   turbulence (0..1 vortex-shedding torque noise), visual, viewDist, launch }
   * Returns a body with geometry expressed relative to the centre of mass.
   */
  function buildBody(spec) {
    const panels = spec.panels || [], spheres = spec.spheres || [], masses = spec.masses || [];
    const subs = [];
    let mass = 0; const mc = [0, 0, 0];
    // sub-panels
    panels.forEach((P, pi) => {
      const total = P.shape === 'ellipse' ? Math.PI * P.hu * P.hw : 4 * P.hu * P.hw;
      const cells = [];
      for (let i = 0; i < P.nu; i++) for (let j = 0; j < P.nw; j++) {
        const du = -P.hu + (i + 0.5) * (2 * P.hu / P.nu);
        const dw = -P.hw + (j + 0.5) * (2 * P.hw / P.nw);
        if (P.shape === 'ellipse' && (du * du) / (P.hu * P.hu) + (dw * dw) / (P.hw * P.hw) > 1) continue;
        cells.push({ du, dw });
      }
      const area = total / cells.length;
      for (const cell of cells) {
        const p = add(P.c, add(scale(P.u, cell.du), scale(P.w, cell.dw)));
        const m = area * P.rho;
        subs.push({ p, area, m, panel: pi, du: cell.du, dw: cell.dw, hu: P.hu, hw: P.hw, u: P.u, w: P.w, n: P.n,
          oneSided: P.oneSided, cd90: P.cd90, cf: P.cf, stall: P.stallDeg, camber: P.camber,
          chord: 2 * P.hu, lifting: P.lifting, suction: P.suction || 0, AR: P.AR });
        mass += m; addTo(mc, scale(p, m));
      }
    });
    for (const s of spheres) { mass += s.m; addTo(mc, scale(s.c, s.m)); }
    for (const pm of masses) { mass += pm.m; addTo(mc, scale(pm.p, pm.m)); }
    const com = scale(mc, 1 / mass);
    // shift geometry to COM frame
    for (const s of subs) s.p = sub(s.p, com);
    const panelsC = panels.map((P) => ({
      c: sub(P.c, com), n: P.n, u: P.u, w: P.w, hu: P.hu, hw: P.hw, stall: P.stallDeg, oneSided: P.oneSided,
      area: P.shape === 'ellipse' ? Math.PI * P.hu * P.hw : 4 * P.hu * P.hw, wake: P.wake,
    }));
    const sph = spheres.map((s) => Object.assign({}, s, { c: sub(s.c, com) }));
    const pts = masses.map((pm) => ({ p: sub(pm.p, com), m: pm.m }));
    // inertia tensor about COM
    const I = m3zero();
    const addPoint = (p, m) => {
      const [x, y, z] = p;
      I[0] += m * (y * y + z * z); I[4] += m * (x * x + z * z); I[8] += m * (x * x + y * y);
      I[1] -= m * x * y; I[3] -= m * x * y; I[2] -= m * x * z; I[6] -= m * x * z; I[5] -= m * y * z; I[7] -= m * y * z;
    };
    for (const s of subs) addPoint(s.p, s.m);
    for (const s of sph) { addPoint(s.c, s.m); const i = 0.4 * s.m * s.r * s.r; I[0] += i; I[4] += i; I[8] += i; }
    for (const pm of pts) addPoint(pm.p, pm.m);
    // guard against degenerate (flat) inertia: give a floor of 2% of the largest principal value
    const maxI = Math.max(I[0], I[4], I[8]) || 1e-9;
    for (const k of [0, 4, 8]) I[k] = Math.max(I[k], 0.02 * maxI);
    const Iinv = m3inv(I);
    // reference area/length
    let areaTotal = subs.reduce((a, s) => a + s.area, 0) + sph.reduce((a, s) => a + Math.PI * s.r * s.r, 0);
    let ext = 0;
    for (const s of subs) ext = Math.max(ext, len(s.p) + Math.max(s.hu, s.hw) / Math.max(1, 1));
    for (const s of sph) ext = Math.max(ext, len(s.c) + s.r);
    for (const pm of pts) ext = Math.max(ext, len(pm.p));
    // neutral point estimate (lifting horizontal panels, quarter chord, weighted by lift slope × area)
    let npNum = 0, npDen = 0, meanChord = 0, liftArea = 0;
    panels.forEach((P, pi) => {
      if (!P.lifting) return;
      const A = 4 * P.hu * P.hw;
      const c = sub(P.c, com);
      const xqc = c[0] + P.u[0] * P.hu / 2;   // quarter chord (u points forward)
      const ar = 6; const a0 = 2 * Math.PI * ar / (ar + 2);
      const wgt = a0 * A * Math.abs(P.n[1]);
      npNum += wgt * xqc; npDen += wgt; meanChord += A * 2 * P.hu; liftArea += A;
    });
    const np = npDen > 0 ? npNum / npDen : 0;
    meanChord = liftArea > 0 ? meanChord / liftArea : ext;
    return {
      name: spec.name || 'body', spec, mass, com, I, Iinv, subs, spheres: sph, points: pts, panels, panelsC,
      areaTotal, ext, np, meanChord, liftArea,
      staticMargin: liftArea > 0 ? (0 - np) / meanChord : null,   // COM is at 0; positive = stable
      turbulence: spec.turbulence || 0,
      // dynamic state
      pos: [0, 0, 0], vel: [0, 0, 0], q: qIdentity(), omega: [0, 0, 0],
      landed: false, t: 0, stats: null, forces: null,
    };
  }

  // ---------- aerodynamics ----------
  const tmp = {};
  /**
   * Accumulate aerodynamic force/torque (world frame) for body at its current state.
   * windFn(pWorld, t) → wind velocity. Returns { F, T, info }.
   */
  function aeroForces(body, windFn, t, out) {
    const F = [0, 0, 0], T = [0, 0, 0];
    const q = body.q, pos = body.pos, vel = body.vel;
    const omegaW = qRot(q, body.omega);
    const tufts = out && out.tufts;
    let lift = 0, drag = 0;   // for telemetry: force components ⟂ and ∥ to the COM airflow
    const vairCom = sub(windFn(pos, t), vel);
    const Vcom = len(vairCom);
    const flowDir = Vcom > 1e-6 ? scale(vairCom, 1 / Vcom) : [0, -1, 0];

    for (let k = 0; k < body.subs.length; k++) {
      const s = body.subs[k];
      const rW = qRot(q, s.p);
      const vpt = add(vel, cross(omegaW, rW));
      const vair = sub(windFn(add(pos, rW), t), vpt);
      const V = len(vair);
      if (tufts) { tufts[k * 6] = rW[0]; tufts[k * 6 + 1] = rW[1]; tufts[k * 6 + 2] = rW[2]; }
      if (V < 1e-4) { if (tufts) { tufts[k * 6 + 3] = rW[0]; tufts[k * 6 + 4] = rW[1]; tufts[k * 6 + 5] = rW[2]; if (out.stall) out.stall[k] = 0; } continue; }
      const nW = qRot(q, s.n), uW = qRot(q, s.u), wW = qRot(q, s.w);
      const nd = dot(vair, nW) / V;            // = -sin(alpha)
      let sinA = -nd;
      if (s.oneSided && sinA < 0) {            // lee face of a closed body: weak base suction only
        const fb = scale(nW, 0.25 * 0.5 * RHO * V * V * s.area);   // pulls outward (toward +n)
        addTo(F, fb); addTo(T, cross(rW, fb));
        if (tufts) { tufts[k * 6 + 3] = rW[0]; tufts[k * 6 + 4] = rW[1]; tufts[k * 6 + 5] = rW[2]; if (out.stall) out.stall[k] = 1; }
        continue;
      }
      const a = Math.abs(sinA);
      const cosA = Math.sqrt(Math.max(0, 1 - a * a));
      const alphaDeg = Math.asin(Math.min(1, a)) / DEG;
      // in-plane flow direction and chordwise station
      const tIn = sub(vair, scale(nW, nd * V));
      const tl = len(tIn);
      const th = tl > 1e-9 ? scale(tIn, 1 / tl) : uW;
      const tu = dot(th, uW), tw = dot(th, wW);
      const L = s.hu * Math.abs(tu) + s.hw * Math.abs(tw) + 1e-9;    // half extent of the parent panel along the flow
      const p = s.du * tu + s.dw * tw;
      const xi = clamp((p + L) / (2 * L), 0, 1);                      // 0 at leading (upstream) edge
      const spanHalf = s.hu * Math.abs(tw) + s.hw * Math.abs(tu) + 1e-9;
      const AR = s.AR ? s.AR : clamp(spanHalf / L, 0.25, 12);
      // stall blend
      const st = smooth(s.stall, s.stall + 10, alphaDeg);
      // centre of pressure walks from the quarter chord toward mid-chord as alpha rises
      // (flat-plate data: x_cp/c ≈ 0.25 + 0.25·sin α) — the source of plate flutter and tumbling
      const weight = (1 - a) * 3 * (1 - xi) * (1 - xi) + a;
      // camber (only for flow arriving from the leading edge of a wing panel)
      let sinEff = sinA, fwd = 0;
      if (s.camber) {
        fwd = clamp(-dot(vair, uW) / V, 0, 1);
        sinEff = sinA - fwd * Math.sin(s.camber.a0Deg * DEG);   // camber lifts toward +n (cn < 0)
      }
      const a0 = 2 * Math.PI * AR / (AR + 2);
      const clAtt = a0 * sinEff;                       // attached-flow lift coefficient (signed)
      const cnStall = s.cd90 * sinA;                   // stalled: pressure force normal to the plate
      const qA = 0.5 * RHO * V * V * s.area * weight;
      const vhat = scale(vair, 1 / V);
      // attached force: blend between "normal to the plate" (sharp edge, no suction) and
      // "perpendicular to the flow" (airfoil with leading-edge suction)
      const ls = s.suction;
      let fAtt;
      if (ls > 0) {
        const lDir = norm(sub(nW, scale(vhat, dot(nW, vhat))));
        fAtt = scale(add(scale(lDir, ls), scale(nW, (1 - ls) * cosA)), -clAtt * qA * (1 - st));
      } else {
        fAtt = scale(nW, -clAtt * cosA * qA * (1 - st));
      }
      const fStall = scale(nW, -cnStall * qA * st);
      const cdi = (1 - st) * clAtt * clAtt / (Math.PI * 0.85 * AR);
      const fT = scale(vhat, (s.cf + cdi) * qA);
      const f = add(add(fAtt, fStall), fT);
      addTo(F, f); addTo(T, cross(rW, f));
      if (s.camber && s.camber.cm0) {
        const M = 0.5 * RHO * V * V * s.area * s.chord * s.camber.cm0 * fwd * (1 - st);
        addTo(T, scale(norm(cross(uW, nW)), M));   // nose-up axis, independent of which side the strip is on
      }
      // telemetry decomposition against the COM airflow
      const fPar = dot(f, flowDir);
      drag += fPar; lift += len(sub(f, scale(flowDir, fPar)));
      if (tufts) {
        const tl2 = 0.7 * Math.min(s.hu, s.hw) + 0.3 * Math.max(s.hu, s.hw);
        const d = scale(norm(vair), tl2);
        tufts[k * 6 + 3] = rW[0] + d[0]; tufts[k * 6 + 4] = rW[1] + d[1]; tufts[k * 6 + 5] = rW[2] + d[2];
        if (out.stall) out.stall[k] = st;
      }
    }
    // Unsteady wake torque on separated plates. A quasi-steady model makes a broadside fall
    // perfectly stable (the plate is a parachute); in reality the shed wake tips it over, and
    // whether it then flutters or tumbles depends on how heavy the plate is for its size.
    // Modelled as an added-mass-scaled torque (ρ·π·c²/4·b, the plate's normal added mass)
    // that turns a stalled plate away from broadside, gain `wake` (0.3 reproduces the
    // paper-flutters / card-tumbles split). Zero when the flow is attached.
    for (const P of body.panelsC) {
      if (!P.wake) continue;
      const rW = qRot(q, P.c);
      const vpt = add(vel, cross(omegaW, rW));
      const vair = sub(windFn(add(pos, rW), t), vpt);
      const V = len(vair);
      if (V < 1e-4) continue;
      const nW = qRot(q, P.n), uW = qRot(q, P.u), wW = qRot(q, P.w);
      const nd = dot(vair, nW);
      if (P.oneSided && -nd < 0) continue;
      const a = Math.abs(nd) / V;
      const alphaDeg = Math.asin(Math.min(1, a)) / DEG;
      const st = smooth(P.stall, P.stall + 10, alphaDeg);
      if (st <= 0) continue;
      const tIn = sub(vair, scale(nW, nd));
      const tl = len(tIn);
      if (tl < 1e-6) continue;
      const th = scale(tIn, 1 / tl);
      const tu = dot(th, uW), tw = dot(th, wW);
      const L = P.hu * Math.abs(tu) + P.hw * Math.abs(tw) + 1e-9;         // half chord along the flow
      const spanHalf = P.hu * Math.abs(tw) + P.hw * Math.abs(tu) + 1e-9;
      const AR = spanHalf / L;
      const m22 = RHO * Math.PI * L * L * (2 * spanHalf) * (AR / (AR + 1));  // added mass normal to the plate
      const tq = scale(cross(tIn, scale(nW, nd)), m22 * st * P.wake);
      addTo(T, tq);
    }
    for (const s of body.spheres) {
      const rW = qRot(q, s.c);
      const vpt = add(vel, cross(omegaW, rW));
      const vair = sub(windFn(add(pos, rW), t), vpt);
      const V = len(vair);
      if (V < 1e-4) continue;
      const f = scale(vair, 0.5 * RHO * V * s.cd * Math.PI * s.r * s.r);
      addTo(F, f); addTo(T, cross(rW, f));
      // viscous spin damping (small)
      addTo(T, scale(omegaW, -0.5 * RHO * V * s.r * s.r * s.r * s.r * 0.2));
      drag += dot(f, flowDir);
    }
    // vortex-shedding proxy: slow random torque for bluff bodies
    if (body.turbulence > 0 && Vcom > 0.3) {
      const nz = body.noise || (body.noise = [makeNoise(11), makeNoise(23), makeNoise(37)]);
      const mag = body.turbulence * 0.5 * RHO * Vcom * Vcom * body.areaTotal * body.ext * 0.08;
      addTo(T, [mag * nz[0](t), mag * nz[1](t), mag * nz[2](t)]);
    }
    return { F, T, lift, drag, V: Vcom, vair: vairCom };
  }

  // ---------- integration ----------
  /**
   * step(body, dt, windFn, t, out): advance by dt seconds with automatic sub-stepping.
   */
  function step(body, dt, windFn, t, out) {
    if (body.landed) return;
    // choose sub-steps from a stiffness estimate: tau = m / (rho * A * V)
    const V = len(sub(windFn(body.pos, t), body.vel)) + 0.5;
    const tauLin = body.mass / (RHO * body.areaTotal * V * 1.5);
    const om = len(body.omega) * body.ext + 0.2;
    const tauRot = Math.min(body.I[0], body.I[4], body.I[8]) / (RHO * body.areaTotal * (V + om) * body.ext * body.ext * 0.5 + 1e-12);
    const tau = Math.min(tauLin, tauRot);
    const n = clamp(Math.ceil(dt / Math.min(1 / 600, tau / 6)), 1, 80);
    const h = dt / n;
    let last = null;
    for (let i = 0; i < n; i++) {
      const want = (i === n - 1) ? out : null;
      const r = aeroForces(body, windFn, t + i * h, want);
      last = r;
      // linear
      const acc = add(scale(r.F, 1 / body.mass), [0, -G, 0]);
      body.vel = add(body.vel, scale(acc, h));
      body.pos = add(body.pos, scale(body.vel, h));
      // angular (body frame, Euler's equations)
      const Tb = qInvRot(body.q, r.T);
      const Iw = m3mulv(body.I, body.omega);
      const gyro = cross(body.omega, Iw);
      const domega = m3mulv(body.Iinv, sub(Tb, gyro));
      body.omega = add(body.omega, scale(domega, h));
      // cap absurd spin rates (numerical guard)
      const wl = len(body.omega);
      if (wl > 400) body.omega = scale(body.omega, 400 / wl);
      const dq = qMul(body.q, [0.5 * body.omega[0] * h, 0.5 * body.omega[1] * h, 0.5 * body.omega[2] * h, 0]);
      body.q = qNorm([body.q[0] + dq[0], body.q[1] + dq[1], body.q[2] + dq[2], body.q[3] + dq[3]]);
    }
    body.t += dt;
    body.forces = last;
    // ground contact: lowest extremity of the body
    if (body.pos[1] - lowestOffset(body) <= 0) {
      body.pos[1] = lowestOffset(body);
      body.landed = true;
      body.vel = [0, 0, 0]; body.omega = [0, 0, 0];
    }
    return last;
  }

  function lowestOffset(body) {
    let low = 0;
    const q = body.q;
    for (const s of body.subs) { const y = qRot(q, s.p)[1]; if (y < low) low = y; }
    for (const s of body.spheres) { const y = qRot(q, s.c)[1] - s.r; if (y < low) low = y; }
    for (const pm of body.points) { const y = qRot(q, pm.p)[1]; if (y < low) low = y; }
    return -low;
  }

  /** Flight telemetry derived from state (main-wing angle of attack, glide ratio…). */
  function telemetry(body, windFn, t) {
    const vair = sub(windFn(body.pos, t), body.vel);
    const V = len(vair);
    const fwd = qRot(body.q, [1, 0, 0]);
    const up = qRot(body.q, [0, 1, 0]);
    // angle of attack in the body's symmetry plane
    const vb = qInvRot(body.q, scale(vair, -1));  // body-frame velocity relative to air
    const alpha = Math.atan2(-vb[1], vb[0]) / DEG;
    const beta = Math.asin(clamp(vb[2] / (V || 1), -1, 1)) / DEG;
    const horiz = Math.hypot(body.vel[0], body.vel[2]);
    const sink = -body.vel[1];
    const glide = sink > 0.05 ? horiz / sink : null;
    return { V, alpha, beta, horiz, sink, glide, fwd, up, spin: len(body.omega) / (2 * Math.PI) };
  }

  /**
   * trimAnalysis(body): scan angle of attack at unit speed, level attitude, find the
   * stable pitch trim (moment crossing from nose-up to nose-down) and the speed at which
   * lift balances weight there. Returns { alpha, V, glide, stable } or { alpha:null }.
   */
  function trimAnalysis(body) {
    const save = { pos: body.pos, vel: body.vel, q: body.q, omega: body.omega };
    body.q = qIdentity(); body.omega = [0, 0, 0]; body.pos = [0, 100, 0];
    const wind0 = () => [0, 0, 0];
    const rows = [];
    for (let a = -8; a <= 24; a += 0.5) {
      body.vel = [Math.cos(a * DEG), -Math.sin(a * DEG), 0];
      const r = aeroForces(body, wind0, 0);
      const lift = r.F[0] * Math.sin(a * DEG) + r.F[1] * Math.cos(a * DEG);
      const drag = -(r.F[0] * Math.cos(a * DEG) - r.F[1] * Math.sin(a * DEG));
      rows.push({ a, M: r.T[2], lift, drag });
    }
    let found = null;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i - 1].M > 0 && rows[i].M <= 0) {
        const f = rows[i - 1].M / (rows[i - 1].M - rows[i].M);
        const a = rows[i - 1].a + f * (rows[i].a - rows[i - 1].a);
        const lift = rows[i - 1].lift + f * (rows[i].lift - rows[i - 1].lift);
        const drag = rows[i - 1].drag + f * (rows[i].drag - rows[i - 1].drag);
        if (lift > 1e-6) { found = { alpha: a, lift, drag }; break; }
      }
    }
    Object.assign(body, save);
    if (!found) return { alpha: null, V: null, glide: null, stable: false, rows };
    const W = body.mass * G;
    const V = Math.sqrt(W / Math.hypot(found.lift, found.drag));
    return { alpha: found.alpha, V, glide: found.lift / Math.max(found.drag, 1e-9), stable: true, rows };
  }

  return {
    trimAnalysis, RHO, G, DEG, v3, add, sub, scale, dot, cross, len, norm, qIdentity, qMul, qNorm, qAxisAngle, qRot, qInvRot, qEuler,
    rectPanel, wing, fin, rod, box, buildBody, aeroForces, step, telemetry, lowestOffset, makeNoise, clamp,
  };
});
