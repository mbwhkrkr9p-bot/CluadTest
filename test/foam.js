const A = require('../src/aero.js'); const O = require('../src/objects.js'); require('../src/foam.js');
const wind0 = () => [0,0,0];
const e = O.MESH_CATALOG.foam;
for (const level of [0, 1, 2]) {
  let t0 = Date.now();
  const base = e.base(level);
  const tBuild = Date.now() - t0;
  const spec = O.meshSpec(base, { size: e.size, mass: e.mass, res: 0, airfoil: e.airfoil, ballast: e.ballast, noSubdivide: true, launch: e.launch });
  const b = A.buildMeshBody(spec);
  const pr = b.mesh.props;
  console.log(`level ${level}: grid ${base.grid.nx}×${base.grid.ny}×${base.grid.nz} built in ${tBuild} ms → ${b.mesh.n} triangles, ${b.mesh.clusters.length} regions, closed=${b.mesh.closed} (boundary edges ${pr.boundaryEdges}), volume ${(pr.volume*1e6).toFixed(0)} cm³ (foam at 30 kg/m³ = ${(pr.volume*30*1000).toFixed(1)} g), area ${(pr.area*1e4).toFixed(0)} cm², com x=${b.com[0].toFixed(3)}`);
  t0 = Date.now(); b.pos=[0,10,0]; b.vel=[5,0,0]; for (let i=0;i<60;i++) A.step(b,1/60,wind0,i/60); console.log(`   physics: ${((Date.now()-t0)/60).toFixed(1)} ms per 60 Hz frame`);
  if (level === 0) {
    for (const ballast of [0, 3, 6, 9, 12]) {
      const bb = A.buildMeshBody(O.meshSpec(base, { size: e.size, mass: e.mass, res: 0, airfoil: e.airfoil, ballast, noSubdivide: true }));
      const tr = A.trimAnalysis(bb);
      bb.pos=[0,3,0]; bb.q=A.qIdentity(); bb.vel=[tr.V||6,0,0]; bb.omega=[0,0,0]; let t=0; while(!bb.landed&&t<30){A.step(bb,1/60,wind0,t); t+=1/60;}
      console.log(`   ballast ${ballast} g (total ${(bb.mass*1000).toFixed(1)} g): trim ${tr.alpha==null?(tr.dive?'dive':'none'):tr.alpha.toFixed(1)+'° at '+tr.V.toFixed(1)+' m/s, L/D '+tr.glide.toFixed(1)} → flew ${bb.pos[0].toFixed(1)} m in ${t.toFixed(1)} s`);
    }
  }
}
