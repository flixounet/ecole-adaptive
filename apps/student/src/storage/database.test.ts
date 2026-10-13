import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession, isExpired, setAnswer } from '../domain/session';
import {
  LearningDatabase,
  completeSession,
  getActiveSession,
  initializeDemo,
  listBanks,
  listProfiles,
  listResults,
  loadResult,
  saveSession,
} from './database';

let database: LearningDatabase;

beforeEach(async () => {
  database = new LearningDatabase(`ecole-test-${crypto.randomUUID()}`);
  await initializeDemo(database);
});

afterEach(async () => {
  database.close();
  await database.delete();
});

describe('IndexedDB persistence', () => {
  it('permits only one active session per profile when two browser connections race to start', async () => {
    const [bank] = await listBanks('lutz', database);
    const first = createSession(bank, 'lutz', 'learn', 1_000);
    const second = createSession(bank, 'lutz', 'exam', 1_001);
    const otherTab = new LearningDatabase(database.name);
    try {
      const attempts = await Promise.allSettled([
        saveSession(first, database),
        saveSession(second, otherTab),
      ]);
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      const rejected = attempts.find(
        (attempt) => attempt.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejected.reason.message).toContain('bereits eine Lernrunde oder Klassenarbeit');
      expect(
        await database.sessions.where('[studentId+status]').equals(['lutz', 'active']).count(),
      ).toBe(1);
      const current = (await getActiveSession('lutz', database))!;
      await saveSession(current, otherTab);
      await completeSession(current, 5_000, database);
      const next = createSession(bank, 'lutz', 'learn', 6_000);
      await saveSession(next, otherTab);
      expect((await getActiveSession('lutz', database))?.id).toBe(next.id);
    } finally {
      otherTab.close();
    }
  });

  it('seeds three profiles once, keeps later changes, and limits bank assignment to Lutz', async () => {
    expect((await listProfiles(database)).map((profile) => profile.id)).toEqual([
      'max',
      'lutz',
      'ben',
    ]);
    expect(await listBanks('max', database)).toEqual([]);
    expect(await listBanks('ben', database)).toEqual([]);
    await database.profiles.update('lutz', { name: 'Lutz geändert' });
    const [bank] = await listBanks('lutz', database);
    await database.banks.update(bank.id, { title: 'Eigene lokale Fassung' });
    await initializeDemo(database);
    expect((await listProfiles(database)).find((profile) => profile.id === 'lutz')?.name).toBe(
      'Lutz geändert',
    );
    expect((await listBanks('lutz', database))[0].title).toBe('Eigene lokale Fassung');
    expect(await database.banks.count()).toBe(1);
  });

  it('recovers answers and the original absolute deadline after a database restart', async () => {
    const [bank] = await listBanks('lutz', database);
    let session = createSession(bank, 'lutz', 'exam', 1_000);
    session = setAnswer(session, session.questionIds[0], '17', 2_000);
    await saveSession(session, database);
    const name = database.name;
    database.close();
    database = new LearningDatabase(name);
    const recovered = await getActiveSession('lutz', database);
    expect(recovered).toEqual(session);
    expect(isExpired(recovered!, session.deadlineAt!)).toBe(true);
    expect(await getActiveSession('max', database)).toBeUndefined();
    expect(await getActiveSession('ben', database)).toBeUndefined();
  });

  it('atomically finalizes exactly once even when timeout and button race, and rejects late autosave', async () => {
    const [bank] = await listBanks('lutz', database);
    let session = createSession(bank, 'lutz', 'exam', 1_000);
    const firstId = session.questionIds[0];
    const first = bank.questions.find((question) => question.id === firstId)!;
    session = setAnswer(session, firstId, first.correctAnswer, 2_000);
    await saveSession(session, database);
    const [manual, duplicate] = await Promise.all([
      completeSession(session, 5_000, database),
      completeSession(session, 6_000, database),
    ]);
    expect(manual).toEqual(duplicate);
    expect(await database.results.count()).toBe(1);
    expect((await database.sessions.get(session.id))?.status).toBe('completed');
    expect(await getActiveSession('lutz', database)).toBeUndefined();
    await saveSession(session, database);
    expect(await getActiveSession('lutz', database)).toBeUndefined();
    expect(await listResults('lutz', database)).toHaveLength(1);
    expect(await listResults('max', database)).toEqual([]);
    expect(await listResults('ben', database)).toEqual([]);
    expect(await loadResult(session.id, 'lutz', database)).toEqual(manual);
    expect(manual.bankSnapshot).toEqual(bank);
    expect(manual.earnedPoints).toBe(first.points);
  });

  it('uses the deadline as the effective finish after closing the browser for too long', async () => {
    const [bank] = await listBanks('lutz', database);
    const session = createSession(bank, 'lutz', 'exam', 1_000);
    await saveSession(session, database);
    const result = await completeSession(session, session.deadlineAt! + 900_000, database);
    expect(result.duration).toBe(bank.durationMinutes * 60);
    expect(result.date).toBe(session.deadlineAt);
    expect((await database.sessions.get(session.id))?.completedAt).toBe(session.deadlineAt);
  });

  it('rejects invalid state before writing and retains no partial result', async () => {
    const [bank] = await listBanks('lutz', database);
    const session = createSession(bank, 'lutz', 'exam', 1_000);
    const invalid = { ...session, studentId: 'max' };
    await expect(saveSession(invalid, database)).rejects.toThrow();
    await expect(
      completeSession({ ...session, deadlineAt: 5_000 }, 6_000, database),
    ).rejects.toThrow();
    expect(await database.sessions.count()).toBe(0);
    expect(await database.results.count()).toBe(0);
  });

  it('rolls back completion if saving the result fails', async () => {
    const [bank] = await listBanks('lutz', database);
    const session = createSession(bank, 'lutz', 'exam', 1_000);
    await saveSession(session, database);
    const rejectWrite = () => {
      throw new Error('Simulated storage failure');
    };
    database.results.hook('creating', rejectWrite);
    await expect(completeSession(session, 5_000, database)).rejects.toThrow(
      'Simulated storage failure',
    );
    database.results.hook('creating').unsubscribe(rejectWrite);
    expect((await database.sessions.get(session.id))?.status).toBe('active');
    expect(await database.results.count()).toBe(0);
    expect((await completeSession(session, 6_000, database)).id).toBe(session.id);
  });

  it('rejects a corrupted retry state that could otherwise grant extra attempts', async () => {
    const [bank] = await listBanks('lutz', database);
    const session = createSession(bank, 'lutz', 'learn', 1_000);
    session.answers[session.questionIds[0]] = {
      value: '999',
      attempts: 3,
      hintsUsed: 2,
      correct: false,
      resolved: false,
    };
    await expect(saveSession(session, database)).rejects.toThrow('Ungültiger Antwortzustand');
    expect(await database.sessions.count()).toBe(0);
  });
});
