import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  canonicalJson,
  parseCatalog,
  parseContentPackage,
  verifyContentHash,
} from '../../../shared/content';

export interface PublishedAsset {
  fileName: string;
  source: string;
}

async function readPublishedJson(root: string, name: string, maxBytes: number): Promise<string> {
  const path = resolve(root, name);
  const canonicalRoot = await realpath(root);
  const canonicalPath = await realpath(path);
  if (!canonicalPath.startsWith(canonicalRoot + sep))
    throw new Error('Veröffentlichter Inhalt darf nicht außerhalb des Content-Ordners liegen.');
  const info = await stat(canonicalPath);
  if (!info.isFile() || info.size > maxBytes)
    throw new Error(`Ungültige oder zu große Inhaltsdatei: ${name}`);
  return readFile(canonicalPath, 'utf8');
}

/** Only catalog-listed, validated JSON enters the public site. Private sources are never copied. */
export async function loadPublishedContent(contentRoot: string): Promise<PublishedAsset[]> {
  const catalogText = await readPublishedJson(contentRoot, 'catalog.json', 2 * 1024 * 1024);
  const catalog = parseCatalog(JSON.parse(catalogText));
  const assets: PublishedAsset[] = [{ fileName: 'content/catalog.json', source: catalogText }];
  for (const entry of catalog.packages) {
    const source = await readPublishedJson(contentRoot, entry.url, 10 * 1024 * 1024);
    const pkg = parseContentPackage(JSON.parse(source));
    if (!(await verifyContentHash(pkg))) throw new Error(`Inhalts-Hash stimmt nicht: ${entry.id}`);
    for (const key of [
      'id',
      'version',
      'contentHash',
      'createdAt',
      'studentIds',
      'subject',
      'grade',
      'chapter',
      'title',
      'modes',
    ] as const) {
      if (canonicalJson(pkg[key]) !== canonicalJson(entry[key]))
        throw new Error(`Katalog und Paket widersprechen sich: ${entry.id} (${key}).`);
    }
    assets.push({ fileName: `content/${entry.url}`, source });
  }
  return assets;
}

export function publishedContentPlugin(contentRoot: string, base: string): Plugin {
  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (!path.startsWith(`${base}content/`)) {
      next();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405;
      response.end();
      return;
    }
    const requested = path.slice(base.length);
    void loadPublishedContent(contentRoot)
      .then((assets) => {
        const asset = assets.find((item) => item.fileName === requested);
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.statusCode = asset ? 200 : 404;
        response.end(
          request.method === 'HEAD'
            ? undefined
            : (asset?.source ?? JSON.stringify({ error: 'Inhalt nicht veröffentlicht.' })),
        );
      })
      .catch(() => {
        response.statusCode = 503;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(
          JSON.stringify({
            error: 'Der veröffentlichte Katalog ist noch nicht verfügbar oder ungültig.',
          }),
        );
      });
  };
  return {
    name: 'ecole-published-content',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    async generateBundle() {
      for (const asset of await loadPublishedContent(contentRoot))
        this.emitFile({ type: 'asset', ...asset });
    },
  };
}
