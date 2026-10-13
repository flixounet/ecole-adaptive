/** Versioned content contracts, independent of React and persistence. */
export type QuestionType = 'numeric' | 'decimal' | 'short_text' | 'expression' | 'multiple_choice';

export interface Question {
  id: string;
  subject: string;
  chapter: string;
  skillIds: string[];
  difficulty: 1 | 2 | 3 | 4;
  points: number;
  questionType: QuestionType;
  question: string;
  instruction: string;
  acceptedAnswers: string[];
  correctAnswer: string;
  explanationSteps: string[];
  hint: string;
  secondHint: string;
  memoryRule: string;
  commonMistake: string;
  sourceRefs: string[];
  estimatedSeconds: number;
  /** Multiple choice answers use the choice ID, never the display text. */
  choices?: { id: string; text: string }[];
}

export interface Skill {
  id: string;
  name: string;
  /** Optional only to preserve version-1 package snapshots. New banks should provide it. */
  subject?: string;
  chapter?: string;
  description?: string;
}
export type SkillDefinition = Skill;
export interface SourceReference {
  id: string;
  label: string;
  kind: 'fixture' | 'image' | 'pdf';
}
export interface QuestionBank {
  schemaVersion: '1.0';
  id: string;
  version: number;
  title: string;
  subject: string;
  chapter: string;
  grade: string;
  language: string;
  studentIds: string[];
  isDemo: boolean;
  sourceNotice: string;
  skills: Skill[];
  sourceRefs: SourceReference[];
  durationMinutes: number;
  /** Number drawn for an exam, not the size of the question pool. */
  questionCount: number;
  questions: Question[];
}
export interface StudentProfile {
  /** Optional only for imported legacy profiles; repositories return managed values. */
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
  id: string;
  name: string;
  grade: string;
  preferredLanguage: string;
  subjects: string[];
}
