const A = require('../src/aero.js'); const O = require('../src/objects.js'); require('../src/foam.js');
const wind0 = () => [0,0,0];
function show(label, b, a = 4) {
  const M = b.mesh;
  b.pos=[0,10,0]; b.q=A.qIdentity(); b.omega=[0,0,0]; b.vel=[5*Math.cos(a*A.DEG), -5*Math.sin(a*A.DEG), 0];
  const out = { elemF: new Float64Array(M.n * 3) };
  const r = A.aeroForces(b, wind0, 0, out);
  const fdx = Math.cos(a*A.DEG), fdy = -Math.sin(a*A.DEG);  // flight direction; lift ⟂, drag ∥ (air flows opposite)
  const per = M.clusters.map(() => ({ L: 0, D: 0 }));
  for (let e = 0; e < M.n; e++) { const fx = out.elemF[e*3], fy = out.elemF[e*3+1]; const d = -(fx*fdx + fy*fdy), l = fx*(-fdy) + fy*fdx; per[M.cluster[e]].L += l; per[M.cluster[e]].D += d; }
  let bl = { L: 0, D: 0 }; M.clusters.forEach((C, i) => { if (C.kind === 1) { bl.L += per[i].L; bl.D += per[i].D; } });
  console.log(`${label} α=${a}: total L=${r.lift.toFixed(3)} D=${r.drag.toFixed(3)} | bluff elements: L ${bl.L.toFixed(3)} D ${bl.D.toFixed(3)}`);
  const rows = M.clusters.map((C, i) => ({ i, C })).filter(x => x.C.kind === 0).sort((x, y) => y.C.area - x.C.area).slice(0, 5);
  for (const { i, C } of rows) {
    const chords = Array.from(C.faces).map(f => M.stmax[f] - M.stmin[f]);
    console.log(`   region ${i}: ${C.faces.length} el, area ${(C.area*1e4).toFixed(0)} cm², centre (${C.cx.toFixed(3)},${C.cy.toFixed(3)},${C.cz.toFixed(3)}) n=(${C.nx.toFixed(2)},${C.ny.toFixed(2)},${C.nz.toFixed(2)}) strip chords ${(Math.min(...chords)*100).toFixed(1)}–${(Math.max(...chords)*100).toFixed(1)} cm, AR ${M.AR[i].toFixed(2)}, α0 ${(Math.asin(M.sinA0[i])/A.DEG).toFixed(1)}°, cm0 ${M.cm0[i].toFixed(3)} | L ${per[i].L.toFixed(3)} D ${per[i].D.toFixed(3)}`);
  }
}
const e = O.MESH_CATALOG.foam;
show('foam L0', A.buildMeshBody(O.meshSpec(e.base(0), { size: 60, mass: 30, res: 0, airfoil: 0.85, ballast: 6, noSubdivide: true })));
const g = O.MESH_CATALOG.mglider;
show('trainer res0', A.buildMeshBody(O.meshSpec(g.base(), { size: 50, mass: 18, res: 0, airfoil: 0.85, ballast: 6 })));
show('trainer res1', A.buildMeshBody(O.meshSpec(g.base(), { size: 50, mass: 18, res: 1, airfoil: 0.85, ballast: 6 })));
