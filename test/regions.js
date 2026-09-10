const A = require('../src/aero.js'); const O = require('../src/objects.js'); require('../src/foam.js');
function report(label, b) {
  const M = b.mesh;
  const rows = M.clusters.map((C, i) => ({ i, kind: C.kind, n: C.faces.length, area: C.area, ny: C.ny, nx: C.nx, nz: C.nz })).sort((a, b) => b.area - a.area);
  const plate = rows.filter(r => r.kind === 0), bluff = rows.filter(r => r.kind === 1);
  console.log(`${label}: ${M.nFacets} facets → ${M.n} elements (${M.paired} paired), ${M.clusters.length} regions: ${plate.length} plate (area ${(M.plateArea*1e4).toFixed(0)} cm²), body area ${(M.bodyArea*1e4).toFixed(0)} cm², ${bluff.length} bluff (area ${(M.bluffArea*1e4).toFixed(0)} cm²)`);
  console.log('   biggest plate regions: ' + plate.slice(0, 8).map(r => `#${r.i} ${r.n}el ${(r.area*1e4).toFixed(0)}cm² n=(${r.nx.toFixed(2)},${r.ny.toFixed(2)},${r.nz.toFixed(2)})`).join(' | '));
  console.log('   biggest bluff regions: ' + bluff.slice(0, 5).map(r => `#${r.i} ${r.n}el ${(r.area*1e4).toFixed(0)}cm² n=(${r.nx.toFixed(2)},${r.ny.toFixed(2)},${r.nz.toFixed(2)})`).join(' | '));
  const small = plate.filter(r => r.n <= 3).length; console.log(`   plate regions with ≤3 elements: ${small}`);
}
const e = O.MESH_CATALOG.foam;
report('foam L0', A.buildMeshBody(O.meshSpec(e.base(0), { size: 60, mass: 30, res: 0, airfoil: 0.85, ballast: 6, noSubdivide: true })));
const g = O.MESH_CATALOG.mglider;
report('trainer res0', A.buildMeshBody(O.meshSpec(g.base(), { size: 50, mass: 18, res: 0, airfoil: 0.85, ballast: 6 })));
report('trainer res2', A.buildMeshBody(O.meshSpec(g.base(), { size: 50, mass: 18, res: 2, airfoil: 0.85, ballast: 6 })));
report('sphere', A.buildMeshBody(O.meshSpec(O.MESH_CATALOG.msphere.base(), { size: 30, mass: 65, res: 0 })));
// why are big trainer facets unpaired?
{
  const b = A.buildMeshBody(O.meshSpec(g.base(), { size: 50, mass: 18, res: 0, airfoil: 0.85, ballast: 6 }));
  const M = b.mesh; const P = b.spec.mesh.positions;
  const un = []; for (let e = 0; e < M.n; e++) if (M.kind[e] === 1 && M.area[e] > 1e-3) un.push(e);
  console.log('trainer unpaired facets > 10 cm²:', un.length);
  for (const e of un.slice(0, 4)) console.log(`   el ${e} c=(${M.cx[e].toFixed(3)},${M.cy[e].toFixed(3)},${M.cz[e].toFixed(3)}) n=(${M.nx[e].toFixed(2)},${M.ny[e].toFixed(2)},${M.nz[e].toFixed(2)}) area ${(M.area[e]*1e4).toFixed(1)} ext ${b.ext.toFixed(3)} T ${(0.2*b.ext).toFixed(3)}`);
}
