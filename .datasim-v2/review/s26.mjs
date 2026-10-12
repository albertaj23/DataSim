import {launch,BASE,sleep,idle} from './lib.mjs';
const A='http://127.0.0.1:4000/api';
await idle();
const pr={projectId:(await import('node:fs')).readFileSync('.datasim-v2/review/pid2.txt','utf8')};
const pid=pr.projectId; console.log('pid2',pid); (await import('node:fs')).writeFileSync('.datasim-v2/review/pid2.txt',pid);
const {page,shot,done,ctx}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(2500);
const comps=async()=>page.locator('.react-flow__node').count();
const pill=async()=>page.getByTestId('revision-pill').innerText().catch(()=>'?');
console.log('start comps',await comps(), await pill());
// delete node via key
await page.getByTestId('node-redis').click(); await sleep(200);
await page.keyboard.press('Delete'); await sleep(500); console.log('after Delete',await comps(), 'edges',await page.locator('.react-flow__edge').count(), await pill()); await shot('150-after-delete');
await page.keyboard.press('Control+z'); await sleep(500); console.log('after Ctrl+Z',await comps(),'edges',await page.locator('.react-flow__edge').count());
await page.keyboard.press('Control+Shift+z'); await sleep(500); console.log('after redo',await comps(),'edges',await page.locator('.react-flow__edge').count());
await page.keyboard.press('Control+z'); await sleep(500); console.log('undo again',await comps(),'edges',await page.locator('.react-flow__edge').count());
// duplicate
await page.getByTestId('node-app').click(); await sleep(200);
await page.keyboard.press('Control+d'); await sleep(600); console.log('after Ctrl+D',await comps(), await pill()); await shot('151-after-dup');
await page.keyboard.press('Control+z'); await sleep(500); console.log('undo dup',await comps());
// delete via inspector button
await page.getByTestId('node-app').click(); await sleep(200);
await page.getByRole('button',{name:/Delete node/}).click(); await sleep(600); console.log('inspector delete: comps',await comps(), 'toasts',await page.locator('[role=alert],[role=status]').allInnerTexts(), 'dialog',await page.locator('[role=dialog],[role=alertdialog]').allInnerTexts()); await shot('152-inspector-delete');
await page.keyboard.press('Control+z'); await sleep(500); console.log('undo',await comps());
// Ctrl+S
await sleep(1500); console.log('pill before save',await pill());
await page.keyboard.press('Control+s'); await sleep(1500); console.log('after Ctrl+S',await pill(), await page.locator('[role=alert],[role=status]').allInnerTexts()); await shot('153-after-ctrl-s');
// validate
await page.getByRole('button',{name:/Validate/}).click(); await sleep(800); await shot('154-validate'); console.log('validate:',await page.locator('[role=alert],[role=status],[role=dialog],[role=menu]').allInnerTexts());
await done('s26-edit');
