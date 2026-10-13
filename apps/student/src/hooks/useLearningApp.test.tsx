// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bankSource from '@shared/fixtures/lutz-maths-demo.json';
import profileSource from '@shared/fixtures/profiles.json';
import { parseQuestionBank, parseStudentProfile } from '@shared/validation';
import type { QuestionBank } from '@shared/types';
import {
  createSession,
  finishSession,
  setAnswer,
  type Result,
  type Session,
} from '../domain/session';
import { useLearningApp } from './useLearningApp';

const repositories = vi.hoisted(() => ({
  initializeDemo: vi.fn(),
  listProfiles: vi.fn(),
  listBanks: vi.fn(),
  listResults: vi.fn(),
  getActiveSession: vi.fn(),
  listSkillStates: vi.fn(),
  listRecentAttempts: vi.fn(),
  listInstalledPackages: vi.fn(),
  startBlueprintSession: vi.fn(),
  persistSession: vi.fn(),
  startAdaptiveSession: vi.fn(),
  completeSession: vi.fn(),
}));
vi.mock('../storage/repositories', () => repositories);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const profiles = profileSource.map(parseStudentProfile);
const lutz = profiles.find((profile) => profile.id === 'lutz')!;
const max = profiles.find((profile) => profile.id === 'max')!;
const bank = parseQuestionBank({
  ...bankSource,
  studentIds: profiles.map((profile) => profile.id),
  questionCount: 2,
});
let clockNow: number;

function exam(studentId = 'lutz', startedAt = clockNow): Session {
  return {
    ...createSession(bank, studentId, 'exam', startedAt, () => 0),
    id: `session-${studentId}`,
  };
}

async function mountedApp() {
  const app = renderHook(() => useLearningApp());
  await act(async () => {
    await Promise.resolve();
  });
  expect(app.result.current.busy).toBe(false);
  return app;
}

