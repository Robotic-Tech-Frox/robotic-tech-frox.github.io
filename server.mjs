import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { exportOnshapeGltf, OnshapeError } from './onshape/proxy.mjs';

const ROOT = process.argv[2] || '.';
const PORT = Number(process.argv[3]) || 4173;

const MT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream'
};

const s = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0] || '/');

    /* Local equivalent of the deployed Onshape proxy, so `?onshape=<link>`
     * works during development. Needs ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY. */
    if (p === '/onshape/gltf') {
      const cors = {
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        Vary: 'Origin'
      };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

      const link = new URL(req.url, 'http://localhost').searchParams.get('url');
      const accessKey = process.env.ONSHAPE_ACCESS_KEY;
      const secretKey = process.env.ONSHAPE_SECRET_KEY;
      try {
        if (!link) throw new OnshapeError('Missing ?url=<onshape document link>', 400);
        const out = await exportOnshapeGltf({ docUrl: link, accessKey, secretKey });
        res.writeHead(200, { ...cors, 'Content-Type': out.contentType, 'Cache-Control': 'public, max-age=600' });
        res.end(Buffer.from(out.bytes));
      } catch (e) {
        res.writeHead(e.status || 502, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message || 'Onshape export failed' }));
      }
      return;
    }
    // normalize path separators; we hold the root in native form
    const root = normalize(ROOT);
    const rootPrefix = root === '.' ? '' : root + sep;
    let file = normalize(join(root, p));
    // block any escape outside the root
    if (!file.startsWith(rootPrefix) && !file.startsWith('./')) { res.writeHead(403); res.end(); return; }
    // root path ('/') maps to index.html for convenience
    if (file === root || file === root + sep || file === './') file = join(root, 'index.html');
    if (!file.endsWith('.html') && !file.endsWith('.js') && !file.endsWith('.css') && !file.endsWith('.svg') && !file.endsWith('.png') && !file.endsWith('.ico') && !file.endsWith('')) { res.writeHead(404); res.end('not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MT[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
});

s.listen(PORT, () => console.log(`serve ${ROOT} -> http://localhost:${PORT}`));
