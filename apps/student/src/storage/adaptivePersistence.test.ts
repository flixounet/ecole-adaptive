import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import source from '@shared/fixtures/lutz-maths-demo.json';
import legacy from '@shared/fixtures/lutz-maths-demo-v1.json';
import profiles from '@shared/fixtures/profiles.json';
import { parseQuestionBank } from '@shared/validation';
import type { QuestionBank } from '@shared/types';
import {
  createSession,
  finishSession,
  moveTo,
  setAnswer,
  submitLearningAnswer,
  type Session,
} from '../domain/session';
import { createSeededRandom } from '../domain/adaptive/selection';
import {
  LearningDatabase,
  completeSession,
  getActiveSession,
  getQuestionHistory,
  initializeDemo,
  listAttempts,
  listBanks,
  listResults,
  listSkillStates,
  loadResult,
  persistSession,
  saveSession,
} from './database';
import { startAdaptiveSession } from './repositories';

let database: LearningDatabase;
beforeEach(async () => {
  database = new LearningDatabase(`adaptive-test-${crypto.randomUUID()}`);
  await initializeDemo(database);
});
afterEach(async () => {
  database.close();
  await database.delete();
});

function bank(): QuestionBank {
  return parseQuestionBank({
    ...structuredClone(source),
    questionCount: 2,
    durationMinutes: 1,
    questions: [
      { ...source.questions[0], points: 2 },
      { ...source.questions[1], points: 3 },
    ],
  });
}
function answer(session: Session, id: string, value: string, now: number): Session {
  return submitLearningAnswer(setAnswer(session, id, value, now), id, now);
}
const firstId = source.questions[0].id;
const secondId = source.questions[1].id;

