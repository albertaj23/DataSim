import { chromium } from '@playwright/test';
import fs from 'node:fs';
export const BASE='http://localhost:5174/DataSim/';
export const API='http://127.0.0.1:4000/api';
export const SC='c:/Users/visha/OneDrive/Desktop/Documents/programming/DataSim/.datasim-v2/review/screens/';
export async function launch(opts={}){
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'dark',...opts});
  const page=await ctx.newPage();
  const errors=[];
  page.on('console',m=>{ if(m.type()==='error') errors.push(`[console] ${page.url()} :: ${m.text()}`)});
  page.on('pageerror',e=>errors.push(`[pageerror] ${page.url()} :: ${e}`));
  page.on('requestfailed',r=>errors.push(`[reqfailed] ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on('response',r=>{ if(r.status()>=400) errors.push(`[http ${r.status()}] ${r.request().method()} ${r.url()}`)});
  return {browser,ctx,page,errors,shot:(n)=>page.screenshot({path:SC+n+'.png'}),
    async done(tag){ const f='c:/Users/visha/OneDrive/Desktop/Documents/programming/DataSim/.datasim-v2/review/errors.log'; fs.appendFileSync(f,`\n== ${tag}\n`+errors.join('\n')+'\n'); await browser.close(); }};
}
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function idle(){ for(let i=0;i<200;i++){ const h=await (await fetch(API+'/health')).json(); if(!h.activeRunId) return; await sleep(1500);} }
