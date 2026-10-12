const A='http://127.0.0.1:4000/api';
const call=async(m,p,b)=>{const r=await fetch(A+p,{method:m,headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined});return r.json()};
const proj=await call('POST','/templates/course-registration/instantiate',{});
const pid=proj.projectId;
async function run(strategy){
  const s=await call('POST',`/projects/${pid}/runs`,{kind:'LOAD',overrides:{strategy}});
  for(;;){await new Promise(r=>setTimeout(r,2000));const r=await call('GET','/runs/'+s.runId);if(['COMPLETED','FAILED'].includes(r.run.status))return r;}
}
const show=(label,r)=>{const t=r.txnStats.find(x=>x.txnName==='search_sections');const s=r.statementStats.find(x=>/slot/.test(x.digestText));console.log(label,'tps',r.run.tpsAvg,'p95',r.run.p95Ms,'| search p50',t.p50Ms,'p95',t.p95Ms,'db',t.dbMs,'| stmt avg',s?.avgMs,'rows',s?.rowsExamined,'| SLO',r.run.sloPass)};
const a=await run('atomic'); show('before',a);
const f=a.findings.find(x=>x.kind==='FULL_SCAN'&&x.fix);
console.log('finding',!!f);
if(f){await call('POST',`/projects/${pid}/apply-fix`,{fix:f.fix});const b=await run('atomic');show('after ',b);}
