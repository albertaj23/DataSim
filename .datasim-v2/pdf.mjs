import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const url = pathToFileURL(path.resolve('docs/pdf/explainer.html')).href;
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(url);
await p.waitForLoadState('networkidle');
await p.pdf({ path: 'docs/DataSim_Project_Explainer.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<div></div>',
  footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#777">DataSim · project explainer · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
await b.close(); console.log('pdf ok');
