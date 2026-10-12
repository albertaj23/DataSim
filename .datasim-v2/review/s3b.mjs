import {launch,BASE,sleep} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(2000);
const src=await page.locator('[data-id="1-users-null-source"], .react-flow__handle.source').first().boundingBox();
async function drag(tx,ty,label){
  const h=await page.locator('.react-flow__node:has([data-testid=node-users]) .react-flow__handle.source').first().boundingBox();
  await page.mouse.move(h.x+h.width/2,h.y+h.height/2); await page.mouse.down();
  await page.mouse.move(tx,ty,{steps:20}); await sleep(200);
  await page.mouse.up(); await sleep(500);
  console.log(label,'toasts:',await page.locator('[role=alert],[role=status]').allInnerTexts(), 'edges', await page.locator('.react-flow__edge').count());
}
const m=await page.getByTestId('node-mysql').boundingBox();
// target handle of mysql
const th=await page.locator('.react-flow__node:has([data-testid=node-mysql]) .react-flow__handle.target').first().boundingBox();
console.log('target handle',th);
await drag(th.x+th.width/2,th.y+th.height/2,'on handle'); await shot('07b-drop-on-handle');
await sleep(5000);
await drag(m.x+m.width*0.7,m.y+m.height/2,'on body');  await shot('07c-drop-on-body');
await sleep(3000);
await drag(m.x+m.width*0.7,m.y+m.height*0.5+60,'near below');
await done('s3b');
