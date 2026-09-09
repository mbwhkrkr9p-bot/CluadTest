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
    const AR = o.AR || span * span / (span * (rootChord + tipChord) / 2);   // override when this is part of a larger surface
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
      elemCount: subs.length,
      turbulence: spec.turbulence || 0,
      // dynamic state
      pos: [0, 0, 0], vel: [0, 0, 0], q: qIdentity(), omega: [0, 0, 0],
      landed: false, t: 0, stats: null, forces: null,
    };
  }

  // ---------- aerodynamics ----------
  const A_mesh = {};   // filled in below (meshForces) once the mesh extension loads
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
    if (body.mesh) {
      const acc = { F, T, lift, drag, flowDir };
      A_mesh.meshForces(body, windFn, t, out, acc);
      lift = acc.lift; drag = acc.drag;
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
    if (body.mesh) {
      const R = A_mesh.quatMat(q), v = body.mesh.verts;
      for (let i = 0; i < v.length; i += 3) { const y = R[3] * v[i] + R[4] * v[i + 1] + R[5] * v[i + 2]; if (y < low) low = y; }
      return -low;
    }
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
    const right = qRot(body.q, [0, 0, 1]);
    const bank = Math.atan2(-right[1], up[1]) / DEG;          // + = right wing down
    const heading = Math.atan2(fwd[2], fwd[0]) / DEG;         // + = turned right of the launch direction
    return { V, alpha, beta, horiz, sink, glide, fwd, up, right, bank, heading, spin: len(body.omega) / (2 * Math.PI) };
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
    if (V > 20 || found.lift < 0.2 * Math.hypot(found.lift, found.drag)) return { alpha: null, V: null, glide: null, stable: false, rows, dive: true };
    return { alpha: found.alpha, V, glide: found.lift / Math.max(found.drag, 1e-9), stable: true, rows };
  }

  return {
    _meshHooks: A_mesh, trimAnalysis, RHO, G, DEG, v3, add, sub, scale, dot, cross, len, norm, qIdentity, qMul, qNorm, qAxisAngle, qRot, qInvRot, qEuler,
    rectPanel, wing, fin, rod, box, buildBody, aeroForces, step, telemetry, lowestOffset, makeNoise, clamp,
  };
});

/* ======================================================================
 * Triangle-mesh bodies — any 3D model as a single mesh.
 * Each facet is an aerodynamic element. Facets are grouped into connected,
 * near-coplanar clusters; each cluster acts like one plate for the centre-of-
 * pressure walk, the aspect ratio and the wake torque, so a wing cut out of a
 * solid still behaves like a wing. Finer meshes sample the local wind (and the
 * body's spin) more finely, so resolution buys accuracy.
 * ==================================================================== */
