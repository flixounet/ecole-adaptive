import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import demo from '@shared/fixtures/lutz-maths-demo.json';
import { computeContentHash, type ContentPackage, type CatalogEntry } from '@shared/content';
import { parseQuestionBank } from '@shared/validation';
import { normalizeBasePath } from '../../build/base';
import { loadPublishedContent } from '../../build/publishedContent';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ecole-content-'));
  roots.push(root);
  await mkdir(join(root, 'packages'));
  const bank = parseQuestionBank(structuredClone(demo));
  const pkg: ContentPackage = {
    packageVersion: 1,
    id: bank.id,
    version: bank.version,
    contentHash: '',
    createdAt: '2026-10-10T12:00:00Z',
    studentIds: bank.studentIds,
    subject: bank.subject,
    grade: bank.grade,
    chapter: bank.chapter,
    title: bank.title,
    modes: ['learn'],
    questionBank: bank,
    tests: [],
  };
  pkg.contentHash = await computeContentHash(pkg);
  const entry: CatalogEntry = {
    id: pkg.id,
    version: pkg.version,
    contentHash: pkg.contentHash,
    createdAt: pkg.createdAt,
    studentIds: pkg.studentIds,
    subject: pkg.subject,
    grade: pkg.grade,
    chapter: pkg.chapter,
    title: pkg.title,
    modes: pkg.modes,
    url: `packages/${pkg.id}-v${pkg.version}.json`,
  };
  const catalog = { catalogVersion: 1, updatedAt: pkg.createdAt, packages: [entry] };
  await writeFile(join(root, 'catalog.json'), JSON.stringify(catalog));
  await writeFile(join(root, entry.url), JSON.stringify(pkg));
  return { root, pkg, entry, catalog };
}
describe('static delivery boundaries', () => {
  it('accepts root and Pages project paths', () => {
    expect(normalizeBasePath(undefined)).toBe('/');
    expect(normalizeBasePath('/ecole-adaptive/')).toBe('/ecole-adaptive/');
  });
  it.each(['https://example.com/', './', '/a/../', '/a//', '/bad?/', '/%2e%2e/'])(
    'rejects unsafe base %s',
    (value) => {
      expect(() => normalizeBasePath(value)).toThrow('VITE_BASE_PATH');
    },
  );
  it('publishes only validated catalog entries, never arbitrary files', async () => {
    const { root, entry } = await fixture();
    await writeFile(join(root, 'private.json'), '{"private":"not published"}');
    await writeFile(join(root, 'packages', 'unapproved.json'), '{"private":"not approved"}');
    const assets = await loadPublishedContent(root);
    expect(assets.map((asset) => asset.fileName)).toEqual([
      'content/catalog.json',
      `content/${entry.url}`,
    ]);
  });
  it('fails the build when the signed package body changes', async () => {
    const { root, pkg, entry } = await fixture();
    pkg.questionBank.questions[0].hint += ' altered';
    await writeFile(join(root, entry.url), JSON.stringify(pkg));
    await expect(loadPublishedContent(root)).rejects.toThrow('Hash');
  });
  it('fails if a listed package is missing', async () => {
    const { root, entry } = await fixture();
    await rm(join(root, entry.url));
    await expect(loadPublishedContent(root)).rejects.toThrow();
  });
  it('rejects catalog metadata that disagrees with its valid package', async () => {
    const { root, catalog } = await fixture();
    catalog.packages[0].title = 'A different title';
    await writeFile(join(root, 'catalog.json'), JSON.stringify(catalog));
    await expect(loadPublishedContent(root)).rejects.toThrow('widersprechen');
  });
  it('refuses symlinks to private source folders outside published content', async () => {
    const { root, entry } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'ecole-private-'));
    roots.push(outside);
    const source = await readFile(join(root, entry.url));
    await writeFile(join(outside, 'private.json'), source);
    await rm(join(root, entry.url));
    await symlink(join(outside, 'private.json'), join(root, entry.url));
    await expect(loadPublishedContent(root)).rejects.toThrow('außerhalb');
  });
});
