import {launch,BASE,sleep} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
for (let i=0;i<4;i++){
const {page,done,errors}=await launch();
const reqs=[];
page.on('response',async r=>{ if(r.url().includes('/api/')) reqs.push(r.request().method()+' '+r.status()+' '+r.url().replace('http://127.0.0.1:4000/api',''))});
await page.goto(BASE+'p/'+pid); await sleep(3000);
console.log(i,'nodes',await page.locator('.react-flow__node').count(),reqs.join(' ; '));
await done('t2');}
