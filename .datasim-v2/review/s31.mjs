import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
const T=Date.now(); let n=0;
await page.goto(BASE+'p/'+pid); await sleep(2500);
console.log('fresh tab during batch: phase',await page.getByTestId('phase-text').innerText().catch(()=>'NONE'),'url',page.url());
await shot('191-batch-fresh-tab');
while(Date.now()-T<420000){
  const h=await (await fetch('http://127.0.0.1:4000/api/health')).json();
  console.log(((Date.now()-T)/1000).toFixed(0),'active',h.activeRunId?.slice(0,8),'url',page.url().replace(BASE,''));
  if(!h.activeRunId){ await sleep(3000); if(!(await (await fetch('http://127.0.0.1:4000/api/health')).json()).activeRunId) break; }
  await sleep(10000);
}
await shot('192-batch-end'); console.log(page.url());
await done('s31-batch');
