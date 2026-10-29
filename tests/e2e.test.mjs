// End-to-end run of index.html?demo=1 in headless Chromium (Playwright).
// The simulated sensor serves tests/fixtures/ringbuffer.txt; a stubbed
// showDirectoryPicker writes into a temporary directory. The files written
// must match the parity outputs in tests/expected/ringbuffer.
// Run `python3 tests/parity.py` first (npm test does both).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SHOTS = process.env.SCREENSHOT_DIR || '';

let server, base, browser;

before(async () => {
  server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' });
    res.end(fs.readFileSync(p));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

// In-page fake of the File System Access API backed by a real directory.
const FAKE_FS = () => {
  const toB64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const bytesOf = async (d) => {
    if (typeof d === 'string') return new TextEncoder().encode(d);
    if (d instanceof Blob) return new Uint8Array(await d.arrayBuffer());
    if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    return new Uint8Array(d);
  };
  const join = (a, b) => (a ? `${a}/${b}` : b);
  const makeFile = (p, name) => ({
    kind: 'file', name,
    async createWritable() {
      const parts = [];
      return {
        async write(d) { parts.push(await bytesOf(d)); },
        async close() {
          const all = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
          let o = 0;
          for (const x of parts) { all.set(x, o); o += x.length; }
          await window.__fsWrite(p, toB64(all));
        },
        async abort() {},
      };
    },
  });
  const makeDir = (p, name) => ({
    kind: 'directory', name,
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async getDirectoryHandle(n, o = {}) {
      const q = join(p, n), k = await window.__fsKind(q);
      if (k === 'dir') return makeDir(q, n);
      if (k === 'file') throw new DOMException('file', 'TypeMismatchError');
      if (!o.create) throw new DOMException('missing', 'NotFoundError');
      await window.__fsMkdir(q);
      return makeDir(q, n);
    },
    async getFileHandle(n, o = {}) {
      const q = join(p, n), k = await window.__fsKind(q);
      if (k === 'file') return makeFile(q, n);
      if (k === 'dir') throw new DOMException('dir', 'TypeMismatchError');
      if (!o.create) throw new DOMException('missing', 'NotFoundError');
      return makeFile(q, n);
    },
  });
  window.showDirectoryPicker = async () => makeDir('', 'Moxy exports');
};

async function openPage({ scheme = 'light', width = 1280, query = '?demo=1', fake = true, init = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moxy-e2e-'));
  const context = await browser.newContext({
    viewport: { width, height: 900 }, colorScheme: scheme, acceptDownloads: true,
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(2026, 9, 29, 12, 0, 0) });
  const safe = (p) => {
    const full = path.join(dir, p);
    if (!full.startsWith(dir)) throw new Error('path escape');
    return full;
  };
  await page.exposeFunction('__fsKind', (p) => {
    const full = safe(p);
    if (!fs.existsSync(full)) return null;
    return fs.statSync(full).isDirectory() ? 'dir' : 'file';
  });
  await page.exposeFunction('__fsMkdir', (p) => { fs.mkdirSync(safe(p)); });
  await page.exposeFunction('__fsWrite', (p, b64) => {
    const full = safe(p);
    if (fs.existsSync(full)) throw new Error(`overwrite attempted: ${p}`);
    fs.writeFileSync(full, Buffer.from(b64, 'base64'));
  });
  if (fake) await page.addInitScript(FAKE_FS);
  if (init) await page.addInitScript(init);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.goto(base + '/index.html' + query);
  return { page, context, dir, errors };
}

async function fillDetails(page, part = 'P007') {
  await page.fill('#f-date', '2026-10-29');
  await page.fill('#f-year', '2026');
  await page.fill('#f-study', 'VO2-A');
  await page.fill('#f-part', part);
}

test('full demo flow writes files identical to the parity outputs', async () => {
  const { page, context, dir, errors } = await openPage();
  try {
    await page.getByText('Demo mode: simulated sensor').waitFor();
    assert.ok(await page.locator('#btn-connect').isDisabled(), 'connect locked before details');
    await fillDetails(page);
    assert.equal(await page.textContent('#folder-name'), '2026-10-29_VO2-A_P007');
    await page.click('#btn-choose');
    await page.getByText('Saving into').waitFor();
    assert.ok(await page.locator('#btn-choose').isHidden(), 'choose button replaced by the remembered folder');
    assert.ok(await page.locator('#btn-allow').isHidden(), 'no allow-access button when permission is granted');

    await page.click('#btn-connect');
    await page.getByText('Sensor connected.').waitFor({ timeout: 20000 });
    const fw = fs.readFileSync(path.join(here, 'fixtures', 'firmware.txt'), 'utf8').trim();
    assert.equal(await page.textContent('#i-fw'), fw);
    assert.equal(await page.getAttribute('#i-diff', 'class'), 'flag', 'clock difference over 2 minutes is highlighted');
    assert.match(await page.textContent('#i-diff'), /^3\.2 minutes \(sensor is behind/);

    assert.ok(await page.locator('#btn-erase').isDisabled(), 'erase locked before download');
    await page.click('#btn-download');
    await page.getByText('Saved 4 sessions to Moxy exports/2026-10-29_VO2-A_P007').waitFor({ timeout: 30000 });
    assert.match(await page.textContent('#progress'), /^Received 7,765 bytes\.$/);
    assert.equal(await page.locator('#sessions-body tr').count(), 4);
    assert.ok(await page.locator('#retry-row').isHidden(), 'no retry button after a successful save');
    assert.ok(await page.locator('#info').isHidden(), 'sensor details cleared after release');

    const out = path.join(dir, '2026-10-29_VO2-A_P007');
    const files = fs.readdirSync(out).sort();
    const want = fs.readdirSync(path.join(here, 'expected', 'ringbuffer')).sort();
    const stamp = files.find((f) => f.startsWith('raw_gd_')).slice(7, 22);
    assert.match(stamp, /^20261029_1200\d\d$/);
    assert.deepEqual(files, [`device_info_${stamp}.txt`, `raw_gd_${stamp}.txt`, ...want].sort());

    for (const f of want) {
      assert.ok(fs.readFileSync(path.join(out, f)).equals(fs.readFileSync(path.join(here, 'expected', 'ringbuffer', f))), f);
    }
    assert.ok(fs.readFileSync(path.join(out, `raw_gd_${stamp}.txt`)).equals(fs.readFileSync(path.join(here, 'fixtures', 'ringbuffer.txt'))),
      'raw file is the exact bytes received');
    const info = fs.readFileSync(path.join(out, `device_info_${stamp}.txt`), 'utf8');
    assert.match(info, /^firmware: Moxy Monitor FW 2\.1\.7 \(demo\)\nSN 00000 HW rev C\ndevice_clock: 10-29,11:56:5\d\nbattery: 3\.94 V\nupdate_mode: 1\nport: USB vendor 0x0000 product 0x0000\nscript: moxy-web v1\.0\ndownloaded_at: 2026-10-29T12:00:\d\d\n$/);

    // Erase: needs the typed word.
    await page.click('#erase-panel > summary');
    assert.ok(await page.locator('#btn-erase').isDisabled());
    assert.ok(await page.locator('#erase-locked').isHidden(), 'erase lock notice gone after save');
    await page.fill('#erase-confirm', 'eras');
    assert.ok(await page.locator('#btn-erase').isDisabled());
    await page.fill('#erase-confirm', 'erase');
    assert.ok(await page.locator('#btn-erase').isEnabled());
    await page.click('#btn-erase');
    await page.getByText('The erase command was sent. The sensor replied: data cleared').waitFor({ timeout: 20000 });
    assert.ok(await page.locator('#btn-erase').isDisabled(), 'erase locks again after use');

    // Same folder name again: refused, nothing overwritten.
    await page.click('#btn-connect');
    await page.getByText('Sensor connected.').waitFor({ timeout: 20000 });
    await page.click('#btn-download');
    await page.getByText('A folder with this name already exists. Change the participant code or date.').waitFor();

    // Console log records commands with timestamps, and can be saved.
    await page.click('#advanced > summary');
    const log = await page.textContent('#console');
    for (const cmd of ['"\\r"', '"ver\\r"', '"time\\r"', '"batt\\r"', '"um\\r"', '"gd\\r"', '"cd\\r"', '"exit\\r"']) {
      assert.ok(log.includes(`sent     ${cmd}`), `console has ${cmd}`);
    }
    const sent = [...log.matchAll(/ sent +"([^"]*)"/g)].map((m) => m[1].replace(/\\r$/, ''));
    assert.deepEqual([...new Set(sent)].sort(), ['', 'batt', 'cd', 'exit', 'gd', 'time', 'um', 'ver'], 'no other commands');
    assert.match(log, /^2026-10-29T12:00:\d\d\.\d{3}  /);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-savelog')]);
    assert.match(dl.suggestedFilename(), /^console_20261029_\d{6}\.txt$/);

    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'flow-1280-light.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('error states use the plain-language messages', async () => {
  const cases = [
    ['nopick', 'No sensor selected. Click Connect sensor and choose the Moxy.'],
    ['busy', 'The sensor is in use by another program. Close GoldenCheetah or any virtual machine, then try again.'],
    ['silent', 'The sensor did not answer. Unplug it, press its button once, plug it back in and try again. Use a data cable, not a charge-only cable.'],
  ];
  await Promise.all(cases.map(async ([scenario, message]) => {
    const { page, context } = await openPage({ query: `?demo=1&scenario=${scenario}` });
    try {
      await fillDetails(page);
      await page.click('#btn-choose');
      await page.click('#btn-connect');
      await page.getByText(message).waitFor({ timeout: 30000 });
      assert.ok(await page.locator('#btn-download').isDisabled(), `${scenario}: download stays locked`);
    } finally {
      await context.close();
    }
  }));
});

test('invalid codes block the flow', async () => {
  const { page, context } = await openPage();
  try {
    await fillDetails(page, 'Jane Doe');
    await page.locator('#f-part').blur();
    await page.getByText('Use letters, numbers and hyphens only.').waitFor();
    assert.ok(await page.locator('#btn-connect').isDisabled());
    assert.equal(await page.textContent('#folder-name'), 'Fill in the details above');
  } finally {
    await context.close();
  }
});

test('unsupported browsers see only the browser message', async () => {
  const { page, context } = await openPage({
    query: '', fake: false,
    init: () => { delete Window.prototype.showDirectoryPicker; delete window.showDirectoryPicker; },
  });
  try {
    await page.getByText('Open this page in Google Chrome or Microsoft Edge on a computer.').waitFor();
    assert.ok(await page.locator('#app').isHidden());
  } finally {
    await context.close();
  }
});

test('no horizontal scrolling at 1280 and 400 px, light and dark', async () => {
  for (const scheme of ['light', 'dark']) {
    for (const width of [1280, 400]) {
      const { page, context } = await openPage({ scheme, width });
      try {
        await fillDetails(page);
        await page.click('#btn-choose');
        await page.click('#btn-connect');
        await page.getByText('Sensor connected.').waitFor({ timeout: 20000 });
        await page.click('#btn-download');
        await page.getByText(/^Saved 4 sessions/).waitFor({ timeout: 30000 });
        await page.click('#erase-panel > summary');
        await page.click('#advanced > summary');
        const { sw, cw } = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        }));
        assert.ok(sw <= cw, `${scheme} ${width}px: scrollWidth ${sw} > ${cw}`);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `layout-${width}-${scheme}.png`), fullPage: true });
      } finally {
        await context.close();
      }
    }
  }
});
