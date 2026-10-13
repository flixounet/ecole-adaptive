import { canonicalFixtureSkillId } from '@shared/fixture-migrations';
import { adaptiveConfig } from './config';
import { recentSubjectAttempts, selectQuestions, skillMastery } from './selection';
import type { ErrorTrainingOptions, ErrorTrainingPlan } from './types';

/** New variants of failed skills. A small pool yields a shorter plan, never padded duplicates. */
export function createErrorTraining(options: ErrorTrainingOptions): ErrorTrainingPlan {
  const { sourceResult, questionBank: bank, studentId } = options;
  if (
    (sourceResult.studentId !== undefined && sourceResult.studentId !== studentId) ||
    sourceResult.bankSnapshot.subject !== bank.subject
  ) {
    throw new Error('Das Ergebnis gehört zu einem anderen Profil oder Fach.');
  }
  const sourceQuestions = new Map(
    sourceResult.bankSnapshot.questions.map((question) => [question.id, question]),
  );
  const originalQuestionIds = [
    ...new Set(
      sourceResult.answers.filter((answer) => !answer.correct).map((answer) => answer.questionId),
    ),
  ];
  const frequency = new Map<string, number>();
  const difficulties = new Map<string, number[]>();
  for (const id of originalQuestionIds) {
    const question = sourceQuestions.get(id);
    if (!question || !question.skillIds.length)
      throw new Error('Die Fehleraufgabe fehlt im gespeicherten Paket.');
    for (const sourceSkill of new Set(question.skillIds)) {
      const skill = canonicalFixtureSkillId(sourceResult.bankSnapshot.id, sourceSkill);
      frequency.set(skill, (frequency.get(skill) ?? 0) + 1);
      difficulties.set(skill, [...(difficulties.get(skill) ?? []), question.difficulty]);
    }
  }
  const targetSkillIds = [...frequency.keys()].sort(
    (a, b) =>
      skillMastery(studentId, bank.subject, a, options.skillStates) -
        skillMastery(studentId, bank.subject, b, options.skillStates) ||
      frequency.get(b)! - frequency.get(a)! ||
      a.localeCompare(b),
  );
  if (!targetSkillIds.length) return { questions: [], targetSkillIds, originalQuestionIds };

  const originals = new Set(originalQuestionIds);
  const related = bank.questions.filter((question) =>
    question.skillIds.some((skill) => frequency.has(skill)),
  );
  const alternatives = related.filter((question) => !originals.has(question.id));
  // With any transfer variant available, original failed questions stay excluded even if fewer than 8 remain.
  const pool = alternatives.length ? alternatives : related;
  const recentIds =
    options.recentQuestionIds ??
    recentSubjectAttempts(studentId, bank.subject, options.recentAttempts).map(
      (attempt) => attempt.questionId,
    );
  const cooledOriginals = recentIds.length
    ? originalQuestionIds.filter((id) =>
        recentIds.slice(0, adaptiveConfig.avoidRecentQuestions).includes(id),
      )
    : originalQuestionIds;
  const difficultyTargetsBySkill = Object.fromEntries(
    [...difficulties].map(([skill, values]) => [
      skill,
      values.reduce((sum, value) => sum + value, 0) / values.length,
    ]),
  );
  const questions = selectQuestions({
    ...options,
    questionBank: { ...bank, questions: pool },
    desiredQuestionCount: options.desiredQuestionCount ?? adaptiveConfig.errorTrainingQuestionCount,
    mode: 'error_training',
    preferredSkillIds: targetSkillIds,
    difficultyTargetsBySkill,
    sourceErrorCountsBySkill: Object.fromEntries(frequency),
    excludeQuestionIds: [
      ...(options.excludeQuestionIds ?? []),
      ...(alternatives.length ? originalQuestionIds : cooledOriginals),
    ],
  });
  return { questions, targetSkillIds, originalQuestionIds };
}
