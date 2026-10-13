import { adaptiveConfig, type AdaptiveConfig } from './config';
import type { AttemptInput, AttemptOutcome, AttemptRecord, StudentSkillState } from './types';

const outcomes: readonly AttemptOutcome[] = [
  'CORRECT_FIRST_TRY',
  'CORRECT_AFTER_HINT',
  'CORRECT_AFTER_MULTIPLE_HINTS',
  'INCORRECT',
  'SKIPPED',
];

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateAttempt(attempt: AttemptInput): void {
  if (
    !attempt ||
    ![attempt.id, attempt.sessionId, attempt.studentId, attempt.subject, attempt.questionId].every(
      text,
    ) ||
    (attempt.testId !== undefined && !text(attempt.testId)) ||
    !['learn', 'exam', 'error_training'].includes(attempt.mode) ||
    !Number.isFinite(attempt.timestamp) ||
    attempt.timestamp < 0 ||
    typeof attempt.answer !== 'string' ||
    typeof attempt.correct !== 'boolean' ||
    typeof attempt.skipped !== 'boolean' ||
    !Number.isInteger(attempt.attemptNumber) ||
    attempt.attemptNumber < 0 ||
    attempt.attemptNumber > 3 ||
    !Number.isInteger(attempt.hintsUsed) ||
    attempt.hintsUsed < 0 ||
    attempt.hintsUsed > 2 ||
    !Number.isInteger(attempt.difficulty) ||
    attempt.difficulty < 1 ||
    attempt.difficulty > 4 ||
    !Array.isArray(attempt.skillIds) ||
    !attempt.skillIds.length ||
    !attempt.skillIds.every(text) ||
    (attempt.responseTimeMs !== null &&
      (!Number.isFinite(attempt.responseTimeMs) || attempt.responseTimeMs < 0)) ||
    (attempt.correct &&
      (attempt.skipped ||
        attempt.attemptNumber < 1 ||
        attempt.hintsUsed >= attempt.attemptNumber)) ||
    (!attempt.skipped && attempt.attemptNumber < 1)
  ) {
    throw new Error('Ungültiger finaler Aufgabenversuch.');
  }
}

export function validateSkillState(state: StudentSkillState): void {
  const counters = [
    state.attempts,
    state.correctCount,
    state.incorrectCount,
    state.skippedCount,
    state.hintedCorrectCount,
    state.currentStreak,
    state.bestStreak,
    state.recentErrorCount,
  ];
  if (
    ![state.studentId, state.subject, state.skillId].every(text) ||
    !Number.isFinite(state.mastery) ||
    state.mastery < 0 ||
    state.mastery > 1 ||
    counters.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    state.attempts !== state.correctCount + state.incorrectCount + state.skippedCount ||
    state.hintedCorrectCount > state.correctCount ||
    state.currentStreak > state.bestStreak ||
    state.bestStreak > state.correctCount ||
    !Array.isArray(state.recentOutcomes) ||
    state.recentOutcomes.some((outcome) => !outcomes.includes(outcome)) ||
    state.recentErrorCount !==
      state.recentOutcomes.filter((outcome) => outcome === 'INCORRECT').length ||
    [state.lastPracticedAt, state.lastIncorrectAt].some(
      (value) => value !== null && (!Number.isFinite(value) || value < 0),
    ) ||
    (state.lastAttemptId !== null && !text(state.lastAttemptId)) ||
    (state.lastDifficulty !== null && ![1, 2, 3, 4].includes(state.lastDifficulty))
  ) {
    throw new Error('Ungültiger Kompetenzstand.');
  }
}

export function createSkillState(
  studentId: string,
  subject: string,
  skillId: string,
  config: Readonly<AdaptiveConfig> = adaptiveConfig,
): StudentSkillState {
  const state: StudentSkillState = {
    studentId,
    subject,
    skillId,
    mastery: config.defaultMastery,
    attempts: 0,
    correctCount: 0,
    incorrectCount: 0,
    skippedCount: 0,
    hintedCorrectCount: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastPracticedAt: null,
    lastIncorrectAt: null,
    recentErrorCount: 0,
    recentOutcomes: [],
    lastAttemptId: null,
    lastDifficulty: null,
  };
  validateSkillState(state);
  return state;
}

