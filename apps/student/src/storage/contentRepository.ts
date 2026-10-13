import {
  canonicalJson,
  parseContentPackage,
  verifyContentHash,
  type ContentPackage,
  type CatalogEntry,
} from '@shared/content';
import { createSession, emptyAnswer, type Session } from '../domain/session';
import {
  db,
  LearningDatabase,
  listSkillStates,
  masterySnapshot,
  persistSession,
  type InstalledPackage,
} from './database';

export async function listInstalledPackages(
  studentId: string,
  database: LearningDatabase = db,
): Promise<InstalledPackage[]> {
  const rows = await database.installedPackages.where('studentId').equals(studentId).toArray();
  for (const row of rows) {
    const pkg = parseContentPackage(row.package);
    if (
      row.packageId !== pkg.id ||
      !pkg.studentIds.includes(studentId) ||
      !Number.isFinite(Date.parse(row.installedAt)) ||
      !(await verifyContentHash(pkg))
    )
      throw new Error('Installiertes Inhaltspaket ist beschädigt.');
  }
  return rows.sort((a, b) => a.package.title.localeCompare(b.package.title));
}
export function matchesCatalogEntry(pkg: ContentPackage, entry: CatalogEntry): boolean {
  const metadata = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'url'));
  const actual = Object.fromEntries(
    Object.keys(metadata).map((key) => [key, pkg[key as keyof ContentPackage]]),
  );
  return canonicalJson(actual) === canonicalJson(metadata);
}
export async function installContentPackage(
  studentId: string,
  input: unknown,
  database: LearningDatabase = db,
): Promise<{ status: 'installed' | 'updated' | 'unchanged'; installed: InstalledPackage }> {
  const pkg = structuredClone(parseContentPackage(input));
  if (!(await verifyContentHash(pkg)))
    throw new Error('Prüfsumme stimmt nicht. Das Paket wurde nicht installiert.');
  if (!pkg.studentIds.includes(studentId))
    throw new Error('Dieses Paket ist dem Profil nicht zugeordnet.');
  return database.transaction(
    'rw',
    [database.profiles, database.installedPackages, database.sessions],
    async () => {
      const profile = await database.profiles.get(studentId);
      if (!profile || profile.archived) throw new Error('Das Profil ist nicht verfügbar.');
      const existing = await database.installedPackages.get([studentId, pkg.id]);
      if (existing) {
        parseContentPackage(existing.package);
        if (!(await verifyContentHash(existing.package)))
          throw new Error('Das installierte Paket ist beschädigt.');
        if (existing.package.version > pkg.version)
          throw new Error('Eine ältere Paketversion kann die installierte nicht ersetzen.');
        if (existing.package.version === pkg.version) {
          if (existing.package.contentHash !== pkg.contentHash)
            throw new Error(
              'Gleiche Paketversion mit anderer Prüfsumme. Bitte eine neue Version veröffentlichen.',
            );
          return { status: 'unchanged', installed: existing };
        }
      }
      if (
        await database.sessions
          .where('[studentId+status]')
          .equals([studentId, 'active'])
          .and((session) => session.mode === 'exam')
          .count()
      )
        throw new Error(
          'Während einer laufenden Klassenarbeit können keine Inhaltspakete installiert oder ersetzt werden.',
        );
      const installed: InstalledPackage = {
        studentId,
        packageId: pkg.id,
        installedAt: new Date().toISOString(),
        package: pkg,
      };
      await database.installedPackages.put(installed);
      return { status: existing ? 'updated' : 'installed', installed };
    },
  );
}
export async function startBlueprintSession(
  input: ContentPackage,
  blueprintId: string,
  studentId: string,
  now = Date.now(),
  database: LearningDatabase = db,
): Promise<Session> {
  const pkg = structuredClone(parseContentPackage(input));
  const installed = await database.installedPackages.get([studentId, pkg.id]);
  if (
    !installed ||
    installed.package.contentHash !== pkg.contentHash ||
    installed.package.version !== pkg.version ||
    !(await verifyContentHash(pkg))
  )
    throw new Error('Die ausgewählte Paketversion ist für dieses Profil nicht installiert.');
  const blueprint = pkg.tests.find((test) => test.id === blueprintId);
  if (!pkg.modes.includes('exam') || !blueprint)
    throw new Error('Der feste Prüfungsplan wurde nicht gefunden.');
  const profile = await database.profiles.get(studentId);
  if (!profile || profile.archived) throw new Error('Das Profil ist nicht verfügbar.');
  const states = await listSkillStates(studentId, pkg.subject, database);
  const base = createSession(pkg.questionBank, studentId, 'exam', now, () => 0);
  const questionIds = [...blueprint.questionIds];
  return persistSession(
    {
      ...base,
      adaptive: false,
      questionIds,
      targetQuestionCount: questionIds.length,
      blueprintSnapshot: structuredClone(blueprint),
      packageContentHash: pkg.contentHash,
      deadlineAt: now + blueprint.durationMinutes * 60_000,
      masteryBefore: masterySnapshot(pkg.questionBank, studentId, states),
      answers: Object.fromEntries(
        questionIds.map((id, index) => [id, emptyAnswer(index === 0 ? now : null)]),
      ),
    },
    database,
  );
}
