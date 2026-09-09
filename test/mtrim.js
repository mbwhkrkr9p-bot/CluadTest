const A = require('../src/aero.js'); const O = require('../src/objects.js');
const wind0=()=>[0,0,0];
const e = O.MESH_CATALOG.mglider;
const b = A.buildMeshBody(O.meshSpec(e.base(), { size: 50, mass: 25, res: 0, airfoil: 0.85 }));
const pp = A.buildBody(O.gliderSpec(Object.assign({}, O.GLIDER_PRESETS.trainer, { incidence: 2.5, tailInc: 0.5, camber: 0 })));
console.log('mesh com', b.com.map(v=>v.toFixed(4)), ' panel com', pp.com.map(v=>v.toFixed(4)));
for (const [label, body] of [['panel', pp], ['mesh', b]]) {
  console.log(label);
  for (const a of [0, 4, 8, 12]) { body.pos=[0,10,0]; body.q=A.qIdentity(); body.omega=[0,0,0]; body.vel=[4*Math.cos(a*A.DEG), -4*Math.sin(a*A.DEG), 0]; const r=A.aeroForces(body,wind0,0); console.log(`  a=${a} L=${r.lift.toFixed(3)} D=${r.drag.toFixed(3)} Fy=${r.F[1].toFixed(3)} Mz=${(r.T[2]*1000).toFixed(2)} mN·m`); }
}
// per-cluster breakdown for the mesh at a=4
b.vel=[4*Math.cos(4*A.DEG), -4*Math.sin(4*A.DEG), 0];
const M = b.mesh; const all = M.clusters;
const groups = [];
for (const C of all) { const keep = [C]; M.clusters = keep; const r = A.aeroForces(b, wind0, 0); groups.push({ c: [C.cx, C.cy, C.cz].map(v=>v.toFixed(3)), n: [C.nx,C.ny,C.nz].map(v=>v.toFixed(2)), area: C.area, Fy: r.F[1], Fx: r.F[0], Mz: r.T[2]*1000 }); }
M.clusters = all;
