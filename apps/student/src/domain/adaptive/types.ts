import type { Question, QuestionBank, Skill } from '@shared/types';

export type Difficulty = 1 | 2 | 3 | 4;
export type AdaptiveMode = 'learn' | 'exam' | 'error_training';
export type AttemptOutcome =
  | 'CORRECT_FIRST_TRY'
  | 'CORRECT_AFTER_HINT'
  | 'CORRECT_AFTER_MULTIPLE_HINTS'
  | 'INCORRECT'
  | 'SKIPPED';
export type RandomProvider = () => number;

/** Compound identity is studentId + subject + skillId, never skillId alone. */
export interface StudentSkillState {
  studentId: string;
  subject: string;
  skillId: string;
  mastery: number;
  attempts: number;
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
  hintedCorrectCount: number;
  currentStreak: number;
  bestStreak: number;
  lastPracticedAt: number | null;
  lastIncorrectAt: number | null;
  recentErrorCount: number;
  recentOutcomes: AttemptOutcome[];
  lastAttemptId: string | null;
  lastDifficulty: Difficulty | null;
}

export interface AttemptInput {
  id: string;
  sessionId: string;
  studentId: string;
  subject: string;
  questionId: string;
  testId?: string;
  mode: AdaptiveMode;
  timestamp: number;
  answer: string;
  correct: boolean;
  attemptNumber: number;
  hintsUsed: number;
  skipped: boolean;
  difficulty: Difficulty;
  skillIds: string[];
  /** null means timing was unavailable, for example in a migrated session. */
  responseTimeMs: number | null;
}

export interface AttemptRecord extends AttemptInput {
  outcome: AttemptOutcome;
  masteryBefore: Record<string, number>;
  masteryAfter: Record<string, number>;
}

export interface SelectionOptions {
  studentId: string;
  questionBank: QuestionBank;
  skillStates: readonly StudentSkillState[];
  recentAttempts: readonly AttemptRecord[];
  desiredQuestionCount: number;
  mode: AdaptiveMode;
  random?: RandomProvider;
  /** Actual presentation history, newest first; includes unfinalized questions. */
  recentQuestionIds?: readonly string[];
  excludeQuestionIds?: readonly string[];
  preferredSkillIds?: readonly string[];
  difficultyTargetsBySkill?: Readonly<Record<string, number>>;
  sourceErrorCountsBySkill?: Readonly<Record<string, number>>;
}

export interface RecommendationOptions {
  studentId: string;
  subject: string;
  skills: readonly Skill[];
  skillStates: readonly StudentSkillState[];
  recentAttempts: readonly AttemptRecord[];
}

export type SkillStatus = 'noch üben' | 'auf dem Weg' | 'sicher' | 'sehr sicher';
export interface LearningRecommendation {
  skillId: string;
  name: string;
  priority: 'high' | 'medium' | 'low';
  mastery: number;
  reason: string;
  status: SkillStatus;
  recentErrors: number;
}

export interface ErrorTrainingOptions extends Omit<
  SelectionOptions,
  'desiredQuestionCount' | 'mode'
> {
  desiredQuestionCount?: number;
  sourceResult: {
    studentId?: string;
    bankSnapshot: QuestionBank;
    answers: readonly { questionId: string; correct: boolean }[];
  };
}

export interface ErrorTrainingPlan {
  questions: Question[];
  targetSkillIds: string[];
  originalQuestionIds: string[];
}

export interface RecurrenceOptions {
  questionIds: readonly string[];
  questionBank: QuestionBank;
  failedQuestionId: string;
  failedIndex: number;
  /** All visited or edited IDs, not just resolved answers: these may not be moved. */
  completedQuestionIds: readonly string[];
  skillStates: readonly StudentSkillState[];
  recentAttempts: readonly AttemptRecord[];
  studentId: string;
  recentQuestionIds?: readonly string[];
  random?: RandomProvider;
  excludeQuestionIds?: readonly string[];
  /** Original error-training focus; multi-skill transfers may not expand this set. */
  allowedSkillIds?: readonly string[];
}

export interface ProgressionOptions extends Omit<
  RecurrenceOptions,
  'failedQuestionId' | 'failedIndex'
> {
  questionId: string;
  currentIndex: number;
}
