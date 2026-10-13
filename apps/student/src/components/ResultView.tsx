import type { StudentProfile } from '@shared/types';
import { canonicalFixtureSkillId } from '@shared/fixture-migrations';
import { getResultRecommendations } from '../domain/adaptive/recommendations';
import type { Result } from '../domain/session';
import { Arrow } from './LearningVisuals';
import { Solution } from './Solution';
import { ShareResult } from './ShareResult';
import { number, readableAnswer, modeLabel } from './format';

export function ResultView({
  result,
  profile,
  onBack,
  onTrainErrors,
  busy,
  hasActiveSession,
}: {
  result: Result;
  profile: StudentProfile;
  onBack: () => void;
  onTrainErrors: () => void;
  busy: boolean;
  hasActiveSession: boolean;
}) {
  const skillStats = result.bankSnapshot.skills
    .map((skill) => {
      const id = canonicalFixtureSkillId(result.testId, skill.id);
      const performance = result.skillPerformance?.[id];
      return {
        id,
        name: skill.name,
        earned: performance?.earned ?? 0,
        max: performance?.possible ?? 0,
      };
    })
    .filter((skill) => skill.max > 0);
  const recommendations = getResultRecommendations(result);
  const weak = recommendations.filter(
    (item) => item.priority === 'high' || item.priority === 'medium',
  );
  const changes = skillStats.filter(
    (skill) =>
      result.masteryBefore?.[skill.id] !== undefined &&
      result.masteryAfter?.[skill.id] !== undefined,
  );
  return (
    <div className="result-page">
      <button className="text-button" onClick={onBack}>
        <Arrow back /> Zur Übersicht
      </button>
      <section className="result-hero">
        <span className="eyebrow">
          {result.mode === 'exam'
            ? 'DEINE KLASSENARBEIT'
            : result.mode === 'error_training'
              ? 'DEIN FEHLERTRAINING'
              : 'DEINE LERNRUNDE'}{' '}
          · ABGESCHLOSSEN
        </span>
        <h1>Ein Schritt weiter, {profile.name}.</h1>
        <p>{result.bankSnapshot.title}</p>
        <div className="score-grid">
          <div className="score-main">
            <strong>{number(result.score20)}</strong>
            <span>/ 20</span>
          </div>
          <div>
            <strong>
              {result.earnedPoints} / {result.maxPoints}
            </strong>
            <span>Punkte</span>
          </div>
          <div>
            <strong>{number(result.percentage)} %</strong>
            <span>der Punkte</span>
          </div>
        </div>
        <p className="result-date">
          {new Date(result.date).toLocaleDateString('de-DE')} · {Math.floor(result.duration / 60)}{' '}
          Min. {result.duration % 60} Sek. · {modeLabel(result.mode)}
        </p>
      </section>
      <ShareResult result={result} profile={profile} />
      {result.mode === 'error_training' && (
        <section className="training-summary">
          <span className="eyebrow">DRANGEBLIEBEN</span>
          <h2>Deine Fehler wurden erneut getestet.</h2>
          <p>
            Mit anderen Aufgaben hast du die gleichen Themen geübt. Hier siehst du, wie sich dein
            Lernstand in dieser Runde verändert hat.
          </p>
        </section>
      )}
      <section className="result-mastery">
        <div className="section-heading">
          <h2>Dein Lernstand nach der Runde</h2>
          <span>Vorher → nachher</span>
        </div>
        {changes.length ? (
          <div className="mastery-deltas">
            {changes.map((skill) => {
              const before = result.masteryBefore[skill.id],
                after = result.masteryAfter[skill.id];
              const delta = (after - before) * 100;
              return (
                <div className="mastery-delta" key={skill.id}>
                  <strong>{skill.name}</strong>
                  <span>
                    {number(before * 100)} % → {number(after * 100)} %
                  </span>
                  <small className={delta > 0 ? 'delta-up' : ''}>
                    {delta > 0 ? '+' : ''}
                    {number(delta)} Prozentpunkte
                  </small>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="learning-note">
            Für dieses frühere Ergebnis wurde noch kein Kompetenzverlauf gespeichert. Deine damalige
            Punktzahl bleibt erhalten.
          </p>
        )}
      </section>
      {result.mistakes.length > 0 && (
        <section className="training-callout">
          <div>
            <h2>Aus Fehlern wird der nächste Schritt.</h2>
            <p>Übe mit neuen Aufgaben zu den Themen, die noch schwer waren.</p>
            {hasActiveSession && <p>Schließe zuerst deine offene Runde ab.</p>}
          </div>
          <button
            className="button primary"
            disabled={busy || hasActiveSession}
            onClick={onTrainErrors}
          >
            Meine Fehler trainieren <Arrow />
          </button>
        </section>
      )}
      <section className="result-topics">
        <div className="section-heading">
          <h2>Deine Themen im Blick</h2>
          <span>Hier kannst du weiterlernen</span>
        </div>
        <div className="topic-grid">
          {skillStats.map((skill) => (
            <div className="topic-card" key={skill.id}>
              <span
                className={`topic-status ${skill.earned / skill.max >= 0.75 ? 'good' : 'practice'}`}
              />
              <strong>{skill.name}</strong>
              <span>
                {skill.earned} / {skill.max} Punkte
              </span>
              <progress max={skill.max} value={skill.earned} aria-label={skill.name} />
            </div>
          ))}
        </div>
        <p className="small-note">
          Aufgaben können zu mehreren Themen gehören. Die Themenpunkte werden deshalb nicht addiert.
        </p>
        <div className="recommendation">
          <strong>
            {weak.length ? 'Das lohnt sich noch zu üben' : 'Das hast du gut verstanden'}
          </strong>
          <p>
            {weak.length
              ? weak.map((item) => `${item.name}: ${item.reason}`).join(' · ')
              : 'Festige deine Themen in einer neuen Lernrunde.'}
          </p>
        </div>
      </section>
      <section className="corrections">
        <div className="section-heading">
          <h2>Deine Korrektur</h2>
          <span>Jede Aufgabe verstehen</span>
        </div>
        {result.answers.map((answer, i) => {
          const q = result.bankSnapshot.questions.find((item) => item.id === answer.questionId)!;
          return (
            <details className="correction" key={q.id}>
              <summary>
                <span
                  className={`correction-status ${answer.correct ? 'correct' : ''}`}
                  aria-label={answer.correct ? 'Richtig' : 'Noch üben'}
                >
                  {answer.correct ? '✓' : '↗'}
                </span>
                <span>
                  <small>Aufgabe {i + 1}</small>
                  <strong>{q.question}</strong>
                </span>
                <span className="correction-score">
                  {answer.earnedPoints} / {answer.maxPoints}
                </span>
              </summary>
              <div className="correction-content">
                <p>
                  Deine Antwort:{' '}
                  <strong>{readableAnswer(q, answer.value) || 'Keine Antwort'}</strong>
                  {result.mode !== 'exam' &&
                    answer.attempts === 0 &&
                    answer.value &&
                    ' (nicht geprüft)'}
                </p>
                <Solution question={q} showMistake={!answer.correct} />
              </div>
            </details>
          );
        })}
      </section>
      <button className="button primary" onClick={onBack}>
        Zurück zur Übersicht <Arrow />
      </button>
    </div>
  );
}
