import type { Question } from '@shared/types';
import { adaptiveConfig } from './config';
import { validateAttempt, validateSkillState } from './mastery';
import type {
  AttemptRecord,
  Difficulty,
  RandomProvider,
  SelectionOptions,
  StudentSkillState,
} from './types';

export function createSeededRandom(seed: number): RandomProvider {
  if (!Number.isFinite(seed) || !Number.isSafeInteger(seed))
    throw new Error('Ungültiger Zufalls-Seed.');
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function recentSubjectAttempts(
  studentId: string,
  subject: string,
  attempts: readonly AttemptRecord[],
): AttemptRecord[] {
  const scoped = attempts.filter(
    (attempt) => attempt.studentId === studentId && attempt.subject === subject,
  );
  for (const attempt of scoped) validateAttempt(attempt);
  return [...scoped]
    .sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))
    .slice(0, adaptiveConfig.recentAttemptWindow);
}

export function skillMastery(
  studentId: string,
  subject: string,
  skillId: string,
  states: readonly StudentSkillState[],
): number {
  const matches = states.filter(
    (state) =>
      state.studentId === studentId && state.subject === subject && state.skillId === skillId,
  );
  if (matches.length > 1) throw new Error('Doppelter Kompetenzstand für denselben Skill.');
  if (!matches.length) return adaptiveConfig.defaultMastery;
  validateSkillState(matches[0]);
  return matches[0].mastery;
}

export function preferredDifficulties(mastery: number): Difficulty[] {
  if (!Number.isFinite(mastery) || mastery < 0 || mastery > 1)
    throw new Error('Ungültiger Kompetenzwert.');
  if (mastery < adaptiveConfig.difficultyThresholds.low) return [1];
  if (mastery < adaptiveConfig.difficultyThresholds.medium) return [1, 2];
  if (mastery <= adaptiveConfig.difficultyThresholds.high) return [2, 3];
  return [3, 4];
}

export interface QuestionWeightOptions {
  question: Question;
  studentId: string;
  subject: string;
  skillStates: readonly StudentSkillState[];
  recentAttempts: readonly AttemptRecord[];
  preferredSkillIds?: readonly string[];
  difficultyTargetsBySkill?: Readonly<Record<string, number>>;
  sourceErrorCountsBySkill?: Readonly<Record<string, number>>;
}

export function questionWeight(options: QuestionWeightOptions): number {
  const {
    question,
    studentId,
    subject,
    skillStates,
    recentAttempts,
    preferredSkillIds = [],
    difficultyTargetsBySkill = {},
    sourceErrorCountsBySkill = {},
  } = options;
  if (
    question.subject !== subject ||
    !question.skillIds.length ||
    !Number.isInteger(question.difficulty) ||
    question.difficulty < 1 ||
    question.difficulty > 4 ||
    !Number.isFinite(question.points) ||
    question.points <= 0
  ) {
    throw new Error('Ungültige Aufgabe für adaptive Auswahl.');
  }
  const skills = [...new Set(question.skillIds)];
  const history = recentSubjectAttempts(studentId, subject, recentAttempts);
  const masteries = skills.map((skill) => skillMastery(studentId, subject, skill, skillStates));
  const weights = skills.map((skill, index) => {
    const recentErrors = history.filter(
      (attempt) => !attempt.correct && !attempt.skipped && attempt.skillIds.includes(skill),
    ).length;
    const sourceErrors = sourceErrorCountsBySkill[skill] ?? 0;
    if (!Number.isSafeInteger(sourceErrors) || sourceErrors < 0)
      throw new Error('Ungültige Fehleranzahl.');
    // The source result and recent window may describe the same errors: use the larger count, not both sums.
    const errors = Math.max(recentErrors, sourceErrors);
    return (
      1 +
      adaptiveConfig.weaknessWeight * (1 - masteries[index]) +
      Math.min(adaptiveConfig.recentErrorBonusCap, errors * adaptiveConfig.recentErrorBonus)
    );
  });
  const mean = masteries.reduce((sum, mastery) => sum + mastery, 0) / masteries.length;
  const preferred = preferredDifficulties(mean);
  const distance = Math.min(
    ...preferred.map((difficulty) => Math.abs(difficulty - question.difficulty)),
  );
  const difficultyWeight =
    distance === 0
      ? adaptiveConfig.preferredDifficultyWeight
      : 1 / (1 + distance * adaptiveConfig.otherDifficultyDistancePenalty);
  const focusWeight = skills.some((skill) => preferredSkillIds.includes(skill))
    ? adaptiveConfig.preferredSkillWeight
    : 1;
  const targets = skills
    .map((skill) => difficultyTargetsBySkill[skill])
    .filter((value) => value !== undefined);
  if (targets.some((value) => !Number.isFinite(value) || value < 1 || value > 4))
    throw new Error('Ungültige Zielschwierigkeit.');
  const similarityWeight = targets.length
    ? 1 /
      (1 +
        Math.abs(
          question.difficulty - targets.reduce((sum, value) => sum + value, 0) / targets.length,
        ) *
          adaptiveConfig.difficultySimilarityPenalty)
    : 1;
  return (
    (weights.reduce((sum, weight) => sum + weight, 0) / weights.length) *
    difficultyWeight *
    focusWeight *
    similarityWeight
  );
}

