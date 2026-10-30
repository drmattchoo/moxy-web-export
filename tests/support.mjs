// Shared by tests/e2e.test.mjs and tools/build-manual.mjs: a static file
// server for the repository and a fake File System Access API.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};

export async function startServer(root) {
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'text/plain' });
    res.end(fs.readFileSync(p));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://localhost:${server.address().port}` };
}

// In-page fake of the File System Access API backed by a real directory.
export const FAKE_FS = () => {
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

// Back the fake picker with a real directory; overwriting is an error.
export async function installFakeFs(page, dir) {
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
  await page.addInitScript(FAKE_FS);
}
