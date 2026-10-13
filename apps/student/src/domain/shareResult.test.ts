import { describe, expect, it } from 'vitest';
import source from '@shared/fixtures/lutz-maths-demo.json';
import { parseQuestionBank } from '@shared/validation';
import { createSession, finishSession, setAnswer } from './session';
import { resultShareText } from './shareResult';
const profile = {
  id: 'lutz',
  name: 'Lutz',
  grade: '5eme',
  preferredLanguage: 'de',
  subjects: ['maths'],
};
function result() {
  const bank = parseQuestionBank({ ...structuredClone(source), questionCount: 2 });
  let session = createSession(bank, 'lutz', 'exam', 1000, () => 0);
  const q = bank.questions.find((item) => item.id === session.questionIds[0])!;
  session = setAnswer(session, q.id, q.correctAnswer, 1100);
  return finishSession(session, 2000);
}
describe('local share text', () => {
  it('formats the actual numeric score, skills and practice recommendations without a server', () => {
    const data = result();
    const text = resultShareText(data, profile);
    expect(text).toContain('Lutz – Mathematik');
    expect(text).toContain(
      `${data.score20.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / 20`,
    );
    expect(text).toContain('Zu üben:');
    expect(text).toContain('DEMO');
    expect(text).not.toContain('[object Object]');
    expect(text).not.toContain('undefined');
  });
  it('rejects sharing an outcome under another profile name', () => {
    expect(() => resultShareText(result(), { ...profile, id: 'max', name: 'Max' })).toThrow(
      'anderen Profil',
    );
  });
});
