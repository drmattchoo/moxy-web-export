// Copy moxy-core.js, the demo fixture and the fonts into index.html.
// Run from anywhere:  node tools/sync.mjs
// index.html stays a single self-contained file; this only rewrites the
// regions between its markers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p));
const b64 = (p) => read(p).toString('base64');

const FONTS = [
  ['Atkinson Hyperlegible', 400, 'tools/fonts/atkinson-400.woff2'],
  ['Atkinson Hyperlegible', 700, 'tools/fonts/atkinson-700.woff2'],
  ['IBM Plex Mono', 400, 'tools/fonts/plexmono-400.woff2'],
  ['IBM Plex Mono', 700, 'tools/fonts/plexmono-700.woff2'],
];

function replaceBetween(html, start, end, body) {
  const i = html.indexOf(start);
  const j = html.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error(`markers not found: ${start}`);
  return html.slice(0, i + start.length) + body + html.slice(j);
}

let html = read('index.html').toString('utf8');

const fontCss = FONTS.map(([family, weight, file]) =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;` +
  `src:url(data:font/woff2;base64,${b64(file)}) format('woff2');}`).join('\n');
html = replaceBetween(html, '/* BEGIN fonts */\n', '/* END fonts */', fontCss + '\n');
html = replaceBetween(html, '/* BEGIN moxy-core.js */\n', '/* END moxy-core.js */', read('moxy-core.js').toString('utf8'));
html = replaceBetween(html, '<script type="text/plain" id="demo-gd">', '</script>', b64('tests/fixtures/ringbuffer.txt'));
html = replaceBetween(html, '<script type="text/plain" id="demo-fw">', '</script>', b64('tests/fixtures/firmware.txt'));

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log(`index.html updated (${(html.length / 1024).toFixed(0)} KB)`);
