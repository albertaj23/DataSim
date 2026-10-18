import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await idle();
await page.goto(BASE+'p/'+pid); await sleep(2000);
await page.getByRole('button',{name:'Run options'}).click(); await sleep(300);
await page.getByRole('menuitem',{name:/Capacity test/}).click();
const t0=Date.now(); let n=0;
while(Date.now()-t0<300000){
  await sleep(5000);
  const ph=await page.getByTestId('phase-text').innerText().catch(()=>'-');
  console.log(((Date.now()-t0)/1000).toFixed(0),ph.replace(/\n/g,' '));
  if(n==2||n==6) await shot('82-capacity-live-'+n); n++;
  const h=await (await fetch('http://127.0.0.1:4000/api/health')).json(); if(!h.activeRunId && n>2) break;
}
await sleep(3000); await shot('83-capacity-finished'); console.log(page.url());
console.log(await page.getByTestId('bottom-panel').innerText().then(t=>t.slice(0,600)));
await done('s17-capacity');
