const A = require('../src/aero.js'); const O = require('../src/objects.js');
const wind0=()=>[0,0,0];
for (const [key, e] of [['mglider', O.MESH_CATALOG.mglider], ['mdart', O.MESH_CATALOG.mdart]]) for (const ballast of [0, 2, 4, 6, 8, 12]) {
  const b = A.buildMeshBody(O.meshSpec(e.base(), { size: e.size, mass: e.mass, res: 0, airfoil: e.airfoil, ballast }));
  const tr = A.trimAnalysis(b);
  b.pos=[0,3,0]; b.q=A.qIdentity(); b.vel=[tr.V||5,0,0]; b.omega=[0,0,0]; let t=0; while(!b.landed&&t<30){A.step(b,1/60,wind0,t); t+=1/60;}
  console.log(`${key} ballast ${ballast}g: m=${(b.mass*1000).toFixed(1)} trim a=${tr.alpha==null?'none':tr.alpha.toFixed(1)} V=${tr.V?tr.V.toFixed(1):'-'} L/D=${tr.glide?tr.glide.toFixed(1):'-'}  flew ${b.pos[0].toFixed(1)} m in ${t.toFixed(1)} s (glide ${(b.pos[0]/3).toFixed(1)})`);
}
