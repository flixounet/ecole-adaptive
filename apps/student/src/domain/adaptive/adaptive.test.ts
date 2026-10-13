import { describe, expect, it } from 'vitest';
import fixture from '@shared/fixtures/lutz-maths-demo.json';
import legacyFixture from '@shared/fixtures/lutz-maths-demo-v1.json';
import type { Question, QuestionBank } from '@shared/types';
import { adaptiveConfig } from './config';
import {
  applyAttemptToSkills,
  classifyAttempt,
  createSkillState,
  updateSkillMastery,
  validateSkillState,
} from './mastery';
import {
  createSeededRandom,
  preferredDifficulties,
  questionWeight,
  selectQuestions,
} from './selection';
import { createErrorTraining } from './errorTraining';
import {
  getLearningRecommendations,
  getResultRecommendations,
  skillStatus,
} from './recommendations';
import { scheduleErrorRecurrence, scheduleTrainingProgression } from './scheduling';
import type {
  AttemptInput,
  AttemptRecord,
  Difficulty,
  RecurrenceOptions,
  SelectionOptions,
  StudentSkillState,
} from './types';

function attempt(overrides: Partial<AttemptInput> = {}): AttemptInput {
  return {
    id: 'session:q1',
    sessionId: 'session',
    studentId: 'lutz',
    subject: 'maths',
    questionId: 'q1',
    testId: 'bank',
    mode: 'learn',
    timestamp: 1000,
    answer: '19',
    correct: true,
    attemptNumber: 1,
    hintsUsed: 0,
    skipped: false,
    difficulty: 2,
    skillIds: ['a'],
    responseTimeMs: 1200,
    ...overrides,
  };
}
function record(overrides: Partial<AttemptInput> = {}): AttemptRecord {
  return applyAttemptToSkills([], attempt(overrides)).record;
}
function state(
  skillId: string,
  mastery: number,
  studentId = 'lutz',
  subject = 'maths',
): StudentSkillState {
  return { ...createSkillState(studentId, subject, skillId), mastery };
}
function question(id: string, skillId: string, difficulty: Difficulty = 2): Question {
  return {
    ...structuredClone(fixture.questions[0]),
    id,
    skillIds: [skillId],
    difficulty,
  } as Question;
}
function bank(questions = [question('a1', 'a'), question('b1', 'b')]): QuestionBank {
  return {
    ...structuredClone(fixture),
    id: 'bank',
    studentIds: ['lutz'],
    questions,
    questionCount: Math.min(questions.length, 12),
    skills: [...new Set(questions.flatMap((q) => q.skillIds))].map((id) => ({ id, name: id })),
  } as QuestionBank;
}
function selection(overrides: Partial<SelectionOptions> = {}): SelectionOptions {
  return {
    studentId: 'lutz',
    questionBank: bank(),
    skillStates: [],
    recentAttempts: [],
    desiredQuestionCount: 1,
    mode: 'learn',
    random: createSeededRandom(42),
    ...overrides,
  };
}

