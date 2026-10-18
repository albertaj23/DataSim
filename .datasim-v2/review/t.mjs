import {launch,BASE,sleep} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done,errors}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(3000);
await shot('tmp'); console.log(await page.locator('body').innerText().then(t=>t.slice(0,300)));console.log(errors);
await done('t');
