import {launch,BASE,sleep,idle} from './lib.mjs';
const rid='de22a69c-e271-4b24-b8ab-8ab6901f0ffb';
const {page,shot,done}=await launch();
await idle();
await page.goto(BASE+'runs/'+rid); await sleep(3000);
await page.getByRole('button',{name:'Re-run'}).last().click();
for(let i=0;i<10;i++){ await sleep(2000); console.log(i,page.url(), await page.getByTestId('phase-text').innerText().catch(()=>'-')); if(i==2) await shot('73-rerun-in-progress'); }
for(let i=0;i<30;i++){ await sleep(2000); const ph=await page.getByTestId('phase-text').innerText().catch(()=>'-'); if(/Completed/.test(ph)){console.log('done');break;} }
await sleep(2000); await shot('74-rerun-done'); console.log(page.url());
console.log(await page.locator('body').innerText().then(t=>t.slice(0,300)));
await done('s13');
