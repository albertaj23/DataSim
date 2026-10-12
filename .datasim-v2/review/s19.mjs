import {launch,BASE,sleep,idle} from './lib.mjs';
const {page,shot,done}=await launch();
await idle();
await page.goto(BASE+'lab'); await sleep(1500);
const conc=page.locator('input').first(); 
const inputs=await page.locator('main input').evaluateAll(i=>i.map(x=>[x.getAttribute('aria-label'),x.value]));
console.log(inputs);
await page.getByRole('spinbutton').first().fill('20').catch(e=>console.log('fill fail',e.message.slice(0,100)));
await page.getByRole('button',{name:/Run 8 strategies/}).click();
const t0=Date.now();
for(let i=0;i<40;i++){ await sleep(3000); const txt=await page.locator('main').innerText(); if(i==1) await shot('101-lab-running'); if(!/Running|Cancel|Stop/.test(txt) && i>1){break;} }
console.log('secs',(Date.now()-t0)/1000);
await sleep(1500); await shot('102-lab-results');
console.log(await page.locator('main').innerText().then(t=>t.slice(t.indexOf('Results'),t.indexOf('Results')+1800)));
await done('s19-lab');