describe('final attempts and mastery transactions', () => {
  it('rejects corrupted stored attempts at the repository boundary before UI rendering', async () => {
    const session = createSession(bank(), 'lutz', 'exam', 1_000);
    await completeSession(session, 2_000, database);
    const [record] = await listAttempts('lutz', 'maths', database);
    await database.attemptRecords.update(record.id, { timestamp: NaN });
    await expect(listAttempts('lutz', 'maths', database)).rejects.toThrow(
      'Ungültiger finaler Aufgabenversuch',
    );
    await database.attemptRecords.put({
      ...record,
      masteryAfter: { 'math.order_operations': Infinity },
    });
    await expect(listAttempts('lutz', 'maths', database)).rejects.toThrow(
      'ungültige Lernstandswerte',
    );
  });

  it('rejects cached results with non-finite values, impossible point totals or invalid timing', async () => {
    const session = createSession(bank(), 'lutz', 'exam', 1_000);
    const result = await completeSession(session, 2_000, database);
    const corruptions = [
      { ...result, score20: NaN },
      { ...result, earnedPoints: Infinity },
      { ...result, maxPoints: 0 },
      { ...result, duration: -1 },
      { ...result, completedAt: 500 },
      { ...result, masteryAfter: { 'math.order_operations': 1.1 } },
      {
        ...result,
        answers: result.answers.map((answer, index) =>
          index === 0 ? { ...answer, earnedPoints: NaN } : answer,
        ),
      },
    ];
    for (const corrupted of corruptions) {
      await database.results.put(corrupted);
      await expect(listResults('lutz', database)).rejects.toThrow('ungültige Werte');
    }
    await database.results.put(result);
    expect((await listResults('lutz', database))[0].id).toBe(result.id);
  });

  it('does not refund used retries or erase viewing history when an older snapshot arrives later', async () => {
    const original = createSession(bank(), 'lutz', 'learn', 1_000);
    let current = answer(original, firstId, '999', 2_000);
    current = moveTo(current, current.questionIds.indexOf(firstId), 2_500);
    await persistSession(current, database);
    const recovered = await persistSession(original, database);
    expect(recovered.answers[firstId]).toMatchObject({
      attempts: 1,
      correct: false,
      value: '999',
      lastViewedAt: 2_500,
    });
    const result = await completeSession(original, 3_000, database);
    expect(result.answers.find((item) => item.questionId === firstId)?.attempts).toBe(1);
    expect(
      (await listAttempts('lutz', 'maths', database)).find((item) => item.questionId === firstId)
        ?.outcome,
    ).toBe('INCORRECT');
  });

  it('does not penalize intermediate failures and commits one hinted success only once', async () => {
    let session = createSession(bank(), 'lutz', 'learn', 1_000);
    session = answer(session, firstId, '999', 2_000);
    await saveSession(session, database);
    session = answer(session, firstId, '999', 3_000);
    await saveSession(session, database);
    expect(await listAttempts('lutz', 'maths', database)).toEqual([]);
    expect(await listSkillStates('lutz', 'maths', database)).toEqual([]);
    session = answer(session, firstId, '19', 4_000);
    await Promise.all([saveSession(session, database), saveSession(session, database)]);
    const [attempt] = await listAttempts('lutz', 'maths', database);
    expect(attempt).toMatchObject({
      outcome: 'CORRECT_AFTER_MULTIPLE_HINTS',
      attemptNumber: 3,
      hintsUsed: 2,
      responseTimeMs: 4_000 - session.answers[firstId].firstViewedAt!,
    });
    const [state] = await listSkillStates('lutz', 'maths', database);
    expect(state).toMatchObject({
      mastery: 0.512,
      attempts: 1,
      correctCount: 1,
      hintedCorrectCount: 1,
      incorrectCount: 0,
    });
    await completeSession(session, 5_000, database);
    expect(
      (await listAttempts('lutz', 'maths', database)).filter((item) => item.questionId === firstId),
    ).toHaveLength(1);
  });

  it('applies one final failure after three wrong answers, with an elapsed timestamp', async () => {
    let session = createSession(bank(), 'lutz', 'learn', 1_000);
    session = moveTo(session, session.questionIds.indexOf(firstId), 1_500);
    for (const now of [2_000, 3_000, 4_000]) session = answer(session, firstId, '999', now);
    await saveSession(session, database);
    expect((await listSkillStates('lutz', 'maths', database))[0]).toMatchObject({
      mastery: 0.42,
      attempts: 1,
      incorrectCount: 1,
    });
    expect((await listAttempts('lutz', 'maths', database))[0]).toMatchObject({
      outcome: 'INCORRECT',
      timestamp: 4_000,
    });
  });

  it('updates exam mastery only at completion and keeps weighted /20 and skill performance', async () => {
    let session = createSession(bank(), 'lutz', 'exam', 1_000);
    session = setAnswer(session, firstId, '19', 2_000);
    session = setAnswer(session, secondId, '999', 3_000);
    await saveSession(session, database);
    expect(await listAttempts('lutz', 'maths', database)).toEqual([]);
    const result = await completeSession(session, 4_000, database);
    expect(result).toMatchObject({
      earnedPoints: 2,
      maxPoints: 5,
      score20: 8,
      percentage: 40,
      subject: 'maths',
      startedAt: 1_000,
      completedAt: 4_000,
      durationSeconds: 3,
    });
    expect(result.skillPerformance['math.order_operations']).toEqual({
      earned: 2,
      possible: 5,
      percentage: 40,
    });
    expect(result.masteryBefore['math.order_operations']).toBe(0.5);
    expect(result.masteryAfter['math.order_operations']).toBe(0.468);
    expect(result.mistakeSkillIds).toEqual(['math.order_operations']);
    expect(await database.attemptRecords.count()).toBe(2);
    await completeSession(session, 9_000, database);
    expect(await database.attemptRecords.count()).toBe(2);
  });

  it('distinguishes a submitted unfinished error from unsubmitted learning and unanswered exams', async () => {
    let learning = createSession(bank(), 'lutz', 'learn', 1_000);
    learning = answer(learning, firstId, '999', 2_000);
    learning = setAnswer(learning, secondId, '40', 2_500);
    await completeSession(learning, 3_000, database);
    const records = await listAttempts('lutz', 'maths', database);
    expect(records.find((item) => item.questionId === firstId)?.outcome).toBe('INCORRECT');
    expect(records.find((item) => item.questionId === secondId)?.outcome).toBe('SKIPPED');
    const exam = createSession(bank(), 'lutz', 'exam', 4_000);
    await completeSession(exam, exam.deadlineAt! + 60_000, database);
    const skipped = (await listAttempts('lutz', 'maths', database)).filter(
      (item) => item.sessionId === exam.id,
    );
    expect(
      skipped.every((item) => item.outcome === 'SKIPPED' && item.timestamp === exam.deadlineAt),
    ).toBe(true);
  });

  it('updates all skills on a multi-skill question exactly once', async () => {
    const multi = bank();
    multi.questionCount = 1;
    multi.questions = [
      { ...multi.questions[0], skillIds: ['math.order_operations', 'math.powers'] },
    ];
    let session = createSession(multi, 'lutz', 'learn', 1_000);
    session = answer(session, firstId, '19', 2_000);
    await Promise.all([saveSession(session, database), saveSession(session, database)]);
    const states = await listSkillStates('lutz', 'maths', database);
    expect(states).toHaveLength(2);
    expect(states.every((state) => state.mastery === 0.548 && state.attempts === 1)).toBe(true);
    expect(await database.attemptRecords.count()).toBe(1);
  });

  it('rolls back mastery, attempt and resolved answer together on an IndexedDB write failure', async () => {
    let session = createSession(bank(), 'lutz', 'learn', 1_000);
    await saveSession(session, database);
    session = answer(session, firstId, '19', 2_000);
    const reject = () => {
      throw new Error('Disk full');
    };
    database.attemptRecords.hook('creating', reject);
    await expect(saveSession(session, database)).rejects.toThrow('Disk full');
    database.attemptRecords.hook('creating').unsubscribe(reject);
    expect(await database.studentSkillStates.count()).toBe(0);
    expect(await database.attemptRecords.count()).toBe(0);
    expect((await getActiveSession('lutz', database))?.answers[firstId].resolved).toBe(false);
    await saveSession(session, database);
    expect(await database.attemptRecords.count()).toBe(1);
  });

  it('rolls back examination mastery too if the result cannot be saved', async () => {
    const session = createSession(bank(), 'lutz', 'exam', 1_000);
    await saveSession(session, database);
    const reject = () => {
      throw new Error('Result write failed');
    };
    database.results.hook('creating', reject);
    await expect(completeSession(session, 2_000, database)).rejects.toThrow('Result write failed');
    database.results.hook('creating').unsubscribe(reject);
    expect(await database.studentSkillStates.count()).toBe(0);
    expect(await database.attemptRecords.count()).toBe(0);
    expect((await getActiveSession('lutz', database))?.status).toBe('active');
  });

  it('keeps mastery and attempts separate for profiles and identically named skills in different subjects', async () => {
    function language(subject: string) {
      const value = bank();
      value.subject = subject;
      value.studentIds = ['lutz', 'max'];
      value.id = `${subject}-demo`;
      value.questionCount = 1;
      value.skills = [{ id: 'vocabulary', name: 'Wortschatz' }];
      value.questions = [{ ...value.questions[0], subject, skillIds: ['vocabulary'] }];
      return value;
    }
    let english = createSession(language('english'), 'lutz', 'learn', 1_000);
    english = answer(english, firstId, '19', 2_000);
    await completeSession(english, 3_000, database);
    const french = createSession(language('french'), 'lutz', 'exam', 4_000);
    await completeSession(french, 5_000, database);
    const max = createSession(language('english'), 'max', 'exam', 6_000);
    await completeSession(max, 7_000, database);
    expect((await listSkillStates('lutz', 'english', database))[0].mastery).toBe(0.548);
    expect((await listSkillStates('lutz', 'french', database))[0].mastery).toBe(0.47);
    expect((await listSkillStates('max', 'english', database))[0].mastery).toBe(0.47);
    expect(await listSkillStates('ben', undefined, database)).toEqual([]);
    expect(await listAttempts('ben', undefined, database)).toEqual([]);
    expect(
      (await listAttempts('max', 'english', database)).every(
        (item) => item.studentId === 'max' && item.subject === 'english',
      ),
    ).toBe(true);
  });

  it('tracks actual viewed questions and refreshes their ordering on a revisit without autosave timestamp drift', async () => {
    let session = createSession(bank(), 'lutz', 'exam', 1_000);
    const first = session.questionIds[0];
    const second = session.questionIds[1];
    await saveSession(session, database);
    expect(
      (await getQuestionHistory('lutz', 'maths', database)).map((item) => item.questionId),
    ).toEqual([first]);
    session = moveTo(session, 1, 2_000);
    await saveSession(session, database);
    session = moveTo(session, 0, 3_000);
    await saveSession(session, database);
    await saveSession(session, database);
    const history = await getQuestionHistory('lutz', 'maths', database);
    expect(history.map((item) => item.questionId)).toEqual([first, second]);
    expect(history[0].shownAt).toBe(3_000);
    expect(await listAttempts('lutz', 'maths', database)).toEqual([]);
  });

  it('processes multiple unsaved final answers chronologically even after out-of-order navigation', async () => {
    let session = createSession(bank(), 'lutz', 'learn', 1_000, () => 0.999);
    session = answer(session, secondId, '40', 2_000);
    session = answer(session, firstId, '19', 3_000);
    await saveSession(session, database);
    expect((await listSkillStates('lutz', 'maths', database))[0]).toMatchObject({
      attempts: 2,
      mastery: 0.596,
      lastPracticedAt: 3_000,
    });
  });
});

