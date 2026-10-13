import type { Question } from '@shared/types';

export const number = (value: number) =>
  value.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const readableAnswer = (question: Question, value: string) =>
  question.choices?.find((choice) => choice.id === value)?.text ?? value;

export const modeLabel = (mode: string) =>
  mode === 'exam' ? 'Klassenarbeit' : mode === 'error_training' ? 'Fehlertraining' : 'Lernmodus';
export const subjectLabel = (subject: string) =>
  ({
    maths: 'Mathematik',
    english: 'Englisch',
    french: 'Französisch',
    svt: 'SVT',
    history_geography: 'Geschichte-Geographie',
  })[subject] ?? subject;
