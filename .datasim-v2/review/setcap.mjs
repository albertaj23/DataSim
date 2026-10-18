import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8'); const A='http://127.0.0.1:4000/api';
const d=(await (await fetch(`${A}/projects/${pid}/draft`)).json()).design;
d.capacity={steps:[50,150,300,450,500],stepDurationS:8};
const r=await fetch(`${A}/projects/${pid}/draft`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({design:d})}); console.log(r.status);
