import {launch,BASE,sleep} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch({viewport:{width:1280,height:720}});
await page.goto(BASE+'p/'+pid); await sleep(2500); await shot('230-studio-1280x720');
const info=await page.evaluate(()=>{
  const cs=getComputedStyle(document.body); const out={bodyFont:cs.fontFamily,bg:cs.backgroundColor,size:cs.fontSize};
  const small={}; document.querySelectorAll('body *').forEach(e=>{ if(!e.childNodes.length) return; const t=[...e.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).length; if(!t) return; const fs=parseFloat(getComputedStyle(e).fontSize); if(fs<10){const k=fs+'px'; small[k]=(small[k]||0)+1;} });
  out.small=small; out.mono=getComputedStyle(document.querySelector('code,pre,.font-mono')||document.body).fontFamily;
  out.fonts=[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family+' '+f.weight).slice(0,10);
  return out;});
console.log(info);
await page.setViewportSize({width:1100,height:700}); await sleep(600); await shot('231-studio-1100x700');
await done('s36');
