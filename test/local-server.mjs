// Runs the whole app on your own computer, with a database file in this folder.
// No Cloudflare account needed. Useful for trying changes before `npm run deploy`.
//
//   npm run try                  then open http://localhost:8787
//
// Settings (optional): PORT=8787  DB_PATH=local-test.sqlite  SYNC_KEY=...  ADMIN_PASSWORD=...  PORTAL_PASSWORD=...
// With ADMIN_PASSWORD set, the logins and the portals (/teacher and /student) work as they do online.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import { createD1 } from './d1-mock.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || join(ROOT, 'local-test.sqlite');
const env = {
  DB: createD1(DB_PATH, join(ROOT, 'migrations')),
  SYNC_KEY: process.env.SYNC_KEY || 'local-sync-key-for-testing-only',
  ...(process.env.ADMIN_PASSWORD ? { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD } : {}),
  ...(process.env.PORTAL_PASSWORD ? { PORTAL_PASSWORD: process.env.PORTAL_PASSWORD } : {}),
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const request = new Request(url, {
        method: req.method,
        headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
        body: hasBody ? Buffer.concat(chunks) : undefined,
      });
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (url.pathname === '/teacher' || url.pathname === '/student') {
      res.writeHead(307, { location: `${url.pathname}/` });
      res.end();
      return;
    }
    const path = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const file = normalize(join(PUBLIC, path));
    if (!file.startsWith(PUBLIC)) throw Object.assign(new Error('bad path'), { code: 'ENOENT' });
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    } else {
      console.error(err);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Server error');
    }
  }
});

server.listen(PORT, () => {
  console.log(`SuccessPath is running at http://localhost:${PORT}`);
  console.log(`Database file: ${DB_PATH}`);
  console.log('Press Ctrl+C to stop.');
});
