import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(2500);
console.log('on reload:',await page.getByTestId('bottom-panel').innerText().then(t=>t.slice(0,300)));
await shot('32-studio-reload-after-run');
for (const t of ['Transactions','Statements','Locks','Invariants','Findings','Log']){
  await page.getByRole('tab',{name:new RegExp('^'+t)}).click(); await sleep(700); await shot('33-panel-'+t.toLowerCase());
  console.log('==',t, await page.getByTestId('bottom-panel').innerText().then(x=>x.slice(0,900)));
}
await done('s8');
