import type { Question } from '@shared/types';
import { readableAnswer } from './format';

export function Solution({ question, showMistake }: { question: Question; showMistake: boolean }) {
  return (
    <div className="solution">
      <p>
        <strong>Richtige Antwort: {readableAnswer(question, question.correctAnswer)}</strong>
      </p>
      <ol>
        {question.explanationSteps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {question.memoryRule && (
        <p className="memory-rule">
          <strong>Zum Merken</strong>
          <br />
          {question.memoryRule}
        </p>
      )}
      {showMistake && (
        <p>
          <strong>Typische Fehlerquelle:</strong> {question.commonMistake}
        </p>
      )}
    </div>
  );
}