describe('adaptive repository and migration', () => {
  it('keeps error-training progression inside the original target skills after a multi-skill transfer', async () => {
    const target = 'math.distributivity';
    const outside = 'math.factorization';
    const base = bank();
    const fixture = parseQuestionBank({
      ...base,
      questionCount: 3,
      questions: [
        {
          ...base.questions[0],
          id: 'target-easy',
          question: 'Testaufgabe 1',
          skillIds: [target],
          difficulty: 1,
        },
        {
          ...base.questions[0],
          id: 'target-multi',
          question: 'Testaufgabe 2',
          skillIds: [target, outside],
          difficulty: 2,
        },
        {
          ...base.questions[0],
          id: 'target-consolidate',
          question: 'Testaufgabe 3',
          skillIds: [target],
          difficulty: 1,
        },
        {
          ...base.questions[0],
          id: 'outside-harder',
          question: 'Testaufgabe 4',
          skillIds: [outside],
          difficulty: 3,
        },
      ],
    });
    let session: Session = {
      ...createSession(fixture, 'lutz', 'error_training', 1_000, () => 0.999),
      adaptive: true,
      targetSkillIds: [target],
    };
    session = answer(session, 'target-easy', '19', 2_000);
    session = await persistSession(session, database);
    expect(session.questionIds[1]).toBe('target-multi');
    session = moveTo(session, 1, 3_000);
    session = answer(session, 'target-multi', '19', 4_000);
    session = await persistSession(session, database);
    expect(session.questionIds[2]).toBe('target-consolidate');
    expect(session.questionIds).not.toContain('outside-harder');
    expect(
      session.questionIds.every((id) =>
        fixture.questions.find((question) => question.id === id)!.skillIds.includes(target),
      ),
    ).toBe(true);
  });

  it('offers a harder same-skill transfer after success in error training', async () => {
    const full = (await listBanks('lutz', database))[0];
    let session = {
      ...createSession(full, 'lutz', 'error_training', 1_000, () => 0.999),
      adaptive: true,
    };
    const id = session.questionIds[0];
    const question = full.questions.find((item) => item.id === id)!;
    expect(question.difficulty).toBe(1);
    session = answer(session, id, question.correctAnswer, 2_000) as typeof session;
    const updated = await persistSession(session, database);
    const next = full.questions.find((item) => item.id === updated.questionIds[1])!;
    expect(next.difficulty).toBe(2);
    expect(next.skillIds.some((skill) => question.skillIds.includes(skill))).toBe(true);
    expect(next.id).not.toBe(id);
  });

  it('scopes individual result access and rejects a changed bank snapshot with the same identity', async () => {
    const session = createSession(bank(), 'lutz', 'exam', 1_000);
    await saveSession(session, database);
    const changed = structuredClone(session);
    changed.bankSnapshot.questions[0].question = 'Changed question with the same ID';
    await expect(saveSession(changed, database)).rejects.toThrow('Aufgabenpaket wurde verändert');
    await expect(completeSession(changed, 2_000, database)).rejects.toThrow(
      'Aufgabenpaket wurde verändert',
    );
    await completeSession(session, 3_000, database);
    expect((await loadResult(session.id, 'lutz', database))?.studentId).toBe('lutz');
    expect(await loadResult(session.id, 'max', database)).toBeUndefined();
    expect(await loadResult(session.id, 'ben', database)).toBeUndefined();
  });

  it('creates eight transfer questions for error training and persists an initial mastery snapshot', async () => {
    const original = createSession(bank(), 'lutz', 'exam', 1_000);
    const result = await completeSession(original, 2_000, database);
    const full = (await listBanks('lutz', database))[0];
    const training = await startAdaptiveSession(
      full,
      'lutz',
      'error_training',
      3_000,
      createSeededRandom(42),
      result,
      database,
    );
    expect(training.questionIds).toHaveLength(8);
    expect(training.questionIds.every((id) => !result.mistakes.includes(id))).toBe(true);
    expect(training.masteryBefore?.['math.order_operations']).toBe(0.44);
    expect(training.targetSkillIds).toContain('math.order_operations');
    expect((await getActiveSession('lutz', database))?.id).toBe(training.id);
  });

  it('persists a recurrence plan without removing viewed or edited answers and replays it idempotently', async () => {
    const full = (await listBanks('lutz', database))[0];
    let session = await startAdaptiveSession(
      full,
      'lutz',
      'learn',
      1_000,
      createSeededRandom(27),
      undefined,
      database,
    );
    const edited = session.questionIds[6];
    session = setAnswer(session, edited, 'keep my draft', 1_100);
    const failed = session.questionIds[0];
    for (const now of [2_000, 3_000, 4_000])
      session = answer(session, failed, 'certainly wrong', now);
    const persisted = await persistSession(session, database);
    expect(persisted.questionIds).toHaveLength(full.questionCount);
    expect(new Set(persisted.questionIds).size).toBe(full.questionCount);
    expect(persisted.answers[edited].value).toBe('keep my draft');
    const repeated = await persistSession(session, database);
    expect(repeated.questionIds).toEqual(persisted.questionIds);
    expect(await listAttempts('lutz', 'maths', database)).toHaveLength(1);
  });

  it('upgrades a populated v1 database without changing original profiles, sessions or result records', async () => {
    const name = `migration-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      profiles: '&id',
      banks: '&id, *studentIds',
      sessions: '&id, studentId, status, [studentId+status], startedAt',
      results: '&id, studentId, date',
    });
    const oldBank = parseQuestionBank(structuredClone(legacy));
    const active = createSession(oldBank, 'lutz', 'exam', 1_000);
    for (const state of Object.values(active.answers)) {
      delete state.firstViewedAt;
      delete state.lastViewedAt;
    }
    const rawResult = finishSession(
      createSession(oldBank, 'lutz', 'exam', 10),
      50,
    ) as unknown as Record<string, unknown>;
    for (const key of [
      'subject',
      'chapter',
      'startedAt',
      'completedAt',
      'durationSeconds',
      'skillPerformance',
      'masteryBefore',
      'masteryAfter',
      'mistakeQuestionIds',
      'mistakeSkillIds',
    ])
      delete rawResult[key];
    await old.table('profiles').bulkAdd(profiles);
    await old.table('banks').add(oldBank);
    await old.table('sessions').add(active);
    await old.table('results').add(rawResult);
    old.close();
    const upgraded = new LearningDatabase(name);
    try {
      await upgraded.open();
      expect(upgraded.verno).toBe(3);
      expect(await upgraded.sessions.get(active.id)).toEqual(active);
      expect(await upgraded.results.get(rawResult.id as string)).toEqual(rawResult);
      expect(await upgraded.attemptRecords.count()).toBe(0);
      expect(await upgraded.studentSkillStates.count()).toBe(0);
      const [normalized] = await listResults('lutz', upgraded);
      expect(normalized.masteryBefore).toEqual({});
      expect(normalized.masteryAfter).toEqual({});
      expect(normalized.subject).toBe('maths');
      expect(normalized.skillPerformance).not.toEqual({});
      await initializeDemo(upgraded);
      expect((await listBanks('lutz', upgraded))[0].version).toBe(2);
      expect((await getActiveSession('lutz', upgraded))?.bankSnapshot).toEqual(oldBank);
      expect(await upgraded.results.get(rawResult.id as string)).toEqual(rawResult);
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });

  it('preserves a locally edited v1 demo instead of overwriting it', async () => {
    const modified = { ...structuredClone(legacy), title: 'Meine eigenen Anpassungen' };
    await database.banks.put(parseQuestionBank(modified));
    await initializeDemo(database);
    expect((await listBanks('lutz', database))[0]).toEqual(modified);
  });

  it('canonicalizes skills of resumed legacy answers and leaves unknown response timing null', async () => {
    const oldBank = parseQuestionBank(structuredClone(legacy));
    let session = createSession(oldBank, 'lutz', 'learn', 1_000);
    const id = session.questionIds[0];
    const question = oldBank.questions.find((item) => item.id === id)!;
    session = answer(session, id, question.correctAnswer, 2_000);
    for (const state of Object.values(session.answers)) {
      delete state.firstViewedAt;
      delete state.lastViewedAt;
      delete state.finalizedAt;
    }
    await saveSession(session, database);
    const [record] = await listAttempts('lutz', 'maths', database);
    expect(record.responseTimeMs).toBeNull();
    expect(record.skillIds.every((skill) => skill.startsWith('math.'))).toBe(true);
    await saveSession(session, database);
    expect(await database.attemptRecords.count()).toBe(1);
  });
});
