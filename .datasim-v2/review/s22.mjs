import {launch,BASE,sleep,idle} from './lib.mjs';
const {page,shot,done}=await launch();
await idle();
await page.goto(BASE+'stepper'); await sleep(2000);
await page.getByRole('combobox').click(); await page.getByRole('option',{name:/Classic deadlock/i}).click(); await sleep(500);
await page.getByRole('button',{name:'Load scenario'}).click(); await sleep(1500); await shot('115-stepper-loaded2');
console.log((await page.locator('main').innerText()).match(/Expected outcome[^\n]*\n?[^\n]*/)?.[0]);
for(let i=0;i<8;i++){ await page.keyboard.press('n'); await sleep(1800); if(i==2) await shot('116-stepper-mid'); const t=await page.locator('main').innerText(); if(/Deadlock found|errno 1213 |ERROR 1213|1213 \(40001\)/i.test(t.replace(/errno 1213/,'xx'))){console.log('deadlock after',i+1);break;} }
await sleep(1500); await shot('117-stepper-deadlock');
console.log(await page.locator('main').innerText().then(t=>t.slice(t.indexOf('T1\nREPEATABLE'),t.indexOf('T1\nREPEATABLE')+2600)));
await page.getByRole('button',{name:/Reset/}).click(); await sleep(800); await shot('118-after-reset');
await done('s22-stepper');
