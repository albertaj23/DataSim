import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
// narrow
{ const {page,shot,done}=await launch({viewport:{width:900,height:800}});
  await page.goto(BASE); await sleep(1500); await shot('140-narrow-projects');
  console.log('narrow:',await page.locator('body').innerText().then(t=>t.slice(0,200)));
  await page.setViewportSize({width:1100,height:800}); await sleep(500); await shot('141-1100-projects');
  await page.goto(BASE+'p/'+pid); await sleep(2000); await shot('142-1100-studio');
  await done('narrow'); }
// offline from start
{ const {ctx,page,shot,done}=await launch();
  await ctx.route('**/api/**',r=>r.abort()); await ctx.route('**/socket.io/**',r=>r.abort());
  await page.goto(BASE); await sleep(3500); await shot('143-offline-projects');
  console.log('offline projects:',await page.locator('body').innerText().then(t=>t.slice(0,500)));
  await page.goto(BASE+'p/'+pid); await sleep(3500); await shot('144-offline-studio');
  console.log('offline studio:',await page.locator('body').innerText().then(t=>t.slice(0,500)));
  await page.goto(BASE+'runs'); await sleep(3000); await shot('145-offline-runs');
  console.log('offline runs:',await page.locator('body').innerText().then(t=>t.slice(0,400)));
  await page.goto(BASE+'runs/2f9ea711-bf35-460b-a065-d2444d0388b2'); await sleep(3000); await shot('146-offline-report');
  console.log('offline report:',await page.locator('body').innerText().then(t=>t.slice(0,400)));
  await page.goto(BASE+'lab'); await sleep(2500); await shot('147-offline-lab');
  await done('offline'); }
// offline after load (studio)
{ const {ctx,page,shot,done}=await launch();
  await page.goto(BASE+'p/'+pid); await sleep(2500);
  await ctx.route('**/api/**',r=>r.abort());
  await page.getByTestId('node-users').click(); await sleep(300);
  await page.getByRole('spinbutton').first().fill('160').catch(()=>{}); await sleep(3000); await shot('148-offline-after-edit');
  console.log('mid-offline:',await page.locator('[role=alert],[role=status]').allInnerTexts(), await page.getByTestId('revision-pill').innerText().catch(()=>'')); 
  await page.getByRole('button',{name:'Run',exact:true}).click(); await sleep(2500); await shot('149-offline-run');
  console.log('run offline toasts:',await page.locator('[role=alert],[role=status]').allInnerTexts());
  await done('offline-mid'); }