describe('mastery: final outcomes and scope', () => {
  it('starts at 0.50 with zero attempts', () => {
    expect(createSkillState('lutz', 'maths', 'a')).toMatchObject({
      mastery: 0.5,
      attempts: 0,
      skippedCount: 0,
      lastPracticedAt: null,
    });
  });

  it.each([
    [{}, 'CORRECT_FIRST_TRY', 0.56],
    [{ hintsUsed: 1, attemptNumber: 2 }, 'CORRECT_AFTER_HINT', 0.53],
    [{ hintsUsed: 2, attemptNumber: 3 }, 'CORRECT_AFTER_MULTIPLE_HINTS', 0.515],
    [{ correct: false, hintsUsed: 2, attemptNumber: 3 }, 'INCORRECT', 0.42],
    [{ correct: false, skipped: true, attemptNumber: 0, answer: '' }, 'SKIPPED', 0.47],
  ] as const)('classifies and applies a final outcome %j', (overrides, outcome, mastery) => {
    const input = attempt(overrides);
    expect(classifyAttempt(input)).toBe(outcome);
    const updated = updateSkillMastery(createSkillState('lutz', 'maths', 'a'), input);
    expect(updated.mastery).toBe(mastery);
    expect(updated.attempts).toBe(1);
  });

  it.each([
    [1, 0.548],
    [2, 0.56],
    [3, 0.572],
    [4, 0.581],
  ] as const)('weights positive difficulty %i correctly', (difficulty, expected) => {
    expect(updateSkillMastery(state('a', 0.5), attempt({ difficulty })).mastery).toBe(expected);
    expect(
      updateSkillMastery(state('a', 0.5), attempt({ difficulty, correct: false })).mastery,
    ).toBe(0.42);
  });

  it('clamps at both ends', () => {
    expect(updateSkillMastery(state('a', 0.99), attempt()).mastery).toBe(1);
    expect(updateSkillMastery(state('a', 0.01), attempt({ correct: false })).mastery).toBe(0);
  });

  it('updates every skill only once, is immutable, and guards a direct replay', () => {
    const original = state('a', 0.5);
    const input = attempt({ skillIds: ['a', 'a', 'b'] });
    const first = applyAttemptToSkills([original], input);
    expect(first.states).toHaveLength(2);
    expect(first.record.skillIds).toEqual(['a', 'b']);
    expect(first.record.masteryBefore).toEqual({ a: 0.5, b: 0.5 });
    expect(first.record.masteryAfter).toEqual({ a: 0.56, b: 0.56 });
    expect(original.mastery).toBe(0.5);
    const replay = applyAttemptToSkills(first.states, input);
    expect(replay.states).toEqual(first.states);
  });

  it('keeps profiles and subjects independent even with the same skill ID', () => {
    const foreign = [state('a', 0.9, 'max'), state('a', 0.1, 'lutz', 'english')];
    expect(applyAttemptToSkills(foreign, attempt()).record.masteryBefore).toEqual({ a: 0.5 });
    expect(() => updateSkillMastery(foreign[0], attempt())).toThrow(/anderen/);
    expect(() => updateSkillMastery(foreign[1], attempt())).toThrow(/anderen/);
  });

  it('maintains counters, streaks and last-10 skill errors independently of skips', () => {
    let current = state('a', 0.5);
    current = updateSkillMastery(current, attempt());
    current = updateSkillMastery(
      current,
      attempt({ id: '2', timestamp: 2000, hintsUsed: 1, attemptNumber: 2 }),
    );
    expect(current).toMatchObject({
      correctCount: 2,
      hintedCorrectCount: 1,
      currentStreak: 2,
      bestStreak: 2,
    });
    current = updateSkillMastery(current, attempt({ id: '3', timestamp: 3000, correct: false }));
    current = updateSkillMastery(
      current,
      attempt({ id: '4', timestamp: 4000, correct: false, skipped: true, attemptNumber: 0 }),
    );
    expect(current).toMatchObject({
      attempts: 4,
      incorrectCount: 1,
      skippedCount: 1,
      currentStreak: 0,
      bestStreak: 2,
      lastIncorrectAt: 3000,
      recentErrorCount: 1,
    });
    for (let index = 5; index < 15; index += 1)
      current = updateSkillMastery(
        current,
        attempt({ id: String(index), timestamp: index * 1000 }),
      );
    expect(current.recentOutcomes).toHaveLength(10);
    expect(current.recentErrorCount).toBe(0);
  });

  it.each([
    { timestamp: NaN },
    { responseTimeMs: Infinity },
    { difficulty: 0 },
    { attemptNumber: -1 },
    { hintsUsed: 3 },
    { skillIds: [] },
    { correct: true, skipped: true },
    { attemptNumber: 0 },
  ])('rejects malformed final input %j', (overrides) => {
    expect(() => applyAttemptToSkills([], attempt(overrides as Partial<AttemptInput>))).toThrow();
  });

  it('rejects malformed or stale states instead of emitting NaN', () => {
    expect(() => validateSkillState(state('a', NaN))).toThrow();
    const updated = updateSkillMastery(state('a', 0.5), attempt());
    expect(() => updateSkillMastery(updated, attempt({ id: 'older', timestamp: 999 }))).toThrow(
      /älterer/,
    );
    expect(() => applyAttemptToSkills([state('a', 0.5), state('a', 0.7)], attempt())).toThrow(
      /Doppelter/,
    );
  });
});

