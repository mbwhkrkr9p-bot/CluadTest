const A = require('../src/aero.js'); const O = require('../src/objects.js'); require('../src/foam.js');
const wind0 = () => [0,0,0];
const e = O.MESH_CATALOG.foam;
const base = e.base(0);
const b = A.buildMeshBody(O.meshSpec(base, { size: 60, mass: 30, res: 0, airfoil: 0.85, ballast: 6, noSubdivide: true }));
const M = b.mesh;
console.log('com (mesh frame)', b.com.map(v => v.toFixed(3)), 'mass', (b.mass*1000).toFixed(1));
// classify regions by position: wing (large plate near x≈+0.05), tail (plate x<-0.15), fin (vertical), bluff
const groups = { wing: [], tail: [], fin: [], fuse: [], bluff: [] };
M.clusters.forEach((C, i) => { if (C.kind === 1) groups.bluff.push(i); else if (Math.abs(C.nz) > 0.7) groups.fin.push(i); else if (C.cx < -0.12) groups.tail.push(i); else if (Math.abs(C.cz) < 0.03 && C.area < 0.003) groups.fuse.push(i); else groups.wing.push(i); });
for (const g in groups) console.log(`  ${g}: ${groups[g].length} regions, area ${(groups[g].reduce((a,i)=>a+M.clusters[i].area,0)*1e4).toFixed(0)} cm²`);
const all = M.clusters;
function forcesOf(ids, a, V=5) {
  M.clusters = ids.map(i => all[i]);
  // elements not in these regions still get computed in pass 2... so mask by zeroing their area temporarily
  const keep = new Set(); ids.forEach(i => all[i].faces.forEach(f => keep.add(f)));
  const saved = Float64Array.from(M.area); for (let f = 0; f < M.n; f++) if (!keep.has(f)) M.area[f] = 0;
  // cluster index remap: pass 2 uses M.cluster[f] → indexes into M.clusters; rebuild a temp map
  const savedCluster = Int32Array.from(M.cluster); ids.forEach((ci, j) => all[ci].faces.forEach(f => { M.cluster[f] = j; }));
  b.pos=[0,10,0]; b.q=A.qIdentity(); b.omega=[0,0,0]; b.vel=[V*Math.cos(a*A.DEG), -V*Math.sin(a*A.DEG), 0];
  const r = A.aeroForces(b, wind0, 0);
  M.area.set(saved); M.cluster.set(savedCluster); M.clusters = all;
  const L = r.F[0]*Math.sin(a*A.DEG) + r.F[1]*Math.cos(a*A.DEG), D = -(r.F[0]*Math.cos(a*A.DEG) - r.F[1]*Math.sin(a*A.DEG));
  return { L, D, M: r.T[2] };
}
console.log('per-group at V=5 m/s (L, D in N; Mz in mN·m about the CG):');
for (const a of [0, 4, 8]) {
  const row = [];
  for (const g of ['wing', 'tail', 'fin', 'fuse', 'bluff']) { const r = forcesOf(groups[g], a); row.push(`${g}: L${r.L.toFixed(3)} D${r.D.toFixed(3)} M${(r.M*1000).toFixed(1)}`); }
  const tot = forcesOf(all.map((_, i) => i), a);
  console.log(`  α=${a}: ${row.join(' | ')} || total L${tot.L.toFixed(3)} D${tot.D.toFixed(3)} M${(tot.M*1000).toFixed(1)}  (W=${(b.mass*9.81).toFixed(3)})`);
}
// wing region details
const wi = groups.wing.map(i => all[i]).sort((x, y) => y.area - x.area)[0];
console.log('largest wing region: area', (wi.area*1e4).toFixed(0), 'cm², centre x', wi.cx.toFixed(3), 'n', [wi.nx, wi.ny, wi.nz].map(v => v.toFixed(2)));
