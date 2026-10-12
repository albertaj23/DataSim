import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(2500);
await page.keyboard.press('Control+k'); await sleep(700); await shot('120-palette');
console.log(await page.locator('[role=dialog]').innerText());
await page.keyboard.type('capac'); await sleep(500); await shot('121-palette-filter');
console.log(await page.locator('[role=dialog]').innerText());
await page.keyboard.press('Escape'); await sleep(300);
// settings/theme
await page.getByRole('button',{name:'Settings'}).click(); await sleep(500); await shot('122-settings-popover');
console.log(await page.locator('[role=dialog],[role=menu],[data-radix-popper-content-wrapper]').allInnerTexts());
await done('s23');