describe('adaptive weighted selection', () => {
  it('is reproducible with a seeded random provider and samples without replacement', () => {
    const input = {
      questionBank: bank(
        Array.from({ length: 12 }, (_, i) => question('q' + i, i % 2 ? 'a' : 'b')),
      ),
      desiredQuestionCount: 8,
    };
    const first = selectQuestions(selection({ ...input, random: createSeededRandom(5) }));
    const second = selectQuestions(selection({ ...input, random: createSeededRandom(5) }));
    expect(first).toEqual(second);
    expect(new Set(first.map((q) => q.id)).size).toBe(8);
  });

  it('selects a weak skill significantly more often over 1000 seeded trials', () => {
    const random = createSeededRandom(712);
    const skillStates = [state('a', 0.2), state('b', 0.9)];
    let weak = 0;
    for (let index = 0; index < 1000; index += 1) {
      if (selectQuestions(selection({ random, skillStates }))[0].skillIds[0] === 'a') weak += 1;
    }
    expect(weak).toBeGreaterThan(620);
    expect(weak).toBeLessThan(780);
  });

  it('adds capped recent errors and retains the concrete 0.50 -> 0.42 weight example', () => {
    const failed = record({ correct: false });
    const updated = applyAttemptToSkills([], attempt({ correct: false })).states;
    const q = question('q1', 'a');
    const before = questionWeight({
      question: q,
      studentId: 'lutz',
      subject: 'maths',
      skillStates: [],
      recentAttempts: [],
    });
    const after = questionWeight({
      question: q,
      studentId: 'lutz',
      subject: 'maths',
      skillStates: updated,
      recentAttempts: [failed],
    });
    expect(before / adaptiveConfig.preferredDifficultyWeight).toBe(2);
    expect(after / adaptiveConfig.preferredDifficultyWeight).toBeCloseTo(2.91);
    const records = Array.from({ length: 10 }, (_, i) =>
      record({ id: String(i), timestamp: i, correct: false }),
    );
    const many = questionWeight({
      question: q,
      studentId: 'lutz',
      subject: 'maths',
      skillStates: [],
      recentAttempts: records,
    });
    const three = questionWeight({
      question: q,
      studentId: 'lutz',
      subject: 'maths',
      skillStates: [],
      recentAttempts: records.slice(0, 3),
    });
    expect(many).toBe(three);
  });

  it('uses only the last 10 attempts of the selected profile and subject', () => {
    const recent = Array.from({ length: 10 }, (_, i) =>
      record({ id: 'new' + i, timestamp: 10000 + i, skillIds: ['b'] }),
    );
    const oldError = record({ id: 'old', timestamp: 1, correct: false });
    const foreign = record({ id: 'foreign', studentId: 'max', correct: false });
    const q = question('q1', 'a');
    const weight = (history: AttemptRecord[]) =>
      questionWeight({
        question: q,
        studentId: 'lutz',
        subject: 'maths',
        skillStates: [],
        recentAttempts: history,
      });
    expect(weight([...recent, oldError, foreign])).toBe(weight([]));
  });

  it('avoids the actual last five presented questions when alternatives exist', () => {
    const questions = Array.from({ length: 10 }, (_, i) => question('q' + i, 'a'));
    const recentQuestionIds = ['q0', 'q1', 'q2', 'q3', 'q4'];
    const selected = selectQuestions(
      selection({ questionBank: bank(questions), desiredQuestionCount: 5, recentQuestionIds }),
    );
    expect(selected.every((q) => !recentQuestionIds.includes(q.id))).toBe(true);
  });

  it('gracefully returns a smaller pool, with no immediate identical fallback', () => {
    expect(
      selectQuestions(
        selection({ questionBank: bank([question('only', 'a')]), recentQuestionIds: ['only'] }),
      ),
    ).toEqual([]);
    const picked = selectQuestions(
      selection({
        questionBank: bank([question('q1', 'a'), question('q2', 'a')]),
        desiredQuestionCount: 8,
        recentQuestionIds: ['q1', 'q2'],
      }),
    );
    expect(picked.map((q) => q.id)).toEqual(['q2', 'q1']);
  });

  it.each([
    [0.39, [1]],
    [0.4, [1, 2]],
    [0.65, [2, 3]],
    [0.85, [2, 3]],
    [0.86, [3, 4]],
  ] as const)('uses explicit difficulty boundaries at %f', (mastery, expected) => {
    expect(preferredDifficulties(mastery)).toEqual(expected);
  });

  it('prefers suitable difficulty while retaining nonzero variation', () => {
    const weight = (difficulty: Difficulty, mastery: number) =>
      questionWeight({
        question: question('q', 'a', difficulty),
        studentId: 'lutz',
        subject: 'maths',
        skillStates: [state('a', mastery)],
        recentAttempts: [],
      });
    expect(weight(1, 0.3)).toBeGreaterThan(weight(3, 0.3));
    expect(weight(4, 0.9)).toBeGreaterThan(weight(1, 0.9));
    expect(weight(4, 0.3)).toBeGreaterThan(0);
  });

  it('rejects malformed count, random, question, and profile requests', () => {
    expect(() => selectQuestions(selection({ desiredQuestionCount: NaN }))).toThrow();
    expect(() => selectQuestions(selection({ random: () => 1 }))).toThrow();
    expect(() => selectQuestions(selection({ studentId: 'max' }))).toThrow();
    expect(() =>
      selectQuestions(selection({ questionBank: bank([{ ...question('q', 'a'), skillIds: [] }]) })),
    ).toThrow();
    expect(() =>
      selectQuestions(selection({ questionBank: bank([{ ...question('q', 'a'), points: 0 }]) })),
    ).toThrow();
  });
});

