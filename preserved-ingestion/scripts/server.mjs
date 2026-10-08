import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'src');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

const server = createServer(async (request, response) => {
  const requested = decodeURIComponent((request.url || '/').split('?')[0]);
  const safePath = normalize(requested).replace(/^\.\.(?:[\\/]|$)/, '');
  let file = join(root, safePath === '/' ? 'index.html' : safePath);
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch {
    try {
      const body = await readFile(join(root, 'index.html'));
      response.writeHead(200, { 'Content-Type': types['.html'], 'Cache-Control': 'no-cache' });
      response.end(body);
    } catch {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Unable to load Global Cinema.');
    }
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Global Cinema listening at http://127.0.0.1:${port}`));
