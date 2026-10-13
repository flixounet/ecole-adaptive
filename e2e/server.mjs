// TEST ONLY: serves the production build and isolated per-context JSON fixtures.
// This module is never imported by the Student build or the Teacher production server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import process from 'node:process';

const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1];
};
const directory = resolve(option('--dist', 'apps/student/dist'));
const port = Number(option('--port', '4180'));
const fixtures = new Map();
const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
async function body(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 10 * 1024 * 1024) throw new Error('Test fixture too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function json(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/__e2e/packages' && request.method === 'POST') {
      const value = await body(request);
      const token = randomUUID();
      fixtures.set(token, value);
      json(response, { token });
      return;
    }
    const fixture = fixtures.get(request.headers['x-ecole-test']);
    if (fixture && path === '/content/catalog.json') {
      json(response, fixture.catalog);
      return;
    }
    if (fixture && path.startsWith('/content/packages/')) {
      const pkg = fixture.packages[path.slice('/content/'.length)];
      json(response, pkg ?? { error: 'Unknown test package' }, pkg ? 200 : 404);
      return;
    }
    const target = resolve(directory, '.' + (path === '/' ? '/index.html' : path));
    if (!target.startsWith(directory + sep)) {
      response.writeHead(404).end();
      return;
    }
    const content = await readFile(target);
    response.writeHead(200, {
      'Content-Type': types[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(content);
  } catch {
    if (!response.headersSent) json(response, { error: 'Unknown test resource' }, 404);
    else response.end();
  }
});
server.listen(port, '127.0.0.1', () =>
  process.stdout.write(`Isolated Student E2E server: http://127.0.0.1:${port}\n`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