describe('error training and recommendations', () => {
  it('finds failed skills and exclusively selects different matching variants', () => {
    const pool = bank([question('failed', 'a'), question('transfer', 'a'), question('other', 'b')]);
    const plan = createErrorTraining({
      ...selection({ questionBank: pool }),
      sourceResult: {
        studentId: 'lutz',
        bankSnapshot: pool,
        answers: [{ questionId: 'failed', correct: false }],
      },
    });
    expect(plan.targetSkillIds).toEqual(['a']);
    expect(plan.originalQuestionIds).toEqual(['failed']);
    expect(plan.questions.map((q) => q.id)).toEqual(['transfer']);
  });

  it('allows a cooled original only when no transfer exists, and never repeats it immediately', () => {
    const pool = bank([question('failed', 'a')]);
    const input = {
      ...selection({ questionBank: pool }),
      sourceResult: { bankSnapshot: pool, answers: [{ questionId: 'failed', correct: false }] },
    };
    expect(createErrorTraining({ ...input, recentQuestionIds: ['failed'] }).questions).toEqual([]);
    expect(
      createErrorTraining({
        ...input,
        recentQuestionIds: ['other1', 'other2', 'other3', 'other4', 'other5', 'failed'],
      }).questions.map((q) => q.id),
    ).toEqual(['failed']);
  });

  it('uses an eight-question default and lists weak targets first', () => {
    const questions = [
      question('failed-a', 'a'),
      question('failed-b', 'b'),
      ...Array.from({ length: 12 }, (_, i) => question('new' + i, i % 2 ? 'a' : 'b')),
    ];
    const pool = bank(questions);
    const input = {
      studentId: 'lutz',
      questionBank: pool,
      skillStates: [state('a', 0.8), state('b', 0.2)],
      recentAttempts: [],
      sourceResult: {
        bankSnapshot: pool,
        answers: [
          { questionId: 'failed-a', correct: false },
          { questionId: 'failed-b', correct: false },
        ],
      },
      random: createSeededRandom(4),
    };
    const plan = createErrorTraining(input);
    expect(plan.questions).toHaveLength(8);
    expect(plan.targetSkillIds).toEqual(['b', 'a']);
  });

  it('returns no fake error training for a perfect result and rejects foreign results', () => {
    const pool = bank();
    const input = {
      ...selection(),
      sourceResult: { bankSnapshot: pool, answers: [{ questionId: 'a1', correct: true }] },
    };
    expect(createErrorTraining(input).questions).toEqual([]);
    expect(() =>
      createErrorTraining({ ...input, sourceResult: { ...input.sourceResult, studentId: 'max' } }),
    ).toThrow();
  });

  it('raises recommendation priority for recent errors and separates subjects', () => {
    const input = {
      studentId: 'lutz',
      subject: 'maths',
      skills: [
        { id: 'a', name: 'Skill A' },
        { id: 'b', name: 'Skill B' },
      ],
      skillStates: [state('a', 0.9), state('b', 0.4), state('a', 0.1, 'max')],
      recentAttempts: [record({ correct: false })],
    };
    const recommendations = getLearningRecommendations(input);
    expect(recommendations[0]).toMatchObject({ skillId: 'b', priority: 'high' });
    expect(recommendations.find((item) => item.skillId === 'a')).toMatchObject({
      priority: 'medium',
      mastery: 0.9,
      recentErrors: 1,
      reason: '1 Fehler in der letzten Aufgabe',
    });
    expect(getLearningRecommendations(input)).toEqual(recommendations);
  });

  it.each([
    [0.49, 'noch üben'],
    [0.5, 'auf dem Weg'],
    [0.75, 'sicher'],
    [0.9, 'sicher'],
    [0.91, 'sehr sicher'],
  ] as const)('provides a calm status for %f', (mastery, expected) =>
    expect(skillStatus(mastery)).toBe(expected),
  );
});

