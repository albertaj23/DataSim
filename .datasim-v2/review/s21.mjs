import {launch,BASE,sleep,idle} from './lib.mjs';
const {page,shot,done}=await launch();
await idle();
await page.goto(BASE+'stepper'); await sleep(2000);
await page.getByRole('combobox').click(); await sleep(300); await shot('111-stepper-scenarios');
console.log(await page.getByRole('option').allInnerTexts());
await page.getByRole('option',{name:/Classic deadlock/i}).click(); await sleep(1500);
await shot('112-stepper-loaded');
console.log(await page.locator('main button').allInnerTexts().then(a=>a.filter(Boolean)));
for(let i=0;i<8;i++){ await page.keyboard.press('n'); await sleep(1500); if(i==2) await shot('113-stepper-mid'); const t=await page.locator('main').innerText(); if(/1213|deadlock found/i.test(t)){console.log('deadlock after',i+1);break;} }
await sleep(1500); await shot('114-stepper-deadlock');
console.log(await page.locator('main').innerText().then(t=>t.slice(0,3200)));
await done('s21-stepper');
