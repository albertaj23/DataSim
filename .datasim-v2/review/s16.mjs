import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(2500);
const t0=Date.now(); let n=0;
while(Date.now()-t0<400000){
  const h=await (await fetch('http://127.0.0.1:4000/api/health')).json();
  const ph=await page.getByTestId('phase-text').innerText().catch(()=>'-');
  console.log(((Date.now()-t0)/1000).toFixed(0),ph.replace(/\n/g,' '));
  if(n%5==1) await shot('82-capacity-live-'+n);
  n++;
  if(!h.activeRunId) break;
  await sleep(6000);
}
await sleep(3000); await shot('83-capacity-finished');
console.log(await page.getByTestId('bottom-panel').innerText().then(t=>t.slice(0,700)));
await done('s16');
