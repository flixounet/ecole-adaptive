import type { TestBlueprint } from '@shared/content';
import type { QuestionBank } from '@shared/types';
import { parseQuestionBank } from '@shared/validation';
import { canonicalFixtureSkillId } from '@shared/fixture-migrations';
import { isCorrectAnswer } from './answers';
import type { AdaptiveMode } from './adaptive/types';

export type SessionMode = AdaptiveMode;

export interface AnswerState {
  value: string;
  attempts: number;
  hintsUsed: number;
  resolved: boolean;
  correct: boolean | null;
  /** Elapsed viewing time includes pauses; absent on migrated Phase-1 answers. */
  firstViewedAt?: number | null;
  lastViewedAt?: number | null;
  finalizedAt?: number;
}

export interface Session {
  id: string;
  studentId: string;
  bankId: string;
  bankVersion: number;
  mode: SessionMode;
  bankSnapshot: QuestionBank;
  questionIds: string[];
  startedAt: number;
  deadlineAt: number | null;
  currentIndex: number;
  answers: Record<string, AnswerState>;
  status: 'active' | 'completed';
  completedAt?: number;
  adaptive?: boolean;
  targetQuestionCount?: number;
  targetSkillIds?: string[];
  sourceResultId?: string;
  sourceMistakeQuestionIds?: string[];
  masteryBefore?: Record<string, number>;
  planRevision?: number;
  blueprintSnapshot?: TestBlueprint;
  packageContentHash?: string;
}

export interface SkillPerformance {
  earned: number;
  possible: number;
  percentage: number;
}

export interface Result {
  blueprintSnapshot?: TestBlueprint;
  packageContentHash?: string;
  id: string;
  studentId: string;
  testId: string;
  bankVersion: number;
  mode: SessionMode;
  date: number;
  duration: number;
  earnedPoints: number;
  maxPoints: number;
  score20: number;
  percentage: number;
  answers: {
    questionId: string;
    value: string;
    correct: boolean;
    earnedPoints: number;
    maxPoints: number;
    attempts: number;
    hintsUsed: number;
  }[];
  skillsBefore: Record<string, number>;
  skillsAfter: Record<string, number>;
  mistakes: string[];
  bankSnapshot: QuestionBank;
  subject: string;
  chapter: string;
  startedAt: number;
  completedAt: number;
  durationSeconds: number;
  skillPerformance: Record<string, SkillPerformance>;
  masteryBefore: Record<string, number>;
  masteryAfter: Record<string, number>;
  mistakeQuestionIds: string[];
  mistakeSkillIds: string[];
}

function checkTime(now: number): void {
  if (!Number.isFinite(now) || now < 0) throw new Error('Ungültiger Zeitpunkt.');
}

function newSessionId(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function emptyAnswer(firstViewedAt: number | null = null): AnswerState {
  return {
    value: '',
    attempts: 0,
    hintsUsed: 0,
    resolved: false,
    correct: null,
    firstViewedAt,
    lastViewedAt: firstViewedAt,
  };
}

export function createSession(
  bank: QuestionBank,
  studentId: string,
  mode: SessionMode,
  now = Date.now(),
  random = Math.random,
): Session {
  const snapshot = structuredClone(parseQuestionBank(bank));
  checkTime(now);
  if (!snapshot.studentIds.includes(studentId))
    throw new Error('Dieses Aufgabenpaket ist dem Profil nicht zugeordnet.');
  if (!['learn', 'exam', 'error_training'].includes(mode)) throw new Error('Ungültiger Modus.');
  const candidates = snapshot.questions.map((question) => question.id);
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const draw = random();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1)
      throw new Error('Ungültige Zufallsauswahl.');
    const other = Math.floor(draw * (index + 1));
    [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
  }
  const questionIds = candidates.slice(0, snapshot.questionCount);
  return {
    id: newSessionId(),
    studentId,
    bankId: snapshot.id,
    bankVersion: snapshot.version,
    mode,
    bankSnapshot: snapshot,
    questionIds,
    startedAt: now,
    deadlineAt: mode === 'exam' ? now + snapshot.durationMinutes * 60_000 : null,
    currentIndex: 0,
    status: 'active',
    answers: Object.fromEntries(
      questionIds.map((id, index) => [id, emptyAnswer(index === 0 ? now : null)]),
    ),
  };
}

