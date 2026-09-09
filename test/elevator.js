const A = require('../src/aero.js'); const O = require('../src/objects.js');
const wind0 = () => [0,0,0];
const base = O.GLIDER_PRESETS.trainer;
const neutral = A.trimAnalysis(A.buildBody(O.gliderSpec(base)));
console.log('trainer neutral trim: a=%s V=%s L/D=%s', neutral.alpha.toFixed(1), neutral.V.toFixed(2), neutral.glide.toFixed(1));
console.log('\nStatic: trim vs elevator deflection (+ = trailing edge up)');
for (const e of [-25, -15, -8, -4, 0, 4, 8, 12, 15, 20, 25]) {
  const b = A.buildBody(O.gliderSpec(Object.assign({}, base, { elevator: e })));
  const tr = A.trimAnalysis(b);
  // pitching moment at the neutral trim state, to show the flap's authority
  b.pos=[0,10,0]; b.q=A.qIdentity(); b.omega=[0,0,0]; b.vel=[neutral.V*Math.cos(neutral.alpha*A.DEG), -neutral.V*Math.sin(neutral.alpha*A.DEG), 0];
  const r = A.aeroForces(b, wind0, 0);
  console.log(`  e=${String(e).padStart(3)}°  Mz at neutral trim state=${(r.T[2]*1000).toFixed(2).padStart(6)} mN·m  → trim ${tr.alpha==null?(tr.dive?'DIVE (no lifting trim)':'NONE'):`a=${tr.alpha.toFixed(1)}°  V=${tr.V.toFixed(2)} m/s  L/D=${tr.glide.toFixed(1)}`}`);
}
console.log('\nDynamic: launched level at the neutral trim speed from 3 m');
for (const e of [15, 0, -15]) {
  const b = A.buildBody(O.gliderSpec(Object.assign({}, base, { elevator: e })));
  b.pos=[0,3,0]; b.q=A.qIdentity(); b.vel=[neutral.V,0,0]; b.omega=[0,0,0];
  let t=0, dt=1/120, maxAlt=3, maxA=-99, minV=99, maxV=0, rows=[];
  while(!b.landed && t<40){ A.step(b,dt,wind0,t); t+=dt; const tel=A.telemetry(b,wind0,t); maxAlt=Math.max(maxAlt,b.pos[1]); maxA=Math.max(maxA,tel.alpha); minV=Math.min(minV,tel.V); maxV=Math.max(maxV,tel.V);
    if (Math.round(t*120)%60===0 && rows.length<8) rows.push(`t${t.toFixed(1)} x${b.pos[0].toFixed(1)} y${b.pos[1].toFixed(2)} V${tel.V.toFixed(1)} a${tel.alpha.toFixed(0)}° pitch${(Math.asin(tel.fwd[1])/A.DEG).toFixed(0)}°`); }
  console.log(`  e=${String(e).padStart(3)}°: flew ${b.pos[0].toFixed(1)} m in ${t.toFixed(1)} s (glide ${(b.pos[0]/3).toFixed(1)}), peak altitude ${maxAlt.toFixed(2)} m, α range up to ${maxA.toFixed(0)}°, speed ${minV.toFixed(1)}–${maxV.toFixed(1)} m/s`);
  console.log('     ' + rows.join(' | '));
}
