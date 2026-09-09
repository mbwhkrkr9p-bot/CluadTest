/* app.js — Airfall: three.js scene, controls and HUD around the aero core. */
(function () {
  'use strict';
  const A = window.AERO, O = window.OBJECTS;
  const $ = (s) => document.querySelector(s);
  const DEG = Math.PI / 180;

  // ------------------------------------------------------------------ theme
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    return { bg: g('--bg'), sky1: g('--sky1'), sky2: g('--sky2'), ground: g('--ground'), grid: g('--grid'), grid2: g('--grid2'),
      fog: g('--fog'), accent: g('--accent'), cyan: g('--cyan'), good: g('--good'), bad: g('--bad'), text: g('--text'), muted: g('--muted') };
  }
  let T = readTheme();

  // ------------------------------------------------------------------ scene
  const canvas = $('#c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 40, 260);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 900);

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y; float t = smoothstep(-0.05, 0.6, h); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 12), skyMat);
  scene.add(sky);

  const groundMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const gridCoarse = new THREE.GridHelper(400, 400); gridCoarse.position.y = 0.003; scene.add(gridCoarse);
  const gridFine = new THREE.GridHelper(6, 60); gridFine.position.y = 0.002; scene.add(gridFine);
  gridCoarse.material.vertexColors = gridFine.material.vertexColors = false;
  gridCoarse.material.transparent = gridFine.material.transparent = true;
  gridCoarse.material.opacity = 0.55; gridFine.material.opacity = 0.35;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.002;
  scene.add(sun); scene.add(sun.target);

  // launch pole + distance markers
  const markers = new THREE.Group(); scene.add(markers);
  const poleMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.5 });
  const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 10, 0)]), poleMat);
  markers.add(pole);
  function ring(r, y, color, opacity) {
    const pts = []; for (let i = 0; i <= 64; i++) pts.push(new THREE.Vector3(r * Math.cos(i / 64 * 6.2832), y, r * Math.sin(i / 64 * 6.2832)));
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  }
  const labelSprites = [];
  function label(text, x, z, w) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const ctx = c.getContext('2d'); ctx.font = '600 44px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    sp.position.set(x, 0.02 + w * 0.18, z); sp.scale.set(w, w * 0.375, 1); sp.userData = { text, ctx, c };
    markers.add(sp); labelSprites.push(sp); return sp;
  }
  function paintLabels() {
    for (const sp of labelSprites) {
      const { ctx, c, text } = sp.userData; ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = T.muted; ctx.fillText(text, 128, 48); sp.material.map.needsUpdate = true;
    }
  }
  [2, 5, 10, 20, 30, 50].forEach((d) => { markers.add(ring(0.12 * Math.sqrt(d), 0.004, 0xffffff, 0.35)).position.x = d; label(d + ' m', d, 0, 0.16 * Math.sqrt(d) + 0.6); });
  markers.add(ring(0.25, 0.004, 0xffffff, 0.6));

  function applyTheme() {
    T = readTheme();
    skyMat.uniforms.top.value.set(T.sky1); skyMat.uniforms.bottom.value.set(T.sky2);
    groundMat.color.set(T.ground); scene.fog.color.set(T.fog);
    gridCoarse.material.color.set(T.grid); gridFine.material.color.set(T.grid2);
    poleMat.color.set(T.muted);
    markers.children.forEach((m) => { if (m.isLine && m !== pole) m.material.color.set(T.grid); });
    paintLabels();
  }
  applyTheme();
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ------------------------------------------------------------------ state
  const state = {
    selected: 'trainer', design: Object.assign({}, O.GLIDER_PRESETS.trainer),
    model: { size: 20, mass: 20, ballast: 0, airfoil: 0, res: 0, zUp: false, name: 'Model', color: 0xB7C4D6, launch: null, turbulence: 0 },
    modelBase: null, wire: true,
    height: 6, speed: null, angle: 0, wind: 0, gust: 0.3, turb: 0.2,
    paused: false, slow: false, forces: false, tufts: true, follow: true,
  };
  const bodies = [];           // live bodies with meshes
  const TRAIL_COLORS = ['#F79A3E', '#4FD1D9', '#E06CC0', '#7ED957', '#F2D45C', '#8FA3FF'];
  let colorIx = 0, simTime = 0;
  const noise = [A.makeNoise(3), A.makeNoise(5), A.makeNoise(8), A.makeNoise(13)];
  const wind = (p, t) => {
    const W = state.wind, g = state.gust, tb = state.turb;
    const base = -W * (1 + 0.35 * g * noise[0](t));
    const s = tb * (0.6 + 0.25 * Math.abs(W));
    return [base + s * noise[1](t * 1.7 + p[0] * 0.4 + p[2] * 0.3), 0.12 * W * g * noise[2](t) + s * 0.5 * noise[3](t * 2.1 + p[1] * 0.5), s * noise[2](t * 1.3 + p[2] * 0.5 + p[0] * 0.2)];
  };

  // ------------------------------------------------------------------ specs
  function currentSpec() {
    if (O.CATALOG[state.selected]) return O.CATALOG[state.selected].make();
    if (isMesh()) {
      const m = state.model;
      return O.meshSpec(state.modelBase, { size: m.size, mass: m.mass, ballast: m.ballast, airfoil: m.airfoil, res: m.res, zUp: m.zUp,
        name: m.name, color: m.color, launch: m.launch || { speed: 0, pitch: state.angle, roll: 0, spin: 0.3 }, turbulence: m.turbulence });
    }
    const preset = O.GLIDER_PRESETS[state.selected];
    const spec = O.gliderSpec(state.design, preset ? preset.label : 'Custom glider');
    spec.visual = { color: preset && preset.color || 0xE9D9B4 };
    return spec;
  }
  function isMesh() { return state.selected === 'upload' || !!O.MESH_CATALOG[state.selected]; }
  function isGlider() { return !O.CATALOG[state.selected] && !isMesh(); }
  function canFly() { return isGlider() || isMesh(); }

  // ------------------------------------------------------------------ meshes
  const vec = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  function makeMesh(body) {
    const g = new THREE.Group();
    const vis = body.spec.visual || {};
    const baseColor = vis.color != null ? vis.color : 0xE9D9B4;
    const mat = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, side: THREE.DoubleSide, roughness: 0.75, metalness: 0.02 }, extra || {}));
    if (vis.mesh) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(body.mesh.verts), 3));
      geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(body.spec.mesh.indices), 1));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat(baseColor, { flatShading: true }));
      m.castShadow = true; g.add(m);
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
      wire.material.color.set(T.text); wire.visible = state.wire; wire.name = 'wire'; g.add(wire);
    } else if (vis.box) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(vis.box[0], vis.box[1], vis.box[2]), mat(baseColor, { side: THREE.FrontSide }));
      m.position.copy(vec(A.scale(body.com, -1))); m.castShadow = true; g.add(m);
    } else {
      body.panelsC.forEach((P, i) => {
        const src = body.panels[i];
        if (src.name === 'fuselage') {
          if (src === body.panels.find((p) => p.name === 'fuselage')) {
            const cyl = new THREE.Mesh(new THREE.CylinderGeometry(P.hw, P.hw, 2 * P.hu, 10), mat(0x2E3644, { side: THREE.FrontSide }));
            cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vec(P.u));
            cyl.position.copy(vec(P.c)); cyl.castShadow = true; g.add(cyl);
          }
          return;
        }
        // plane spans (w, u) with normal n: a right-handed basis (w × u = n)
        let geo;
        if (src.shape === 'ellipse') { geo = new THREE.CircleGeometry(1, 40); geo.scale(P.hw, P.hu, 1); }
        else geo = new THREE.PlaneGeometry(2 * P.hw, 2 * P.hu);
        let color = baseColor;
        if (src.name === 'fin') color = 0x2E3644;
        if (src.name.startsWith('tail')) color = baseColor;
        if (src.name.startsWith('elevatorR')) color = 0x8C6A3F;
        if (src.name.startsWith('elevatorL')) color = 0x6F7E9C;
        if (vis.leaf) color = i === 0 ? baseColor : 0x3f7a2f;
        const m = new THREE.Mesh(geo, mat(color));
        const basis = new THREE.Matrix4().makeBasis(vec(P.w), vec(P.u), vec(P.n));
        m.quaternion.setFromRotationMatrix(basis);
        m.position.copy(vec(P.c)); m.castShadow = true; g.add(m);
        if (vis.card) {   // pip on one face so tumbling reads
          const pip = new THREE.Mesh(new THREE.CircleGeometry(P.hw * 0.35, 24), mat(0xC8313A, { side: THREE.FrontSide }));
          pip.quaternion.copy(m.quaternion); pip.position.copy(m.position).add(vec(P.n).multiplyScalar(0.0006)); g.add(pip);
        }
      });
      if (vis.leaf) {   // stem
        const P = body.panelsC[0];
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.05, 6), mat(0x7a5a2c));
        stem.rotation.z = Math.PI / 2; stem.position.copy(vec(A.add(P.c, [-P.hu - 0.02, 0, 0]))); g.add(stem);
      }
    }
    for (const s of body.spheres) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(s.r, 24, 16), mat(vis.seed ? 0x6b4a24 : baseColor, { side: THREE.FrontSide }));
      m.position.copy(vec(s.c)); m.castShadow = true; g.add(m);
    }
    for (const pm of body.points) {   // ballast
      const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.004, body.ext * 0.03), 12, 8), mat(0x2E3644, { side: THREE.FrontSide }));
      m.position.copy(vec(pm.p)); g.add(m);
    }
    // centre of mass marker
    const cg = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.003, body.ext * 0.02), 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    cg.material.color.set(T.accent); g.add(cg);
    return g;
  }

  function makeTufts(body) {
    const n = body.elemCount;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    lines.frustumCulled = false;
    return lines;
  }
  function makeTrail(color) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6000 * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    line.frustumCulled = false; line.userData.count = 0; return line;
  }

  // ------------------------------------------------------------------ staged (preview) body
  let staged = null;
  function restage() {
    if (staged) { scene.remove(staged.mesh); disposeGroup(staged.mesh); }
    const spec = currentSpec();
    const body = spec.kind === 'mesh' ? A.buildMeshBody(spec) : A.buildBody(spec);
    const mesh = makeMesh(body);
    scene.add(mesh);
    staged = { body, mesh, spec };
    placeStaged();
    refreshDesignStats();
    refreshModelStats();
    pole.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, state.height, 0)]);
    pole.computeLineDistances();
    updateBlurb();
  }
  function launchQuat(spec) {
    const L = spec.launch;
    const pitch = canFly() && (staged && staged.trim && staged.trim.alpha != null) ? state.angle : L.pitch;
    return A.qEuler(L.roll, pitch, 0);
  }
  function placeStaged() {
    if (!staged) return;
    const q = launchQuat(staged.spec);
    staged.mesh.position.set(0, state.height, 0);
    staged.mesh.quaternion.set(q[0], q[1], q[2], q[3]);
  }
  function disposeGroup(g) { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }

  // ------------------------------------------------------------------ drop
  function drop() {
    if (!staged) return;
    const spec = staged.spec, body = staged.body;
    const q = launchQuat(spec);
    body.pos = [0, state.height, 0];
    body.q = q;
    const trimV = staged.trim && staged.trim.V;
    const speed = canFly() ? (state.speed == null ? (trimV || spec.launch.speed) : state.speed) : spec.launch.speed;
    body.vel = A.qRot(q, [speed, 0, 0]);
    const s = spec.launch.spin || 0;
    body.omega = [s * (Math.random() - 0.5) * 2, s * (Math.random() - 0.5) * 2, s * (Math.random() - 0.5) * 2];
    body.t = 0; body.landed = false; body.launchedAt = simTime;
    body.noise = [A.makeNoise(Math.random() * 1e6 | 0), A.makeNoise(Math.random() * 1e6 | 0), A.makeNoise(Math.random() * 1e6 | 0)];
    body.out = { tufts: new Float32Array(body.elemCount * 6), stall: new Float32Array(body.elemCount) };
    const color = TRAIL_COLORS[colorIx++ % TRAIL_COLORS.length];
    const live = {
      body, mesh: staged.mesh, tufts: makeTufts(body), trail: makeTrail(color), color, name: spec.name, maxV: 0, launchHeight: state.height,
      arrows: [new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0x4FD1D9, 0.2, 0.1),
        new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xF79A3E, 0.2, 0.1),
        new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 1, 0xBBBBBB, 0.2, 0.1)],
    };
    live.arrows[0].setColor(new THREE.Color(T.cyan)); live.arrows[1].setColor(new THREE.Color(T.accent)); live.arrows[2].setColor(new THREE.Color(T.muted));
    live.arrows.forEach((a) => { a.visible = state.forces; scene.add(a); });
    scene.add(live.tufts); scene.add(live.trail);
    bodies.push(live);
    while (bodies.length > 6) removeBody(bodies.shift());
    staged = null;
    follow = live; state.follow = true;
    restage();
    toast(spec.name + (speed > 0 ? ' launched at ' + speed.toFixed(1) + ' m/s' : ' released'));
  }
  function removeBody(live) {
    scene.remove(live.mesh); scene.remove(live.tufts); scene.remove(live.trail); live.arrows.forEach((a) => scene.remove(a));
    disposeGroup(live.mesh); live.tufts.geometry.dispose(); live.trail.geometry.dispose();
    if (follow === live) follow = null;
  }
  function clearAll() { while (bodies.length) removeBody(bodies.pop()); flightLog.length = 0; renderLog(); }

  // ------------------------------------------------------------------ camera
  let follow = null;
  const sheetEl = $('#sheet');
  const cam = { theta: 0.9, phi: 1.05, dist: 1.4, target: new THREE.Vector3(0, state.height, 0) };
  function viewDist() { const s = (follow && follow.body.spec) || (staged && staged.spec); return s && s.viewDist || 1.4; }
  cam.dist = viewDist();
  function updateCamera(dt) {
    const src = state.follow && follow ? follow.body.pos : (staged ? [0, state.height, 0] : null);
    if (src) { const k = 1 - Math.exp(-dt * 8); cam.target.lerp(vec(src), k); }
    const d = cam.dist;
    camera.position.set(
      cam.target.x + d * Math.sin(cam.phi) * Math.cos(cam.theta),
      Math.max(0.03, cam.target.y + d * Math.cos(cam.phi)),
      cam.target.z + d * Math.sin(cam.phi) * Math.sin(cam.theta));
    camera.near = Math.max(0.005, d * 0.02); camera.far = 900; camera.updateProjectionMatrix();
    // on a phone the sheet covers the bottom of the canvas: aim below the target so it sits in the visible middle
    const sheetH = window.innerWidth < 900 ? sheetEl.getBoundingClientRect().height : 0;
    const dy = d * Math.tan(camera.fov * DEG / 2) * (sheetH / Math.max(1, canvas.clientHeight));
    camera.lookAt(cam.target.x, cam.target.y - dy, cam.target.z);
    // sun follows the target so the shadow stays sharp at every scale
    const r = Math.max(0.6, d * 2.2);
    sun.position.set(cam.target.x + r * 0.5, cam.target.y + r, cam.target.z + r * 0.35);
    sun.target.position.copy(cam.target);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -r; sun.shadow.camera.right = sun.shadow.camera.top = r;
    sun.shadow.camera.near = 0.05; sun.shadow.camera.far = r * 4; sun.shadow.camera.updateProjectionMatrix();
    gridFine.position.x = Math.round(cam.target.x); gridFine.position.z = Math.round(cam.target.z);
    gridFine.visible = d < 6;
  }
  // pointer orbit + pinch
  const ptrs = new Map(); let lastPinch = 0, lastTap = 0;
  canvas.addEventListener('pointerdown', (e) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId);
    const now = performance.now(); if (now - lastTap < 300 && ptrs.size === 1) { state.follow = !state.follow; toast(state.follow ? 'Following' : 'Free camera'); } lastTap = now; });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId);
    if (ptrs.size === 1) { cam.theta += (e.clientX - p.x) * 0.006; cam.phi = A.clamp(cam.phi - (e.clientY - p.y) * 0.005, 0.15, 1.52); }
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (lastPinch) cam.dist = A.clamp(cam.dist * (lastPinch / d), 0.08, 80); lastPinch = d; }
  });
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) lastPinch = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = A.clamp(cam.dist * Math.exp(e.deltaY * 0.0015), 0.08, 80); }, { passive: false });

  // ------------------------------------------------------------------ HUD
  const tele = $('#tele');
  const chipDefs = [['V', 'airspeed', 'm/s'], ['α', 'angle of attack', '°'], ['sink', 'sink rate', 'm/s'], ['L/D', 'glide ratio', ''], ['spin', 'spin', 'rev/s'], ['bank', 'bank', '°'], ['hdg', 'heading', '°'], ['alt', 'height', 'm'], ['dist', 'distance', 'm']];
  const chips = {};
  for (const [id, k, unit] of chipDefs) {
    const el = document.createElement('div'); el.className = 'chip'; el.innerHTML = `<div class="k">${k}</div><div class="v"><span>–</span><small>${unit}</small></div>`;
    tele.appendChild(el); chips[id] = el;
  }
  const setChip = (id, v) => { chips[id].querySelector('.v span').textContent = v; };
  let hudClock = 0;
  function updateHUD() {
    const live = follow;
    if (!live) { for (const id in chips) setChip(id, '–'); chips['α'].classList.remove('stall'); return; }
    const b = live.body;
    const tel = A.telemetry(b, wind, simTime);
    setChip('V', tel.V.toFixed(1)); setChip('α', tel.alpha.toFixed(0)); setChip('sink', tel.sink.toFixed(1));
    setChip('L/D', tel.glide ? tel.glide.toFixed(1) : '–'); setChip('spin', tel.spin.toFixed(1));
    setChip('bank', (tel.bank > 0 ? '+' : '') + tel.bank.toFixed(0)); setChip('hdg', (tel.heading > 0 ? '+' : '') + tel.heading.toFixed(0));
    setChip('alt', b.pos[1].toFixed(2)); setChip('dist', Math.hypot(b.pos[0], b.pos[2]).toFixed(1));
    const flyer = live.body.spec.kind !== 'object';
    chips['spin'].hidden = flyer; chips['bank'].hidden = !flyer; chips['hdg'].hidden = !flyer;
    chips['α'].classList.toggle('stall', Math.abs(tel.alpha) > 14 && tel.V > 0.5 && !b.landed);
  }
  const toastEl = $('#toast'); let toastTimer = 0;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800); }

  // ------------------------------------------------------------------ object chips
  const objectsEl = $('#objects');
  function buildChips() {
    objectsEl.innerHTML = '';
    const mk = (key, labelText) => {
      const b = document.createElement('button'); b.className = 'obj' + (key === state.selected ? ' on' : ''); b.textContent = labelText; b.setAttribute('role', 'tab');
      b.addEventListener('click', () => select(key)); objectsEl.appendChild(b);
    };
    for (const [k, o] of Object.entries(O.CATALOG)) mk(k, o.label);
    const sep = document.createElement('div'); sep.className = 'sep'; objectsEl.appendChild(sep);
    for (const [k, p] of Object.entries(O.GLIDER_PRESETS)) if (k !== 'custom') mk(k, p.label);
    const sep2 = document.createElement('div'); sep2.className = 'sep'; objectsEl.appendChild(sep2);
    for (const [k, e] of Object.entries(O.MESH_CATALOG)) mk(k, e.label);
    if (state.modelBase && state.model.name && state.uploadName) mk('upload', state.uploadName);
    const up = document.createElement('button'); up.className = 'obj upload'; up.textContent = 'Open STL / OBJ…'; up.addEventListener('click', () => fileInput.click()); objectsEl.appendChild(up);
  }
  const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = '.stl,.obj'; fileInput.hidden = true; document.body.appendChild(fileInput);
  function useUploadedMesh(mesh, name) {
    if (!mesh.indices.length) throw new Error('no triangles found');
    // sensible defaults: 20 cm long; foam-like solid (150 kg/m³) or paper-like shell (250 g/m²)
    const np = A.meshProps(A.normalizeMesh(mesh, 0.2, false));
    const massG = np.closed ? np.volume * 150 * 1000 : np.area * 0.25 * 1000;
    Object.assign(state.model, { size: 20, mass: Math.max(0.1, +massG.toPrecision(3)), ballast: 0, airfoil: 0.5, res: 0, zUp: false, name, color: 0xB7C4D6, launch: null, turbulence: 0 });
    state.modelBase = mesh; state.uploadBase = mesh; state.uploadName = name;
    buildChips(); select('upload');
    toast(`${name}: ${np.faces} triangles, ${np.closed ? 'closed solid' : 'open surface'}`);
  }
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0]; if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const mesh = /\.obj$/i.test(f.name) ? O.parseOBJ(new TextDecoder().decode(buf)) : O.parseSTL(buf);
      useUploadedMesh(mesh, f.name.replace(/\.(stl|obj)$/i, ''));
    } catch (e) { toast('Could not read that file: ' + e.message); }
    fileInput.value = '';
  });
  function select(key) {
    state.selected = key; state.speed = null;
    if (O.GLIDER_PRESETS[key]) { state.design = Object.assign({}, O.GLIDER_PRESETS[key]); syncDesignSliders(); }
    if (O.MESH_CATALOG[key]) {
      const e = O.MESH_CATALOG[key];
      state.modelBase = e.base();
      Object.assign(state.model, { size: e.size, mass: e.mass, ballast: e.ballast || 0, airfoil: e.airfoil, res: e.res, zUp: false, name: e.label, color: e.color, launch: e.launch, turbulence: e.turbulence || 0 });
    }
    if (key === 'upload') state.modelBase = state.uploadBase || state.modelBase;
    if (isMesh()) { state.uploadBase = key === 'upload' ? state.modelBase : state.uploadBase; syncModelSliders(); }
    $('#designPanel').style.display = isGlider() ? '' : 'none';
    $('#modelPanel').style.display = isMesh() ? '' : 'none';
    const label = sourceInfo().label;
    objectsEl.querySelectorAll('.obj').forEach((b) => b.classList.toggle('on', b.textContent === label));
    restage(); cam.dist = viewDist();
    if (!canFly() && state.height < 3) { state.height = 6; syncAir(); restage(); }
  }
  function sourceInfo() {
    if (state.selected === 'upload') return { label: state.uploadName || 'Your model', blurb: 'Your own model. Set its real size and mass; add nose ballast if it is meant to fly.' };
    return O.CATALOG[state.selected] || O.GLIDER_PRESETS[state.selected] || O.MESH_CATALOG[state.selected];
  }
  function updateBlurb() {
    const src = sourceInfo();
    const b = staged && staged.body;
    let s = `<b>${src.label}.</b> ${src.blurb}`;
    if (b) s += ` Mass ${(b.mass * 1000).toFixed(b.mass < 0.001 ? 2 : 1)} g.`;
    $('#blurb').innerHTML = s;
  }

  // ------------------------------------------------------------------ design sliders
  const designEl = $('#design');
  function buildDesign() {
    designEl.innerHTML = '';
    const presets = document.createElement('div'); presets.className = 'design-presets';
    for (const [k, p] of Object.entries(O.GLIDER_PRESETS)) { const b = document.createElement('button'); b.textContent = p.label; b.addEventListener('click', () => select(k)); presets.appendChild(b); }
    designEl.appendChild(presets);
    const flaps = document.createElement('div'); flaps.className = 'design-presets flaps';
    for (const [labelText, l, r] of [['Both up', 15, 15], ['Neutral', 0, 0], ['Both down', -15, -15], ['Roll left', 6, -6], ['Roll right', -6, 6]]) {
      const b = document.createElement('button'); b.textContent = labelText; b.dataset.l = l; b.dataset.r = r;
      b.addEventListener('click', () => { state.design.elevL = l; state.design.elevR = r; state.selected = customKey(); syncDesignSliders(); restage(); });
      flaps.appendChild(b);
    }
    designEl.appendChild(flaps);
    for (const P of O.GLIDER_PARAMS) {
      const w = document.createElement('div'); w.className = 'sl';
      w.innerHTML = `<label for="d_${P.key}">${P.label}</label><output id="o_${P.key}"></output><input type="range" id="d_${P.key}" min="${P.min}" max="${P.max}" step="${P.step}">`;
      designEl.appendChild(w);
      const inp = w.querySelector('input');
      inp.addEventListener('input', () => { state.design[P.key] = parseFloat(inp.value); state.selected = customKey(); w.querySelector('output').textContent = fmt(P, inp.value); restage(); });
    }
    syncDesignSliders();
  }
  const fmt = (P, v) => {
    if (P.key === 'elevL' || P.key === 'elevR') return +v === 0 ? 'neutral' : `${Math.abs(+v)}° ${+v > 0 ? 'up' : 'down'}`;
    return `${(+v).toFixed(P.step < 1 ? (P.step < 0.1 ? 2 : 1) : 0)} ${P.unit}`.trim();
  };
  function customKey() {   // editing a preset makes it a custom design that keeps the preset's look
    if (!O.GLIDER_PRESETS[state.selected]) return state.selected;
    const base = state.selected;
    O.GLIDER_PRESETS['custom'] = Object.assign({}, O.GLIDER_PRESETS[base], { label: 'Custom glider', blurb: 'Your own design. Tune it until the trim numbers look right, then drop it.' });
    return 'custom';
  }
  function syncDesignSliders() {
    document.querySelectorAll('.flaps button').forEach((b) => b.classList.toggle('on', +b.dataset.l === (state.design.elevL || 0) && +b.dataset.r === (state.design.elevR || 0)));
    for (const P of O.GLIDER_PARAMS) {
      const inp = document.getElementById('d_' + P.key); if (!inp) continue;
      const v = state.design[P.key] == null ? P.min : state.design[P.key];
      inp.value = v; document.getElementById('o_' + P.key).textContent = fmt(P, v);
    }
  }
  function refreshDesignStats() {
    const el = $('#designStats');
    if (!isGlider() || !staged) { el.textContent = ''; return; }
    const b = staged.body;
    const tr = A.trimAnalysis(b);
    staged.trim = tr;
    const sm = b.staticMargin == null ? null : b.staticMargin * 100;
    let s = `${(b.mass * 1000).toFixed(0)} g · SM ${sm == null ? '–' : sm.toFixed(0) + '%'}`;
    s += tr.alpha == null ? ' · no trim' : ` · trims at ${tr.alpha.toFixed(1)}° / ${tr.V.toFixed(1)} m/s · L/D ${tr.glide.toFixed(1)}`;
    el.textContent = s;
    el.className = 'stat ' + (tr.alpha == null || sm < 2 ? 'bad' : (sm > 5 && sm < 35 ? 'good' : ''));
    syncAir();
  }

  // ------------------------------------------------------------------ model (mesh) panel
  const modelEl = $('#model');
  const MODEL = [
    { key: 'size', label: 'Size (longest side)', unit: 'cm', min: 2, max: 200, step: 0.5 },
    { key: 'mass', label: 'Mass', unit: 'g', min: -1, max: 3.7, step: 0.02, log: true },
    { key: 'ballast', label: 'Nose ballast', unit: 'g', min: 0, max: 60, step: 0.5 },
    { key: 'airfoil', label: 'Surface (flat plate → airfoil)', unit: '', min: 0, max: 1, step: 0.05 },
    { key: 'res', label: 'Mesh resolution (subdivisions)', unit: '', min: 0, max: 3, step: 1 },
  ];
  let modelTimer = 0;
  function buildModel() {
    const row = document.createElement('div'); row.className = 'design-presets';
    row.innerHTML = '<button id="zup">File is Z-up</button><button id="wire" class="on">Wireframe</button>';
    modelEl.appendChild(row);
    row.querySelector('#zup').addEventListener('click', (e) => { state.model.zUp = !state.model.zUp; e.target.classList.toggle('on', state.model.zUp); restage(); });
    row.querySelector('#wire').addEventListener('click', (e) => { state.wire = !state.wire; e.target.classList.toggle('on', state.wire); scene.traverse((o) => { if (o.name === 'wire') o.visible = state.wire; }); });
    for (const P of MODEL) {
      const w = document.createElement('div'); w.className = 'sl';
      w.innerHTML = `<label for="m_${P.key}">${P.label}</label><output id="mo_${P.key}"></output><input type="range" id="m_${P.key}" min="${P.min}" max="${P.max}" step="${P.step}">`;
      modelEl.appendChild(w);
      const inp = w.querySelector('input');
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        state.model[P.key] = P.log ? +Math.pow(10, v).toPrecision(3) : v;
        w.querySelector('output').textContent = fmtModel(P, state.model[P.key]);
        clearTimeout(modelTimer); modelTimer = setTimeout(restage, P.key === 'res' ? 0 : 120);
      });
    }
    const stats = document.createElement('p'); stats.className = 'foot'; stats.id = 'modelInfo'; modelEl.appendChild(stats);
  }
  const fmtModel = (P, v) => P.key === 'res' ? `${v} (${v === 0 ? 'as built' : '×' + Math.pow(4, v) + ' faces'})` : `${(+v).toFixed(v < 10 ? 1 : 0)} ${P.unit}`.trim();
  function syncModelSliders() {
    for (const P of MODEL) {
      const inp = document.getElementById('m_' + P.key); if (!inp) continue;
      const v = state.model[P.key];
      inp.value = P.log ? Math.log10(Math.max(0.1, v)) : v;
      document.getElementById('mo_' + P.key).textContent = fmtModel(P, v);
    }
    const z = $('#zup'); if (z) z.classList.toggle('on', state.model.zUp);
  }
  function refreshModelStats() {
    if (!isMesh() || !staged) { $('#modelStats').textContent = ''; return; }
    const b = staged.body, M = b.mesh, pr = M.props;
    const tr = A.trimAnalysis(b); staged.trim = tr;
    const el = $('#modelStats');
    el.textContent = `${M.n} faces · ${M.closed ? 'solid' : 'shell'} · ` + (tr.alpha == null ? (tr.dive ? 'dives' : 'no glide') : `glides ${tr.glide.toFixed(1)} : 1 at ${tr.V.toFixed(1)} m/s`);
    el.className = 'stat ' + (tr.alpha == null ? '' : 'good');
    const info = $('#modelInfo');
    if (info) info.textContent = `${M.n} triangles in ${M.clusters.length} flat regions · ${M.closed ? 'closed solid' : 'open surface, both sides in the air'} · volume ${(pr.volume * 1e6).toFixed(pr.volume * 1e6 < 10 ? 2 : 0)} cm³ · surface ${(pr.area * 1e4).toFixed(0)} cm² · ${(b.mass * 1000).toFixed(1)} g` +
      (tr.alpha == null ? ' · no stable lifting trim: it will not glide as is (try nose ballast, or none).' : ` · trims at ${tr.alpha.toFixed(1)}° angle of attack, ${tr.V.toFixed(1)} m/s, lift/drag ${tr.glide.toFixed(1)}.`);
    syncAir();
  }

  // ------------------------------------------------------------------ air & launch sliders
  const airEl = $('#air');
  const AIR = [
    { key: 'height', label: 'Drop height', unit: 'm', min: 1, max: 40, step: 0.5 },
    { key: 'speed', label: 'Launch speed (if it can fly)', unit: 'm/s', min: 0, max: 14, step: 0.5, auto: true },
    { key: 'angle', label: 'Launch angle', unit: '°', min: -30, max: 40, step: 1 },
    { key: 'wind', label: 'Wind (+ = headwind)', unit: 'm/s', min: -6, max: 6, step: 0.5 },
    { key: 'gust', label: 'Gustiness', unit: '', min: 0, max: 1, step: 0.1 },
    { key: 'turb', label: 'Turbulence', unit: 'm/s', min: 0, max: 1, step: 0.1 },
  ];
  function buildAir() {
    for (const P of AIR) {
      const w = document.createElement('div'); w.className = 'sl';
      w.innerHTML = `<label for="a_${P.key}">${P.label}</label><output id="ao_${P.key}"></output><input type="range" id="a_${P.key}" min="${P.min}" max="${P.max}" step="${P.step}">`;
      airEl.appendChild(w);
      const inp = w.querySelector('input');
      inp.addEventListener('input', () => {
        state[P.key] = parseFloat(inp.value);
        if (P.key === 'height') { placeStaged(); pole.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, state.height, 0)]); pole.computeLineDistances(); }
        if (P.key === 'angle') placeStaged();
        syncAir();
      });
      inp.addEventListener('dblclick', () => { if (P.auto) { state.speed = null; syncAir(); } });
    }
    syncAir();
  }
  function syncAir() {
    for (const P of AIR) {
      const inp = document.getElementById('a_' + P.key); if (!inp) continue;
      let v = state[P.key];
      if (P.key === 'speed' && v == null) { v = staged && staged.trim && staged.trim.V ? staged.trim.V : 0; inp.value = v; document.getElementById('ao_' + P.key).textContent = canFly() && v > 0 ? v.toFixed(1) + ' m/s (trim)' : (canFly() ? '0 (no trim)' : '–'); continue; }
      inp.value = v; document.getElementById('ao_' + P.key).textContent = `${(+v).toFixed(P.step < 1 ? 1 : 0)} ${P.unit}`.trim();
    }
    const w = state.wind;
    $('#airStats').textContent = `${state.height} m · ${w === 0 ? 'calm' : Math.abs(w).toFixed(1) + ' m/s ' + (w > 0 ? 'headwind' : 'tailwind')}`;
  }

  // ------------------------------------------------------------------ flight log
  const flightLog = [];
  function onLand(live) {
    const b = live.body;
    const dist = Math.hypot(b.pos[0], b.pos[2]);
    const time = b.t;
    const h = state.height;
    const entry = { name: live.name, color: live.color, dist, time, glide: dist / Math.max(0.01, live.launchHeight || h), maxV: live.maxV };
    flightLog.unshift(entry); if (flightLog.length > 8) flightLog.pop();
    renderLog();
    live.tufts.visible = false;
    toast(`${live.name}: ${dist.toFixed(1)} m in ${time.toFixed(1)} s`);
  }
  function renderLog() {
    const el = $('#log');
    if (!flightLog.length) { el.innerHTML = '<span class="h" style="grid-column:1/-1">No landings yet.</span>'; $('#logStats').textContent = ''; return; }
    let h = '<span></span><span class="h">object</span><span class="h">dist</span><span class="h">time</span><span class="h">glide</span>';
    for (const e of flightLog) h += `<span class="sw" style="background:${e.color}"></span><span class="name">${e.name}</span><span>${e.dist.toFixed(1)} m</span><span>${e.time.toFixed(1)} s</span><span>${e.glide.toFixed(1)} : 1</span>`;
    el.innerHTML = h;
    const last = flightLog[0]; $('#logStats').textContent = `${last.name} · ${last.dist.toFixed(1)} m · ${last.glide.toFixed(1)} : 1`;
  }

  // ------------------------------------------------------------------ buttons
  $('#drop').addEventListener('click', drop);
  $('#reset').addEventListener('click', () => { clearAll(); toast('Cleared'); });
  const toggle = (id, key, onLabel) => { const b = $(id); b.addEventListener('click', () => { state[key] = !state[key]; b.classList.toggle('on', state[key]); b.setAttribute('aria-pressed', String(state[key])); if (onLabel) b.textContent = state[key] ? onLabel[1] : onLabel[0]; if (key === 'forces') bodies.forEach((l) => l.arrows.forEach((a) => a.visible = state.forces)); }); };
  toggle('#pause', 'paused', ['Pause', 'Resume']); toggle('#slow', 'slow'); toggle('#forces', 'forces');
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); drop(); } });

  // ------------------------------------------------------------------ main loop
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
  }
  const tmpV = new THREE.Vector3();
  function updateVisuals() {
    for (const live of bodies) {
      const b = live.body;
      live.mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
      live.mesh.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      // trail
      const tg = live.trail.geometry, pa = tg.attributes.position, n = live.trail.userData.count;
      if (n === 0 || tmpV.set(pa.getX(n - 1), pa.getY(n - 1), pa.getZ(n - 1)).distanceTo(live.mesh.position) > Math.max(0.004, b.ext * 0.08)) {
        if (n < 6000) { pa.setXYZ(n, b.pos[0], b.pos[1], b.pos[2]); live.trail.userData.count = n + 1; tg.setDrawRange(0, n + 1); pa.needsUpdate = true; }
      }
      // tufts
      if (b.out && state.tufts && !b.landed) {
        const tp = live.tufts.geometry.attributes.position, tc = live.tufts.geometry.attributes.color;
        const src = b.out.tufts, st = b.out.stall;
        const g = new THREE.Color(T.good), r = new THREE.Color(T.bad), c = new THREE.Color();
        for (let i = 0; i < b.elemCount; i++) {
          tp.setXYZ(i * 2, src[i * 6] + b.pos[0], src[i * 6 + 1] + b.pos[1], src[i * 6 + 2] + b.pos[2]);
          tp.setXYZ(i * 2 + 1, src[i * 6 + 3] + b.pos[0], src[i * 6 + 4] + b.pos[1], src[i * 6 + 5] + b.pos[2]);
          c.copy(g).lerp(r, st[i]);
          tc.setXYZ(i * 2, c.r, c.g, c.b); tc.setXYZ(i * 2 + 1, c.r, c.g, c.b);
        }
        tp.needsUpdate = true; tc.needsUpdate = true; live.tufts.visible = true;
      } else live.tufts.visible = false;
      // force arrows: lift ⟂ flow, drag ∥ flow, weight
      if (state.forces && b.forces && !b.landed) {
        const F = b.forces.F, va = b.forces.vair, V = A.len(va) || 1;
        const fd = A.scale(va, 1 / V);
        const par = A.scale(fd, A.dot(F, fd)), perp = A.sub(F, par);
        const W = b.mass * A.G, L = b.ext * 1.3;
        const setArrow = (ar, v) => { const m = A.len(v); ar.position.copy(live.mesh.position); if (m > 1e-6) { ar.setDirection(vec(A.scale(v, 1 / m))); ar.setLength(L * m / W, L * 0.18, L * 0.09); ar.visible = true; } else ar.visible = false; };
        setArrow(live.arrows[0], perp); setArrow(live.arrows[1], par); setArrow(live.arrows[2], [0, -W, 0]);
      } else live.arrows.forEach((a) => a.visible = false);
    }
  }
  let last = performance.now();
  function frame(now) {
    resize();
    const real = Math.min(0.05, (now - last) / 1000); last = now;
    const dt = state.paused ? 0 : real * (state.slow ? 0.25 : 1);
    if (dt > 0) {
      for (const live of bodies) {
        const b = live.body; if (b.landed) continue;
        A.step(b, dt, wind, simTime, b.out);
        const tel = A.telemetry(b, wind, simTime); live.maxV = Math.max(live.maxV, tel.V);
        if (b.landed) onLand(live);
      }
      simTime += dt;
    }
    if (staged) staged.mesh.position.y = state.height + 0.01 * Math.sin(now * 0.002) * Math.min(1, state.height * 0.3);
    updateVisuals();
    updateCamera(real);
    hudClock += real; if (hudClock > 0.1) { hudClock = 0; updateHUD(); }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ boot
  buildChips(); buildDesign(); buildModel(); buildAir(); renderLog();
  select('trainer');
  $('#designPanel').open = $('#modelPanel').open = window.innerWidth >= 900;
  requestAnimationFrame(frame);
  window.airfall = { state, cam, drop, select, clearAll, bodies, staged: () => staged, loadMesh: useUploadedMesh };
})();
