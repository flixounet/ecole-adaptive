import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { computeContentHash, type ContentPackage } from '@shared/content';
import { parseQuestionBank } from '@shared/validation';
import source from '@shared/fixtures/lutz-maths-demo.json';
import {
  LearningDatabase,
  initializeDemo,
  listProfiles,
  listBanks,
  listResults,
  completeSession,
  getActiveSession,
  listRecentAttempts,
  hasAnyActiveSession,
} from './database';
import { createProfile, saveProfile, archiveProfile } from './profileRepository';
import {
  listInstalledPackages,
  installContentPackage,
  startBlueprintSession,
} from './contentRepository';
import { exportBackup, importBackup } from './backupRepository';
import { createSession, setAnswer } from '../domain/session';
import { startAdaptiveSession } from './repositories';

let database: LearningDatabase;
const extras: LearningDatabase[] = [];
beforeEach(async () => {
  database = new LearningDatabase(`phase3-${crypto.randomUUID()}`);
  await initializeDemo(database);
});
afterEach(async () => {
  for (const db of [database, ...extras.splice(0)]) {
    db.close();
    await db.delete();
  }
});
async function sample(version = 1): Promise<ContentPackage> {
  const bank = parseQuestionBank({
    ...structuredClone(source),
    id: 'new-unit',
    version,
    studentIds: ['lutz', 'max'],
  });
  const pkg: ContentPackage = {
    packageVersion: 1,
    id: bank.id,
    version,
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
        id: 'fixed',
        title: 'Feste Prüfung',
        mode: 'exam',
        durationMinutes: 10,
        questionIds: [bank.questions[3].id, bank.questions[1].id],
        seed: 1,
      },
    ],
  };
  pkg.contentHash = await computeContentHash(pkg);
  return pkg;
}
describe('managed profiles and additive v3 migration', () => {
  it('seeds grades, creates unlimited named IDs, edits and archives without losing results', async () => {
    expect((await listProfiles(database)).map((p) => p.grade)).toEqual(['3eme', '5eme', 'CM1']);
    const one = await createProfile({ name: 'Émile', grade: 'CM2' }, database),
      two = await createProfile({ name: 'Émile', grade: '6eme' }, database);
    expect([one.id, two.id]).toEqual(['emile', 'emile-2']);
    await saveProfile({ ...one, name: 'Emile modifié', grade: '6eme' }, database);
    await archiveProfile(one.id, true, database);
    expect((await listProfiles(database)).some((p) => p.id === one.id)).toBe(false);
    expect((await listProfiles(true, database)).find((p) => p.id === one.id)?.name).toBe(
      'Emile modifié',
    );
    await archiveProfile(one.id, false, database);
    expect((await listProfiles(database)).find((p) => p.id === one.id)?.grade).toBe('6eme');
  });
  it('migrates actual v2 profiles without overwriting personalized grades or other stores', async () => {
    const name = `v2-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(2).stores({
      profiles: '&id',
      banks: '&id,*studentIds',
      sessions: '&id,studentId,status,[studentId+status],startedAt',
      results: '&id,studentId,date',
      studentSkillStates: '[studentId+subject+skillId],studentId,[studentId+subject]',
      attemptRecords: '&id,studentId,[studentId+subject],sessionId,timestamp',
      questionHistory: '&id,studentId,[studentId+subject],sessionId,shownAt',
    });
    await old.table('profiles').bulkAdd([
      { id: 'max', name: 'Max', grade: '2nde', preferredLanguage: 'fr', subjects: ['french'] },
      {
        id: 'ben',
        name: 'Ben',
        grade: 'Noch nicht festgelegt',
        preferredLanguage: 'de',
        subjects: ['maths'],
      },
    ]);
    old.close();
    const migrated = new LearningDatabase(name);
    extras.push(migrated);
    await migrated.open();
    expect(migrated.verno).toBe(3);
    const profiles = await listProfiles(migrated);
    expect(profiles.find((p) => p.id === 'max')).toMatchObject({
      grade: '2nde',
      preferredLanguage: 'fr',
      subjects: ['french'],
      archived: false,
    });
    expect(profiles.find((p) => p.id === 'ben')?.grade).toBe('CM1');
    expect(await migrated.installedPackages.count()).toBe(0);
  });
});
describe('per-profile immutable packages and blueprints', () => {
  it('installs for one assigned profile only, rejects wrong profile and checksum', async () => {
    const pkg = await sample();
    expect((await installContentPackage('lutz', pkg, database)).status).toBe('installed');
    expect((await listBanks('lutz', database)).some((b) => b.id === pkg.id)).toBe(true);
    expect(await listBanks('max', database)).toEqual([]);
    expect(await listInstalledPackages('max', database)).toEqual([]);
    await expect(installContentPackage('ben', pkg, database)).rejects.toThrow('zugeordnet');
    await expect(
      installContentPackage('max', { ...pkg, contentHash: '0'.repeat(64) }, database),
    ).rejects.toThrow('Prüfsumme');
  });
  it('keeps installation idempotent, rejects rewrites/downgrades and preserves old results on update', async () => {
    const pkg = await sample();
    await installContentPackage('lutz', pkg, database);
    const first = await listInstalledPackages('lutz', database);
    expect((await installContentPackage('lutz', pkg, database)).status).toBe('unchanged');
    expect(await listInstalledPackages('lutz', database)).toEqual(first);
    const rewrite = structuredClone(pkg);
    rewrite.questionBank.questions[0].points = 0.5;
    rewrite.contentHash = await computeContentHash(rewrite);
    await expect(installContentPackage('lutz', rewrite, database)).rejects.toThrow(
      'Gleiche Paketversion',
    );
    const session = await startBlueprintSession(pkg, 'fixed', 'lutz', 1_000, database);
    const result = await completeSession(session, 2_000, database);
    expect((await installContentPackage('lutz', await sample(2), database)).status).toBe('updated');
    expect((await listResults('lutz', database))[0]).toEqual(result);
    await expect(installContentPackage('lutz', pkg, database)).rejects.toThrow('ältere');
  });
  it('starts fixed ordered exams with configured deadline and retains snapshots across reload', async () => {
    const pkg = await sample();
    await installContentPackage('lutz', pkg, database);
    let session = await startBlueprintSession(pkg, 'fixed', 'lutz', 1_000, database);
    expect(session.questionIds).toEqual(pkg.tests[0].questionIds);
    expect(session.deadlineAt).toBe(601_000);
    expect(session.bankSnapshot.durationMinutes).toBe(pkg.questionBank.durationMinutes);
    session = setAnswer(session, session.questionIds[0], '8', 2_000);
    const { persistSession } = await import('./database');
    await persistSession(session, database);
    const name = database.name;
    database.close();
    database = new LearningDatabase(name);
    expect(await getActiveSession('lutz', database)).toEqual(session);
    await expect(installContentPackage('lutz', await sample(2), database)).rejects.toThrow(
      'laufenden Klassenarbeit',
    );
    await expect(archiveProfile('lutz', true, database)).rejects.toThrow('laufende Runde');
    expect(await hasAnyActiveSession(database)).toBe(true);
    const result = await completeSession(session, 999_999, database);
    expect(result.durationSeconds).toBe(600);
    expect(result.blueprintSnapshot).toEqual(pkg.tests[0]);
  });
  it('rejects altered fixed plans and keeps adaptive learning for learning-enabled packages', async () => {
    const pkg = await sample();
    await installContentPackage('lutz', pkg, database);
    await expect(
      startAdaptiveSession(
        pkg.questionBank,
        'lutz',
        'exam',
        1_000,
        Math.random,
        undefined,
        database,
      ),
    ).rejects.toThrow('festen Prüfungsplan');
    const session = await startBlueprintSession(pkg, 'fixed', 'lutz', 1_000, database);
    const { persistSession } = await import('./database');
    await expect(
      persistSession({ ...session, questionIds: [...session.questionIds].reverse() }, database),
    ).rejects.toThrow('feste Prüfung');
    await completeSession(session, 2_000, database);
    const learn = await startAdaptiveSession(
      pkg.questionBank,
      'lutz',
      'learn',
      3_000,
      Math.random,
      undefined,
      database,
    );
    expect(learn.adaptive).toBe(true);
  });
  it('allows focused error training after an exam-only package while ordinary learning remains disabled', async () => {
    const pkg = await sample();
    pkg.modes = ['exam'];
    pkg.contentHash = await computeContentHash(pkg);
    await installContentPackage('lutz', pkg, database);
    await expect(
      startAdaptiveSession(
        pkg.questionBank,
        'lutz',
        'learn',
        1_000,
        Math.random,
        undefined,
        database,
      ),
    ).rejects.toThrow('ausschließlich');
    const exam = await startBlueprintSession(pkg, 'fixed', 'lutz', 1_000, database);
    const result = await completeSession(exam, 2_000, database);
    const training = await startAdaptiveSession(
      pkg.questionBank,
      'lutz',
      'error_training',
      3_000,
      () => 0.2,
      result,
      database,
    );
    expect(training.sourceResultId).toBe(result.id);
    expect(training.mode).toBe('error_training');
    expect(training.questionIds.length).toBeGreaterThan(0);
    const originalSkills = new Set(
      result.answers
        .filter((a) => !a.correct)
        .flatMap((a) => pkg.questionBank.questions.find((q) => q.id === a.questionId)!.skillIds),
    );
    for (const id of training.questionIds)
      expect(
        pkg.questionBank.questions
          .find((q) => q.id === id)!
          .skillIds.some((skill) => originalSkills.has(skill)),
      ).toBe(true);
    await completeSession(training, 4_000, database);
    await expect(
      startAdaptiveSession(
        pkg.questionBank,
        'max',
        'error_training',
        5_000,
        Math.random,
        result,
        database,
      ),
    ).rejects.toThrow('anderen Profil');
  });
  it('isolates installations, updates, results and archives for Max, Lutz and Ben', async () => {
    const pkg = await sample();
    pkg.studentIds = ['max', 'lutz', 'ben'];
    pkg.questionBank.studentIds = [...pkg.studentIds];
    pkg.contentHash = await computeContentHash(pkg);
    for (const studentId of pkg.studentIds) {
      await installContentPackage(studentId, pkg, database);
      let session = await startBlueprintSession(pkg, 'fixed', studentId, 1_000, database);
      if (studentId === 'max') {
        const question = pkg.questionBank.questions.find((q) => q.id === session.questionIds[0])!;
        session = setAnswer(session, question.id, question.correctAnswer, 1_100);
      }
      await completeSession(session, 2_000, database);
    }
    const update = structuredClone(pkg);
    update.version = 2;
    update.questionBank.version = 2;
    update.contentHash = await computeContentHash(update);
    await installContentPackage('max', update, database);
    for (const studentId of pkg.studentIds) {
      const [result] = await listResults(studentId, database);
      expect(result.studentId).toBe(studentId);
      expect(result.bankVersion).toBe(1);
      expect((await listInstalledPackages(studentId, database))[0].package.version).toBe(
        studentId === 'max' ? 2 : 1,
      );
      expect(
        (await listRecentAttempts(studentId, 'maths', 10, database)).every(
          (a) => a.studentId === studentId,
        ),
      ).toBe(true);
    }
    await archiveProfile('lutz', true, database);
    expect(await listResults('lutz', database)).toHaveLength(1);
    expect(await listInstalledPackages('lutz', database)).toHaveLength(1);
    expect((await listProfiles(database)).map((p) => p.id)).toEqual(['max', 'ben']);
  });
  it('loads only the newest limited attempts per subject and profile through compound indexes', async () => {
    const bank = (await listBanks('lutz', database))[0];
    const session = createSession(bank, 'lutz', 'exam', 1_000);
    await completeSession(session, 2_000, database);
    expect(await listRecentAttempts('max', undefined, 2, database)).toEqual([]);
    expect(await listRecentAttempts('lutz', 'english', 2, database)).toEqual([]);
    expect(await listRecentAttempts('lutz', 'maths', 2, database)).toHaveLength(2);
  });
});
describe('complete validated backup and atomic merge', () => {
  it('restores package, active deadline, answers, mastery and archived custom profiles on a fresh device', async () => {
    const pkg = await sample();
    await installContentPackage('lutz', pkg, database);
    const session = await startBlueprintSession(pkg, 'fixed', 'lutz', 1_000, database);
    await completeSession(session, 2_000, database);
    const next = await startBlueprintSession(pkg, 'fixed', 'lutz', 3_000, database);
    const custom = await createProfile({ name: 'Test Kind', grade: 'CM1' }, database);
    await archiveProfile(custom.id, true, database);
    const max = (await listProfiles(database)).find((p) => p.id === 'max')!;
    await saveProfile({ ...max, grade: '2nde' }, database);
    const backup = await exportBackup(database);
    const target = new LearningDatabase(`restore-${crypto.randomUUID()}`);
    extras.push(target);
    await initializeDemo(target);
    expect((await importBackup(JSON.parse(JSON.stringify(backup)), target)).added).toBeGreaterThan(
      0,
    );
    expect(await getActiveSession('lutz', target)).toEqual(next);
    expect((await listProfiles(true, target)).find((p) => p.id === custom.id)?.archived).toBe(true);
    expect((await listProfiles(target)).find((p) => p.id === 'max')?.grade).toBe('2nde');
    const restored = await exportBackup(target);
    expect({ ...restored, exportedAt: backup.exportedAt }).toEqual(backup);
    expect((await importBackup(backup, target)).added).toBe(0);
  });
  it('rejects conflicts atomically while preserving unrelated profiles', async () => {
    const backup = await exportBackup(database);
    const custom = await createProfile({ name: 'Unique', grade: 'CM1' }, database);
    const max = (await listProfiles(database)).find((p) => p.id === 'max')!;
    await saveProfile({ ...max, grade: '2nde' }, database);
    backup.profiles.push({ ...custom, id: 'new-from-backup' });
    await expect(importBackup(backup, database)).rejects.toThrow('Konflikt');
    expect(await database.profiles.get('new-from-backup')).toBeUndefined();
    expect(await database.profiles.get(custom.id)).toEqual(custom);
  });
  it('rejects malformed backup, package hashes and cross-profile references before writing', async () => {
    const pkg = await sample();
    await installContentPackage('lutz', pkg, database);
    const backup = await exportBackup(database);
    backup.installedPackages[0].studentId = 'ben';
    await expect(importBackup(backup, database)).rejects.toThrow('Paket');
    await expect(importBackup({ ...backup, backupVersion: 99 }, database)).rejects.toThrow(
      'Sicherung',
    );
    expect(await database.results.count()).toBe(0);
  });
  it('rolls back every restored table if a late IndexedDB write fails', async () => {
    const pkg = await sample();
    await installContentPackage('lutz', pkg, database);
    const session = await startBlueprintSession(pkg, 'fixed', 'lutz', 1_000, database);
    await completeSession(session, 2_000, database);
    const backup = await exportBackup(database);
    const target = new LearningDatabase(`rollback-${crypto.randomUUID()}`);
    extras.push(target);
    await initializeDemo(target);
    const reject = () => {
      throw new Error('Disk full');
    };
    target.questionHistory.hook('creating', reject);
    await expect(importBackup(backup, target)).rejects.toThrow('Disk full');
    target.questionHistory.hook('creating').unsubscribe(reject);
    expect(await target.results.count()).toBe(0);
    expect(await target.attemptRecords.count()).toBe(0);
    expect(await target.studentSkillStates.count()).toBe(0);
    expect(await target.installedPackages.count()).toBe(0);
  });
});
