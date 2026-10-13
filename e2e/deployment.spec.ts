import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeSession, finish, selectProfile } from './helpers';

test('Pages subpath works offline and defers real service-worker updates during an exam', async ({
  browser,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'ecole-pages-build-'));
  const base = '/school/ecole/';
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/vite/bin/vite.js'),
      'build',
      '--config',
      'apps/student/vite.config.ts',
      '--outDir',
      directory,
    ],
    { cwd: root, encoding: 'utf8', env: { ...process.env, VITE_BASE_PATH: base } },
  );
  if (output.status !== 0) {
    await rm(directory, { recursive: true, force: true });
    throw new Error(output.stderr + output.stdout);
  }
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  let serviceWorkerVersion = 1;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (!path.startsWith(base)) {
      response.writeHead(404).end();
      return;
    }
    const relative = path.slice(base.length) || 'index.html';
    void readFile(join(directory, relative))
      .then((content) => {
        response.setHeader('Content-Type', types[extname(relative)] ?? 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(
          relative === 'sw.js'
            ? Buffer.concat([
                content,
                Buffer.from(`\n// E2E service worker revision ${serviceWorkerVersion}\n`),
              ])
            : content,
        );
      })
      .catch(() => {
        response.writeHead(404).end();
      });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a local server port');
  const url = `http://127.0.0.1:${address.port}${base}`;
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Wer lernt heute?' })).toBeVisible();
    await expect(page.getByText('· App offline bereit', { exact: true })).toBeVisible();
    const manifestResponse = await context.request.get(url + 'manifest.webmanifest');
    const manifest = await manifestResponse.json();
    expect(manifest.start_url).toBe(base);
    expect(manifest.scope).toBe(base);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toBe(url);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Wer lernt heute?' })).toBeVisible();
    await expect(
      page.getByText('Offline – heruntergeladene Inhalte verfügbar', { exact: true }),
    ).toBeVisible();
    await context.setOffline(false);
    await selectProfile(page, 'Lutz');
    await page.getByRole('button', { name: 'Klassenarbeit starten', exact: true }).first().click();
    await expect(page.locator('.session-page')).toBeVisible();
    const original = await activeSession(page);
    serviceWorkerVersion = 2;
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect(
      page.getByText('Eine neue Version von École ist verfügbar.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aktualisieren', exact: true })).toBeDisabled();
    expect((await activeSession(page)).id).toBe(original.id);
    expect(
      await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting)),
    ).toBe(true);
    await finish(page);
    await expect(page.getByRole('button', { name: 'Aktualisieren', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Aktualisieren', exact: true })).toHaveCSS('background-color', 'rgb(40, 89, 76)');
    await page.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Wer lernt heute?' })).toBeVisible();
    await selectProfile(page, 'Lutz');
    await page.getByRole('button', { name: 'Meine Ergebnisse', exact: true }).click();
    await expect(page.locator('.history-row')).toHaveCount(1);
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
