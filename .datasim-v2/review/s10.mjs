import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await page.goto(BASE); await sleep(1000);
await page.getByRole('link',{name:'Runs'}).first().click(); await sleep(2000);
await shot('60-runs');
console.log(page.url()); console.log(await page.locator('body').innerText().then(t=>t.slice(0,1400)));
console.log('rows',await page.getByTestId('run-row').count());
// filters
console.log((await page.locator('[aria-label=Filters] *').allInnerTexts()).slice(0,20));
await done('s10');
