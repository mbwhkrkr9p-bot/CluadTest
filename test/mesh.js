const A = require('../src/aero.js'); const O = require('../src/objects.js');
const wind0 = () => [0,0,0];
function fly(spec, h, speed, tmax=30) {
  const b = A.buildMeshBody(spec); const L = spec.launch;
  b.pos=[0,h,0]; b.q=A.qEuler(L.roll,L.pitch,0); b.vel=A.qRot(b.q,[speed==null?L.speed:speed,0,0]); b.omega=[L.spin*0.7,L.spin*0.5,L.spin*0.3];
  let t=0, dt=1/60, spin=0, n=0, maxV=0, flips=0, lastUp=1;
  while(!b.landed && t<tmax){ A.step(b,dt,wind0,t); t+=dt; const tel=A.telemetry(b,wind0,t); spin+=tel.spin; n++; maxV=Math.max(maxV,tel.V); if(Math.sign(tel.up[1])!==Math.sign(lastUp)) flips++; lastUp=tel.up[1]; }
  return { b, t, dist: Math.hypot(b.pos[0],b.pos[2]), spin: spin/n, maxV, flips };
}
for (const [k, e] of Object.entries(O.MESH_CATALOG)) {
  for (const res of [0, 1, 2]) {
    const spec = O.meshSpec(e.base(), { size: e.size, mass: e.mass, res, airfoil: e.airfoil, ballast: e.ballast || 0, name: e.label, launch: e.launch });
    const b = A.buildMeshBody(spec);
    const tr = e.glider ? A.trimAnalysis(b) : null;
    const r = fly(spec, e.glider ? 3 : 10, e.glider && tr && tr.V ? tr.V : null);
    console.log(`${e.label.padEnd(18)} res${res} faces=${b.mesh.n} clusters=${b.mesh.clusters.length} closed=${b.mesh.closed} m=${(b.mass*1000).toFixed(1)}g` +
      (tr ? ` trim a=${tr.alpha==null?'none':tr.alpha.toFixed(1)} V=${tr.V?tr.V.toFixed(1):'-'} L/D=${tr.glide?tr.glide.toFixed(1):'-'}` : '') +
      ` | aloft ${r.t.toFixed(1)}s dist ${r.dist.toFixed(1)}m maxV ${r.maxV.toFixed(1)} spin ${r.spin.toFixed(2)} flips ${r.flips}`);
  }
}
