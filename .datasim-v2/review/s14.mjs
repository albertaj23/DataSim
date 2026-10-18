import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await idle();
await page.goto(BASE+'p/'+pid); await sleep(2000);
await page.locator('button:right-of(:text("Run"))').first().count();
// the Run split menu chevron
const chev=page.getByRole('button',{name:/run options|more run|Run menu|Run mode/i});
console.log('chev count',await chev.count());
const btns=await page.locator('header button, [role=banner] button').evaluateAll(b=>b.map(x=>x.getAttribute('aria-label')||x.innerText.trim()));
console.log(btns);
await done('s14');
