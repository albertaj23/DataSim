import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(2000);
await page.getByTestId('node-mysql').dblclick(); await sleep(1200);
await page.getByRole('tab',{name:'Query'}).click(); await sleep(400);
await page.getByRole('button',{name:'Run',exact:true}).click(); await sleep(1500); await shot('17-schema-query-result');
console.log((await page.getByLabel('SQL query').count()));
await page.getByRole('button',{name:'Normalize'}).click(); await sleep(1200); await shot('18-normalize');
console.log((await page.locator('[role=dialog]').allInnerTexts()).join('\n').slice(0,1500));
await page.keyboard.press('Escape'); await sleep(500);
await page.keyboard.press('Escape'); await sleep(800); await shot('19-after-esc'); console.log(page.url());
// workload
await page.getByTestId('node-users').dblclick(); await sleep(1500); await shot('20-workload');
console.log(await page.locator('body').innerText().then(t=>t.slice(0,1500)));
await done('s5');
