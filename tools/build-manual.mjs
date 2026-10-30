// Build docs/Moxy-Data-Export-User-Manual.pdf.
// 1. Runs index.html?demo=1 in headless Chromium and screenshots each step
//    into docs/img/.
// 2. Prints docs/manual.html to PDF.
// Run from anywhere:  node tools/build-manual.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer, installFakeFs } from '../tests/support.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(root, 'docs', 'img');
const PDF = path.join(root, 'docs', 'Moxy-Data-Export-User-Manual.pdf');

async function openDemo(browser, base, query = '?demo=1') {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(2026, 9, 29, 12, 0, 0) });
  await installFakeFs(page, fs.mkdtempSync(path.join(os.tmpdir(), 'moxy-manual-')));
  await page.goto(base + '/index.html' + query);
  // The manual shows the normal page, not the demo banner.
  await page.evaluate(() => { document.getElementById('demo-banner').hidden = true; });
  await page.fill('#f-date', '2026-10-29');
  await page.fill('#f-year', '2026');
  await page.fill('#f-study', 'VO2-A');
  await page.fill('#f-part', 'P007');
  return { context, page };
}

const shot = (page, selector, name) =>
  page.locator(selector).screenshot({ path: path.join(IMG, name), animations: 'disabled' });

async function screenshots(browser, base) {
  fs.mkdirSync(IMG, { recursive: true });
  const { context, page } = await openDemo(browser, base);
  await page.locator('#f-part').blur();
  await shot(page, '#step-details', '01-details.png');
  await page.click('#btn-choose');
  await page.getByText('Saving into').waitFor();
  await shot(page, '#step-folder', '02-folder.png');
  await page.click('#btn-connect');
  await page.getByText('Sensor connected.').waitFor({ timeout: 20000 });
  await shot(page, '#step-connect', '03-connect.png');
  await page.click('#btn-download');
  await page.getByText(/^Saved 4 sessions/).waitFor({ timeout: 30000 });
  await shot(page, '#step-download', '04-download.png');
  await shot(page, '#step-result', '05-result.png');
  await page.click('#erase-panel > summary');
  await page.fill('#erase-confirm', 'erase');
  await page.locator('#erase-confirm').blur();
  await shot(page, '#erase-panel', '06-erase.png');
  await page.click('#advanced > summary');
  // Drop the note the fake folder picker causes (it cannot be stored in IndexedDB).
  await page.locator('#console').evaluate((el) => {
    el.textContent = el.textContent.split('\n').filter((l) => !l.includes('could not remember')).join('\n');
    el.scrollTop = 0;
  });
  await shot(page, '#advanced', '08-advanced.png');
  await context.close();

  const err = await openDemo(browser, base, '?demo=1&scenario=silent');
  await err.page.click('#btn-choose');
  await err.page.click('#btn-connect');
  await err.page.getByText('The sensor did not answer.').waitFor({ timeout: 30000 });
  await shot(err.page, '#step-connect', '07-error.png');
  await err.context.close();
}

const { server, base } = await startServer(root);
const browser = await chromium.launch();
try {
  await screenshots(browser, base);
  const page = await browser.newPage();
  await page.goto(base + '/docs/manual.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: PDF, format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-size:8px;color:#55555b;padding:0 18mm;display:flex;justify-content:space-between;font-family:sans-serif">
      <span>Moxy Data Export · User manual · v1.0</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  console.log(`wrote ${path.relative(root, PDF)}`);
} finally {
  await browser.close();
  server.close();
}
