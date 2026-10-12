import {launch,BASE,sleep,SC} from './lib.mjs';
const [,, rid, tag, w]=process.argv;
const {page,done}=await launch(w?{viewport:{width:+w,height:900}}:{});
await page.goto(BASE+'runs/'+rid); await sleep(3500);
const H=await page.evaluate(()=>document.querySelector('main').scrollHeight);
let i=0;
for(let y=0;y<H;y+=800){ await page.evaluate(y=>document.querySelector('main').scrollTo(0,y),y); await sleep(500); await page.screenshot({path:SC+tag+'-'+(i++)+'.png'}); }
console.log('shots',i,'H',H);
await done('report2 '+tag);
