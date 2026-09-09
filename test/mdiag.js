const A = require('../src/aero.js'); const O = require('../src/objects.js');
const wind0=()=>[0,0,0];
function trace(b, label) {
  b.pos=[0,25,0]; b.q=A.qEuler(0,60,0); b.vel=[0,0,0]; b.omega=[0,0,0];
  let t=0, dt=1/120, rows=[];
  while(!b.landed && t<3){ A.step(b,dt,wind0,t); t+=dt; if (Math.round(t*120)%24===0) { const tel=A.telemetry(b,wind0,t); rows.push(`t${t.toFixed(1)} V${tel.V.toFixed(1)} up${tel.up[1].toFixed(2)} ω[${b.omega.map(v=>v.toFixed(1)).join(',')}] vx${b.vel[0].toFixed(1)} vy${b.vel[1].toFixed(1)}`);} }
  console.log(label); console.log('  '+rows.join('\n  '));
}
const spec = O.CATALOG.card.make(); spec.turbulence = 0; trace(A.buildBody(spec), 'panel card');
const e = O.MESH_CATALOG.mcard; trace(A.buildMeshBody(O.meshSpec(e.base(), { size: 8.9, mass: 1.77, res: 0, airfoil: 0 })), 'mesh card');
// static comparison: forces & torque at fixed states
for (const [label, b] of [['panel', A.buildBody(O.CATALOG.card.make())], ['mesh', A.buildMeshBody(O.meshSpec(e.base(), { size: 8.9, mass: 1.77, res: 0, airfoil: 0 }))]]) {
  b.pos=[0,10,0]; b.q=A.qEuler(0,0,0); 
  for (const a of [10, 45, 80]) { b.vel=[3*Math.cos(a*A.DEG), -3*Math.sin(a*A.DEG), 0]; b.omega=[0,0,0]; const r=A.aeroForces(b,wind0,0); console.log(`${label} a=${a}: F=[${r.F.map(v=>v.toFixed(4))}] T=[${r.T.map(v=>(v*1000).toFixed(3))}] mN·m`); }
  b.vel=[0,-3,0]; b.omega=[0,0,10]; const r=A.aeroForces(b,wind0,0); console.log(`${label} broadside spinning z 10rad/s: F=[${r.F.map(v=>v.toFixed(4))}] T=[${r.T.map(v=>(v*1000).toFixed(3))}]`);
  b.omega=[0,10,0]; const r2=A.aeroForces(b,wind0,0); console.log(`${label} broadside spinning y 10rad/s: F=[${r2.F.map(v=>v.toFixed(4))}] T=[${r2.T.map(v=>(v*1000).toFixed(3))}]`);
  b.omega=[10,0,0]; const r3=A.aeroForces(b,wind0,0); console.log(`${label} broadside spinning x 10rad/s: F=[${r3.F.map(v=>v.toFixed(4))}] T=[${r3.T.map(v=>(v*1000).toFixed(3))}]`);
}
