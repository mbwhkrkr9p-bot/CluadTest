const A = require('../src/aero.js');
const O = require('../src/objects.js');
const wind0 = () => [0, 0, 0];

function run(spec, { h = 10, speed = null, dt = 1 / 60, tmax = 30, wind = wind0, label } = {}) {
  const b = A.buildBody(spec);
  const L = spec.launch;
  b.pos = [0, h, 0];
  b.q = A.qEuler(L.roll, L.pitch, 0);
  const s = speed == null ? L.speed : speed;
  b.vel = A.qRot(b.q, [s, 0, 0]);
  b.omega = [L.spin * 0.7, L.spin * 0.5, L.spin * 0.3];
  let t = 0, maxV = 0, spinSum = 0, n = 0, alphaHist = [], ups = [], vy = [];
  const samples = [];
  while (!b.landed && t < tmax) {
    A.step(b, dt, wind, t);
    t += dt;
    const tel = A.telemetry(b, wind, t);
    maxV = Math.max(maxV, tel.V); spinSum += tel.spin; n++;
    if (n % 30 === 0) samples.push({ t: t.toFixed(1), y: b.pos[1].toFixed(2), x: b.pos[0].toFixed(2), V: tel.V.toFixed(2), a: tel.alpha.toFixed(0), spin: tel.spin.toFixed(1), upY: tel.up[1].toFixed(2), gl: tel.glide ? tel.glide.toFixed(1) : '-' });
    ups.push(tel.up[1]); vy.push(b.vel[1]);
  }
  const dist = Math.hypot(b.pos[0], b.pos[2]);
  const upMean = ups.reduce((a, c) => a + c, 0) / ups.length;
  const upVar = Math.sqrt(ups.reduce((a, c) => a + (c - upMean) ** 2, 0) / ups.length);
  console.log(`\n== ${label || spec.name}  mass=${(b.mass*1000).toFixed(2)}g  SM=${b.staticMargin==null?'-':(b.staticMargin*100).toFixed(0)+'%'}`);
  console.log(`  aloft ${t.toFixed(2)}s  dist ${dist.toFixed(2)}m  maxV ${maxV.toFixed(2)}  meanSpin ${(spinSum/n).toFixed(2)}rev/s  up.y mean ${upMean.toFixed(2)} sd ${upVar.toFixed(2)}  glide ${(dist/h).toFixed(2)}`);
  return { b, samples, t, dist };
}
const which = process.argv[2];
for (const [k, o] of Object.entries(O.CATALOG)) {
  if (which && which !== k) continue;
  const r = run(o.make(), { h: 10 });
  console.log('  ' + r.samples.slice(0, 12).map(s => `t${s.t} y${s.y} V${s.V} a${s.a} sp${s.spin} up${s.upY}`).join('\n  '));
}
for (const [k, p] of Object.entries(O.GLIDER_PRESETS)) {
  if (which && which !== k) continue;
  const r = run(O.gliderSpec(p, p.label), { h: 3, tmax: 60 });
  console.log('  ' + r.samples.slice(0, 14).map(s => `t${s.t} x${s.x} y${s.y} V${s.V} a${s.a} up${s.upY} gl${s.gl}`).join('\n  '));
}
