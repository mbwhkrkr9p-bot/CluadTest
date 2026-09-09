const A = require('../src/aero.js'); const O = require('../src/objects.js');
const wind0=()=>[0,0,0];
for (const rho of [0.08, 0.15, 0.31, 0.6, 1.2]) for (const spin0 of [0.3, 3]) {
  const spec = O.CATALOG.card.make(); spec.panels[0].rho = rho; spec.turbulence = 0;
  const b = A.buildBody(spec); b.pos=[0,20,0]; b.q=A.qEuler(0,15,0); b.vel=[0,0,0]; b.omega=[0,0,spin0*6.28];
  let t=0, dt=1/120, spinSum=0, n=0, flips=0, lastUp=1, Vsum=0;
  while(!b.landed && t<40){ A.step(b,dt,wind0,t); t+=dt; const tel=A.telemetry(b,wind0,t); if(t>3){spinSum+=tel.spin; n++; Vsum+=tel.V; if(Math.sign(tel.up[1])!==Math.sign(lastUp)) flips++; lastUp=tel.up[1];} }
  console.log(`rho=${rho} spin0=${spin0}: meanSpin ${(spinSum/n).toFixed(2)} rev/s  flips ${flips}  V ${(Vsum/n).toFixed(2)}  aloft ${t.toFixed(1)}s  drift ${Math.hypot(b.pos[0],b.pos[2]).toFixed(1)}m`);
}
