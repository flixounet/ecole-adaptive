import { useState } from 'react';
import type { Result } from '../domain/session';
import { Arrow } from './LearningVisuals';
import { modeLabel, number, subjectLabel } from './format';

export function HistoryView({
  results,
  onResult,
}: {
  results: Result[];
  onResult: (result: Result) => void;
}) {
  const [subject, setSubject] = useState('all');
  const [mode, setMode] = useState('all');
  const subjects = [...new Set(results.map((r) => r.bankSnapshot.subject))];
  const filtered = results
    .filter(
      (r) =>
        (subject === 'all' || r.bankSnapshot.subject === subject) &&
        (mode === 'all' || r.mode === mode),
    )
    .sort((a, b) => b.date - a.date);
  return (
    <div className="history-page">
      <section className="greeting">
        <div>
          <span className="eyebrow">DEIN WEG BIS HIERHER</span>
          <h1>Meine Ergebnisse</h1>
          <p>Deine abgeschlossenen Runden und alle Lösungswege an einem Ort.</p>
        </div>
      </section>
      <div className="history-filters">
        <label htmlFor="history-subject">
          Fach
          <select id="history-subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="all">Alle Fächer</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {subjectLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="history-mode">
          Modus
          <select id="history-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="all">Alle Modi</option>
            <option value="learn">Lernmodus</option>
            <option value="exam">Klassenarbeit</option>
            <option value="error_training">Fehlertraining</option>
          </select>
        </label>
        <span>
          {filtered.length} {filtered.length === 1 ? 'Ergebnis' : 'Ergebnisse'}
        </span>
      </div>
      {!filtered.length ? (
        <div className="empty-state">
          <h2>
            {results.length ? 'Kein Ergebnis für diesen Filter.' : 'Deine erste Runde wartet.'}
          </h2>
          <p>
            {results.length
              ? 'Wähle ein anderes Fach oder einen anderen Modus.'
              : 'Wenn du eine Runde abschließt, findest du hier dein Ergebnis.'}
          </p>
        </div>
      ) : (
        <div className="history-list">
          {filtered.map((result) => (
            <button className="history-row" key={result.id} onClick={() => onResult(result)}>
              <span className="history-date">
                {new Date(result.date).toLocaleDateString('de-DE')}
                <small>
                  {new Date(result.date).toLocaleTimeString('de-DE', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </small>
              </span>
              <span className="history-title">
                <span className={`mode-badge ${result.mode === 'exam' ? 'exam' : ''}`}>
                  {modeLabel(result.mode)}
                </span>
                <strong>
                  {subjectLabel(result.bankSnapshot.subject)} · {result.bankSnapshot.chapter}
                </strong>
                <small>
                  {Math.floor(result.duration / 60)} Min. {result.duration % 60} Sek. ·{' '}
                  {result.earnedPoints} / {result.maxPoints} Punkte
                </small>
              </span>
              <span className="history-score">
                <strong>{number(result.score20)}</strong>
                <small>/ 20</small>
              </span>
              <Arrow />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
