const A = require('../src/aero.js'); const O = require('../src/objects.js');
const wind0 = () => [0,0,0];
for (const [k,p] of Object.entries(O.GLIDER_PRESETS)) {
  const b = A.buildBody(O.gliderSpec(p, k));
  const tr = A.trimAnalysis(b);
  let line = `${k.padEnd(10)} m=${(b.mass*1000).toFixed(1)}g SM=${(b.staticMargin*100).toFixed(0)}% trim a=${tr.alpha==null?'none':tr.alpha.toFixed(1)} V=${tr.V?tr.V.toFixed(2):'-'} L/D=${tr.glide?tr.glide.toFixed(1):'-'}`;
  // fly it from 3 m at trim speed (or 6 m/s)
  b.q = A.qEuler(0, 0, 0); b.pos=[0,3,0]; b.vel=[tr.V||6,0,0]; b.omega=[0,0,0];
  let t=0, dt=1/60, trace=[];
  while(!b.landed && t<30){ A.step(b,dt,wind0,t); t+=dt; if(Math.round(t*60)%30===0){const tel=A.telemetry(b,wind0,t); trace.push(`${t.toFixed(1)}s x${b.pos[0].toFixed(1)} y${b.pos[1].toFixed(2)} V${tel.V.toFixed(1)} a${tel.alpha.toFixed(0)} up${tel.up[1].toFixed(2)} gl${tel.glide?tel.glide.toFixed(1):'-'}`);} }
  console.log(line + `  → flew ${b.pos[0].toFixed(1)}m in ${t.toFixed(1)}s, glide ${(b.pos[0]/3).toFixed(1)}`);
  console.log('   ' + trace.slice(0,10).join(' | '));
}
