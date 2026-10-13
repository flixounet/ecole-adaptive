import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import source from './fixtures/lutz-maths-demo.json';
import {
  canonicalJson,
  computeContentHash,
  parseContentPackage,
  parseCatalog,
  sha256,
  verifyContentHash,
  type ContentPackage,
} from './content';
import { parseQuestionBank } from './validation';

async function sample(): Promise<ContentPackage> {
  const bank = parseQuestionBank(structuredClone(source));
  const pkg: ContentPackage = {
    packageVersion: 1,
    id: bank.id,
    version: bank.version,
    contentHash: '0'.repeat(64),
    createdAt: '2026-10-10T12:00:00.000Z',
    studentIds: bank.studentIds,
    subject: bank.subject,
    grade: bank.grade,
    chapter: bank.chapter,
    title: bank.title,
    modes: ['learn', 'exam'],
    questionBank: bank,
    tests: [
      {
        id: 'exam1',
        title: 'Feste Prüfung',
        mode: 'exam',
        durationMinutes: 20,
        questionIds: bank.questions.slice(0, 4).map((q) => q.id),
        seed: 42,
      },
    ],
  };
  pkg.contentHash = await computeContentHash(pkg);
  return pkg;
}
describe('content contracts and deterministic checksums', () => {
  it.each(['', 'abc', 'ä français 😀', 'x'.repeat(10000)])(
    'matches standard SHA256 vector %#',
    (text) => {
      expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'));
    },
  );
  it('uses ECMAScript floats, UTF16 key ordering and rejects invalid JSON scalars', () => {
    expect(canonicalJson({ z: 1.0, a: 1e-7, '😀': true, '\uffff': false })).toBe(
      '{"a":1e-7,"z":1,"😀":true,"￿":false}',
    );
    expect(() => canonicalJson({ a: NaN })).toThrow();
    expect(() => canonicalJson('\ud800')).toThrow();
  });
  it('validates package alignment and detects content mutation independently of version', async () => {
    const pkg = await sample();
    expect(parseContentPackage(pkg)).toEqual(pkg);
    expect(await verifyContentHash(pkg)).toBe(true);
    pkg.questionBank.questions[0].points = 0.5;
    expect(await verifyContentHash(pkg)).toBe(false);
    pkg.title = 'other';
    expect(() => parseContentPackage(pkg)).toThrow('Paketmetadaten');
  });
  it('validates fixed question references, mode contracts and distributions', async () => {
    const pkg = await sample();
    pkg.tests[0].questionIds = ['missing'];
    expect(() => parseContentPackage(pkg)).toThrow('unbekannte');
    pkg.tests[0].questionIds = [pkg.questionBank.questions[0].id];
    pkg.tests[0].difficultyDistribution = { '1': 50 };
    expect(() => parseContentPackage(pkg)).toThrow('100 Prozent');
    delete pkg.tests[0].difficultyDistribution;
    pkg.modes = ['learn'];
    expect(() => parseContentPackage(pkg)).toThrow('Prüfungspakete');
  });
  it('accepts every requested exam duration', async () => {
    const pkg = await sample();
    for (const duration of [10, 20, 30, 40, 45, 60] as const) {
      pkg.tests[0].durationMinutes = duration;
      expect(() => parseContentPackage(pkg)).not.toThrow();
    }
  });
  it('requires local immutable catalog paths matching identity/version', async () => {
    const pkg = await sample();
    const meta = Object.fromEntries(
      Object.entries(pkg).filter(
        ([key]) => !['questionBank', 'tests', 'packageVersion'].includes(key),
      ),
    );
    const catalog = {
      catalogVersion: 1,
      updatedAt: meta.createdAt,
      packages: [{ ...meta, url: `packages/${meta.id}-v${meta.version}.json` }],
    };
    expect(parseCatalog(catalog)).toEqual(catalog);
    catalog.packages[0].url = 'https://evil.invalid/a.json';
    expect(() => parseCatalog(catalog)).toThrow();
  });
  it('verifies the Python-published package with the same RFC8785 hash', async () => {
    const catalog = parseCatalog(
      JSON.parse(readFileSync(new URL('../content/catalog.json', import.meta.url), 'utf8')),
    );
    for (const entry of catalog.packages) {
      const pkg = parseContentPackage(
        JSON.parse(readFileSync(new URL(`../content/${entry.url}`, import.meta.url), 'utf8')),
      );
      expect(pkg.contentHash).toBe(entry.contentHash);
      expect(await verifyContentHash(pkg)).toBe(true);
    }
  });
});
