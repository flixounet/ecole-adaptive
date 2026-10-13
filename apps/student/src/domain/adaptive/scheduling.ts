import type { Question } from '@shared/types';
import { adaptiveConfig } from './config';
import { questionWeight, weightedPick } from './selection';
import type { ProgressionOptions, RecurrenceOptions } from './types';

function inspect(options: RecurrenceOptions) {
  const { questionBank, questionIds, failedIndex, failedQuestionId, studentId } = options;
  const questions = new Map(questionBank.questions.map((question) => [question.id, question]));
  if (
    !questionBank.studentIds.includes(studentId) ||
    !Number.isInteger(failedIndex) ||
    failedIndex < 0 ||
    failedIndex >= questionIds.length ||
    questionIds[failedIndex] !== failedQuestionId ||
    new Set(questionIds).size !== questionIds.length ||
    questionIds.some((id) => !questions.has(id))
  ) {
    throw new Error('Ungültiger Lernplan für die Wiederholung.');
  }
  const failed = questions.get(failedQuestionId)!;
  if (!failed.skillIds.length) throw new Error('Die Aufgabe besitzt keine Skill-Zuordnung.');
  const protectedIds = new Set([
    ...options.completedQuestionIds,
    ...(options.recentQuestionIds ?? []),
  ]);
  for (const id of questionIds.slice(0, failedIndex + 1)) protectedIds.add(id);
  const excluded = new Set(options.excludeQuestionIds ?? []);
  const allowedSkills = new Set(options.allowedSkillIds ?? []);
  const withinTrainingFocus = (question: Question) =>
    allowedSkills.size === 0 || question.skillIds.some((skill) => allowedSkills.has(skill));
  const sharesSkill = (question: Question) =>
    question.skillIds.some((skill) => failed.skillIds.includes(skill));
  return { questions, failed, protectedIds, excluded, sharesSkill, withinTrainingFocus };
}

function replaceOrSwap(plan: string[], targetIndex: number, questionId: string): string[] {
  const existingIndex = plan.indexOf(questionId);
  const next = [...plan];
  if (existingIndex >= 0)
    [next[targetIndex], next[existingIndex]] = [next[existingIndex], next[targetIndex]];
  else next[targetIndex] = questionId;
  return next;
}

/** Keeps visited/edited slots intact, gives two intervening questions, then adds a transfer variant. */
export function scheduleErrorRecurrence(options: RecurrenceOptions): string[] {
  const { questions, failed, protectedIds, excluded, sharesSkill, withinTrainingFocus } =
    inspect(options);
  const random = options.random ?? Math.random;
  const earliest = options.failedIndex + adaptiveConfig.recurrenceMinIntervening + 1;
  const plan = [...options.questionIds];
  const mutable = (index: number) => index > options.failedIndex && !protectedIds.has(plan[index]);
  // Where possible, move already-planned same-skill questions out of the immediate two slots.
  for (let index = options.failedIndex + 1; index < Math.min(earliest, plan.length); index += 1) {
    if (!mutable(index) || !sharesSkill(questions.get(plan[index])!)) continue;
    const donor = plan.findIndex(
      (id, candidate) =>
        candidate >= earliest &&
        mutable(candidate) &&
        !sharesSkill(questions.get(id)!) &&
        withinTrainingFocus(questions.get(id)!),
    );
    if (donor >= 0) [plan[index], plan[donor]] = [plan[donor], plan[index]];
  }
  const eligibleSlots = plan
    .map((_, index) => index)
    .filter((index) => index >= earliest && mutable(index));
  if (!eligibleSlots.length) return plan;
  const preferredSlots = eligibleSlots.filter(
    (index) =>
      index >= options.failedIndex + adaptiveConfig.recurrencePreferredStart &&
      index <= options.failedIndex + adaptiveConfig.recurrencePreferredEnd,
  );
  const targetIndex = (preferredSlots.length ? preferredSlots : eligibleSlots)[0];
  const candidates = options.questionBank.questions.filter(
    (question) =>
      question.id !== failed.id &&
      !protectedIds.has(question.id) &&
      !excluded.has(question.id) &&
      sharesSkill(question) &&
      withinTrainingFocus(question) &&
      (!plan.includes(question.id) || plan.indexOf(question.id) >= earliest),
  );
  const question = weightedPick(
    candidates,
    (candidate) =>
      questionWeight({
        question: candidate,
        studentId: options.studentId,
        subject: options.questionBank.subject,
        skillStates: options.skillStates,
        recentAttempts: options.recentAttempts,
        preferredSkillIds: failed.skillIds,
      }) /
      (1 + Math.abs(candidate.difficulty - failed.difficulty)),
    random,
  );
  if (question) return replaceOrSwap(plan, targetIndex, question.id);
  // If no transfer exists, retain the safe plan; never insert an immediate identical question.
  return plan;
}

/** After a successful error-training answer, offer a slightly harder transfer if one exists. */
export function scheduleTrainingProgression(options: ProgressionOptions): string[] {
  const recurrence: RecurrenceOptions = {
    ...options,
    failedIndex: options.currentIndex,
    failedQuestionId: options.questionId,
  };
  const {
    failed: current,
    protectedIds,
    excluded,
    sharesSkill,
    withinTrainingFocus,
  } = inspect(recurrence);
  const targetIndex = options.questionIds.findIndex(
    (id, index) => index > options.currentIndex && !protectedIds.has(id),
  );
  if (targetIndex < 0) return [...options.questionIds];
  const desiredDifficulty = Math.min(
    4,
    current.difficulty + adaptiveConfig.trainingProgressionDifficultyStep,
  );
  const candidates = options.questionBank.questions.filter(
    (question) =>
      question.id !== current.id &&
      !protectedIds.has(question.id) &&
      !excluded.has(question.id) &&
      sharesSkill(question) &&
      withinTrainingFocus(question) &&
      question.difficulty === desiredDifficulty,
  );
  const question = weightedPick(
    candidates,
    (candidate) =>
      questionWeight({
        question: candidate,
        studentId: options.studentId,
        subject: options.questionBank.subject,
        skillStates: options.skillStates,
        recentAttempts: options.recentAttempts,
        preferredSkillIds: current.skillIds,
      }),
    options.random ?? Math.random,
  );
  return question
    ? replaceOrSwap([...options.questionIds], targetIndex, question.id)
    : [...options.questionIds];
}
