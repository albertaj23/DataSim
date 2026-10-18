import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await page.goto(BASE); await sleep(1500);
await page.getByRole('button',{name:'Settings'}).click(); await page.getByRole('radio',{name:'Light'}).click().catch(async()=>{await page.getByText('Light',{exact:true}).click()}); await sleep(500);
await page.keyboard.press('Escape'); await sleep(300);
await shot('130-light-projects');
await page.goto(BASE+'p/'+pid); await sleep(2500); await shot('131-light-studio');
await page.getByTestId('node-mysql').dblclick(); await sleep(1500); await shot('132-light-schema');
await page.keyboard.press('Escape'); await sleep(500);
await page.goto(BASE+'runs/44b96e6e-0ec4-4105-aa39-a1685b589735'); await sleep(3000); await shot('133-light-report-capacity');
await page.goto(BASE+'compare?ids=de22a69c-e271-4b24-b8ab-8ab6901f0ffb,2f9ea711-bf35-460b-a065-d2444d0388b2'); await sleep(3000); await shot('134-light-compare');
await page.goto(BASE+'lab'); await sleep(1500); await shot('135-light-lab');
// revert
await page.getByRole('button',{name:'Settings'}).click(); await page.getByRole('radio',{name:'Dark'}).click().catch(async()=>{await page.getByText('Dark',{exact:true}).click()});
await done('s24-light');
