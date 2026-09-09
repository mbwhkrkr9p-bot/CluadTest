const A = require('../src/aero.js'); const O = require('../src/objects.js');
for (const [k,p] of Object.entries(O.GLIDER_PRESETS)) {
  const line = [];
  for (const nose of [0,2,4,6,8,10,14,20,30]) { const b = A.buildBody(O.gliderSpec(Object.assign({},p,{nose}))); line.push(`${nose}g:${(b.staticMargin*100).toFixed(0)}%`); }
  console.log(k, line.join('  '));
}
