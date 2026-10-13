import type { Question, QuestionType } from '@shared/types';

const minusSigns = /[−–—﹣－]/g;
const superscripts: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁺': '+',
  '⁻': '-',
};

/** Decimal comparison is string based: no rounding, evaluation or hidden tolerance. */
function normalizeDecimal(value: string): string | null {
  const cleaned = value.normalize('NFKC').trim().replace(minusSigns, '-').replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/^[+-]/, '');
  const [whole = '', fractional = ''] = unsigned.split('.');
  const integer = whole.replace(/^0+/, '') || '0';
  const fraction = fractional.replace(/0+$/, '');
  const zero = integer === '0' && fraction === '';
  return `${negative && !zero ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

export function normalizeAnswer(value: string, type: QuestionType): string {
  if (type === 'numeric' || type === 'decimal') {
    return normalizeDecimal(value) ?? value.trim().replace(minusSigns, '-');
  }
  if (type === 'expression') {
    const normalized = value
      .replace(
        /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g,
        (exponent) => `^${Array.from(exponent, (digit) => superscripts[digit]).join('')}`,
      )
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(minusSigns, '-')
      .replace(/[×·⋅∗]/g, '*')
      .replace(/÷/g, '/')
      .replace(/\*\*/g, '^')
      .replace(/,/g, '.');
    // Whitespace between digits is never interpreted as concatenation ("1 2" ≠ "12").
    if (/\d\s+\d/.test(normalized)) return normalized.replace(/\s+/g, ' ');
    return normalized.replace(/\s+/g, '');
  }
  if (type === 'multiple_choice') return value.trim();
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isCorrectAnswer(question: Question, value: string): boolean {
  if (!value.trim()) return false;
  if (
    (question.questionType === 'numeric' || question.questionType === 'decimal') &&
    normalizeDecimal(value) === null
  )
    return false;
  if (question.questionType === 'expression' && /\d\s+\d/.test(value)) return false;
  if (
    question.questionType === 'multiple_choice' &&
    !question.choices?.some((choice) => choice.id === value.trim())
  )
    return false;
  const answer = normalizeAnswer(value, question.questionType);
  return question.acceptedAnswers.some(
    (accepted) => normalizeAnswer(accepted, question.questionType) === answer,
  );
}
