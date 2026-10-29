// Byte-for-byte parity between moxy-core.js and moxy_dump.py.
// Run `python3 tests/parity.py` first (npm test does both).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const core = require('../moxy-core.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures');
const EXPECTED = path.join(here, 'expected');

// Must match tests/parity.py.
const TODAY = { year: 2026, month: 10, day: 29 };
const YEAR = 2026;
const FIRMWARE = fs.readFileSync(path.join(FIXTURES, 'firmware.txt'), 'utf8').trim();
const CASES = [
  ['ringbuffer', 'ringbuffer.txt', 30, 30],
  ['ringbuffer_gap10_min5', 'ringbuffer.txt', 10, 5],
  ['rollover', 'rollover.txt', 30, 30],
  ['nosessions', 'nosessions.txt', 30, 30],
];

function jsOutputs(fixture, gap, minRows) {
  const raw = fs.readFileSync(path.join(FIXTURES, fixture));
  const rows = core.parseDump(core.decodeBytes(raw), YEAR, TODAY);
  const out = new Map();
  for (const s of core.splitSessions(rows, gap, minRows)) {
    out.set(core.sessionFilename(s), Buffer.from(core.sessionCsv(s, FIRMWARE), 'utf8'));
  }
  return out;
}

function expectedOutputs(name) {
  const dir = path.join(EXPECTED, name);
  const out = new Map();
  if (!fs.existsSync(path.join(EXPECTED))) {
    throw new Error('tests/expected is missing: run `python3 tests/parity.py` first');
  }
  if (!fs.existsSync(dir)) return out; // a case with zero sessions
  for (const f of fs.readdirSync(dir).sort()) out.set(f, fs.readFileSync(path.join(dir, f)));
  return out;
}

for (const [name, fixture, gap, minRows] of CASES) {
  test(`parity: ${name}`, () => {
    const want = expectedOutputs(name);
    const got = jsOutputs(fixture, gap, minRows);
    assert.deepEqual([...got.keys()].sort(), [...want.keys()].sort(), 'session file names');
    for (const [file, bytes] of want) {
      assert.ok(got.get(file).equals(bytes), `${name}/${file} differs from moxy_dump.py output`);
    }
  });
}

test('fixtures cover the required cases', () => {
  const ring = fs.readFileSync(path.join(FIXTURES, 'ringbuffer.txt'), 'latin1');
  assert.match(ring, /\r\n ,,,,,\r\n/, 'space-comma delimiter');
  assert.match(ring, /\r\n,,,,,\r\n/, 'comma delimiter');
  assert.match(ring, /\d+-\d+,\d+:\d:\d,/, 'non-padded times');
  assert.match(ring, /\r\n\d+-\d+,[\d:]+,\d+,\d+,[\d.]+,\d+,\d+\r\n/, '7-field line');
  const rows = core.parseDump(ring, YEAR, TODAY);
  assert.ok(rows.some((r) => r.date.startsWith('2025-12')), 'mm-dd later than today');
  const sorted = core.parseDump(ring.split('\r\n').reverse().join('\r\n'), YEAR, TODAY);
  assert.deepEqual(sorted.map((r) => r.t), rows.map((r) => r.t), 'order independent');
});

test('folder name, codes and stamps', () => {
  assert.equal(core.folderName('2026-10-29', 'VO2-1', 'P007'), '2026-10-29_VO2-1_P007');
  assert.ok(core.isValidCode('P-07a'));
  for (const bad of ['', 'P 07', 'P_07', 'Jo\u00e9', '../x']) assert.ok(!core.isValidCode(bad), bad);
  const d = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(core.stamp(d), '20260102_030405');
  assert.equal(core.localIso(d), '2026-01-02T03:04:05');
  assert.equal(core.portLabel({ usbVendorId: 0x483, usbProductId: 0x5740 }),
    'USB vendor 0x0483 product 0x5740');
});

test('console helpers', () => {
  assert.equal(core.cleanResponse('ver\r\nMoxy 2.1\r\nSN 1\r\n> ', 'ver'), 'Moxy 2.1\nSN 1');
  assert.equal(core.cleanResponse('\r\n>', ''), '');
  assert.ok(core.endsWithPrompt('abc\r\n>  \r\n'));
  assert.ok(!core.endsWithPrompt('a > b'));
  const enc = (s) => new TextEncoder().encode(s);
  assert.ok(core.gdComplete(enc('gd\r\n10-1,1:1:1,1,1,1,1\r\n>')));
  assert.ok(!core.gdComplete(enc('gd\r\n10-1,1:1:1,1,1,1,1\r\n')));
  assert.ok(!core.gdComplete(enc('x'.repeat(100) + '>')), 'needs CRLF in the last 64 bytes');
});

test('sensor clock parsing', () => {
  const now = new Date(2026, 9, 29, 12, 0, 0);
  assert.equal(+core.parseSensorClock('10-29,11:58:3', now), +new Date(2026, 9, 29, 11, 58, 3));
  assert.equal(+core.parseSensorClock('2026-10-29 11:58:03', now), +new Date(2026, 9, 29, 11, 58, 3));
  assert.equal(+core.parseSensorClock('Time: 10/29/2026 11:58:03', now), +new Date(2026, 9, 29, 11, 58, 3));
  assert.equal(core.parseSensorClock('no clock here', now), null);
});

test('index.html carries a verbatim copy of moxy-core.js', () => {
  const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
  const m = /\/\* BEGIN moxy-core\.js \*\/\n([\s\S]*?)\/\* END moxy-core\.js \*\//.exec(html);
  assert.ok(m, 'markers present');
  assert.equal(m[1], fs.readFileSync(path.join(here, '..', 'moxy-core.js'), 'utf8'),
    'run `node tools/sync.mjs`');
});

test('index.html demo dump and firmware match the fixtures', () => {
  const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
  const gd = /<script type="text\/plain" id="demo-gd">([A-Za-z0-9+/=]*)<\/script>/.exec(html);
  assert.ok(gd, 'demo-gd block present');
  assert.ok(Buffer.from(gd[1], 'base64').equals(fs.readFileSync(path.join(FIXTURES, 'ringbuffer.txt'))));
  const fw = /<script type="text\/plain" id="demo-fw">([A-Za-z0-9+/=]*)<\/script>/.exec(html);
  assert.ok(fw, 'demo-fw block present');
  assert.equal(Buffer.from(fw[1], 'base64').toString('utf8'), fs.readFileSync(path.join(FIXTURES, 'firmware.txt'), 'utf8'));
});
