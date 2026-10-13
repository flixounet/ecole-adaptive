import Ajv from 'ajv';
import { canonicalJson, parseContentPackage, verifyContentHash } from '@shared/content';
import {
  parseManagedProfile,
  upgradeProfile,
  defaultSubjects,
  type ManagedStudentProfile,
} from '@shared/profiles';
import { parseQuestionBank } from '@shared/validation';
import type { QuestionBank } from '@shared/types';
import backupSchema from '@shared/schemas/backup.schema.json';
import bankSchema from '@shared/schemas/question-bank.schema.json';
import profileSchema from '@shared/schemas/student-profile.schema.json';
import profilesFixture from '@shared/fixtures/profiles.json';
import demoFixture from '@shared/fixtures/lutz-maths-demo.json';
import type { Result, Session } from '../domain/session';
import type { AttemptRecord, StudentSkillState } from '../domain/adaptive/types';
import { validateSkillState } from '../domain/adaptive/mastery';
import {
  db,
  LearningDatabase,
  normalizeResult,
  validateSession,
  validateStoredAttempt,
  type InstalledPackage,
  type QuestionHistory,
} from './database';

export interface BackupDTO {
  backupVersion: 1;
  exportedAt: string;
  profiles: ManagedStudentProfile[];
  banks: QuestionBank[];
  installedPackages: InstalledPackage[];
  sessions: Session[];
  results: Result[];
  studentSkillStates: StudentSkillState[];
  attemptRecords: AttemptRecord[];
  questionHistory: QuestionHistory[];
}
const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addSchema(bankSchema);
ajv.addSchema(profileSchema, 'student-profile');
const validateShape = ajv.compile<BackupDTO>(backupSchema);
const tableNames = [
  'profiles',
  'banks',
  'installedPackages',
  'sessions',
  'results',
  'studentSkillStates',
  'attemptRecords',
  'questionHistory',
] as const;
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Ungültige Sicherung: ${message}`);
}
function uniqueKeys<T>(rows: T[], key: (row: T) => string): void {
  requireThat(new Set(rows.map(key)).size === rows.length, 'doppelte Datensatz-ID.');
}
export async function parseBackup(input: unknown): Promise<BackupDTO> {
  requireThat(validateShape(input), ajv.errorsText(validateShape.errors));
  const backup = structuredClone(input);
  requireThat(Number.isFinite(Date.parse(backup.exportedAt)), 'Exportdatum.');
  canonicalJson(backup);
  backup.profiles.forEach(parseManagedProfile);
  backup.banks.forEach(parseQuestionBank);
  uniqueKeys(backup.profiles, (row) => row.id);
  uniqueKeys(backup.banks, (row) => row.id);
  const profiles = new Set(backup.profiles.map((row) => row.id));
  const own = (id: string) =>
    requireThat(profiles.has(id), 'Datensatz verweist auf unbekanntes Profil.');
  const sessionMap = new Map(backup.sessions.map((row) => [row.id, row]));
  const activeProfiles = new Set<string>();
  uniqueKeys(backup.sessions, (row) => row.id);
  uniqueKeys(backup.results, (row) => row.id);
  for (const session of backup.sessions) {
    validateSession(session);
    own(session.studentId);
    if (session.status === 'active') {
      requireThat(!activeProfiles.has(session.studentId), 'mehrere aktive Runden eines Profils.');
      activeProfiles.add(session.studentId);
    }
  }
  for (const result of backup.results) {
    normalizeResult(result);
    own(result.studentId);
    requireThat(result.bankSnapshot.studentIds.includes(result.studentId), 'Ergebniszuordnung.');
    const session = sessionMap.get(result.id);
    if (session)
      requireThat(
        session.studentId === result.studentId && session.status === 'completed',
        'Ergebnis und Sitzung widersprechen sich.',
      );
  }
  uniqueKeys(backup.installedPackages, (row) => `${row.studentId}:${row.packageId}`);
  for (const row of backup.installedPackages) {
    own(row.studentId);
    const pkg = parseContentPackage(row.package);
    requireThat(
      row.packageId === pkg.id &&
        pkg.studentIds.includes(row.studentId) &&
        Number.isFinite(Date.parse(row.installedAt)) &&
        (await verifyContentHash(pkg)),
      'installiertes Paket oder Prüfsumme.',
    );
  }
  uniqueKeys(backup.studentSkillStates, (row) => `${row.studentId}:${row.subject}:${row.skillId}`);
  for (const state of backup.studentSkillStates) {
    own(state.studentId);
    validateSkillState(state);
  }
  uniqueKeys(backup.attemptRecords, (row) => row.id);
  for (const record of backup.attemptRecords) {
    own(record.studentId);
    validateStoredAttempt(record);
    const session = sessionMap.get(record.sessionId);
    requireThat(
      session &&
        session.studentId === record.studentId &&
        session.bankSnapshot.subject === record.subject &&
        session.questionIds.includes(record.questionId) &&
        record.id === `${record.sessionId}:${record.questionId}`,
      'Versuch und Sitzung widersprechen sich.',
    );
  }
  uniqueKeys(backup.questionHistory, (row) => row.id);
  for (const row of backup.questionHistory) {
    own(row.studentId);
    const session = sessionMap.get(row.sessionId);
    requireThat(
      session &&
        session.studentId === row.studentId &&
        session.bankId === row.bankId &&
        session.bankSnapshot.subject === row.subject &&
        session.mode === row.mode &&
        session.bankSnapshot.questions.some((q) => q.id === row.questionId) &&
        row.id === `${row.sessionId}:${row.questionId}` &&
        Number.isFinite(row.shownAt) &&
        row.shownAt >= session.startedAt,
      'Aufgabenhistorie.',
    );
  }
  return backup;
}

/** Explicit user-requested whole-device export; ordinary learning queries remain scoped. */
export async function exportBackup(database: LearningDatabase = db): Promise<BackupDTO> {
  const backup = await database.transaction(
    'r',
    tableNames.map((name) => database.table(name)),
    async () => {
      const result: Record<string, unknown> = {
        backupVersion: 1,
        exportedAt: new Date().toISOString(),
      };
      for (const name of tableNames) result[name] = await database.table(name).toArray();
      return result;
    },
  );
  return parseBackup(backup);
}
export async function importBackup(
  input: unknown,
  database: LearningDatabase = db,
): Promise<{ added: number; unchanged: number }> {
  const backup = await parseBackup(input); // All schemas, references and hashes before any writes.
  return database.transaction(
    'rw',
    tableNames.map((name) => database.table(name)),
    async () => {
      let added = 0,
        unchanged = 0;
      const incomingActives = backup.sessions.filter((session) => session.status === 'active');
      for (const session of incomingActives) {
        const active = await database.sessions
          .where('[studentId+status]')
          .equals([session.studentId, 'active'])
          .first();
        requireThat(
          !active || active.id === session.id,
          'bestehende aktive Runde kollidiert mit Sicherung.',
        );
      }
      const pristineProfile = async (id: string, existing: unknown): Promise<boolean> => {
        const fixture = profilesFixture.find((profile) => profile.id === id);
        if (
          !fixture ||
          canonicalJson(existing) !==
            canonicalJson(
              upgradeProfile(
                { ...fixture, subjects: [...defaultSubjects] },
                '2026-10-10T00:00:00.000Z',
              ),
            )
        )
          return false;
        for (const name of [
          'sessions',
          'results',
          'studentSkillStates',
          'attemptRecords',
          'questionHistory',
          'installedPackages',
        ])
          if (await database.table(name).where('studentId').equals(id).count()) return false;
        return true;
      };
      // Validate every conflict first. No table can be partially restored on rejection.
      const additions: Array<{ table: string; row: unknown; replace: boolean }> = [];
      for (const name of tableNames)
        for (const row of backup[name]) {
          const key =
            name === 'installedPackages'
              ? [(row as InstalledPackage).studentId, (row as InstalledPackage).packageId]
              : name === 'studentSkillStates'
                ? [
                    (row as StudentSkillState).studentId,
                    (row as StudentSkillState).subject,
                    (row as StudentSkillState).skillId,
                  ]
                : (row as { id: string }).id;
          const existing = await database.table(name).get(key);
          if (existing === undefined) {
            additions.push({ table: name, row, replace: false });
            continue;
          }
          if (canonicalJson(existing) === canonicalJson(row)) {
            unchanged++;
            continue;
          }
          const seedProfile =
            name === 'profiles' &&
            (await pristineProfile((row as ManagedStudentProfile).id, existing));
          const seedBank =
            name === 'banks' &&
            canonicalJson(existing) === canonicalJson(demoFixture) &&
            !(await database.sessions
              .filter((session) => session.bankId === (row as QuestionBank).id)
              .count());
          requireThat(
            seedProfile || seedBank,
            `Konflikt in ${name} (${Array.isArray(key) ? key.join('/') : key}). Es wurde nichts importiert.`,
          );
          additions.push({ table: name, row, replace: true });
        }
      for (const { table, row, replace } of additions) {
        if (replace) await database.table(table).put(row);
        else await database.table(table).add(row);
        added++;
      }
      return { added, unchanged };
    },
  );
}
