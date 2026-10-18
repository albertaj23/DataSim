const A='http://127.0.0.1:4000/api';
const call=async(m,p,b)=>{const r=await fetch(A+p,{method:m,headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined});return r.json()};
const proj=await call('POST','/templates/course-registration/instantiate',{});
const steps=(process.env.STEPS||'50,150,300,450,500').split(',').map(Number);
const s=await call('POST',`/projects/${proj.projectId}/runs`,{kind:'CAPACITY',overrides:{strategy:'atomic',capacitySteps:steps,capacityStepDurationS:+(process.env.DUR||8)}});
for(;;){await new Promise(r=>setTimeout(r,2000));const r=await call('GET','/runs/'+s.runId);if(['COMPLETED','FAILED'].includes(r.run.status)){console.log(r.run.status,r.run.errorText||'');console.log(r.capacity?.sentence);console.log(r.capacity?.points.map(p=>[p.vus,p.tps,p.p95Ms,p.errorRate].join('/')).join('  '),JSON.stringify(r.capacity?.fit),'knee',r.capacity?.kneeVus);break;}}
