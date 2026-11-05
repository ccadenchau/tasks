import http from 'node:http';
import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const upstream = 'https://api.cadenchau.com';
const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.startsWith('/__api/')) {
    if (!['GET', 'POST', 'PUT'].includes(request.method)) { response.writeHead(405).end('Method not allowed'); return; }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const apiResponse = await fetch(`${upstream}${url.pathname.slice('/__api'.length)}${url.search}`, {
        method: request.method,
        headers: { ...(request.headers.authorization ? { Authorization: request.headers.authorization } : {}), ...(request.headers['content-type'] ? { 'Content-Type': request.headers['content-type'] } : {}) },
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        signal: AbortSignal.timeout(25000),
      });
      response.writeHead(apiResponse.status, { 'Content-Type': apiResponse.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
      response.end(Buffer.from(await apiResponse.arrayBuffer()));
    } catch (error) {
      response.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'Local API proxy failed', detail: error.message }));
    }
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end('Forbidden'); return; }
  try {
    await access(file);
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; connect-src 'self' https://api.cadenchau.com; form-action 'self'" });
    response.end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
const port = Number(process.env.PORT || 8080);
server.listen(port, '127.0.0.1', () => console.log(`Local app: http://localhost:${port}`));
