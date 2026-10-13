import Ajv from 'ajv';
import bankSchema from './schemas/question-bank.schema.json';
import packageSchema from './schemas/content-package.schema.json';
import catalogSchema from './schemas/content-catalog.schema.json';
import { parseQuestionBank } from './validation';
import type { QuestionBank } from './types';

export type ContentMode = 'learn' | 'exam';
export interface TestBlueprint {
  id: string;
  title: string;
  mode: 'exam';
  durationMinutes: 10 | 20 | 30 | 40 | 45 | 60;
  questionIds: string[];
  seed?: number;
  skillDistribution?: Record<string, number>;
  difficultyDistribution?: Partial<Record<'1' | '2' | '3' | '4', number>>;
}
export interface PackageMetadata {
  id: string;
  version: number;
  contentHash: string;
  createdAt: string;
  studentIds: string[];
  subject: string;
  grade: string;
  chapter: string;
  title: string;
  modes: ContentMode[];
}
export interface ContentPackage extends PackageMetadata {
  packageVersion: 1;
  questionBank: QuestionBank;
  tests: TestBlueprint[];
}
export interface CatalogEntry extends PackageMetadata {
  url: string;
}
export interface ContentCatalog {
  catalogVersion: 1;
  updatedAt: string;
  packages: CatalogEntry[];
}

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(bankSchema);
const validatePackage = ajv.compile<ContentPackage>(packageSchema);
const validateCatalog = ajv.compile<ContentCatalog>(catalogSchema);
function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function validateBlueprint(blueprint: TestBlueprint, bank: QuestionBank): void {
  const shape = ajv.getSchema(
    'https://ecole-adaptive.local/schemas/content-package-1.json#/properties/tests/items',
  );
  if (!shape?.(blueprint)) throw new Error('Ungültiger Prüfungsplan.');
  const questionIds = new Set(bank.questions.map((q) => q.id));
  const skillIds = new Set(bank.skills.map((skill) => skill.id));
  if (blueprint.questionIds.some((id) => !questionIds.has(id)))
    throw new Error('Prüfungsplan enthält unbekannte Aufgaben.');
  if (Object.keys(blueprint.skillDistribution ?? {}).some((id) => !skillIds.has(id)))
    throw new Error('Prüfungsplan enthält unbekannte Kompetenzen.');
  for (const distribution of [blueprint.skillDistribution, blueprint.difficultyDistribution]) {
    if (
      distribution &&
      Math.abs(Object.values(distribution).reduce((sum, n) => sum + n, 0) - 100) > 1e-7
    )
      throw new Error('Prüfungsverteilung muss 100 Prozent ergeben.');
  }
}

export function parseContentPackage(input: unknown): ContentPackage {
  if (!validatePackage(input))
    throw new Error(`Ungültiges Inhaltspaket: ${ajv.errorsText(validatePackage.errors)}`);
  const pkg = input;
  const bank = parseQuestionBank(pkg.questionBank);
  for (const key of ['id', 'version', 'subject', 'grade', 'chapter', 'title'] as const) {
    if (pkg[key] !== bank[key])
      throw new Error(`Paketmetadaten stimmen nicht mit der Aufgabenbank überein: ${key}.`);
  }
  if (canonicalJson([...pkg.studentIds].sort()) !== canonicalJson([...bank.studentIds].sort()))
    throw new Error('Paketzuordnung stimmt nicht mit der Aufgabenbank überein.');
  if (!validDate(pkg.createdAt)) throw new Error('Ungültiges Paketdatum.');
  if (pkg.modes.includes('exam') !== pkg.tests.length > 0)
    throw new Error('Prüfungspakete benötigen mindestens einen festen Prüfungsplan.');
  if (new Set(pkg.tests.map((test) => test.id)).size !== pkg.tests.length)
    throw new Error('Doppelte Prüfungsplan-ID.');
  for (const test of pkg.tests) validateBlueprint(test, bank);
  canonicalJson(pkg); // Reject non-I-JSON strings and non-finite numbers before hashing/export.
  return pkg;
}

export function parseCatalog(input: unknown): ContentCatalog {
  if (!validateCatalog(input))
    throw new Error(`Ungültiger Inhaltskatalog: ${ajv.errorsText(validateCatalog.errors)}`);
  if (!validDate(input.updatedAt) || input.packages.some((pkg) => !validDate(pkg.createdAt)))
    throw new Error('Ungültiges Katalogdatum.');
  if (new Set(input.packages.map((pkg) => pkg.id)).size !== input.packages.length)
    throw new Error('Doppelte Paket-ID im Katalog.');
  for (const pkg of input.packages)
    if (pkg.url !== `packages/${pkg.id}-v${pkg.version}.json`)
      throw new Error('Paketpfad passt nicht zu ID und Version.');
  return input;
}

/** RFC 8785 for JSON values: ECMAScript numbers and UTF-16 code-unit key ordering. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Nicht endliche JSON-Zahl.');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Ungültiges Unicode-Zeichen.');
      } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('Ungültiges Unicode-Zeichen.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${canonicalJson(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  throw new Error('Nur JSON-Daten sind erlaubt.');
}

// SHA-256 also works on a local HTTP LAN where crypto.subtle is not exposed.
// Kept deterministic and tested against node:crypto and RFC8785 cross-language fixtures.
export function sha256(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(length);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(length - 4, bytes.length * 8);
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotate = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits));
  const w = new Uint32Array(64);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15],
        b = w[i - 2];
      w[i] =
        (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) +
        w[i - 16] +
        (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10)) +
        w[i - 7];
    }
    let [a, b, c, d, e, f, g, z] = h;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (z + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) |
        0;
      const t2 =
        ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      z = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, z].forEach((n, i) => {
      h[i] = (h[i] + n) | 0;
    });
  }
  return h.map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');
}
export async function computeContentHash(
  pkg: Omit<ContentPackage, 'contentHash'> | ContentPackage,
): Promise<string> {
  const data = { ...pkg } as Partial<ContentPackage>;
  delete data.contentHash;
  return sha256(canonicalJson(data));
}
export async function verifyContentHash(pkg: ContentPackage): Promise<boolean> {
  return pkg.contentHash === (await computeContentHash(pkg));
}
