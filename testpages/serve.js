// Dependency-free static file server for the test pages.
// Usage: node serve.js [port]   (default 8080, or the PORT environment variable)
//
// WebUSB and Web MIDI need a secure context: http://localhost counts, a LAN address over plain
// http does not. For the phone use GitHub Pages, or forward the port with
// `adb reverse tcp:8080 tcp:8080` and open http://localhost:8080 on the phone.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  let file = normalize(join(ROOT, pathname));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return send(res, 403, 'Forbidden');

  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: `${pathname}/` });
        return res.end();
      }
      file = join(file, 'index.html');
      info = await stat(file);
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
});

server.on('error', (e) => {
  console.error(`Cannot start the server on port ${PORT}: ${e.message}`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT}`);
  console.log(`  http://localhost:${PORT}/`);
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`  http://${net.address}:${PORT}/   (LAN; plain http, so no WebUSB/Web MIDI there)`);
    }
  }
  console.log('Stop with Ctrl+C.');
});
