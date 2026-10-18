import {launch,BASE,sleep} from './lib.mjs';
const {page,done,errors,shot}=await launch();
page.on('console',m=>console.log('C',m.type(),m.text().slice(0,200)));
page.on('request',r=>{ if(/design|zod|shared/.test(r.url())&&!/node_modules\/\.vite/.test(r.url())) console.log('REQ',r.url().slice(0,120))});
await page.goto(BASE+'p/7601985e-f099-4ca6-9dc8-3ada4be7fbe0'); await sleep(3000);
console.log(await page.evaluate(()=>document.querySelector('.react-flow')?.outerHTML.length));
console.log(await page.locator('.react-flow__viewport').innerHTML().then(h=>h.slice(0,300)));
await done('t5');
