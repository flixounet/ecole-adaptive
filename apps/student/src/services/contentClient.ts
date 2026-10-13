import {
  parseCatalog,
  parseContentPackage,
  type CatalogEntry,
  type ContentCatalog,
  type ContentPackage,
} from '@shared/content';

export const CONTENT_LIMITS = { catalogBytes: 2 * 1024 * 1024, packageBytes: 20 * 1024 * 1024 };
export const catalogUrl = () =>
  new URL(`${import.meta.env.BASE_URL}content/catalog.json`, window.location.href);
async function fetchJson(url: URL, limit: number, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal });
  if (!response.ok)
    throw new Error('Die Inhalte sind gerade nicht erreichbar. Bitte später erneut versuchen.');
  if (Number(response.headers.get('content-length')) > limit)
    throw new Error('Die Inhaltsdatei ist zu groß.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Der Download konnte nicht gelesen werden.');
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error('Die Inhaltsdatei ist zu groß.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Die Inhaltsdatei ist beschädigt oder kein gültiges JSON.');
  }
}
export async function fetchCatalog(signal: AbortSignal): Promise<ContentCatalog> {
  return parseCatalog(await fetchJson(catalogUrl(), CONTENT_LIMITS.catalogBytes, signal));
}
export async function fetchPackage(
  entry: CatalogEntry,
  signal: AbortSignal,
): Promise<ContentPackage> {
  // parseCatalog enforces this same relative format. Recheck before any network action.
  if (
    entry.url !== `packages/${entry.id}-v${entry.version}.json` ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(entry.id)
  )
    throw new Error('Ungültiger Paketpfad.');
  const pkg = parseContentPackage(
    await fetchJson(new URL(entry.url, catalogUrl()), CONTENT_LIMITS.packageBytes, signal),
  );
  if (
    pkg.id !== entry.id ||
    pkg.version !== entry.version ||
    pkg.contentHash !== entry.contentHash ||
    pkg.subject !== entry.subject ||
    pkg.grade !== entry.grade ||
    pkg.title !== entry.title ||
    pkg.chapter !== entry.chapter ||
    pkg.createdAt !== entry.createdAt ||
    [...pkg.studentIds].sort().join('|') !== [...entry.studentIds].sort().join('|') ||
    [...pkg.modes].sort().join('|') !== [...entry.modes].sort().join('|')
  )
    throw new Error('Paket und Katalog stimmen nicht überein. Bitte den Katalog neu laden.');
  return pkg;
}
export function sameGrade(first: string, second: string) {
  const normalize = (value: string) =>
    value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, '');
  return normalize(first) === normalize(second);
}