export function remainingSeconds(deadlineAt: number | null, now = Date.now()): number | null {
  if (deadlineAt === null) return null;
  return Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

export function isExpired(session: Session, now = Date.now()): boolean {
  return session.deadlineAt !== null && now >= session.deadlineAt;
}

function editable(session: Session, questionId: string, now: number): boolean {
  return (
    session.status === 'active' &&
    !isExpired(session, now) &&
    session.questionIds.includes(questionId) &&
    !session.answers[questionId]?.resolved
  );
}

export function setAnswer(
  session: Session,
  questionId: string,
  value: string,
  now = Date.now(),
): Session {
  if (!editable(session, questionId, now)) return session;
  checkTime(now);
  return {
    ...session,
    answers: {
      ...session.answers,
      [questionId]: {
        ...session.answers[questionId],
        value,
        firstViewedAt: session.answers[questionId].firstViewedAt ?? now,
        lastViewedAt: session.answers[questionId].lastViewedAt ?? now,
      },
    },
  };
}

export function submitLearningAnswer(
  session: Session,
  questionId: string,
  now = Date.now(),
): Session {
  if (session.mode === 'exam' || !editable(session, questionId, now)) return session;
  checkTime(now);
  const previous = session.answers[questionId];
  if (!previous.value.trim()) return session;
  const question = session.bankSnapshot.questions.find((item) => item.id === questionId);
  if (!question) return session;
  const correct = isCorrectAnswer(question, previous.value);
  const attempts = previous.attempts + 1;
  const resolved = correct || attempts >= 3;
  return {
    ...session,
    answers: {
      ...session.answers,
      [questionId]: {
        ...previous,
        attempts,
        correct,
        resolved,
        hintsUsed: correct ? previous.hintsUsed : Math.min(attempts, 2),
        ...(resolved ? { finalizedAt: now } : {}),
      },
    },
  };
}

export function moveTo(session: Session, index: number, now = Date.now()): Session {
  if (!Number.isInteger(index) || index < 0 || index >= session.questionIds.length) return session;
  const id = session.questionIds[index];
  const answer = session.answers[id];
  if (session.status !== 'active' || isExpired(session, now))
    return { ...session, currentIndex: index };
  checkTime(now);
  return {
    ...session,
    currentIndex: index,
    answers: {
      ...session.answers,
      [id]: { ...answer, firstViewedAt: answer.firstViewedAt ?? now, lastViewedAt: now },
    },
  };
}

export function protectedQuestionIds(session: Session): string[] {
  return session.questionIds.filter((id) => {
    const answer = session.answers[id];
    return (
      answer.resolved ||
      answer.attempts > 0 ||
      Boolean(answer.value.trim()) ||
      answer.firstViewedAt != null
    );
  });
}

/** Apply a domain-generated future plan without removing any viewed or edited answer. */
export function applyQuestionPlan(session: Session, questionIds: string[]): Session {
  if (
    questionIds.length !== session.questionIds.length ||
    new Set(questionIds).size !== questionIds.length
  )
    throw new Error('Ungültiger Trainingsplan.');
  const known = new Set(session.bankSnapshot.questions.map((question) => question.id));
  if (
    questionIds.some((id) => !known.has(id)) ||
    protectedQuestionIds(session).some((id) => !questionIds.includes(id))
  )
    throw new Error('Bearbeitete Aufgaben dürfen nicht ersetzt werden.');
  if (questionIds.every((id, index) => id === session.questionIds[index])) return session;
  const currentId = session.questionIds[session.currentIndex];
  return {
    ...session,
    questionIds,
    currentIndex: Math.max(0, questionIds.indexOf(currentId)),
    planRevision: (session.planRevision ?? 0) + 1,
    answers: Object.fromEntries(
      questionIds.map((id) => [id, session.answers[id] ?? emptyAnswer()]),
    ),
  };
}

export function resultSkillPerformance(
  bank: QuestionBank,
  answers: readonly { questionId: string; earnedPoints: number; maxPoints: number }[],
): Record<string, SkillPerformance> {
  const performance: Record<string, SkillPerformance> = {};
  for (const answer of answers) {
    const question = bank.questions.find((item) => item.id === answer.questionId);
    for (const id of new Set(
      (question?.skillIds ?? []).map((rawId) => canonicalFixtureSkillId(bank.id, rawId)),
    )) {
      const previous = Object.hasOwn(performance, id)
        ? performance[id]
        : { earned: 0, possible: 0, percentage: 0 };
      performance[id] = {
        earned: previous.earned + answer.earnedPoints,
        possible: previous.possible + answer.maxPoints,
        percentage: 0,
      };
    }
  }
  for (const skill of Object.values(performance)) {
    skill.percentage = skill.possible ? Math.round((skill.earned / skill.possible) * 1000) / 10 : 0;
  }
  return performance;
}

/** Pure grading preserves the Phase-1 /20 calculation. Mastery is supplied by storage. */
export function finishSession(session: Session, now = Date.now()): Result {
  checkTime(now);
  const completedAt = session.completedAt ?? now;
  const end = session.deadlineAt === null ? completedAt : Math.min(completedAt, session.deadlineAt);
  const questions = new Map(
    session.bankSnapshot.questions.map((question) => [question.id, question]),
  );
  const answers = session.questionIds.map((questionId) => {
    const question = questions.get(questionId);
    if (!question) throw new Error('Eine Aufgabe fehlt im gespeicherten Paket.');
    const answer = session.answers[questionId];
    const correct =
      session.mode === 'exam'
        ? isCorrectAnswer(question, answer.value)
        : answer.resolved && answer.correct === true;
    return {
      questionId,
      value: answer.value,
      correct,
      earnedPoints: correct ? question.points : 0,
      maxPoints: question.points,
      attempts: session.mode === 'exam' ? (answer.value.trim() ? 1 : 0) : answer.attempts,
      hintsUsed: answer.hintsUsed,
    };
  });
  const maxPoints = answers.reduce((total, answer) => total + answer.maxPoints, 0);
  if (!Number.isFinite(maxPoints) || maxPoints <= 0)
    throw new Error('Eine Runde benötigt positive mögliche Punkte.');
  const earnedPoints = answers.reduce((total, answer) => total + answer.earnedPoints, 0);
  const ratio = earnedPoints / maxPoints;
  const mistakes = answers.filter((answer) => !answer.correct).map((answer) => answer.questionId);
  const mistakeSkillIds = Array.from(
    new Set(
      mistakes
        .flatMap((id) => questions.get(id)?.skillIds ?? [])
        .map((id) => canonicalFixtureSkillId(session.bankId, id)),
    ),
  );
  const duration = Math.max(0, Math.floor((end - session.startedAt) / 1000));
  const before = { ...session.masteryBefore };
  return {
    ...(session.blueprintSnapshot
      ? { blueprintSnapshot: structuredClone(session.blueprintSnapshot) }
      : {}),
    ...(session.packageContentHash ? { packageContentHash: session.packageContentHash } : {}),
    id: session.id,
    studentId: session.studentId,
    testId: session.bankId,
    bankVersion: session.bankVersion,
    mode: session.mode,
    date: end,
    duration,
    earnedPoints,
    maxPoints,
    score20: Math.round(ratio * 200) / 10,
    percentage: Math.round(ratio * 1000) / 10,
    answers,
    skillsBefore: before,
    skillsAfter: {},
    mistakes,
    bankSnapshot: structuredClone(session.bankSnapshot),
    subject: session.bankSnapshot.subject,
    chapter: session.bankSnapshot.chapter,
    startedAt: session.startedAt,
    completedAt: end,
    durationSeconds: duration,
    skillPerformance: resultSkillPerformance(session.bankSnapshot, answers),
    masteryBefore: before,
    masteryAfter: {},
    mistakeQuestionIds: mistakes,
    mistakeSkillIds,
  };
}
