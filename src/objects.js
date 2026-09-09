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
      panels.push(...wing({ span: tSpan, rootChord: tChord, tipChord: tChord, incidenceDeg: p.tailInc,
        pos: [tailX, 0, 0], strips: 2, subChord: 2, rho: skin, name: 'tail', suction: 0.7 }));
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
