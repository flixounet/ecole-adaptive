import type { QuestionBank, Skill } from '@shared/types';
import { canonicalFixtureSkillId } from '@shared/fixture-migrations';
import { adaptiveConfig } from './config';
import { recentSubjectAttempts, skillMastery } from './selection';
import type { LearningRecommendation, RecommendationOptions, SkillStatus } from './types';

export function skillStatus(mastery: number): SkillStatus {
  if (!Number.isFinite(mastery) || mastery < 0 || mastery > 1)
    throw new Error('Ungültiger Kompetenzwert.');
  const thresholds = adaptiveConfig.statusThresholds;
  if (mastery < thresholds.practice) return 'noch üben';
  if (mastery < thresholds.secure) return 'auf dem Weg';
  if (mastery <= thresholds.verySecure) return 'sicher';
  return 'sehr sicher';
}

function recommendation(
  skill: Skill,
  mastery: number,
  errors: number,
  historyLength: number,
  practiced: boolean,
  fromResult = false,
): LearningRecommendation {
  const status = skillStatus(mastery);
  let priority: LearningRecommendation['priority'] =
    mastery < adaptiveConfig.recommendationThresholds.high
      ? 'high'
      : mastery <= adaptiveConfig.recommendationThresholds.medium
        ? 'medium'
        : 'low';
  if (errors > 0) priority = priority === 'low' ? 'medium' : 'high';
  const reason = errors
    ? fromResult
      ? `${errors} ${errors === 1 ? 'Aufgabe' : 'Aufgaben'} in diesem Ergebnis noch nicht richtig gelöst.`
      : `${errors} Fehler ${historyLength === 1 ? "in der letzten Aufgabe" : `in den letzten ${historyLength} Aufgaben`}`
    : !practiced
      ? `Noch kein gemessener Kompetenzwert; Startwert ${Math.round(adaptiveConfig.defaultMastery * 100)} %.`
      : priority === 'high'
        ? 'Diese Grundlagen brauchen noch Übung.'
        : priority === 'medium'
          ? 'Weiter üben und die Regeln festigen.'
          : 'Mit gelegentlichen Aufgaben festigen.';
  return {
    skillId: skill.id,
    name: skill.name,
    priority,
    mastery,
    reason,
    status,
    recentErrors: errors,
  };
}

function sorted(recommendations: LearningRecommendation[]): LearningRecommendation[] {
  const order = { high: 0, medium: 1, low: 2 };
  return recommendations.sort(
    (a, b) =>
      order[a.priority] - order[b.priority] ||
      b.recentErrors - a.recentErrors ||
      a.mastery - b.mastery ||
      a.skillId.localeCompare(b.skillId),
  );
}

export function getLearningRecommendations(
  options: RecommendationOptions,
): LearningRecommendation[] {
  const { studentId, subject, skills, skillStates, recentAttempts } = options;
  if (!studentId || !subject || new Set(skills.map((skill) => skill.id)).size !== skills.length) {
    throw new Error('Ungültiger Auftrag für Lernempfehlungen.');
  }
  const history = recentSubjectAttempts(studentId, subject, recentAttempts);
  return sorted(
    skills.map((skill) => {
      const mastery = skillMastery(studentId, subject, skill.id, skillStates);
      const recentErrors = history.filter(
        (attempt) => !attempt.correct && !attempt.skipped && attempt.skillIds.includes(skill.id),
      ).length;
      const practiced = skillStates.some(
        (state) =>
          state.studentId === studentId &&
          state.subject === subject &&
          state.skillId === skill.id &&
          state.attempts > 0,
      );
      return recommendation(skill, mastery, recentErrors, history.length, practiced);
    }),
  );
}

export interface ResultRecommendationInput {
  studentId: string;
  bankSnapshot: QuestionBank;
  masteryAfter: Readonly<Record<string, number>>;
  answers: readonly { questionId: string; correct: boolean }[];
}

/** Historical recommendations use the result's captured mastery and answers, never today's state. */
export function getResultRecommendations(
  result: ResultRecommendationInput,
): LearningRecommendation[] {
  const { bankSnapshot: bank } = result;
  if (!result.studentId || !bank.studentIds.includes(result.studentId)) {
    throw new Error('Das Ergebnis gehört zu einem anderen Profil.');
  }
  const questions = new Map(bank.questions.map((question) => [question.id, question]));
  const errorCounts = new Map<string, number>();
  const practicedSkills = new Set<string>();
  for (const answer of result.answers) {
    const question = questions.get(answer.questionId);
    if (!question || typeof answer.correct !== 'boolean')
      throw new Error('Ungültige Ergebnisantwort.');
    for (const skillId of new Set(question.skillIds)) {
      const canonical = canonicalFixtureSkillId(bank.id, skillId);
      practicedSkills.add(canonical);
      if (!answer.correct) errorCounts.set(canonical, (errorCounts.get(canonical) ?? 0) + 1);
    }
  }
  return sorted(
    bank.skills
      .map((skill) => {
        const id = canonicalFixtureSkillId(bank.id, skill.id);
        const measured = result.masteryAfter[id] ?? result.masteryAfter[skill.id];
        const mastery = measured ?? adaptiveConfig.defaultMastery;
        return recommendation(
          { ...skill, id },
          mastery,
          errorCounts.get(id) ?? 0,
          result.answers.length,
          measured !== undefined && practicedSkills.has(id),
          true,
        );
      })
      .filter((item) => practicedSkills.has(item.skillId)),
  );
}
