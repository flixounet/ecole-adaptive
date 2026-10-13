import type { AttemptOutcome, Difficulty } from './types';

export interface AdaptiveConfig {
  defaultMastery: number;
  masteryDeltas: Record<AttemptOutcome, number>;
  positiveDifficultyModifiers: Record<Difficulty, number>;
  recentAttemptWindow: number;
  avoidRecentQuestions: number;
  weaknessWeight: number;
  recentErrorBonus: number;
  recentErrorBonusCap: number;
  preferredDifficultyWeight: number;
  otherDifficultyDistancePenalty: number;
  preferredSkillWeight: number;
  difficultySimilarityPenalty: number;
  errorTrainingQuestionCount: number;
  difficultyThresholds: { low: number; medium: number; high: number };
  statusThresholds: { practice: number; secure: number; verySecure: number };
  recommendationThresholds: { high: number; medium: number };
  trainingProgressionDifficultyStep: number;
  recurrenceMinIntervening: number;
  recurrencePreferredStart: number;
  recurrencePreferredEnd: number;
}

export const adaptiveConfig: Readonly<AdaptiveConfig> = {
  defaultMastery: 0.5,
  masteryDeltas: {
    CORRECT_FIRST_TRY: 0.06,
    CORRECT_AFTER_HINT: 0.03,
    CORRECT_AFTER_MULTIPLE_HINTS: 0.015,
    INCORRECT: -0.08,
    SKIPPED: -0.03,
  },
  positiveDifficultyModifiers: { 1: 0.8, 2: 1, 3: 1.2, 4: 1.35 },
  recentAttemptWindow: 10,
  avoidRecentQuestions: 5,
  weaknessWeight: 2,
  recentErrorBonus: 0.75,
  recentErrorBonusCap: 2.25,
  preferredDifficultyWeight: 1.5,
  otherDifficultyDistancePenalty: 1,
  preferredSkillWeight: 1.5,
  difficultySimilarityPenalty: 1,
  errorTrainingQuestionCount: 8,
  difficultyThresholds: { low: 0.4, medium: 0.65, high: 0.85 },
  statusThresholds: { practice: 0.5, secure: 0.75, verySecure: 0.9 },
  recommendationThresholds: { high: 0.5, medium: 0.7 },
  trainingProgressionDifficultyStep: 1,
  recurrenceMinIntervening: 2,
  recurrencePreferredStart: 4,
  recurrencePreferredEnd: 7,
};
