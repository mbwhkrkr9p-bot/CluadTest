const A = require('../src/aero.js'); const O = require('../src/objects.js');
const wind0 = () => [0,0,0];
const key = process.argv[2] || 'trainer';
const p = O.GLIDER_PRESETS[key];
const b = A.buildBody(O.gliderSpec(p, key));
console.log('mass', (b.mass*1000).toFixed(1), 'SM', (b.staticMargin*100).toFixed(0)+'%', 'np', b.np.toFixed(3), 'chord', b.meanChord.toFixed(3), 'nose at', b.points[0].p[0].toFixed(3));
// static pitch curve: body level, flying at V=6 with flight path angle such that alpha = a
console.log('static pitch moment vs alpha (V=6, level attitude, no rotation):');
for (const a of [-4,-2,0,2,4,6,8,10,12,15,20]) {
  b.q = A.qIdentity(); b.pos=[0,10,0]; b.omega=[0,0,0];
  const V=6; b.vel=[V*Math.cos(a*A.DEG), -V*Math.sin(a*A.DEG), 0];
  const r = A.aeroForces(b, wind0, 0);
  console.log(`  a=${a}  L=${r.lift.toFixed(3)} D=${r.drag.toFixed(3)} Fy=${r.F[1].toFixed(3)} Mz=${r.T[2].toFixed(5)} Mx=${r.T[0].toFixed(5)} My=${r.T[1].toFixed(5)}  W=${(b.mass*9.81).toFixed(3)}`);
}
// per-panel contribution at alpha=4
b.q = A.qIdentity(); b.vel=[6*Math.cos(4*A.DEG), -6*Math.sin(4*A.DEG), 0];
const byPanel = {};
const saveSubs = b.subs;
for (const s of saveSubs) { const nm = b.panels[s.panel].name.replace(/[RL]?\d+$/,''); byPanel[nm] = byPanel[nm]||[]; byPanel[nm].push(s); }
for (const [nm, subs] of Object.entries(byPanel)) { b.subs = subs; const r = A.aeroForces(b, wind0, 0); console.log(`  ${nm}: Fy=${r.F[1].toFixed(4)} Fx=${r.F[0].toFixed(4)} Mz=${r.T[2].toFixed(5)} x=${subs.reduce((a,s)=>a+s.p[0],0)/subs.length}`); }
b.subs = saveSubs;
// time trace
b.q = A.qEuler(0, 2, 0); b.pos=[0,3,0]; b.vel = A.qRot(b.q,[5,0,0]); b.omega=[0,0,0]; b.landed=false; b.t=0;
let t=0; const dt=1/60;
while(!b.landed && t<6){ A.step(b,dt,wind0,t); t+=dt; if (Math.round(t*60)%6===0){ const tel=A.telemetry(b,wind0,t); const fwd=tel.fwd, up=tel.up; const pitch=Math.asin(fwd[1])/A.DEG, roll=Math.atan2(-up[2], up[1])/A.DEG; console.log(`t${t.toFixed(1)} x${b.pos[0].toFixed(2)} y${b.pos[1].toFixed(2)} V${tel.V.toFixed(2)} a${tel.alpha.toFixed(1)} b${tel.beta.toFixed(1)} pitch${pitch.toFixed(0)} roll${roll.toFixed(0)} w[${b.omega.map(v=>v.toFixed(1))}] gl${tel.glide?tel.glide.toFixed(1):'-'}`);} }