(function (root) {
  const A = (typeof module === 'object' && module.exports) ? module.exports : root.AERO;
  const RHO = A.RHO, DEG = A.DEG, clamp = A.clamp;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /** Weld duplicate vertices (STL has none shared) so edges and adjacency make sense. */
  function weld(mesh, tol) {
    const positions = mesh.positions, indices = mesh.indices;
    const n = positions.length / 3;
    let ext = 0; for (let i = 0; i < positions.length; i++) ext = Math.max(ext, Math.abs(positions[i]));
    const eps = (tol || 1e-6) * (ext || 1);
    const map = new Map(), remap = new Int32Array(n), out = [];
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      const key = Math.round(x / eps) + ',' + Math.round(y / eps) + ',' + Math.round(z / eps);
      let id = map.get(key);
      if (id == null) { id = out.length / 3; map.set(key, id); out.push(x, y, z); }
      remap[i] = id;
    }
    const idx = [];
    for (let i = 0; i < indices.length; i += 3) {
      const a = remap[indices[i]], b = remap[indices[i + 1]], c = remap[indices[i + 2]];
      if (a !== b && b !== c && a !== c) idx.push(a, b, c);
    }
    return { positions: Float64Array.from(out), indices: Uint32Array.from(idx) };
  }

  /** Split every triangle into four (midpoint subdivision). */
  function subdivide(mesh, times) {
    let { positions, indices } = mesh;
    for (let k = 0; k < (times || 0); k++) {
      const pos = Array.from(positions), idx = [], mid = new Map();
      const midpoint = (a, b) => {
        const key = a < b ? a + '_' + b : b + '_' + a;
        let m = mid.get(key);
        if (m == null) { m = pos.length / 3; pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2); mid.set(key, m); }
        return m;
      };
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i], b = indices[i + 1], c = indices[i + 2];
        const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
        idx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      }
      positions = Float64Array.from(pos); indices = Uint32Array.from(idx);
    }
    return { positions, indices };
  }

  /** Geometry facts: bounding box, area, signed volume, whether every edge has exactly two faces. */
  function meshProps(mesh) {
    const { positions: P, indices: I } = mesh;
    const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { bb.min[k] = Math.min(bb.min[k], P[i + k]); bb.max[k] = Math.max(bb.max[k], P[i + k]); }
    let area = 0, vol = 0;
    const edges = new Map();
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i], b = I[i + 1], c = I[i + 2];
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      area += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      for (const [p, q] of [[a, b], [b, c], [c, a]]) { const key = p < q ? p + '_' + q : q + '_' + p; edges.set(key, (edges.get(key) || 0) + 1); }
    }
    // closed = no boundary edges (edges used by a single face). Edges shared by more than two
    // faces are allowed: a model assembled from touching solids is still a solid.
    let boundary = 0;
    for (const v of edges.values()) if (v === 1) boundary++;
    const closed = I.length > 0 && boundary === 0;
    if (vol < 0) vol = -vol;   // inward-wound meshes are flipped in buildMeshBody
    return { bbox: bb, area, volume: vol, closed, boundaryEdges: boundary, faces: I.length / 3, size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]] };
  }

  /** Scale so the longest dimension equals `size`, centred on the bounding box; optional Z-up → Y-up swap. */
  function normalizeMesh(mesh, size, zUp) {
    const props = meshProps(mesh);
    const longest = Math.max(...props.size) || 1;
    const s = size / longest;
    const c = [(props.bbox.min[0] + props.bbox.max[0]) / 2, (props.bbox.min[1] + props.bbox.max[1]) / 2, (props.bbox.min[2] + props.bbox.max[2]) / 2];
    const P = new Float64Array(mesh.positions.length);
    for (let i = 0; i < P.length; i += 3) {
      let x = (mesh.positions[i] - c[0]) * s, y = (mesh.positions[i + 1] - c[1]) * s, z = (mesh.positions[i + 2] - c[2]) * s;
      if (zUp) { const t = y; y = z; z = -t; }
      P[i] = x; P[i + 1] = y; P[i + 2] = z;
    }
    return { positions: P, indices: mesh.indices };
  }

  /**
   * buildMeshBody(spec): spec.mesh = {positions, indices} in metres, spec.meshOpts = {
   *   mass (kg), suction (0..1), cd90, stallDeg, cf, wake, clusterDeg (normal tolerance for grouping) }
   */
  function buildMeshBody(spec) {
    const o = Object.assign({ mass: 0.02, suction: 0, cd90: 1.3, stallDeg: 13, cf: 0.015, wake: 0.3, clusterDeg: 20, ballast: 0, ballastPos: null }, spec.meshOpts || {});
    const mesh = spec.mesh;
    const P = mesh.positions, I = mesh.indices, nF = I.length / 3;
    const props = meshProps(mesh);
    // signed volume tells us the winding; flip if the normals point inward
    let volS = 0;
    for (let i = 0; i < I.length; i += 3) { const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3; volS += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; }
    const flip = props.closed && volS < 0;
    const idx = new Uint32Array(I.length);
    for (let f = 0; f < nF; f++) { idx[f * 3] = I[f * 3]; idx[f * 3 + 1] = flip ? I[f * 3 + 2] : I[f * 3 + 1]; idx[f * 3 + 2] = flip ? I[f * 3 + 1] : I[f * 3 + 2]; }
    const cx = new Float64Array(nF), cy = new Float64Array(nF), cz = new Float64Array(nF);
    const nx = new Float64Array(nF), ny = new Float64Array(nF), nz = new Float64Array(nF), area = new Float64Array(nF);
    for (let f = 0; f < nF; f++) {
      let a = I[f * 3], b = I[f * 3 + 1], c = I[f * 3 + 2];
      if (flip) { const t = b; b = c; c = t; }
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], qx = P[c * 3], qy = P[c * 3 + 1], qz = P[c * 3 + 2];
      cx[f] = (ax + bx + qx) / 3; cy[f] = (ay + by + qy) / 3; cz[f] = (az + bz + qz) / 3;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az;
      let Nx = uy * vz - uz * vy, Ny = uz * vx - ux * vz, Nz = ux * vy - uy * vx;
      const l = Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz) || 1e-12;
      area[f] = 0.5 * l; nx[f] = Nx / l; ny[f] = Ny / l; nz[f] = Nz / l;
    }
    // mass properties (o.mass is the shell/solid mass; ballast is a point mass added on top)
    const mass = o.mass;
    let com = [0, 0, 0];
    const Iten = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const addPoint = (x, y, z, m) => {
      Iten[0] += m * (y * y + z * z); Iten[4] += m * (x * x + z * z); Iten[8] += m * (x * x + y * y);
      Iten[1] -= m * x * y; Iten[3] -= m * x * y; Iten[2] -= m * x * z; Iten[6] -= m * x * z; Iten[5] -= m * y * z; Iten[7] -= m * y * z;
    };
    if (props.closed && props.volume > 1e-12) {
      // solid: integrate tetrahedra (origin, a, b, c) with the canonical covariance formulas
      const rho = mass / props.volume;
      let mx = 0, my = 0, mz = 0;
      const cov = [0, 0, 0, 0, 0, 0]; // xx yy zz xy yz zx
      for (let f = 0; f < nF; f++) {
        let a = I[f * 3], b = I[f * 3 + 1], c = I[f * 3 + 2]; if (flip) { const t = b; b = c; c = t; }
        const x1 = P[a * 3], y1 = P[a * 3 + 1], z1 = P[a * 3 + 2], x2 = P[b * 3], y2 = P[b * 3 + 1], z2 = P[b * 3 + 2], x3 = P[c * 3], y3 = P[c * 3 + 1], z3 = P[c * 3 + 2];
        const det = x1 * (y2 * z3 - z2 * y3) - y1 * (x2 * z3 - z2 * x3) + z1 * (x2 * y3 - y2 * x3);
        const v = det / 6;
        mx += v * (x1 + x2 + x3) / 4; my += v * (y1 + y2 + y3) / 4; mz += v * (z1 + z2 + z3) / 4;
        // ∫x² dV = det/60·(Σxᵢ² + Σxᵢxⱼ),  ∫xy dV = det/120·(2Σxᵢyᵢ + Σ_{i≠j} xᵢyⱼ) over the tetrahedron (0,a,b,c)
        const k = det / 60, k2 = det / 120;
        cov[0] += k * (x1 * x1 + x2 * x2 + x3 * x3 + x1 * x2 + x2 * x3 + x3 * x1);
        cov[1] += k * (y1 * y1 + y2 * y2 + y3 * y3 + y1 * y2 + y2 * y3 + y3 * y1);
        cov[2] += k * (z1 * z1 + z2 * z2 + z3 * z3 + z1 * z2 + z2 * z3 + z3 * z1);
        cov[3] += k2 * (2 * (x1 * y1 + x2 * y2 + x3 * y3) + x1 * y2 + x2 * y1 + x2 * y3 + x3 * y2 + x3 * y1 + x1 * y3);
        cov[4] += k2 * (2 * (y1 * z1 + y2 * z2 + y3 * z3) + y1 * z2 + y2 * z1 + y2 * z3 + y3 * z2 + y3 * z1 + y1 * z3);
        cov[5] += k2 * (2 * (z1 * x1 + z2 * x2 + z3 * x3) + z1 * x2 + z2 * x1 + z2 * x3 + z3 * x2 + z3 * x1 + z1 * x3);
      }
      const V = props.volume;
      com = [mx / V, my / V, mz / V];
      // inertia about origin then shift to COM
      Iten[0] = rho * (cov[1] + cov[2]); Iten[4] = rho * (cov[0] + cov[2]); Iten[8] = rho * (cov[0] + cov[1]);
      Iten[1] = Iten[3] = -rho * cov[3]; Iten[5] = Iten[7] = -rho * cov[4]; Iten[2] = Iten[6] = -rho * cov[5];
      const [x, y, z] = com;
      Iten[0] -= mass * (y * y + z * z); Iten[4] -= mass * (x * x + z * z); Iten[8] -= mass * (x * x + y * y);
      Iten[1] += mass * x * y; Iten[3] += mass * x * y; Iten[2] += mass * x * z; Iten[6] += mass * x * z; Iten[5] += mass * y * z; Iten[7] += mass * y * z;
    } else {
      // shell: mass spread by area
      const tot = props.area || 1;
      let mx = 0, my = 0, mz = 0;
      for (let f = 0; f < nF; f++) { const m = mass * area[f] / tot; mx += m * cx[f]; my += m * cy[f]; mz += m * cz[f]; }
      com = [mx / mass, my / mass, mz / mass];
      for (let f = 0; f < nF; f++) addPoint(cx[f] - com[0], cy[f] - com[1], cz[f] - com[2], mass * area[f] / tot);
    }
    // ballast: a point mass (nose weight). Default position: the most forward point of the model.
    const points = [];
    let totalMass = mass;
    if (o.ballast > 0) {
      let bp = o.ballastPos;
      if (!bp) { let best = -Infinity, bi = 0; for (let i = 0; i < P.length; i += 3) if (P[i] > best) { best = P[i]; bi = i; } bp = [P[bi], P[bi + 1], P[bi + 2]]; }
      const mb = o.ballast;
      const cNew = [(com[0] * mass + bp[0] * mb) / (mass + mb), (com[1] * mass + bp[1] * mb) / (mass + mb), (com[2] * mass + bp[2] * mb) / (mass + mb)];
      // move the body inertia to the new COM (parallel axis), then add the point mass
      const dx = com[0] - cNew[0], dy = com[1] - cNew[1], dz = com[2] - cNew[2];
      Iten[0] += mass * (dy * dy + dz * dz); Iten[4] += mass * (dx * dx + dz * dz); Iten[8] += mass * (dx * dx + dy * dy);
      Iten[1] -= mass * dx * dy; Iten[3] -= mass * dx * dy; Iten[2] -= mass * dx * dz; Iten[6] -= mass * dx * dz; Iten[5] -= mass * dy * dz; Iten[7] -= mass * dy * dz;
      addPoint(bp[0] - cNew[0], bp[1] - cNew[1], bp[2] - cNew[2], mb);
      points.push({ p: [bp[0] - cNew[0], bp[1] - cNew[1], bp[2] - cNew[2]], m: mb });
      com = cNew; totalMass = mass + mb;
    }
    for (let f = 0; f < nF; f++) { cx[f] -= com[0]; cy[f] -= com[1]; cz[f] -= com[2]; }
    const verts = new Float64Array(P.length);
    for (let i = 0; i < P.length; i += 3) { verts[i] = P[i] - com[0]; verts[i + 1] = P[i + 1] - com[1]; verts[i + 2] = P[i + 2] - com[2]; }
    const maxI = Math.max(Iten[0], Iten[4], Iten[8]) || 1e-9;
    for (const k of [0, 4, 8]) Iten[k] = Math.max(Iten[k], 0.02 * maxI);
    const m3inv = (m) => { const [a, b, c, d, e, f, g, h, i] = m; const A_ = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g; const s = 1 / (a * A_ + b * B + c * C); return [A_ * s, -(b * i - c * h) * s, (b * f - c * e) * s, B * s, (a * i - c * g) * s, -(a * f - c * d) * s, C * s, -(a * h - b * g) * s, (a * e - b * d) * s]; };
    // clusters: connected facets with normals within clusterDeg
    const cluster = new Int32Array(nF).fill(-1);
    const edgeFaces = new Map();
    for (let f = 0; f < nF; f++) for (let e = 0; e < 3; e++) {
      const p = I[f * 3 + e], q = I[f * 3 + (e + 1) % 3]; const key = p < q ? p + '_' + q : q + '_' + p;
      let arr = edgeFaces.get(key); if (!arr) { arr = []; edgeFaces.set(key, arr); } arr.push(f);
    }
    const adj = Array.from({ length: nF }, () => []);
    for (const arr of edgeFaces.values()) for (const f of arr) for (const g of arr) if (f !== g) adj[f].push(g);
    const cosTol = Math.cos(o.clusterDeg * DEG);
    const clusters = [];
    for (let f = 0; f < nF; f++) {
      if (cluster[f] >= 0) continue;
      const id = clusters.length, faces = [f], stack = [f]; cluster[f] = id;
      // grow while the facet normal stays close to the seed's normal (keeps a curved surface from becoming one plate)
      while (stack.length) { const g = stack.pop(); for (const h of adj[g]) { if (cluster[h] >= 0) continue; if (nx[h] * nx[f] + ny[h] * ny[f] + nz[h] * nz[f] >= cosTol) { cluster[h] = id; faces.push(h); stack.push(h); } } }
      let ax = 0, ay = 0, az = 0, ar = 0, Nx = 0, Ny = 0, Nz = 0;
      for (const g of faces) { ax += cx[g] * area[g]; ay += cy[g] * area[g]; az += cz[g] * area[g]; ar += area[g]; Nx += nx[g] * area[g]; Ny += ny[g] * area[g]; Nz += nz[g] * area[g]; }
      const nl = Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz) || 1e-12;
      clusters.push({ faces: Int32Array.from(faces), cx: ax / ar, cy: ay / ar, cz: az / ar, nx: Nx / nl, ny: Ny / nl, nz: Nz / nl, area: ar });
    }
    let ext = 0;
    for (let i = 0; i < verts.length; i += 3) ext = Math.max(ext, Math.hypot(verts[i], verts[i + 1], verts[i + 2]));
    const factor = props.closed ? 0.5 : 1;   // a closed solid's two skins share one plate's force
    return {
      name: spec.name || 'Model', spec, mass: totalMass, com, I: Iten, Iinv: m3inv(Iten), subs: [], spheres: [], points, panels: [], panelsC: [],
      mesh: { n: nF, cx, cy, cz, nx, ny, nz, area, cluster, clusters, verts, idx, closed: props.closed, factor, props, opts: o,
        tmin: new Float64Array(clusters.length), tmax: new Float64Array(clusters.length), AR: new Float64Array(clusters.length), reatt: new Float64Array(clusters.length),
        tx: new Float64Array(clusters.length), ty: new Float64Array(clusters.length), tz: new Float64Array(clusters.length) },
      elemCount: nF, areaTotal: props.area * factor, ext, np: 0, meanChord: ext, liftArea: 0, staticMargin: null,
      turbulence: spec.turbulence || 0,
      pos: [0, 0, 0], vel: [0, 0, 0], q: A.qIdentity(), omega: [0, 0, 0], landed: false, t: 0, stats: null, forces: null,
    };
  }

  /** Rotation matrix (row-major) from quaternion. */
  function quatMat(q) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  }

  /** Aerodynamic force/torque of a mesh body (scalar math, no allocation in the facet loop). */
  function meshForces(body, windFn, t, out, acc) {
    const M = body.mesh, o = M.opts, R = quatMat(body.q);
    const px = body.pos[0], py = body.pos[1], pz = body.pos[2];
    const vx = body.vel[0], vy = body.vel[1], vz = body.vel[2];
    const ow = A.qRot(body.q, body.omega); const ox = ow[0], oy = ow[1], oz = ow[2];
    const fd = acc.flowDir;
    const tufts = out && out.tufts, stallOut = out && out.stall;
    let Fx = 0, Fy = 0, Fz = 0, Tx = 0, Ty = 0, Tz = 0, lift = 0, drag = 0;
    const rot = (x, y, z) => [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];
    // rotate every vertex once; body extent downstream along the COM flow direction (reattachment heuristic)
    const V0 = M.verts, nV = V0.length / 3;
    const wv = M.wverts || (M.wverts = new Float64Array(V0.length));
    let bodyMax = -Infinity;
    for (let i = 0; i < nV; i++) {
      const x = V0[i * 3], y = V0[i * 3 + 1], z = V0[i * 3 + 2];
      const gx = R[0] * x + R[1] * y + R[2] * z, gy = R[3] * x + R[4] * y + R[5] * z, gz = R[6] * x + R[7] * y + R[8] * z;
      wv[i * 3] = gx; wv[i * 3 + 1] = gy; wv[i * 3 + 2] = gz;
      const pr = gx * fd[0] + gy * fd[1] + gz * fd[2]; if (pr > bodyMax) bodyMax = pr;
    }
    const idx = M.idx;
    // pass 1: per cluster, in-plane flow direction and extents
    for (let k = 0; k < M.clusters.length; k++) {
      const C = M.clusters[k];
      const [rx, ry, rz] = rot(C.cx, C.cy, C.cz);
      const [nX, nY, nZ] = rot(C.nx, C.ny, C.nz);
      const w = windFn([px + rx, py + ry, pz + rz], t);
      const ax = w[0] - (vx + oy * rz - oz * ry), ay = w[1] - (vy + oz * rx - ox * rz), az = w[2] - (vz + ox * ry - oy * rx);
      const V = Math.sqrt(ax * ax + ay * ay + az * az);
      const nd = ax * nX + ay * nY + az * nZ;
      let tx = ax - nd * nX, ty = ay - nd * nY, tz = az - nd * nZ;
      const tlFlow = Math.sqrt(tx * tx + ty * ty + tz * tz);   // in-plane airspeed at the cluster
      let tl = tlFlow;
      if (tl < 1e-9) { // flow dead-on: any in-plane direction
        tx = -nY; ty = nX; tz = 0; tl = Math.sqrt(tx * tx + ty * ty); if (tl < 1e-9) { tx = 1; ty = 0; tz = 0; tl = 1; }
      }
      tx /= tl; ty /= tl; tz /= tl;
      const sx = nY * tz - nZ * ty, sy = nZ * tx - nX * tz, sz = nX * ty - nY * tx;
      // exact region extents from the facets' vertices (resolution-independent)
      let tmin = Infinity, tmax = -Infinity, smin = Infinity, smax = -Infinity, cmax = -Infinity;
      const faces = C.faces;
      for (let j = 0; j < faces.length; j++) {
        const f = faces[j];
        for (let e = 0; e < 3; e++) {
          const vi = idx[f * 3 + e];
          const gx = wv[vi * 3], gy = wv[vi * 3 + 1], gz = wv[vi * 3 + 2];
          const pt = gx * tx + gy * ty + gz * tz, ps = gx * sx + gy * sy + gz * sz;
          if (pt < tmin) tmin = pt; if (pt > tmax) tmax = pt; if (ps < smin) smin = ps; if (ps > smax) smax = ps;
          const pr = gx * fd[0] + gy * fd[1] + gz * fd[2]; if (pr > cmax) cmax = pr;
        }
      }
      if (tmax - tmin < 1e-9) { tmin -= 1e-6; tmax += 1e-6; }
      if (smax - smin < 1e-9) { smin -= 1e-6; smax += 1e-6; }
      M.tmin[k] = tmin; M.tmax[k] = tmax; M.tx[k] = tx; M.ty[k] = ty; M.tz[k] = tz;
      const L = (tmax - tmin) / 2, spanHalf = (smax - smin) / 2;
      // Reattachment: a bluff face with a long body behind it (a slab's leading edge, a fuselage
      // nose) sheds a wake that reattaches, and most of its pressure drag is recovered downstream.
      // Scale the separated-flow force by the afterbody length over the face's smaller extent.
      const h = Math.max(2 * Math.min(L, spanHalf), 1e-6);
      const after = Math.max(0, bodyMax - cmax);
      M.reatt[k] = 1 - 0.7 * smooth(0.5, 4, after / h);
      const AR = clamp(spanHalf / L, 0.25, 12);
      M.AR[k] = AR;
      // wake torque on separated flow (cluster level)
      if (o.wake && V > 1e-4) {
        const a = Math.abs(nd) / V;
        const st = smooth(o.stallDeg, o.stallDeg + 10, Math.asin(Math.min(1, a)) / DEG);
        if (st > 0) {
          const m22 = RHO * Math.PI * L * L * (2 * spanHalf) * (AR / (AR + 1)) * M.factor * M.reatt[k];
          // cross(tIn, nd·n) with tIn = t̂·tl(original)
          const ix = tx * tlFlow, iy = ty * tlFlow, iz = tz * tlFlow;
          const bx = nX * nd, by = nY * nd, bz = nZ * nd;
          const g = m22 * st * o.wake;
          Tx += (iy * bz - iz * by) * g; Ty += (iz * bx - ix * bz) * g; Tz += (ix * by - iy * bx) * g;
        }
      }
    }
    // pass 2: per facet
    const a0max = 12;
    for (let f = 0; f < M.n; f++) {
      const rx = R[0] * M.cx[f] + R[1] * M.cy[f] + R[2] * M.cz[f], ry = R[3] * M.cx[f] + R[4] * M.cy[f] + R[5] * M.cz[f], rz = R[6] * M.cx[f] + R[7] * M.cy[f] + R[8] * M.cz[f];
      const nX = R[0] * M.nx[f] + R[1] * M.ny[f] + R[2] * M.nz[f], nY = R[3] * M.nx[f] + R[4] * M.ny[f] + R[5] * M.nz[f], nZ = R[6] * M.nx[f] + R[7] * M.ny[f] + R[8] * M.nz[f];
      const w = windFn([px + rx, py + ry, pz + rz], t);
      const ax = w[0] - (vx + oy * rz - oz * ry), ay = w[1] - (vy + oz * rx - ox * rz), az = w[2] - (vz + ox * ry - oy * rx);
      const V = Math.sqrt(ax * ax + ay * ay + az * az);
      if (tufts) { tufts[f * 6] = rx; tufts[f * 6 + 1] = ry; tufts[f * 6 + 2] = rz; }
      if (V < 1e-4) { if (tufts) { tufts[f * 6 + 3] = rx; tufts[f * 6 + 4] = ry; tufts[f * 6 + 5] = rz; if (stallOut) stallOut[f] = 0; } continue; }
      const nd = (ax * nX + ay * nY + az * nZ) / V;
      const sinA = -nd, a = Math.abs(sinA), cosA = Math.sqrt(Math.max(0, 1 - a * a));
      const alphaDeg = Math.asin(Math.min(1, a)) / DEG;
      const k = M.cluster[f];
      // chordwise interval [xi0, xi1] of this facet along the region's flow axis; the attached-flow
      // weight 3(1-ξ)² is integrated exactly over it, so totals and moments do not depend on facet size
      const ktx = M.tx[k], kty = M.ty[k], ktz = M.tz[k];
      const i0 = idx[f * 3] * 3, i1 = idx[f * 3 + 1] * 3, i2 = idx[f * 3 + 2] * 3;
      const p0 = wv[i0] * ktx + wv[i0 + 1] * kty + wv[i0 + 2] * ktz, p1 = wv[i1] * ktx + wv[i1 + 1] * kty + wv[i1 + 2] * ktz, p2 = wv[i2] * ktx + wv[i2 + 1] * kty + wv[i2 + 2] * ktz;
      const inv = 1 / (M.tmax[k] - M.tmin[k]);
      // area-weighted mean of the quadratic 3(1-ξ)² over the triangle: exact via its edge midpoints
      const e0 = 1 - clamp((0.5 * (p0 + p1) - M.tmin[k]) * inv, 0, 1), e1 = 1 - clamp((0.5 * (p1 + p2) - M.tmin[k]) * inv, 0, 1), e2 = 1 - clamp((0.5 * (p2 + p0) - M.tmin[k]) * inv, 0, 1);
      const w0 = e0 * e0, w1 = e1 * e1, w2 = e2 * e2, wAtt = w0 + w1 + w2;
      // pressure-weighted point of action of the attached-flow force (edge midpoints weighted by w)
      let ax_ = rx, ay_ = ry, az_ = rz;
      if (wAtt > 1e-12) {
        const iw = 0.5 / wAtt;
        ax_ = iw * (w0 * (wv[i0] + wv[i1]) + w1 * (wv[i1] + wv[i2]) + w2 * (wv[i2] + wv[i0]));
        ay_ = iw * (w0 * (wv[i0 + 1] + wv[i1 + 1]) + w1 * (wv[i1 + 1] + wv[i2 + 1]) + w2 * (wv[i2 + 1] + wv[i0 + 1]));
        az_ = iw * (w0 * (wv[i0 + 2] + wv[i1 + 2]) + w1 * (wv[i1 + 2] + wv[i2 + 2]) + w2 * (wv[i2 + 2] + wv[i0 + 2]));
      }
      const AR = M.AR[k];
      const st = smooth(o.stallDeg, o.stallDeg + 10, alphaDeg);
      const weight = (1 - a) * wAtt + a;
      const a0 = 2 * Math.PI * AR / (AR + 2);
      const clAtt = a0 * sinA;
      const cnStall = o.cd90 * sinA;
      const qA = 0.5 * RHO * V * V * M.area[f] * weight * M.factor;
      const ux = ax / V, uy = ay / V, uz = az / V;
      let fx, fy, fz;
      const ls = o.suction;
      if (ls > 0) {
        let lx = nX - ux * nd, ly = nY - uy * nd, lz = nZ - uz * nd;
        const ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1; lx /= ll; ly /= ll; lz /= ll;
        const g = -clAtt * qA * (1 - st);
        fx = (lx * ls + nX * (1 - ls) * cosA) * g; fy = (ly * ls + nY * (1 - ls) * cosA) * g; fz = (lz * ls + nZ * (1 - ls) * cosA) * g;
      } else {
        const g = -clAtt * cosA * qA * (1 - st);
        fx = nX * g; fy = nY * g; fz = nZ * g;
      }
      const gs = -cnStall * qA * st * (M.closed && sinA < 0 ? 0.5 : 1) * M.reatt[k];   // lee skin of a solid: base suction, weaker
      fx += nX * gs; fy += nY * gs; fz += nZ * gs;
      const cdi = (1 - st) * clAtt * clAtt / (Math.PI * 0.85 * AR);
      const gt = (o.cf + cdi) * qA;
      fx += ux * gt; fy += uy * gt; fz += uz * gt;
      Fx += fx; Fy += fy; Fz += fz;
      // point of action: attached part at the weighted point, separated part at the centroid
      const bl = weight > 1e-12 ? ((1 - a) * wAtt) / weight : 0;
      const px_ = rx + bl * (ax_ - rx), py_ = ry + bl * (ay_ - ry), pz_ = rz + bl * (az_ - rz);
      Tx += py_ * fz - pz_ * fy; Ty += pz_ * fx - px_ * fz; Tz += px_ * fy - py_ * fx;
      const fPar = fx * fd[0] + fy * fd[1] + fz * fd[2];
      drag += fPar; lift += Math.sqrt(Math.max(0, fx * fx + fy * fy + fz * fz - fPar * fPar));
      if (tufts) {
        const tl2 = Math.sqrt(M.area[f]) * 1.2;
        tufts[f * 6 + 3] = rx + ux * tl2; tufts[f * 6 + 4] = ry + uy * tl2; tufts[f * 6 + 5] = rz + uz * tl2;
        if (stallOut) stallOut[f] = st;
      }
      if (a0 > a0max) { /* unreachable guard */ }
    }
    acc.F[0] += Fx; acc.F[1] += Fy; acc.F[2] += Fz; acc.T[0] += Tx; acc.T[1] += Ty; acc.T[2] += Tz;
    acc.lift += lift; acc.drag += drag;
  }

  Object.assign(A, { weld, subdivide, meshProps, normalizeMesh, buildMeshBody, meshForces, quatMat });
  Object.assign(A._meshHooks, { meshForces, quatMat });
})(typeof self !== 'undefined' ? self : this);
