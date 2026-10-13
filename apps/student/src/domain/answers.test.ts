import { describe, expect, it } from 'vitest';
import type { Question } from '@shared/types';
import demo from '@shared/fixtures/lutz-maths-demo.json';
import { isCorrectAnswer, normalizeAnswer } from './answers';

function question(
  type: Question['questionType'],
  acceptedAnswers: string[],
  choices?: Question['choices'],
): Question {
  return {
    ...demo.questions[0],
    difficulty: 1,
    questionType: type,
    acceptedAnswers,
    choices,
  } as Question;
}

describe('answer normalization', () => {
  it.each(['12,5', '12.50', '+0012,500', ' 12.5 '])(
    'accepts an explicit decimal variant: %s',
    (answer) => {
      expect(isCorrectAnswer(question('decimal', ['12.5']), answer)).toBe(true);
    },
  );

  it('normalizes signed zero and leading decimals without floating-point rounding', () => {
    expect(normalizeAnswer('-000,000', 'decimal')).toBe('0');
    expect(normalizeAnswer('−,50', 'decimal')).toBe('-0.5');
    expect(isCorrectAnswer(question('numeric', ['9007199254740993']), '9007199254740992')).toBe(
      false,
    );
  });

  it.each(['1 2', '1\t2', '1,2.0', '1e1', 'Infinity', 'NaN', '2+10', ''])(
    'rejects malformed numeric input: %s',
    (answer) => {
      expect(isCorrectAnswer(question('numeric', ['12']), answer)).toBe(false);
    },
  );

  it('normalizes only documented expression typography', () => {
    const expression = question('expression', ['2*x^2-3*x']);
    expect(isCorrectAnswer(expression, ' 2 × x² − 3 · x ')).toBe(true);
    expect(isCorrectAnswer(expression, '2*x**2-3*x')).toBe(true);
    expect(isCorrectAnswer(question('expression', ['x^10']), 'x¹⁰')).toBe(true);
    expect(isCorrectAnswer(question('expression', ['x1']), 'x¹')).toBe(false);
    expect(isCorrectAnswer(expression, 'x*(2*x-3)')).toBe(false);
    expect(isCorrectAnswer(question('expression', ['12*x']), '1 2*x')).toBe(false);
  });

  it('does not execute expression input', () => {
    expect(isCorrectAnswer(question('expression', ['12']), 'globalThis.alert(12)')).toBe(false);
    expect(isCorrectAnswer(question('expression', ['12']), '6+6')).toBe(false);
  });

  it('uses multiple-choice IDs and normalizes short-text spacing', () => {
    const choice = question(
      'multiple_choice',
      ['b'],
      [
        { id: 'a', text: '10' },
        { id: 'b', text: '12' },
      ],
    );
    expect(isCorrectAnswer(choice, 'b')).toBe(true);
    expect(isCorrectAnswer(choice, '12')).toBe(false);
    expect(
      isCorrectAnswer(question('short_text', ['zuerst die Klammer']), ' Zuerst  die KLAMMER '),
    ).toBe(true);
  });
});
