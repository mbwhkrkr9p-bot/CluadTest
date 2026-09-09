// panel trainer with the same settings as the mesh trainer, for comparison
const A = require('../src/aero.js'); const O = require('../src/objects.js');
const p = Object.assign({}, O.GLIDER_PRESETS.trainer, { incidence: 2.5, tailInc: 0.5, camber: 0 });
const b = A.buildBody(O.gliderSpec(p)); const tr = A.trimAnalysis(b);
console.log(`panel trainer (same params): m=${(b.mass*1000).toFixed(1)}g SM=${(b.staticMargin*100).toFixed(0)}% trim a=${tr.alpha==null?'none':tr.alpha.toFixed(1)} V=${tr.V?tr.V.toFixed(1):'-'} L/D=${tr.glide?tr.glide.toFixed(1):'-'}`);
