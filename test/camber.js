// Calibrate the camber gain: a straight NACA 4412 wing (AR 6) should give CL≈0.4 at α=0 and a lift slope ≈ 4.5/rad
const A = require('../src/aero.js'); const O = require('../src/objects.js'); require('../src/foam.js');
const wind0 = () => [0,0,0];
const p = Object.assign({}, O.FOAM_DEFAULT, { span: 0.6, rootChord: 0.1, tipChord: 0.1, sweep: 0, dihedral: 0, incidence: 0, wingX: 0, wingY: 0,
  fuseR: 0.0001, fuseX0: -0.001, fuseX1: 0.001, tailSpan: 0.0001, tailChord: 0.0001, finHeight: 0.0001, finRootChord: 0.0001, finTipChord: 0.0001, fillet: 0.002 });
const mesh = O.foamGliderMesh(1, p);
const b = A.buildMeshBody({ mesh, meshOpts: { mass: 0.03, suction: 0.85, cd90: 1.3, stallDeg: 13, cf: 0.015, wake: 0.3 } });
const S = 0.06, q = 0.5 * 1.225 * 25;
for (const gain of ['thin-airfoil']) {
  const cls = [];
  for (const a of [-4, 0, 4, 8]) { b.pos=[0,10,0]; b.q=A.qIdentity(); b.omega=[0,0,0]; b.vel=[5*Math.cos(a*A.DEG), -5*Math.sin(a*A.DEG), 0]; const r=A.aeroForces(b,wind0,0); const L=r.F[0]*Math.sin(a*A.DEG)+r.F[1]*Math.cos(a*A.DEG); const D=-(r.F[0]*Math.cos(a*A.DEG)-r.F[1]*Math.sin(a*A.DEG)); cls.push(`α${a}: CL ${(L/(q*S)).toFixed(2)} CD ${(D/(q*S)).toFixed(3)} Cm ${(r.T[2]/(q*S*0.1)).toFixed(3)}`); }
  const big = b.mesh.clusters.map((C,i)=>({i,a:C.area,k:C.kind})).sort((x,y)=>y.a-x.a)[0]; console.log('   wing region α0 =', (Math.asin(b.mesh.sinA0[big.i])/A.DEG).toFixed(2)+'°', 'cm0 =', b.mesh.cm0[big.i].toFixed(3), '(NACA 4412 theory: α0 ≈ −4.2°, cm ≈ −0.10)');
  console.log(`${gain}: ${cls.join(' | ')}   (faces ${b.mesh.nFacets}, regions ${b.mesh.clusters.length})`);
}
