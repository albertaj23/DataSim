import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await idle();
await page.goto(BASE+'p/'+pid); await sleep(2000);
await page.getByRole('button',{name:'Run options'}).click(); await sleep(300);
await page.getByRole('menuitem',{name:/Compare strategies/}).click();
const T=Date.now(); let i=0;
while(Date.now()-T<150000){ await sleep(5000); const ph=await page.getByTestId('phase-text').innerText().catch(()=>'-'); console.log(((Date.now()-T)/1000).toFixed(0),page.url().replace(BASE,''),ph.replace(/\n/g,' ')); if(i++==2) await shot('220-batch-live'); if(/compare\?/.test(page.url())) break; const h=await (await fetch('http://127.0.0.1:4000/api/health')).json(); if(!h.activeRunId&&i>3) break; }
await sleep(2500); await shot('221-batch-end'); console.log(page.url());
await done('s35');
