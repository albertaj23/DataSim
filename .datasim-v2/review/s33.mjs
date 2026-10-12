import {launch,BASE,sleep} from './lib.mjs';
const {page,shot,done,errors}=await launch();
const names=['Review 1: Shared Resource Allocation','Flash Sale Checkout','Bank Transfers and Deadlocks'];
let i=0;
for(const n of names){
  await page.goto(BASE); await sleep(1200);
  await page.getByRole('button',{name:new RegExp(n.split(':')[0])}).first().click().catch(async()=>{await page.getByText(n,{exact:false}).first().click()});
  await page.waitForURL(/\/p\//,{timeout:20000}); await sleep(2500);
  await shot('200-template-'+(i++)); console.log(n,'->',page.url().split('/p/')[1], 'nodes',await page.locator('.react-flow__node').count());
  await page.getByTestId('node-mysql').dblclick().catch(()=>{}); await sleep(1500); await shot('201-template-schema-'+(i-1));
  await page.keyboard.press('Escape');
}
console.log(errors);
await done('s33');
