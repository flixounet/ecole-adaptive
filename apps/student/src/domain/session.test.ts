import { describe, expect, it, vi } from 'vitest';
import source from '@shared/fixtures/lutz-maths-demo.json';
import { parseQuestionBank } from '@shared/validation';
import {
  createSession,
  finishSession,
  isExpired,
  moveTo,
  remainingSeconds,
  setAnswer,
  submitLearningAnswer,
} from './session';

function bank() {
  return parseQuestionBank({
    ...structuredClone(source),
    durationMinutes: 1,
    questionCount: 2,
    questions: [
      { ...source.questions[0], points: 2 },
      { ...source.questions[1], points: 3 },
    ],
  });
}

describe('sessions and scoring', () => {
  it('generates unique session IDs on local HTTP where randomUUID is unavailable', () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    try {
      const first = createSession(bank(), 'lutz', 'learn', 1_000);
      const second = createSession(bank(), 'lutz', 'learn', 1_000);
      expect(first.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(first.id).not.toBe(second.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('takes an independent immutable snapshot and randomized sample without duplicate questions', () => {
    const original = parseQuestionBank(structuredClone(source));
    const session = createSession(original, 'lutz', 'exam', 1_000, () => 0);
    expect(session.questionIds).toHaveLength(original.questionCount);
    expect(new Set(session.questionIds).size).toBe(original.questionCount);
    expect(session.questionIds).not.toEqual(
      original.questions.slice(0, original.questionCount).map((q) => q.id),
    );
    original.questions[0].question = 'changed';
    expect(session.bankSnapshot.questions[0].question).not.toBe('changed');
    expect(() => createSession(original, 'max', 'learn', 1_000)).toThrow(/Profil/);
  });

  it('scores weighted points, unanswered questions, /20 and percent consistently', () => {
    const original = createSession(bank(), 'lutz', 'exam', 1_000);
    const answered = setAnswer(
      original,
      source.questions[0].id,
      source.questions[0].correctAnswer,
      2_000,
    );
    const result = finishSession(answered, 11_000);
    expect(original.answers[source.questions[0].id].value).toBe('');
    expect(result).toMatchObject({
      earnedPoints: 2,
      maxPoints: 5,
      score20: 8,
      percentage: 40,
      duration: 10,
    });
    expect(result.mistakes).toEqual([source.questions[1].id]);
    expect(
      result.answers.find((answer) => answer.questionId === source.questions[1].id)?.attempts,
    ).toBe(0);
    expect(result.skillsBefore).toEqual({});
    expect(result.skillsAfter).toEqual({});
  });

  it('gives progressive hints and freezes learning answers after three wrong attempts', () => {
    let session = createSession(bank(), 'lutz', 'learn', 1_000);
    const id = source.questions[0].id;
    expect(submitLearningAnswer(session, id, 2_000)).toBe(session);
    session = setAnswer(session, id, '999', 2_000);
    session = submitLearningAnswer(session, id, 2_000);
    expect(session.answers[id]).toMatchObject({
      attempts: 1,
      hintsUsed: 1,
      resolved: false,
      correct: false,
    });
    session = submitLearningAnswer(session, id, 3_000);
    expect(session.answers[id]).toMatchObject({ attempts: 2, hintsUsed: 2, resolved: false });
    session = submitLearningAnswer(session, id, 4_000);
    expect(session.answers[id]).toMatchObject({
      attempts: 3,
      hintsUsed: 2,
      resolved: true,
      correct: false,
    });
    expect(setAnswer(session, id, '19', 5_000)).toBe(session);
    expect(submitLearningAnswer(session, id, 5_000)).toBe(session);
    expect(finishSession(session, 6_000).earnedPoints).toBe(0);
  });

  it('freezes a correct learning answer and preserves the hints already used', () => {
    const id = source.questions[0].id;
    let session = createSession(bank(), 'lutz', 'learn', 1_000);
    session = submitLearningAnswer(setAnswer(session, id, '99', 2_000), id, 2_000);
    session = submitLearningAnswer(setAnswer(session, id, '19', 3_000), id, 3_000);
    expect(session.answers[id]).toMatchObject({
      attempts: 2,
      hintsUsed: 1,
      correct: true,
      resolved: true,
    });
    expect(setAnswer(session, id, '0', 4_000)).toBe(session);
    expect(finishSession(session, 4_000).earnedPoints).toBe(2);
  });

  it('does not award learning points for a correct but unsubmitted edit', () => {
    let session = createSession(bank(), 'lutz', 'learn', 1_000);
    session = setAnswer(session, source.questions[0].id, '19', 2_000);
    expect(finishSession(session, 3_000).earnedPoints).toBe(0);
  });

  it('uses absolute deadlines on resume, blocks expired edits, and caps date and duration', () => {
    const session = createSession(bank(), 'lutz', 'exam', 1_000);
    expect(session.deadlineAt).toBe(61_000);
    expect(remainingSeconds(session.deadlineAt, 60_001)).toBe(1);
    expect(remainingSeconds(session.deadlineAt, 61_000)).toBe(0);
    expect(remainingSeconds(null, 61_000)).toBeNull();
    const recovered = structuredClone(session);
    expect(isExpired(recovered, 61_000)).toBe(true);
    expect(setAnswer(recovered, source.questions[0].id, '19', 61_000)).toBe(recovered);
    expect(finishSession(recovered, 120_000)).toMatchObject({ date: 61_000, duration: 60 });
  });

  it('exam answers stay ungraded before finalization and navigation remains bounded', () => {
    const session = createSession(bank(), 'lutz', 'exam', 1_000);
    const answered = setAnswer(session, source.questions[0].id, '19', 2_000);
    expect(submitLearningAnswer(answered, source.questions[0].id, 3_000)).toBe(answered);
    expect(answered.answers[source.questions[0].id]).toMatchObject({
      correct: null,
      resolved: false,
      hintsUsed: 0,
    });
    expect(moveTo(session, -1)).toBe(session);
    expect(moveTo(session, 2)).toBe(session);
    expect(moveTo(session, 1).currentIndex).toBe(1);
  });
});
