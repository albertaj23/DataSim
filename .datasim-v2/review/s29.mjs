import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
const bad=/\bNaN\b|undefined|\[object Object\]|Infinity|\bnull\b|TypeError|at Object\.|stack/;
async function scan(name){ const t=await page.locator('body').innerText(); const m=t.match(bad); if(m) console.log('BAD TOKEN',name,m[0], t.slice(Math.max(0,t.indexOf(m[0])-60),t.indexOf(m[0])+60).replace(/\n/g,' '));
  const geo=await page.evaluate(()=>{const out=[];document.querySelectorAll('svg').forEach(s=>{const r=s.getBoundingClientRect(); if(r.width<2&&r.height>0||r.height<2&&r.width>0) out.push('svg '+r.width+'x'+r.height)}); document.querySelectorAll('.recharts-responsive-container').forEach(c=>{const r=c.getBoundingClientRect(); if(r.width<10||r.height<10) out.push('chart '+r.width+'x'+r.height)}); 
   document.documentElement.scrollWidth>document.documentElement.clientWidth&&out.push('hscroll page '+document.documentElement.scrollWidth); return out});
  if(geo.length) console.log('GEO',name,geo); }
const pages=[['projects',BASE],['runs',BASE+'runs'],['lab',BASE+'lab'],['stepper',BASE+'stepper'],['studio',BASE+'p/'+pid],
 ['report-naive',BASE+'runs/2f9ea711-bf35-460b-a065-d2444d0388b2'],['report-cap',BASE+'runs/44b96e6e-0ec4-4105-aa39-a1685b589735'],
 ['compare',BASE+'compare?ids=de22a69c-e271-4b24-b8ab-8ab6901f0ffb,2f9ea711-bf35-460b-a065-d2444d0388b2']];
for(const [n,u] of []){ await page.goto(u); await sleep(2500); await scan(n); }
// lab tabs
await page.goto(BASE+'lab'); await sleep(1500);
await page.getByRole('tab',{name:'Index experiment'}).click(); await sleep(800); await shot('180-lab-index-idle'); await scan('lab-index');
await page.getByRole('tab',{name:'History'}).click(); await sleep(1200); await shot('181-lab-history'); await scan('lab-history');
console.log('history text:',await page.locator('main').innerText().then(t=>t.slice(0,600)));
await page.getByRole('tab',{name:'Strategy benchmark'}).click(); await page.getByText('Lost update',{exact:true}).first().click(); await sleep(800); await shot('182-lab-lost-update'); await scan('lab-lu');
// studio panel tabs + schema tabs
await page.goto(BASE+'p/'+pid); await sleep(2000);
for(const t of ['Live','Transactions','Statements','Locks','Invariants','Findings','Log']){ await page.getByRole('tab',{name:new RegExp('^'+t)}).click(); await sleep(400); await scan('panel-'+t); }
// toggle bottom panel
await done('s29-crawl');
