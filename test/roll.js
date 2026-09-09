const A = require('../src/aero.js'); const O = require('../src/objects.js');
const wind0 = () => [0,0,0];
const base = O.GLIDER_PRESETS.trainer;
const neutral = A.trimAnalysis(A.buildBody(O.gliderSpec(base)));
console.log('Static moments at the neutral trim state (V=%s, a=%s°):', neutral.V.toFixed(2), neutral.alpha.toFixed(1));
for (const [l, r] of [[0, 0], [10, 10], [10, -10], [-10, 10], [12, 0], [0, 12]]) {
  const b = A.buildBody(O.gliderSpec(Object.assign({}, base, { elevL: l, elevR: r })));
  b.pos=[0,10,0]; b.q=A.qIdentity(); b.omega=[0,0,0]; b.vel=[neutral.V*Math.cos(neutral.alpha*A.DEG), -neutral.V*Math.sin(neutral.alpha*A.DEG), 0];
  const r0 = A.aeroForces(b, wind0, 0);
  console.log(`  L=${String(l).padStart(3)}° R=${String(r).padStart(3)}°  roll Mx=${(r0.T[0]*1000).toFixed(2).padStart(6)}  yaw My=${(r0.T[1]*1000).toFixed(2).padStart(6)}  pitch Mz=${(r0.T[2]*1000).toFixed(2).padStart(6)} mN·m`);
}
console.log('\nDynamic: launched level at trim speed from 6 m');
for (const [label, l, r] of [['neutral', 0, 0], ['roll left (L up, R down)', 6, -6], ['roll right (L down, R up)', -6, 6], ['left half up only', 12, 0]]) {
  const b = A.buildBody(O.gliderSpec(Object.assign({}, base, { elevL: l, elevR: r })));
  b.pos=[0,6,0]; b.q=A.qIdentity(); b.vel=[neutral.V,0,0]; b.omega=[0,0,0];
  let t=0, dt=1/120, rows=[], maxBank=0;
  while(!b.landed && t<40){ A.step(b,dt,wind0,t); t+=dt; const tel=A.telemetry(b,wind0,t); if (Math.abs(tel.bank)>Math.abs(maxBank)) maxBank=tel.bank;
    if (Math.round(t*120)%120===0 && rows.length<6) rows.push(`t${t.toFixed(0)}s bank${tel.bank.toFixed(0)}° hdg${tel.heading.toFixed(0)}° z${b.pos[2].toFixed(1)}m`); }
  console.log(`  ${label.padEnd(26)} landed x=${b.pos[0].toFixed(1)} z=${b.pos[2].toFixed(1)} m after ${t.toFixed(1)} s, peak bank ${maxBank.toFixed(0)}°  | ${rows.join(' | ')}`);
}
