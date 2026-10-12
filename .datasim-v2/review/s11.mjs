import {launch,BASE,sleep,idle} from './lib.mjs';
const {page,shot,done}=await launch();
await page.goto(BASE+'runs'); await sleep(2000);
const rows=page.getByTestId('run-row');
await rows.nth(0).getByRole('checkbox').check(); await rows.nth(1).getByRole('checkbox').check(); await sleep(300);
await shot('61-runs-selected');
await page.getByRole('button',{name:/Compare/}).first().click(); await sleep(3000);
console.log(page.url());
await shot('62-compare-top');
console.log(await page.locator('main').innerText());
const H=await page.evaluate(()=>document.querySelector('main').scrollHeight); console.log('H',H);
let i=1; for(let y=800;y<H;y+=800){ await page.evaluate(y=>document.querySelector('main').scrollTo(0,y),y); await sleep(500); await page.screenshot({path:'.datasim-v2/review/screens/62-compare-'+(i++)+'.png'}); }
await done('s11');
