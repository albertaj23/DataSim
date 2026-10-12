import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await idle();
await page.goto(BASE+'p/'+pid); await sleep(2000);
const t0=Date.now();
await page.getByRole('button',{name:'Run',exact:true}).click();
let i=0;
while(Date.now()-t0<120000){
  await sleep(2500); i++;
  const stop=await page.getByTestId('stop-run').count();
  const phase=await page.getByTestId('phase-text').innerText().catch(()=>'-');
  console.log(((Date.now()-t0)/1000).toFixed(1),'stop?',stop,'phase:',phase.replace(/\n/g,' '));
  if(i==1||i==3||i==5||i==7) await shot('30-run-live-'+i);
  if(!stop && i>2) break;
}
await sleep(2500); await shot('31-run-finished');
console.log(await page.locator('[data-testid=bottom-panel]').innerText().then(t=>t.slice(0,1800)));
console.log('NODES', await page.locator('.react-flow__node').allInnerTexts());
await done('s7-run-naive');