describe('spaced transfer scheduling', () => {
  function schedule(overrides: Partial<RecurrenceOptions> = {}): RecurrenceOptions {
    const questions = [
      question('failed', 'a'),
      ...Array.from({ length: 7 }, (_, i) => question('filler' + i, 'b')),
      question('transfer', 'a', 2),
      question('harder', 'a', 3),
    ];
    return {
      studentId: 'lutz',
      questionBank: bank(questions),
      questionIds: questions.slice(0, 8).map((q) => q.id),
      failedQuestionId: 'failed',
      failedIndex: 0,
      completedQuestionIds: ['failed'],
      skillStates: [],
      recentAttempts: [],
      random: () => 0,
      ...overrides,
    };
  }

  it('inserts a different same-skill question in the preferred +4..7 window', () => {
    const options = schedule();
    const next = scheduleErrorRecurrence(options);
    expect(next.slice(0, 4)).toEqual(options.questionIds.slice(0, 4));
    expect(next[4]).toBe('transfer');
    expect(new Set(next).size).toBe(next.length);
    expect(options.questionIds[4]).toBe('filler3');
  });

  it('moves avoidable next-two same-skill questions out of the immediate slots', () => {
    const options = schedule({
      questionIds: ['failed', 'transfer', 'filler0', 'filler1', 'filler2', 'filler3'],
    });
    const next = scheduleErrorRecurrence(options);
    expect(next[1]).not.toBe('transfer');
    expect(next.indexOf('transfer')).toBeGreaterThanOrEqual(3);
  });

  it('never changes a visited or edited slot and falls back to earliest +3', () => {
    const options = schedule({
      completedQuestionIds: ['failed', 'filler3', 'filler4', 'filler5', 'filler6'],
    });
    const next = scheduleErrorRecurrence(options);
    expect(next[3]).toBe('transfer');
    expect(next.slice(4)).toEqual(options.questionIds.slice(4));
  });

  it('leaves the plan intact when there is no remaining spaced slot or alternative', () => {
    const options = schedule({ questionIds: ['failed', 'filler0', 'filler1'] });
    expect(scheduleErrorRecurrence(options)).toEqual(options.questionIds);
    const only = bank([
      question('failed', 'a'),
      ...Array.from({ length: 5 }, (_, i) => question('f' + i, 'b')),
    ]);
    const noVariant = schedule({
      questionBank: only,
      questionIds: only.questions.map((q) => q.id),
    });
    expect(scheduleErrorRecurrence(noVariant)).toEqual(noVariant.questionIds);
  });

  it('offers a harder transfer after success without touching protected answers', () => {
    const options = schedule();
    const { failedQuestionId: questionId, failedIndex: currentIndex, ...rest } = options;
    const next = scheduleTrainingProgression({
      ...rest,
      questionId,
      currentIndex,
      completedQuestionIds: ['failed', 'filler0'],
    });
    expect(next[1]).toBe('filler0');
    expect(next[2]).toBe('harder');
  });

  it('rejects a malformed current position', () => {
    expect(() => scheduleErrorRecurrence(schedule({ failedIndex: 3 }))).toThrow();
  });
});

