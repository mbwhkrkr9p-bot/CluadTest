const A = require('../src/aero.js'); const O = require('../src/objects.js');
const wind0=()=>[0,0,0];
function run(b, label) {
  b.pos=[0,25,0]; b.q=A.qEuler(0,60,0); b.vel=[0,0,0]; b.omega=[0,0,0.5];
  let t=0, dt=1/120, spinSum=0, n=0, flips=0, lastUp=1, Vsum=0, tiltSum=0, reversals=0, lastVx=0;
  while(!b.landed && t<40){ A.step(b,dt,wind0,t); t+=dt; const tel=A.telemetry(b,wind0,t); if(t>4){spinSum+=tel.spin; n++; Vsum+=tel.V; tiltSum+=Math.acos(Math.abs(tel.up[1]))/A.DEG; if(Math.sign(tel.up[1])!==Math.sign(lastUp)) flips++; lastUp=tel.up[1]; if (Math.sign(b.vel[0])!==Math.sign(lastVx) && Math.abs(b.vel[0])>0.05) reversals++; if(Math.abs(b.vel[0])>0.05) lastVx=b.vel[0];} }
  console.log(`${label.padEnd(22)} spin ${(spinSum/n).toFixed(2)} rev/s  flips ${flips}  vx reversals ${reversals}  meanTilt ${(tiltSum/n).toFixed(0)}°  V ${(Vsum/n).toFixed(2)}  aloft ${t.toFixed(1)}s  drift ${Math.hypot(b.pos[0],b.pos[2]).toFixed(1)}m`);
}
for (const rho of [0.08, 0.31, 1.2]) {
  const spec = O.CATALOG.card.make(); spec.panels[0].rho = rho; spec.turbulence = 0;
  run(A.buildBody(spec), `panel card ρ=${rho}`);
  const e = O.MESH_CATALOG.mcard;
  for (const res of [0, 1]) {
    const ms = O.meshSpec(e.base(), { size: 8.9, mass: rho * 0.089 * 0.064 * 1000, res, airfoil: 0 });
    run(A.buildMeshBody(ms), `mesh card ρ=${rho} res${res}`);
  }
}
