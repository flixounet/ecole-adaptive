import { useEffect, useRef } from 'react';
import {
  moveTo,
  remainingSeconds,
  setAnswer,
  submitLearningAnswer,
  type Session,
} from '../domain/session';
import { Arrow } from './LearningVisuals';
import { Solution } from './Solution';
import { adaptiveConfig } from '../domain/adaptive/config';

export function SessionView({
  session,
  now,
  busy,
  saving,
  saveFailed,
  onChange,
  onFinish,
  onPause,
}: {
  session: Session;
  now: number;
  busy: boolean;
  saving: boolean;
  saveFailed: boolean;
  onChange: (s: Session) => void;
  onFinish: () => void;
  onPause: () => void;
}) {
  const id = session.questionIds[session.currentIndex];
  const question = session.bankSnapshot.questions.find((q) => q.id === id)!;
  const answer = session.answers[id];
  const learn = session.mode !== 'exam';
  const done = session.questionIds.filter((key) =>
    learn ? session.answers[key].resolved : session.answers[key].value.trim(),
  ).length;
  const seconds = remainingSeconds(session.deadlineAt, now);
  const disabled = busy || answer.resolved || (seconds !== null && seconds <= 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, [id]);
  function check() {
    if (learn && !disabled && !saving) onChange(submitLearningAnswer(session, id));
  }
  const feedback = learn && answer.attempts > 0;
  return (
    <div className="session-page">
      <div className="session-heading">
        <button className="text-button" onClick={onPause} disabled={busy || saving}>
          <Arrow back /> Zur Übersicht
        </button>
        <span className={`mode-badge ${learn ? '' : 'exam'}`}>
          {session.mode === 'error_training'
            ? 'Fehlertraining · neue Aufgaben für deine Themen'
            : learn
              ? 'Lernmodus · ohne Zeitdruck'
              : 'Klassenarbeitsmodus'}
        </span>
      </div>
      {session.mode === 'error_training' &&
        session.questionIds.length < adaptiveConfig.errorTrainingQuestionCount && (
          <p className="learning-note">
            Für diese Runde sind {session.questionIds.length} passende Aufgaben verfügbar. Mit
            weiteren Varianten im Aufgabenpaket kann das Training länger werden.
          </p>
        )}
      <div className="session-progress">
        <div>
          <strong>
            Aufgabe {session.currentIndex + 1} <span>/ {session.questionIds.length}</span>
          </strong>
          <span className="save-status" role="status">
            {saving
              ? 'Wird gespeichert …'
              : saveFailed
                ? 'Noch nicht gespeichert'
                : 'Lokal gespeichert'}
          </span>
        </div>
        {seconds !== null && (
          <span
            className={`timer ${seconds < 180 ? 'urgent' : ''}`}
            aria-label={`Restzeit ${Math.floor(seconds / 60)} Minuten ${seconds % 60} Sekunden`}
          >
            ◷{' '}
            {Math.floor(seconds / 60)
              .toString()
              .padStart(2, '0')}
            :{(seconds % 60).toString().padStart(2, '0')}
          </span>
        )}
      </div>
      <progress
        className="progress"
        max={session.questionIds.length}
        value={done}
        aria-label="Bearbeitete Aufgaben"
      />
      <article className="question-card">
        <div className="question-meta">
          <span>
            {question.skillIds
              .map((skill) => session.bankSnapshot.skills.find((s) => s.id === skill)?.name)
              .join(' · ')}
          </span>
          <span>
            {question.points} {question.points === 1 ? 'Punkt' : 'Punkte'}
          </span>
        </div>
        <h1 ref={titleRef} tabIndex={-1}>
          {question.question}
        </h1>
        <p className="instruction">{question.instruction}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          {question.questionType === 'multiple_choice' ? (
            <fieldset className="choice-list" disabled={disabled}>
              <legend>Wähle eine Antwort</legend>
              {question.choices?.map((choice, i) => (
                <label
                  className={`choice ${answer.value === choice.id ? 'chosen' : ''}`}
                  key={choice.id}
                >
                  <input
                    type="radio"
                    name={id}
                    value={choice.id}
                    checked={answer.value === choice.id}
                    onChange={() => onChange(setAnswer(session, id, choice.id))}
                  />
                  <span className="choice-letter">{String.fromCharCode(65 + i)}</span>
                  <span>{choice.text}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <div className="answer-field">
              <label htmlFor="answer">Deine Antwort</label>
              <input
                ref={inputRef}
                id="answer"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                inputMode={
                  question.questionType === 'numeric' || question.questionType === 'decimal'
                    ? 'decimal'
                    : 'text'
                }
                maxLength={512}
                value={answer.value}
                disabled={disabled}
                onChange={(e) => onChange(setAnswer(session, id, e.target.value))}
                placeholder={
                  question.questionType === 'numeric' || question.questionType === 'decimal'
                    ? 'Ergebnis eingeben'
                    : 'Antwort eingeben'
                }
                aria-describedby="answer-help"
              />
              <span id="answer-help">
                {question.questionType === 'decimal'
                  ? 'Dezimalzahlen mit Komma oder Punkt sind möglich.'
                  : question.questionType === 'expression'
                    ? 'Für Mal kannst du ×, · oder * schreiben.'
                    : 'Nimm dir Zeit und lies die Aufgabe genau.'}
              </span>
            </div>
          )}
          {learn && !answer.resolved && (
            <button
              className="button primary check-button"
              type="submit"
              disabled={disabled || saving || !answer.value.trim()}
            >
              Antwort prüfen <Arrow />
            </button>
          )}
        </form>
        {feedback && (
          <section
            className={`feedback ${answer.correct ? 'success' : 'try-again'}`}
            aria-live="polite"
          >
            <h2>
              {answer.correct
                ? 'Gut gemacht. Das stimmt!'
                : answer.resolved
                  ? 'Schauen wir uns den Lösungsweg an.'
                  : answer.attempts === 1
                    ? 'Noch nicht ganz. Hier ist ein Hinweis.'
                    : 'Du hast noch einen Versuch.'}
            </h2>
            {!answer.resolved && (
              <p>{answer.attempts === 1 ? question.hint : question.secondHint}</p>
            )}
            {answer.resolved && <Solution question={question} showMistake={!answer.correct} />}
          </section>
        )}
      </article>
      <nav className="question-navigation" aria-label="Aufgabennavigation">
        <button
          className="button secondary"
          disabled={busy || saving || session.currentIndex === 0}
          onClick={() => onChange(moveTo(session, session.currentIndex - 1))}
        >
          <Arrow back /> Zurück
        </button>
        <span>
          {done} von {session.questionIds.length} bearbeitet
        </span>
        {session.currentIndex < session.questionIds.length - 1 ? (
          <button
            className="button primary"
            disabled={busy || saving}
            onClick={() => onChange(moveTo(session, session.currentIndex + 1))}
          >
            {(learn ? answer.resolved : answer.value.trim()) ? 'Weiter' : 'Überspringen'} <Arrow />
          </button>
        ) : (
          <button className="button primary" onClick={onFinish} disabled={busy || saving}>
            Zur Abgabe <Arrow />
          </button>
        )}
      </nav>
      <div className="question-overview" aria-label="Direkt zu Aufgabe">
        {session.questionIds.map((qId, index) => (
          <button
            key={qId}
            className={`${index === session.currentIndex ? 'current' : ''} ${(learn ? session.answers[qId].resolved : session.answers[qId].value.trim()) ? 'answered' : ''}`}
            aria-label={`Aufgabe ${index + 1}${(learn ? session.answers[qId].resolved : session.answers[qId].value.trim()) ? ', bearbeitet' : ', offen'}`}
            aria-current={index === session.currentIndex ? 'step' : undefined}
            disabled={busy || saving}
            onClick={() => onChange(moveTo(session, index))}
          >
            {index + 1}
          </button>
        ))}
      </div>
      <div className="finish-row">
        <p>
          {learn
            ? 'Du darfst Fehler machen. Dafür ist der Lernmodus da.'
            : 'Keine Hinweise während der Arbeit. Deine Zeit läuft auch nach dem Verlassen weiter.'}
        </p>
        <button className="text-button" onClick={onFinish} disabled={busy || saving}>
          {learn ? 'Lernrunde beenden' : 'Arbeit abgeben'}
        </button>
      </div>
    </div>
  );
}