export function weightedPick<T>(
  candidates: readonly T[],
  weight: (candidate: T) => number,
  random: RandomProvider,
): T | undefined {
  if (!candidates.length) return undefined;
  const weights = candidates.map(weight);
  if (weights.some((value) => !Number.isFinite(value) || value <= 0))
    throw new Error('Ungültiges Auswahlgewicht.');
  const total = weights.reduce((sum, value) => sum + value, 0);
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1 || !Number.isFinite(total)) {
    throw new Error('Ungültige Zufallsauswahl.');
  }
  let position = draw * total;
  for (let index = 0; index < candidates.length; index += 1) {
    position -= weights[index];
    if (position < 0) return candidates[index];
  }
  return candidates[candidates.length - 1];
}

export function selectQuestions(options: SelectionOptions): Question[] {
  const {
    studentId,
    questionBank: bank,
    skillStates,
    recentAttempts,
    desiredQuestionCount,
    mode,
    random = Math.random,
    excludeQuestionIds = [],
    preferredSkillIds = [],
    difficultyTargetsBySkill = {},
    sourceErrorCountsBySkill = {},
  } = options;
  if (
    !studentId ||
    !bank.studentIds.includes(studentId) ||
    !['learn', 'exam', 'error_training'].includes(mode) ||
    !Number.isSafeInteger(desiredQuestionCount) ||
    desiredQuestionCount < 1
  ) {
    throw new Error('Ungültiger Auftrag für adaptive Auswahl.');
  }
  const history = recentSubjectAttempts(studentId, bank.subject, recentAttempts);
  const recentIds = options.recentQuestionIds ?? history.map((attempt) => attempt.questionId);
  if (recentIds.some((id) => typeof id !== 'string' || !id))
    throw new Error('Ungültige Aufgabenhistorie.');
  const exclusion = new Set(excludeQuestionIds);
  let available = bank.questions.filter((question) => !exclusion.has(question.id));
  if (new Set(available.map((question) => question.id)).size !== available.length)
    throw new Error('Doppelte Aufgaben-IDs.');
  const weights = new Map(
    available.map((question) => [
      question.id,
      questionWeight({
        question,
        studentId,
        subject: bank.subject,
        skillStates,
        recentAttempts: history,
        preferredSkillIds,
        difficultyTargetsBySkill,
        sourceErrorCountsBySkill,
      }),
    ]),
  );
  const selected: Question[] = [];
  while (selected.length < desiredQuestionCount && available.length) {
    const rollingHistory = [...selected.map((question) => question.id).reverse(), ...recentIds];
    const recent = new Set([
      ...recentIds.slice(0, adaptiveConfig.avoidRecentQuestions),
      ...selected.map((question) => question.id),
    ]);
    const alternatives = available.filter((question) => !recent.has(question.id));
    // Recent exclusions are soft when the pool is small; immediate identical repetition is never allowed.
    const candidates = alternatives.length
      ? alternatives
      : available.filter((question) => question.id !== rollingHistory[0]);
    const question = weightedPick(candidates, (item) => weights.get(item.id)!, random);
    if (!question) break;
    selected.push(question);
    available = available.filter((item) => item.id !== question.id);
  }
  return selected;
}