describe('historical results and error-training regressions', () => {
  it('canonicalizes old demo skill IDs before finding new transfer questions', () => {
    const current = fixture as QuestionBank;
    const old = legacyFixture as QuestionBank;
    const plan = createErrorTraining({
      ...selection({ questionBank: current }),
      sourceResult: {
        studentId: 'lutz',
        bankSnapshot: old,
        answers: [{ questionId: old.questions[0].id, correct: false }],
      },
    });
    expect(plan.targetSkillIds).toEqual(['math.order_operations']);
    expect(plan.questions.length).toBeGreaterThan(0);
    expect(
      plan.questions.every(
        (q) => q.id !== old.questions[0].id && q.skillIds.includes('math.order_operations'),
      ),
    ).toBe(true);
  });

  it('weights proximity to source difficulty without hard exclusions', () => {
    const weight = (difficulty: Difficulty) =>
      questionWeight({
        question: question('q', 'a', difficulty),
        studentId: 'lutz',
        subject: 'maths',
        skillStates: [],
        recentAttempts: [],
        difficultyTargetsBySkill: { a: 1 },
      });
    expect(weight(1)).toBeGreaterThan(weight(2));
    expect(weight(4)).toBeGreaterThan(0);
    expect(weight(1) / weight(2)).toBe(2);
  });

  it('actually weights source-result error frequency for equally strong skills', () => {
    const pool = bank([
      question('failed-a', 'a'),
      question('failed-b1', 'b'),
      question('failed-b2', 'b'),
      question('failed-b3', 'b'),
      question('transfer-a', 'a'),
      question('transfer-b', 'b'),
    ]);
    const sourceResult = {
      bankSnapshot: pool,
      answers: pool.questions.slice(0, 4).map((q) => ({ questionId: q.id, correct: false })),
    };
    const plan = createErrorTraining({
      ...selection({ questionBank: pool, desiredQuestionCount: 1, random: () => 0.45 }),
      sourceResult,
    });
    // Equal weights at 0.45 would select the first variant; 3 vs 1 source errors select B.
    expect(plan.questions.map((q) => q.id)).toEqual(['transfer-b']);
    expect(plan.targetSkillIds).toEqual(['b', 'a']);
  });

  it('does not double-count the same error evidence in source and recent histories', () => {
    const input = {
      question: question('q', 'a'),
      studentId: 'lutz',
      subject: 'maths',
      skillStates: [],
      recentAttempts: [record({ correct: false })],
    };
    expect(questionWeight({ ...input, sourceErrorCountsBySkill: { a: 1 } })).toBe(
      questionWeight(input),
    );
  });

  it('holds original-only pools until the last-five cooldown has passed', () => {
    const pool = bank([question('failed', 'a')]);
    const input = {
      ...selection({ questionBank: pool }),
      sourceResult: { bankSnapshot: pool, answers: [{ questionId: 'failed', correct: false }] },
    };
    expect(
      createErrorTraining({ ...input, recentQuestionIds: ['another', 'failed'] }).questions,
    ).toEqual([]);
    expect(createErrorTraining({ ...input, recentQuestionIds: [] }).questions).toEqual([]);
  });

  it('builds historical recommendations from captured mastery, not live state', () => {
    const pool = bank();
    const input = {
      studentId: 'lutz',
      bankSnapshot: pool,
      masteryAfter: { a: 0.42 },
      answers: [{ questionId: 'a1', correct: false }],
    };
    expect(getResultRecommendations(input)).toEqual([
      {
        skillId: 'a',
        name: 'a',
        priority: 'high',
        mastery: 0.42,
        reason: '1 Aufgabe in diesem Ergebnis noch nicht richtig gelöst.',
        status: 'noch üben',
        recentErrors: 1,
      },
    ]);
    const unknown = getResultRecommendations({
      ...input,
      masteryAfter: {},
      answers: [{ questionId: 'a1', correct: true }],
    });
    expect(unknown[0]).toMatchObject({
      mastery: 0.5,
      reason: 'Noch kein gemessener Kompetenzwert; Startwert 50 %.',
    });
    expect(() => getResultRecommendations({ ...input, masteryAfter: { a: Infinity } })).toThrow();
  });
});