export function classifyAttempt(attempt: AttemptInput): AttemptOutcome {
  validateAttempt(attempt);
  if (attempt.skipped) return 'SKIPPED';
  if (!attempt.correct) return 'INCORRECT';
  if (attempt.hintsUsed >= 2) return 'CORRECT_AFTER_MULTIPLE_HINTS';
  if (attempt.hintsUsed === 1) return 'CORRECT_AFTER_HINT';
  return 'CORRECT_FIRST_TRY';
}

/** Applies one FINAL question outcome. Persistence additionally deduplicates the attempt ID. */
export function updateSkillMastery(
  currentState: StudentSkillState,
  attempt: AttemptInput,
  config: Readonly<AdaptiveConfig> = adaptiveConfig,
): StudentSkillState {
  validateSkillState(currentState);
  const outcome = classifyAttempt(attempt);
  if (
    currentState.studentId !== attempt.studentId ||
    currentState.subject !== attempt.subject ||
    !attempt.skillIds.includes(currentState.skillId)
  ) {
    throw new Error('Der Versuch gehört zu einem anderen Profil, Fach oder Skill.');
  }
  if (currentState.lastAttemptId === attempt.id) return structuredClone(currentState);
  if (currentState.lastPracticedAt !== null && attempt.timestamp < currentState.lastPracticedAt) {
    throw new Error('Ein älterer Versuch darf keinen neueren Kompetenzstand überschreiben.');
  }
  const delta = config.masteryDeltas[outcome];
  const modifier = delta > 0 ? config.positiveDifficultyModifiers[attempt.difficulty] : 1;
  if (
    !Number.isFinite(delta) ||
    !Number.isFinite(modifier) ||
    modifier <= 0 ||
    !Number.isSafeInteger(config.recentAttemptWindow) ||
    config.recentAttemptWindow < 1
  ) {
    throw new Error('Ungültige Mastery-Konfiguration.');
  }
  const correct = attempt.correct && !attempt.skipped;
  const currentStreak = correct ? currentState.currentStreak + 1 : 0;
  const recentOutcomes = [...currentState.recentOutcomes, outcome].slice(
    -config.recentAttemptWindow,
  );
  const state: StudentSkillState = {
    ...currentState,
    mastery:
      Math.round(Math.min(1, Math.max(0, currentState.mastery + delta * modifier)) * 1e12) / 1e12,
    attempts: currentState.attempts + 1,
    correctCount: currentState.correctCount + Number(correct),
    incorrectCount: currentState.incorrectCount + Number(outcome === 'INCORRECT'),
    skippedCount: currentState.skippedCount + Number(outcome === 'SKIPPED'),
    hintedCorrectCount: currentState.hintedCorrectCount + Number(correct && attempt.hintsUsed > 0),
    currentStreak,
    bestStreak: Math.max(currentState.bestStreak, currentStreak),
    lastPracticedAt: attempt.timestamp,
    lastIncorrectAt: outcome === 'INCORRECT' ? attempt.timestamp : currentState.lastIncorrectAt,
    recentErrorCount: recentOutcomes.filter((value) => value === 'INCORRECT').length,
    recentOutcomes,
    lastAttemptId: attempt.id,
    lastDifficulty: attempt.difficulty,
  };
  validateSkillState(state);
  return state;
}

export function applyAttemptToSkills(
  currentStates: readonly StudentSkillState[],
  attempt: AttemptInput,
  config: Readonly<AdaptiveConfig> = adaptiveConfig,
): { states: StudentSkillState[]; record: AttemptRecord } {
  const outcome = classifyAttempt(attempt);
  const skillIds = [...new Set(attempt.skillIds)];
  const masteryBefore: Record<string, number> = {};
  const masteryAfter: Record<string, number> = {};
  const states = skillIds.map((skillId) => {
    const matches = currentStates.filter(
      (state) =>
        state.studentId === attempt.studentId &&
        state.subject === attempt.subject &&
        state.skillId === skillId,
    );
    if (matches.length > 1) throw new Error('Doppelter Kompetenzstand für denselben Skill.');
    const before =
      matches[0] ?? createSkillState(attempt.studentId, attempt.subject, skillId, config);
    const after = updateSkillMastery(before, attempt, config);
    masteryBefore[skillId] = before.mastery;
    masteryAfter[skillId] = after.mastery;
    return after;
  });
  return {
    states,
    record: { ...structuredClone(attempt), skillIds, outcome, masteryBefore, masteryAfter },
  };
}
