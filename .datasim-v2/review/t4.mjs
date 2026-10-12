import {launch,BASE,sleep} from './lib.mjs';
const ids=['35547b9b-a006-4d2a-90c4-fc352a8fa334','ba00b74d-3cfe-4c0f-a89e-d4e98c74b799'];
const {page,done,errors,shot}=await launch();
for(const id of ids){ await page.goto(BASE+'p/'+id); await sleep(2500); console.log(id,'nodes',await page.locator('.react-flow__node').count(), await page.locator('text=Components').locator('xpath=following-sibling::*').first().innerText().catch(()=>'')); }
await shot('tmp2');
await done('t4');
