import {launch,BASE,sleep} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,done,errors,shot}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(1500);
console.log('nodes',await page.locator('.react-flow__node').count());
await page.reload(); await sleep(2500);
console.log('after reload nodes',await page.locator('.react-flow__node').count());
// navigate via projects list
await page.goto(BASE); await sleep(1200);
await page.locator('tr',{hasText:'Course Registration Rush'}).first().click(); await sleep(2500);
console.log(page.url(),'via list nodes',await page.locator('.react-flow__node').count());
console.log(errors);
await done('t3');
