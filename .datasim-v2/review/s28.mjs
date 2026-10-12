import {launch,BASE,sleep,idle} from './lib.mjs';
import fs from 'node:fs';
const pid=fs.readFileSync('.datasim-v2/review/pid2.txt','utf8');
const {page,shot,done}=await launch();
await page.goto(BASE+'p/'+pid); await sleep(2000);
// rename inline
await page.getByTestId('project-name').click(); await sleep(300); await shot('170-rename-edit');
console.log('rename el:',await page.locator('input:focus').count());
await page.keyboard.press('Control+a'); await page.keyboard.type('QA Renamed Project'); await page.keyboard.press('Enter'); await sleep(1200);
console.log('after rename:',await page.getByTestId('project-name').innerText(), await page.locator('[role=alert],[role=status]').allInnerTexts());
await page.reload(); await sleep(2000); console.log('persisted:',await page.getByTestId('project-name').innerText());
// empty rename
await page.getByTestId('project-name').click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter'); await sleep(800);
console.log('empty rename ->',await page.getByTestId('project-name').innerText(), await page.locator('[role=alert],[role=status]').allInnerTexts());
// projects page: duplicate + archive
await page.goto(BASE); await sleep(1500);
const row=page.getByTestId('project-row').filter({hasText:'QA Renamed Project'}).first();
console.log('rows with name',await page.getByTestId('project-row').filter({hasText:'QA Renamed Project'}).count());
console.log(await row.locator('button').evaluateAll(b=>b.map(x=>x.getAttribute('aria-label')||x.title||x.innerText)));
await row.hover(); await shot('171-row-hover');
await row.getByRole('button',{name:/Duplicate/i}).click(); await sleep(1800); await shot('172-after-duplicate'); console.log('dup url',page.url(), await page.locator('[role=alert],[role=status]').allInnerTexts());
await page.goto(BASE); await sleep(1500);
console.log('rows with name now',await page.getByTestId('project-row').filter({hasText:'QA Renamed Project'}).count(), await page.getByTestId('project-row').filter({hasText:'QA Renamed Project'}).allInnerTexts());
const row2=page.getByTestId('project-row').filter({hasText:'QA Renamed Project'}).first();
await row2.getByRole('button',{name:/Archive/i}).click(); await sleep(1000); await shot('173-archive-click');
console.log('archive dialog/toast:',await page.locator('[role=alert],[role=status],[role=dialog],[role=alertdialog]').allInnerTexts());
await sleep(1000);
console.log('rows with name after archive',await page.getByTestId('project-row').filter({hasText:'QA Renamed Project'}).count());
await done('s28-project-actions');
