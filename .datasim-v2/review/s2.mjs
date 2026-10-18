import {launch,BASE,sleep} from './lib.mjs';
import fs from 'node:fs';
const {page,shot,done}=await launch();
await page.goto(BASE); await sleep(1000);
await page.getByText('Course Registration Rush').first().click();
await page.waitForURL(/\/p\//,{timeout:20000}); await sleep(2500);
const id=page.url().split('/p/')[1].split(/[?#]/)[0]; fs.writeFileSync('.datasim-v2/review/pid.txt',id); console.log('pid',id,page.url());
await shot('02-studio-idle');
// buttons / topbar text
console.log(await page.locator('header, [role=banner]').first().innerText().catch(()=>'nohdr'));
console.log((await page.locator('button').allInnerTexts()).filter(Boolean).join(' | '));
// click a node
await page.getByTestId('node-app').click().catch(e=>console.log('node-app?',e.message.slice(0,80)));
await sleep(500); await shot('03-studio-app-selected');
await page.getByTestId('node-users').click(); await sleep(500); await shot('04-studio-users-selected');
await done('step2');