async function openedExam() {
  const app = await mountedApp();
  await act(async () => {
    await app.result.current.selectProfile(lutz);
  });
  await act(async () => {
    await app.result.current.start(bank, 'exam');
  });
  expect(app.result.current.session).not.toBeNull();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.useFakeTimers();
  clockNow = 2_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clockNow);
  repositories.initializeDemo.mockResolvedValue(undefined);
  repositories.listProfiles.mockResolvedValue(profiles);
  repositories.listBanks.mockImplementation(async (studentId: string) =>
    studentId === 'lutz' ? [bank] : [],
  );
  repositories.listResults.mockResolvedValue([]);
  repositories.getActiveSession.mockResolvedValue(undefined);
  repositories.listSkillStates.mockResolvedValue([]);
  repositories.listRecentAttempts.mockResolvedValue([]);
  repositories.listInstalledPackages.mockResolvedValue([]);
  repositories.persistSession.mockImplementation(async (session: Session) =>
    structuredClone(session),
  );
  repositories.startAdaptiveSession.mockImplementation(
    async (_bank: QuestionBank, studentId: string) => exam(studentId),
  );
  repositories.completeSession.mockImplementation(async (session: Session) =>
    finishSession(session, clockNow),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Learning app coordination', () => {
  it('keeps the owner and deadline when a profile-switch warning is cancelled', async () => {
    const old = exam('max');
    repositories.getActiveSession.mockImplementation(async (id: string) => id === 'max' ? old : undefined);
    const app = await mountedApp();
    await act(async () => { await app.result.current.selectProfile(max); });
    vi.mocked(window.confirm).mockReturnValue(false);
    await act(async () => { await app.result.current.selectProfile(lutz); });
    expect(window.confirm).toHaveBeenCalled();
    expect(app.result.current.profile?.id).toBe('max');
    expect(app.result.current.savedSession?.deadlineAt).toBe(old.deadlineAt);
  });
  it('does not show an expiring old profile exam under a newly selected profile', async () => {
    const old = exam('max', clockNow - bank.durationMinutes * 60_000 + 100);
    const loadingLutz = deferred<QuestionBank[]>();
    const oldCompletion = deferred<Result>();
    repositories.getActiveSession.mockImplementation(async (id: string) =>
      id === 'max' ? old : undefined,
    );
    repositories.completeSession.mockReturnValue(oldCompletion.promise);
    const app = await mountedApp();
    await act(async () => {
      await app.result.current.selectProfile(max);
    });
    expect(app.result.current.savedSession?.studentId).toBe('max');
    repositories.listBanks.mockImplementation((id: string) =>
      id === 'lutz' ? loadingLutz.promise : Promise.resolve([]),
    );

    let selection!: Promise<void>;
    act(() => {
      selection = app.result.current.selectProfile(lutz);
    });
    clockNow += 200;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    await act(async () => {
      loadingLutz.resolve([bank]);
      await selection;
    });
    // Covers both safe policies: finish the old exam without displaying it, or
    // defer its submission until its owner is selected again.
    await act(async () => {
      oldCompletion.resolve(finishSession(old, clockNow));
      await Promise.resolve();
    });
    expect(app.result.current.profile?.id).toBe('lutz');
    expect(app.result.current.result?.studentId).not.toBe('max');
    expect(app.result.current.savedSession?.studentId).not.toBe('max');
    expect(app.result.current.results.every((result) => result.studentId === 'lutz')).toBe(true);
    expect(app.result.current.banks).toEqual([bank]);
  });

  it('waits for queued autosaves and submits the latest typed answer', async () => {
    const app = await openedExam();
    const original = app.result.current.session!;
    const id = original.questionIds[0];
    const correct = original.bankSnapshot.questions.find(
      (question) => question.id === id,
    )!.correctAnswer;
    const first = setAnswer(original, id, 'wrong', clockNow);
    const latest = setAnswer(first, id, correct, clockNow);
    const firstWrite = deferred<Session>();
    const secondWrite = deferred<Session>();
    repositories.persistSession
      .mockReset()
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise)
      .mockImplementation(async (session: Session) => session);
    let firstSave!: Promise<Session>;
    let secondSave!: Promise<Session>;
    let completion!: Promise<void>;
    await act(async () => {
      firstSave = app.result.current.persist(first);
      secondSave = app.result.current.persist(latest);
      completion = app.result.current.finish();
      await Promise.resolve();
    });
    expect(repositories.completeSession).not.toHaveBeenCalled();
    await act(async () => {
      firstWrite.resolve(first);
      await firstSave;
    });
    expect(repositories.completeSession).not.toHaveBeenCalled();
    await act(async () => {
      secondWrite.resolve(latest);
      await secondSave;
      await completion;
    });
    expect(repositories.completeSession).toHaveBeenCalledTimes(1);
    expect(repositories.completeSession.mock.calls[0][0].answers[id].value).toBe(correct);
    expect(
      app.result.current.result?.answers.find((answer) => answer.questionId === id)?.correct,
    ).toBe(true);
    expect(app.result.current.session).toBeNull();
  });

  it('ignores a second submit while the first completion is pending', async () => {
    const app = await openedExam();
    const active = app.result.current.session!;
    const gate = deferred<Result>();
    repositories.completeSession.mockReturnValue(gate.promise);
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = app.result.current.finish();
      second = app.result.current.finish();
      await Promise.resolve();
    });
    expect(repositories.completeSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      gate.resolve(finishSession(active, clockNow));
      await Promise.all([first, second]);
    });
    expect(repositories.completeSession).toHaveBeenCalledTimes(1);
    expect(app.result.current.result?.id).toBe(active.id);
  });

  it('keeps unsaved input on storage failure and clears the error only after retry', async () => {
    const app = await openedExam();
    const active = app.result.current.session!;
    const id = active.questionIds[0];
    const changed = setAnswer(active, id, 'my unsaved answer', clockNow);
    repositories.persistSession.mockRejectedValueOnce(new Error('Speicher voll'));
    await act(async () => {
      await app.result.current.persist(changed).catch(() => undefined);
    });
    expect(app.result.current.session?.answers[id].value).toBe('my unsaved answer');
    expect(app.result.current.saveFailed).toBe(true);
    expect(app.result.current.error).toContain('Speicher voll');
    expect(app.result.current.saving).toBe(false);
    await act(async () => {
      await app.result.current.persist(changed);
    });
    expect(app.result.current.saveFailed).toBe(false);
    expect(app.result.current.error).toBe('');
    expect(app.result.current.session?.answers[id].value).toBe('my unsaved answer');
  });
  it('keeps an expired exam recoverable when automatic submission fails', async () => {
    const expired = exam('lutz', clockNow - bank.durationMinutes * 60_000 - 1);
    repositories.getActiveSession.mockResolvedValue(expired);
    repositories.completeSession.mockRejectedValueOnce(
      new Error('Datenbank vorübergehend gesperrt'),
    );
    const app = await mountedApp();
    await act(async () => {
      await app.result.current.selectProfile(lutz);
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(repositories.completeSession).toHaveBeenCalledTimes(1);
    expect(app.result.current.savedSession?.id).toBe(expired.id);
    expect(app.result.current.savedSession?.deadlineAt).toBe(expired.deadlineAt);
    expect(app.result.current.result).toBeNull();
    expect(app.result.current.error).toContain('Abgabe nicht gespeichert');
    repositories.completeSession.mockImplementation(async (session: Session) => {
      repositories.getActiveSession.mockResolvedValue(undefined);
      return finishSession(session, clockNow);
    });
    await act(async () => {
      await app.result.current.finish(app.result.current.savedSession!);
    });
    expect(repositories.completeSession).toHaveBeenCalledTimes(2);
    expect(app.result.current.result?.completedAt).toBe(expired.deadlineAt);
    expect(app.result.current.savedSession).toBeNull();
    expect(app.result.current.error).toBe('');
  });

  it('refuses to open a result owned by another profile', async () => {
    const app = await mountedApp();
    await act(async () => {
      await app.result.current.selectProfile(lutz);
    });
    act(() => {
      app.result.current.openResult(finishSession(exam('max'), clockNow));
    });
    expect(app.result.current.profile?.id).toBe('lutz');
    expect(app.result.current.result).toBeNull();
  });
});
