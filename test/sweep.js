const A = require('../src/aero.js'); const O = require('../src/objects.js');
const base = O.GLIDER_PRESETS.trainer;
for (const inc of [1,2,3]) for (const tailInc of [-2,-1,0,1,2]) {
  const b = A.buildBody(O.gliderSpec(Object.assign({}, base, {incidence: inc, tailInc})));
  const tr = A.trimAnalysis(b);
  process.stdout.write(`inc${inc} tail${tailInc}: a=${tr.alpha==null?'none':tr.alpha.toFixed(1)} V=${tr.V?tr.V.toFixed(1):'-'} L/D=${tr.glide?tr.glide.toFixed(1):'-'}   `);
  if (tailInc===2) console.log();
}
