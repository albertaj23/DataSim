import {launch,BASE,sleep} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid.txt','utf8');
const {page,shot,done}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(2000);
const m=await page.getByTestId('node-mysql').boundingBox();
for (const [fx,fy,l] of [[0.5,0.5,'center'],[0.1,0.5,'icon'],[0.5,0.3,'title'],[0.9,0.9,'pill']]){
  const h=await page.locator('.react-flow__node:has([data-testid=node-users]) .react-flow__handle.source').first().boundingBox();
  await page.mouse.move(h.x+h.width/2,h.y+h.height/2); await page.mouse.down();
  await page.mouse.move(m.x+m.width*fx,m.y+m.height*fy,{steps:20}); await sleep(200);
  await page.mouse.up(); await sleep(600);
  console.log(l,await page.locator('[role=alert]').allInnerTexts()); await sleep(4500);
}
await done('s3c');
