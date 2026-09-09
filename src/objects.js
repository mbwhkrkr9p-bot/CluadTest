/*
 * objects.js — catalogue of droppable bodies and the parametric glider designer.
 * Depends on aero.js (AERO global / module).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./aero.js'));
  else root.OBJECTS = factory(root.AERO);
})(typeof self !== 'undefined' ? self : this, function (A) {
  'use strict';
  const { rectPanel, wing, fin, rod, box } = A;

  // ------------------------------------------------------------------
  // Glider designer: one parameter set describes wing, tail, fin, ballast.
  // ------------------------------------------------------------------
  const GLIDER_PARAMS = [
    { key: 'span', label: 'Wing span', unit: 'cm', min: 10, max: 90, step: 1, scale: 0.01 },
    { key: 'chord', label: 'Wing chord', unit: 'cm', min: 3, max: 25, step: 0.5, scale: 0.01 },
    { key: 'taper', label: 'Tip / root chord', unit: '', min: 0.3, max: 1, step: 0.05, scale: 1 },
    { key: 'sweep', label: 'Sweep', unit: '°', min: -10, max: 50, step: 1, scale: 1 },
    { key: 'dihedral', label: 'Dihedral', unit: '°', min: -10, max: 25, step: 1, scale: 1 },
    { key: 'incidence', label: 'Wing incidence', unit: '°', min: -4, max: 10, step: 0.5, scale: 1 },
    { key: 'wingX', label: 'Wing position', unit: 'cm fwd', min: -10, max: 15, step: 0.5, scale: 0.01 },
    { key: 'camber', label: 'Camber', unit: '°', min: 0, max: 6, step: 0.5, scale: 1 },
    { key: 'airfoil', label: 'Airfoil (flat plate → wing section)', unit: '%', min: 0, max: 100, step: 5, scale: 0.01 },
    { key: 'reflex', label: 'Reflex / trim', unit: 'cm0', min: -0.05, max: 0.1, step: 0.01, scale: 1 },
    { key: 'tailArea', label: 'Tailplane area', unit: '% wing', min: 0, max: 40, step: 1, scale: 0.01 },
    { key: 'tailArm', label: 'Tail arm', unit: 'cm', min: 5, max: 60, step: 1, scale: 0.01 },
    { key: 'tailInc', label: 'Tail incidence', unit: '°', min: -8, max: 6, step: 0.5, scale: 1 },
    { key: 'elevL', label: 'Left elevator half', unit: '°', min: -25, max: 25, step: 1, scale: 1 },
    { key: 'elevR', label: 'Right elevator half', unit: '°', min: -25, max: 25, step: 1, scale: 1 },
    { key: 'finArea', label: 'Fin area', unit: '% wing', min: 0, max: 25, step: 1, scale: 0.01 },
    { key: 'nose', label: 'Nose weight', unit: 'g', min: 0, max: 40, step: 0.5, scale: 0.001 },
    { key: 'skin', label: 'Skin weight', unit: 'g/m²', min: 60, max: 600, step: 10, scale: 0.001 },
  ];

  const GLIDER_PRESETS = {
    trainer: {
      label: 'Trainer glider', color: 0xE9D9B4, blurb: 'Rectangular wing, real tail, balsa skin. The safe way to fly.',
      span: 50, chord: 9, taper: 1, sweep: 0, dihedral: 6, incidence: 1, wingX: 4, camber: 2.5, reflex: 0,
      tailArea: 22, tailArm: 28, tailInc: 2, finArea: 8, nose: 7, skin: 250, airfoil: 85,
    },
    dart: {
      label: 'Paper dart', color: 0xF4F4F0, blurb: 'The classic folded plane: swept, no tail, keel underneath.',
      span: 20, chord: 22, taper: 0.35, sweep: 42, dihedral: 12, incidence: 1, wingX: 2, camber: 0, reflex: 0.02,
      tailArea: 0, tailArm: 5, tailInc: 0, finArea: 6, nose: 5, skin: 160, airfoil: 35,
    },
    wing: {
      label: 'Flying wing', color: 0x3C4A5E, blurb: 'Swept, no tail. Reflex on the trailing edge keeps it from tumbling.',
      span: 70, chord: 16, taper: 0.5, sweep: 28, dihedral: 3, incidence: 2, wingX: 0, camber: 1, reflex: 0.03,
      tailArea: 0, tailArm: 5, tailInc: 0, finArea: 10, nose: 12, skin: 220, airfoil: 85,
    },
    tailless: {
      label: 'Untrimmed wing', color: 0x5E3C3C, blurb: 'The same wing with no reflex and no tail. Watch what happens.',
      span: 70, chord: 16, taper: 0.5, sweep: 28, dihedral: 3, incidence: 2, wingX: 0, camber: 1, reflex: -0.01,
      tailArea: 0, tailArm: 5, tailInc: 0, finArea: 10, nose: 12, skin: 220, airfoil: 85,
    },
    tailheavy: {
      label: 'Tail-heavy trainer', color: 0xE9D9B4, blurb: 'The trainer without its nose weight. Stalls, dives, repeats.',
      span: 50, chord: 9, taper: 1, sweep: 0, dihedral: 6, incidence: 1, wingX: 4, camber: 2.5, reflex: 0,
      tailArea: 22, tailArm: 28, tailInc: 2, finArea: 8, nose: 2, skin: 250, airfoil: 85,
    },
  };

  function gliderSpec(p, name) {
    const span = p.span * 0.01, chord = p.chord * 0.01, skin = p.skin * 0.001;
    const wingX = p.wingX * 0.01;
    const panels = [];
    // main wing (mean quarter chord at x = wingX)
    panels.push(...wing({
      span, rootChord: chord * 2 / (1 + p.taper), tipChord: chord * 2 * p.taper / (1 + p.taper),
      sweepDeg: p.sweep, dihedralDeg: p.dihedral, incidenceDeg: p.incidence,
      pos: [wingX + span / 4 * Math.tan(p.sweep * A.DEG) * 0.5, 0.01, 0], strips: 5, subChord: 3, rho: skin,
      suction: (p.airfoil == null ? 85 : p.airfoil) * 0.01, cf: 0.025,
      camber: (p.camber || p.reflex) ? { a0Deg: p.camber, cm0: p.reflex } : null, name: 'wing',
    }));
    const wingArea = span * chord;
    // tail
    const tailX = -p.tailArm * 0.01;
    if (p.tailArea > 0) {
      const tA = wingArea * p.tailArea * 0.01;
      const tChord = Math.min(chord * 0.75, Math.sqrt(tA / 3));
      const tSpan = tA / tChord;
      // fixed front 60% of the tailplane + a hinged rear 40% split into left and right elevator halves,
      // each rotated about the hinge line by its own deflection (+ = trailing edge up = nose-up command).
      // All pieces use the whole tailplane's aspect ratio so the split itself changes nothing at zero deflection.
      const tAR = tSpan / tChord;
      const cFix = 0.6 * tChord, cFl = 0.4 * tChord;
      const le = tailX + tChord / 4;                  // tail leading edge (wing() puts the quarter chord at pos)
      panels.push(...wing({ span: tSpan, rootChord: cFix, tipChord: cFix, incidenceDeg: p.tailInc, AR: tAR,
        pos: [le - cFix / 4, 0, 0], strips: 2, subChord: 2, rho: skin, name: 'tail', suction: 0.7 }));
      const hinge = le - cFix;
      for (const [side, e] of [[1, p.elevR || 0], [-1, p.elevL || 0]]) {
        const er = e * A.DEG;
        panels.push(...wing({ span: tSpan, rootChord: cFl, tipChord: cFl, incidenceDeg: p.tailInc - e, AR: tAR, sides: [side],
          pos: [hinge - (cFl / 4) * Math.cos(er), (cFl / 4) * Math.sin(er), 0], strips: 2, subChord: 2, rho: skin, name: 'elevator' + (side > 0 ? 'R' : 'L'), suction: 0.7 }));
      }
    }
    if (p.finArea > 0) {
      const fA = wingArea * p.finArea * 0.01;
      const fChord = Math.sqrt(fA / 1.2), fH = fA / fChord;
      const finX = p.tailArea > 0 ? tailX : wingX - chord * 0.3;
      const up = p.tailArea > 0;   // paper dart / flying wing: keel underneath
      panels.push(fin({ pos: [finX, 0, 0], chord: fChord, height: fH, rho: skin, up, name: 'fin' }));
    }
    // fuselage rod from nose to tail
    const noseX = wingX + chord * 0.6 + 0.04;
    const rodTo = p.tailArea > 0 ? tailX - 0.01 : wingX - chord * 0.6;
    const fuseDia = p.tailArea > 0 ? 0.012 : 0.006;
    panels.push(...rod({ from: [noseX, 0, 0], to: [rodTo, 0, 0], dia: fuseDia, rho: p.tailArea > 0 ? 0.6 : 0.2, name: 'fuselage' }));
    const masses = [{ p: [noseX, 0, 0], m: p.nose * 0.001 + 0.0002 }];
    return {
      name: name || 'Glider', kind: 'glider', panels, masses, turbulence: 0,
      launch: { speed: 5, pitch: 2, roll: 0, spin: 0 }, viewDist: Math.max(1.4, span * 2.6),
    };
  }

  // ------------------------------------------------------------------
  // Everyday objects
  // ------------------------------------------------------------------
  const CATALOG = {
    leaf: {
      label: 'Leaf', blurb: 'A 9 cm leaf, 60 g/m². Light enough that the air wins.',
      make: () => ({
        name: 'Leaf', kind: 'object',
        panels: [rectPanel({ c: [0, 0, 0], u: [1, 0, 0], w: [0, 0, 1], hu: 0.045, hw: 0.03, nu: 5, nw: 4, shape: 'ellipse', rho: 0.06, cd90: 1.2, stallDeg: 10, name: 'blade' })],
        masses: [{ p: [-0.05, 0, 0], m: 0.00003 }],
        turbulence: 0.15, viewDist: 0.9,
        launch: { speed: 0, pitch: 20, roll: 25, spin: 0.5 }, visual: { color: 0x5da34a, leaf: true },
      }),
    },
    card: {
      label: 'Playing card', blurb: '89 × 64 mm, 1.8 g. Dense enough to tumble end over end.',
      make: () => ({
        name: 'Playing card', kind: 'object',
        panels: [rectPanel({ c: [0, 0, 0], u: [1, 0, 0], w: [0, 0, 1], hu: 0.0445, hw: 0.032, nu: 4, nw: 3, rho: 0.31, cd90: 1.17, stallDeg: 10, name: 'card' })],
        turbulence: 0.1, viewDist: 0.9,
        launch: { speed: 0, pitch: 15, roll: 0, spin: 0.3 }, visual: { color: 0xf4f1e6, card: true },
      }),
    },
    paper: {
      label: 'Sheet of paper', blurb: 'A6 sheet, 80 g/m². Flutters, side-slips, sometimes tumbles.',
      make: () => ({
        name: 'Sheet of paper', kind: 'object',
        panels: [rectPanel({ c: [0, 0, 0], u: [1, 0, 0], w: [0, 0, 1], hu: 0.0525, hw: 0.037, nu: 5, nw: 4, rho: 0.08, cd90: 1.2, stallDeg: 10, name: 'sheet' })],
        turbulence: 0.12, viewDist: 0.9,
        launch: { speed: 0, pitch: 12, roll: 8, spin: 0.2 }, visual: { color: 0xfafafa },
      }),
    },
    box: {
      label: 'Cardboard box', blurb: '20 cm cube, 150 g. Bluff body: drag, no lift, chaotic tumble.',
      make: () => ({
        name: 'Cardboard box', kind: 'object',
        panels: box({ size: [0.2, 0.2, 0.2], rho: 0.15 / (6 * 0.04), sub: 3, cd90: 1.05 }),
        turbulence: 1.0, viewDist: 1.4,
        launch: { speed: 0, pitch: 12, roll: 20, spin: 0.8 }, visual: { color: 0xc59a5a, box: [0.2, 0.2, 0.2] },
      }),
    },
    ball: {
      label: 'Beach ball', blurb: '30 cm, 65 g. Only drag; reaches terminal speed in a couple of metres.',
      make: () => ({
        name: 'Beach ball', kind: 'object', panels: [],
        spheres: [{ c: [0, 0, 0], r: 0.15, cd: 0.47, m: 0.065 }],
        turbulence: 0, viewDist: 1.6,
        launch: { speed: 0, pitch: 0, roll: 0, spin: 1 }, visual: { color: 0xf25c54 },
      }),
    },
    samara: {
      label: 'Maple seed', blurb: 'A 4 cm samara: heavy seed on a thin blade. It should spin as it falls.',
      make: () => ({
        name: 'Maple seed', kind: 'object',
        panels: [rectPanel({ c: [0, 0, 0.018], u: [1, 0, 0], w: [0, 0, 1], hu: 0.0055, hw: 0.016, nu: 3, nw: 6, shape: 'ellipse', rho: 0.035, cd90: 1.2, stallDeg: 12, name: 'blade' })],
        spheres: [{ c: [0, 0, -0.003], r: 0.004, cd: 0.5, m: 0.00004 }],
        turbulence: 0.05, viewDist: 0.35,
        launch: { speed: 0, pitch: 10, roll: 30, spin: 2 }, visual: { color: 0xb8925a, seed: true },
      }),
    },
    shuttle: {
      label: 'Shuttlecock', blurb: 'Cork nose, feather skirt. Dropped tail-first, it turns itself over.',
      make: () => {
        const panels = [];
        const N = 8;
        for (let i = 0; i < N; i++) {
          const ang = (i / N) * Math.PI * 2;
          const dir = [0, Math.cos(ang), Math.sin(ang)];
          const r0 = 0.014, r1 = 0.033, x0 = -0.025, x1 = -0.075;
          const c = [ (x0 + x1) / 2, dir[1] * (r0 + r1) / 2, dir[2] * (r0 + r1) / 2 ];
          const u = A.norm([x0 - x1, dir[1] * (r0 - r1), dir[2] * (r0 - r1)]);   // toward the nose
          const w = [0, -Math.sin(ang), Math.cos(ang)];
          const L = Math.hypot(x0 - x1, r1 - r0);
          const width = 2 * Math.PI * (r0 + r1) / 2 / N;
          panels.push(rectPanel({ c, u, w, hu: L / 2, hw: width / 2, nu: 3, nw: 1, rho: 0.03, cd90: 0.5, cf: 0.02, stallDeg: 90, name: 'feather' + i }));
        }
        return {
          name: 'Shuttlecock', kind: 'object', panels,
          spheres: [{ c: [0, 0, 0], r: 0.013, cd: 0.45, m: 0.0028 }],
          turbulence: 0, viewDist: 0.5,
          launch: { speed: 0, pitch: 120, roll: 0, spin: 0.5 }, visual: { color: 0xf2f2f2, shuttle: true },
        };
      },
    },
  };

  return { CATALOG, GLIDER_PARAMS, GLIDER_PRESETS, gliderSpec };
});

/* ======================================================================
 * Mesh objects: procedural samples, file parsers, and the mesh glider.
 * ==================================================================== */