describe('fixed error-training focus across multi-skill transfers', () => {
  it('does not drift into an outside-only skill when progressing from a mixed-skill answer', () => {
    const mixed = { ...question('mixed', 'target', 2), skillIds: ['target', 'outside'] };
    const pool = bank([
      mixed,
      question('consolidate', 'target', 1),
      question('outside-only', 'outside', 3),
    ]);
    const options = {
      studentId: 'lutz',
      questionBank: pool,
      questionIds: ['mixed', 'consolidate'],
      questionId: 'mixed',
      currentIndex: 0,
      completedQuestionIds: ['mixed'],
      skillStates: [],
      recentAttempts: [],
      random: () => 0,
      allowedSkillIds: ['target'],
    };
    expect(scheduleTrainingProgression(options)).toEqual(options.questionIds);
    const allowedHarder = {
      ...question('allowed-harder', 'target', 3),
      skillIds: ['target', 'outside'],
    };
    expect(
      scheduleTrainingProgression({
        ...options,
        questionBank: bank([...pool.questions, allowedHarder]),
      }),
    ).toEqual(['mixed', 'allowed-harder']);
  });

  it('keeps a recurrence within the original focus despite an extra skill on the failed question', () => {
    const mixed = { ...question('mixed-failure', 'target', 2), skillIds: ['target', 'outside'] };
    const fillers = Array.from({ length: 7 }, (_, i) =>
      question('other-focus-' + i, 'other-target'),
    );
    const pool = bank([
      mixed,
      ...fillers,
      question('outside-only', 'outside'),
      question('target-transfer', 'target'),
    ]);
    const plan = [mixed.id, ...fillers.map((q) => q.id)];
    const next = scheduleErrorRecurrence({
      studentId: 'lutz',
      questionBank: pool,
      questionIds: plan,
      failedQuestionId: mixed.id,
      failedIndex: 0,
      completedQuestionIds: [mixed.id],
      skillStates: [],
      recentAttempts: [],
      random: () => 0,
      allowedSkillIds: ['target', 'other-target'],
    });
    expect(next[4]).toBe('target-transfer');
    expect(next).not.toContain('outside-only');
  });
});
