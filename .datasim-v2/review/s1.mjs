import {launch,BASE,sleep} from './lib.mjs';
import fs from 'node:fs';
const {page,shot,done}=await launch();
await page.goto(BASE); await sleep(1500);
await shot('01-projects');
console.log(await page.locator('body').innerText());
await done('projects');