(function (root) {
  const isNode = typeof module === 'object' && module.exports;
  const A = isNode ? require('./aero.js') : root.AERO;
  const O = isNode ? module.exports : root.OBJECTS;
  const DEG = Math.PI / 180;

  // ---- builders (positions flat xyz in metres, indices CCW outward)
  function merge(list) {
    const pos = [], idx = [];
    for (const m of list) { const off = pos.length / 3; for (const v of m.positions) pos.push(v); for (const i of m.indices) idx.push(i + off); }
    return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx) };
  }
  function transform(mesh, fn) {
    const P = new Float64Array(mesh.positions.length);
    for (let i = 0; i < P.length; i += 3) { const r = fn([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]); P[i] = r[0]; P[i + 1] = r[1]; P[i + 2] = r[2]; }
    return { positions: P, indices: mesh.indices };
  }
  /** Closed box sx×sy×sz centred at c, with nx×ny×nz facets per face pair (resolution). */
  function boxMesh(sx, sy, sz, c = [0, 0, 0], seg = 1) {
    const pos = [], idx = [];
    const h = [sx / 2, sy / 2, sz / 2];
    const face = (axis, sign) => {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const base = pos.length / 3;
      for (let i = 0; i <= seg; i++) for (let j = 0; j <= seg; j++) {
        const p = [0, 0, 0]; p[axis] = sign * h[axis]; p[u] = -h[u] + (2 * h[u] * i) / seg; p[v] = -h[v] + (2 * h[v] * j) / seg;
        pos.push(p[0] + c[0], p[1] + c[1], p[2] + c[2]);
      }
      for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
        const a = base + i * (seg + 1) + j, b = a + seg + 1, cc = a + 1, d = b + 1;
        if (sign > 0) idx.push(a, b, d, a, d, cc); else idx.push(a, d, b, a, cc, d);
      }
    };
    for (let axis = 0; axis < 3; axis++) { face(axis, 1); face(axis, -1); }
    return A.weld({ positions: Float64Array.from(pos), indices: Uint32Array.from(idx) }, 1e-7);
  }
  function icosphere(r, n = 2, c = [0, 0, 0]) {
    const t = (1 + Math.sqrt(5)) / 2;
    let pos = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
    let idx = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
    let m = A.subdivide({ positions: Float64Array.from(pos), indices: Uint32Array.from(idx) }, n);
    return transform(m, (p) => { const l = Math.hypot(p[0], p[1], p[2]); return [c[0] + r * p[0] / l, c[1] + r * p[1] / l, c[2] + r * p[2] / l]; });
  }
  const rotY = (deg) => (p) => { const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]]; };
  const rotZ = (deg) => (p) => { const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]]; };
  const rotX = (deg) => (p) => { const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]]; };
  const move = (d) => (p) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
  const chain = (...fns) => (p) => fns.reduce((q, f) => f(q), p);

  /** Thin closed wing slab with taper, sweep, dihedral, incidence — from the glider parameters. */
  function wingSlab(p, thickness, seg) {
    const span = p.span * 0.01, chord = p.chord * 0.01;
    const rootC = chord * 2 / (1 + p.taper), tipC = chord * 2 * p.taper / (1 + p.taper);
    const halves = [];
    for (const side of [1, -1]) {
      const strips = seg;
      const pos = [], idx = [];
      // build a lofted slab: sections along span, each a rectangle (4 verts) → closed by quads
      const sections = [];
      for (let i = 0; i <= strips; i++) {
        const f = i / strips, y = f * span / 2, c = rootC + (tipC - rootC) * f;
        const xqc = -y * Math.tan(p.sweep * DEG);
        sections.push({ x0: xqc + c / 4, x1: xqc - 3 * c / 4, z: side * y, yUp: y * Math.tan(p.dihedral * DEG) });
      }
      for (const s of sections) {
        pos.push(s.x0, s.yUp + thickness / 2, s.z, s.x1, s.yUp + thickness / 2, s.z, s.x1, s.yUp - thickness / 2, s.z, s.x0, s.yUp - thickness / 2, s.z);
      }
      const q = (a, b, c, d) => { if (side > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); };
      for (let i = 0; i < strips; i++) {
        const a = i * 4, b = (i + 1) * 4;
        q(a, a + 1, b + 1, b);          // top
        q(a + 2, a + 3, b + 3, b + 2);  // bottom
        q(a + 1, a + 2, b + 2, b + 1);  // trailing edge
        q(a + 3, a, b, b + 3);          // leading edge
      }
      // caps
      q(0, 3, 2, 1);
      const e = strips * 4; q(e, e + 1, e + 2, e + 3);
      halves.push({ positions: Float64Array.from(pos), indices: Uint32Array.from(idx) });
    }
    let m = A.weld(merge(halves), 1e-7);      // join the halves at the root
    m = transform(m, rotZ(p.incidence));
    return m;
  }
  /** Whole glider as one mesh (wing slab, tail slab, fin, fuselage box, nose block). */
  function gliderMesh(p, seg = 4) {
    const span = p.span * 0.01, chord = p.chord * 0.01;
    const parts = [];
    const wingX = p.wingX * 0.01;
    parts.push(transform(wingSlab(p, 0.004, seg), move([wingX, 0.012, 0])));
    const wingArea = span * chord;
    const tailX = -p.tailArm * 0.01;
    if (p.tailArea > 0) {
      const tA = wingArea * p.tailArea * 0.01, tChord = Math.min(chord * 0.75, Math.sqrt(tA / 3)), tSpan = tA / tChord;
      const eL = p.elevL || 0, eR = p.elevR || 0;
      if (eL === 0 && eR === 0) {
        parts.push(transform(wingSlab({ span: tSpan * 100, chord: tChord * 100, taper: 1, sweep: 0, dihedral: 0, incidence: p.tailInc }, 0.003, Math.max(2, seg >> 1)), move([tailX, 0, 0])));
      } else {
        const cFix = 0.6 * tChord, cFl = 0.4 * tChord, le = tailX + tChord / 4, hinge = le - cFix;
        parts.push(transform(wingSlab({ span: tSpan * 100, chord: cFix * 100, taper: 1, sweep: 0, dihedral: 0, incidence: p.tailInc }, 0.003, Math.max(2, seg >> 1)), move([le - cFix / 4, 0, 0])));
        // each flap half: a slab of half span shifted to its side, leading edge at the origin, rotated nose-down by e, placed on the hinge
        for (const [side, e] of [[1, eR], [-1, eL]]) {
          let flap = wingSlab({ span: tSpan * 50, chord: cFl * 100, taper: 1, sweep: 0, dihedral: 0, incidence: 0 }, 0.003, Math.max(1, seg >> 2));
          flap = transform(flap, chain(move([-cFl / 4, 0, side * tSpan / 4]), rotZ(-e + p.tailInc), move([hinge, 0, 0])));
          parts.push(flap);
        }
      }
    }
    if (p.finArea > 0) {
      const fA = wingArea * p.finArea * 0.01, fChord = Math.sqrt(fA / 1.2), fH = fA / fChord;
      const finX = p.tailArea > 0 ? tailX : wingX - chord * 0.3;
      const up = p.tailArea > 0 ? 1 : -1;
      parts.push(boxMesh(fChord, fH, 0.003, [finX, up * fH / 2, 0], Math.max(1, seg >> 1)));
    }
    const noseX = wingX + chord * 0.6 + 0.04, rodTo = p.tailArea > 0 ? tailX - 0.01 : wingX - chord * 0.6;
    const dia = p.tailArea > 0 ? 0.012 : 0.006;
    parts.push(boxMesh(noseX - rodTo, dia, dia, [(noseX + rodTo) / 2, 0, 0], Math.max(2, seg)));
    return merge(parts);   // parts stay separate solids; each is closed on its own
  }
  /** Folded paper dart as an open surface: two swept wing panels in a V plus a keel. */
  function dartMesh(seg = 3) {
    const L = 0.21, halfSpan = 0.09, dihedral = 18 * DEG;
    const parts = [];
    for (const side of [1, -1]) {
      const pos = [], idx = [];
      // triangle-ish panel: nose at (L/2,0,0), trailing root (-L/2,0,0), tip (-L/2, up, ±halfSpan) — lofted in `seg` strips
      for (let i = 0; i <= seg; i++) {
        const f = i / seg, z = side * halfSpan * f, y = halfSpan * f * Math.tan(dihedral);
        const xle = L / 2 - L * f * 0.95;           // swept leading edge
        pos.push(xle, y, z, -L / 2, y, z);
      }
      for (let i = 0; i < seg; i++) { const a = i * 2, b = a + 2; if (side > 0) idx.push(a, a + 1, b + 1, a, b + 1, b); else idx.push(a, b + 1, a + 1, a, b, b + 1); }
      parts.push({ positions: Float64Array.from(pos), indices: Uint32Array.from(idx) });
    }
    // keel (vertical plate under the centreline)
    const keelH = 0.02, kp = [L / 2, 0, 0, -L / 2, 0, 0, -L / 2, -keelH, 0, L / 2, -keelH, 0];
    parts.push({ positions: Float64Array.from(kp), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) });
    return A.weld(merge(parts), 1e-7);
  }

  // ---- file parsers
  function parseSTL(buffer) {
    const bytes = new Uint8Array(buffer);
    const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 600)));
    const dv = new DataView(buffer);
    const isBinary = bytes.length >= 84 && (dv.getUint32(80, true) * 50 + 84 === bytes.length || !/^\s*solid/i.test(head));
    const pos = [];
    if (isBinary) {
      const n = dv.getUint32(80, true);
      for (let i = 0; i < n; i++) { const o = 84 + i * 50; for (let v = 0; v < 3; v++) { const b = o + 12 + v * 12; pos.push(dv.getFloat32(b, true), dv.getFloat32(b + 4, true), dv.getFloat32(b + 8, true)); } }
    } else {
      const text = new TextDecoder().decode(bytes);
      const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g; let m;
      while ((m = re.exec(text))) pos.push(+m[1], +m[2], +m[3]);
    }
    const idx = new Uint32Array(pos.length / 3); for (let i = 0; i < idx.length; i++) idx[i] = i;
    return A.weld({ positions: Float64Array.from(pos), indices: idx }, 1e-6);
  }
  function parseOBJ(text) {
    const pos = [], idx = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim(); if (!line || line[0] === '#') continue;
      const t = line.split(/\s+/);
      if (t[0] === 'v') pos.push(+t[1], +t[2], +t[3]);
      else if (t[0] === 'f') {
        const vs = t.slice(1).map((s) => { let i = parseInt(s.split('/')[0], 10); return i < 0 ? pos.length / 3 + i : i - 1; });
        for (let i = 1; i + 1 < vs.length; i++) idx.push(vs[0], vs[i], vs[i + 1]);
      }
    }
    return A.weld({ positions: Float64Array.from(pos), indices: Uint32Array.from(idx) }, 1e-6);
  }

  // ---- sample catalogue (mesh path)
  const MESH_CATALOG = {
    mcard: {
      label: 'Card (mesh)', blurb: 'The playing card again, but as a closed 0.3 mm slab of triangles. Compare it with the panel version.',
      size: 8.9, mass: 1.8, res: 1, airfoil: 0, base: () => boxMesh(0.089, 0.0003, 0.064, [0, 0, 0], 4),
      launch: { speed: 0, pitch: 15, roll: 0, spin: 0.3 }, viewDist: 0.9, color: 0xf4f1e6,
    },
    mcube: {
      label: 'Cube (mesh)', blurb: '20 cm closed cube. Six faces of triangles; drag from the windward faces, base suction behind.',
      size: 20, mass: 150, res: 1, airfoil: 0, base: () => boxMesh(0.2, 0.2, 0.2, [0, 0, 0], 3),
      launch: { speed: 0, pitch: 12, roll: 20, spin: 0.8 }, viewDist: 1.4, color: 0xc59a5a, turbulence: 0.8,
    },
    msphere: {
      label: 'Sphere (mesh)', blurb: 'An icosphere. Raise the resolution and watch the drag settle toward a steady value.',
      size: 30, mass: 65, res: 0, airfoil: 0, base: () => icosphere(0.15, 2),
      launch: { speed: 0, pitch: 0, roll: 0, spin: 1 }, viewDist: 1.6, color: 0xf25c54,
    },
    mdart: {
      label: 'Paper dart (mesh)', blurb: 'A folded dart as an open surface: two swept panels in a V and a keel. 5 g of paper.',
      size: 21, mass: 4, res: 1, airfoil: 0.3, ballast: 1.5, base: () => dartMesh(3),
      launch: { speed: 6, pitch: 2, roll: 0, spin: 0 }, viewDist: 1.2, color: 0xf6f6f2, glider: true,
    },
    mglider: {
      label: 'Trainer (mesh)', blurb: 'The trainer glider built as one solid mesh: slab wing and tail, fin, fuselage bar, nose block.',
      size: 50, mass: 18, res: 0, airfoil: 0.85, ballast: 6,
      base: () => gliderMesh(Object.assign({}, O.GLIDER_PRESETS.trainer, { incidence: 2.5, tailInc: 0.5 }), 4),
      launch: { speed: 5, pitch: 2, roll: 0, spin: 0 }, viewDist: 1.5, color: 0xE9D9B4, glider: true,
    },
  };

  /** Build a mesh spec from a base mesh + user settings (size in cm, mass in g, res subdivisions). */
  function meshSpec(base, opts) {
    const o = Object.assign({ size: 20, mass: 20, res: 0, airfoil: 0, ballast: 0, zUp: false, name: 'Model', color: 0xB7C4D6, launch: { speed: 0, pitch: 15, roll: 10, spin: 0.5 }, viewDist: null, turbulence: 0 }, opts);
    let mesh = A.normalizeMesh(base, o.size * 0.01, o.zUp);
    let faces = mesh.indices.length / 3, res = 0;
    while (res < o.res && faces * 4 <= 12000) { mesh = A.subdivide(mesh, 1); faces *= 4; res++; }
    return {
      name: o.name, kind: 'mesh', mesh, meshOpts: { mass: o.mass * 0.001, suction: o.airfoil, cd90: 1.3, stallDeg: 13, cf: 0.015, wake: 0.3, ballast: o.ballast * 0.001 },
      launch: o.launch, viewDist: o.viewDist || Math.max(0.6, o.size * 0.01 * 2.8), turbulence: o.turbulence, visual: { color: o.color, mesh: true },
      resApplied: res,
    };
  }

  Object.assign(O, { MESH_CATALOG, meshSpec, boxMesh, icosphere, gliderMesh, dartMesh, parseSTL, parseOBJ, mergeMeshes: merge, transformMesh: transform });
})(typeof self !== 'undefined' ? self : this);
