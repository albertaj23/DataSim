import {launch,BASE,sleep} from './lib.mjs';
const {page,shot,done}=await launch();
await page.goto(BASE+'runs'); await sleep(2000); await shot('196-runs-after-batch');
console.log(await page.getByTestId('run-row').first().innerText());
console.log(await page.getByTestId('run-row').nth(1).innerText());
await done('s32');
