import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(2000);
await page.getByTestId('node-mysql').dblclick(); await sleep(1500);
const tb=page.getByRole('button',{name:'DDL',exact:true}); console.log('toolbar DDL disabled?',await tb.isDisabled(), await tb.getAttribute('title'));
await page.getByRole('tab',{name:'DDL',exact:true}).click(); await sleep(800); await shot('11-schema-ddl');
console.log((await page.locator('.cm-content').allInnerTexts()).join('\n---\n').slice(0,4500));
// click a table
await page.getByRole('tab',{name:'Table',exact:true}).click();
await page.locator('.react-flow__node').filter({hasText:'section'}).first().click(); await sleep(600); await shot('12-schema-section-selected');
await page.getByRole('tab',{name:'Query'}).click(); await sleep(600); await shot('13-schema-query-unprovisioned');
await page.getByRole('tab',{name:'Problems'}).click(); await sleep(600); await shot('14-schema-problems');
// provision
await idle();
await page.getByRole('button',{name:'Provision sandbox'}).click();
for(let i=0;i<8;i++){ await sleep(700); if(i==1) await shot('15-schema-provisioning'); }
await sleep(4000); await shot('16-schema-provisioned');
console.log(await page.locator('[role=alert],[role=status]').allInnerTexts());
await done('s4');
