import {launch,BASE,sleep} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done,errors}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(2500);
await page.getByTestId('node-mysql').click(); await sleep(500); await shot('210-inspector-db');
await page.getByTestId('node-users').click(); await sleep(500); await shot('211-inspector-users');
await page.locator('.react-flow__edge').first().click({force:true}).catch(()=>{}); await sleep(500); await shot('212-inspector-edge');
// kebab menu
await page.getByRole('button',{name:/menu/}).first().click().catch(e=>console.log('kebab',e.message.slice(0,60))); await sleep(400); await shot('213-kebab');
console.log(await page.getByRole('menuitem').allInnerTexts());
await page.keyboard.press('Escape');
// overflow menu
await page.getByRole('button',{name:'More actions'}).click(); await sleep(400); await shot('214-overflow'); console.log(await page.getByRole('menuitem').allInnerTexts());
await page.keyboard.press('Escape');
// export menu on report
await done('s34');
