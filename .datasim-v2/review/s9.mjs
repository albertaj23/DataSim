import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await idle();
await page.goto(BASE+'p/'+pid); await sleep(2000);
await page.getByRole('combobox',{name:'Concurrency strategy'}).click(); await sleep(300); await shot('50-strategy-menu');
console.log(await page.getByRole('option').allInnerTexts());
await page.getByRole('option',{name:/atomic/i}).click(); await sleep(500);
const t0=Date.now();
await page.getByRole('button',{name:'Run',exact:true}).click();
let bott=false, reloaded=false;
for(let i=0;i<60;i++){
  await sleep(1500);
  const txt=await page.locator('body').innerText();
  if(/bottleneck/i.test(txt)&&!bott){bott=true; console.log('bottleneck text seen at',(Date.now()-t0)/1000); await shot('51-bottleneck');}
  const ph=await page.getByTestId('phase-text').innerText().catch(()=>'-');
  if(!reloaded && /Measuring [6-9]\//.test(ph)){ reloaded=true; console.log('RELOAD at',ph); await page.reload(); await sleep(2500); await shot('52-reload-mid-run'); console.log('after reload phase:',await page.getByTestId('phase-text').innerText().catch(()=>'NO PHASE'), 'stop btn', await page.getByTestId('stop-run').count()); }
  if(/Completed/.test(ph)) {console.log('completed',(Date.now()-t0)/1000);break;}
}
await sleep(2000); await shot('53-atomic-finished');
console.log(await page.getByTestId('bottom-panel').innerText().then(t=>t.slice(0,500)));
await done('s9-atomic-reload');
