import { useState } from 'react';
import type { StudentProfile } from '@shared/types';
import type { Result } from '../domain/session';
import { resultShareText } from '../domain/shareResult';

export function ShareResult({ result, profile }: { result: Result; profile: StudentProfile }) {
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState('');
  const text = resultShareText(result, profile);
  async function share() {
    setMessage('');
    if (navigator.share) {
      try {
        await navigator.share({ title: 'École Adaptive – Ergebnis', text });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    setExpanded(true);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Ergebnis kopiert.');
    } catch {
      setMessage('Markiere den Text und wähle „Kopieren“.');
    }
  }
  return (
    <section className="share-panel" aria-label="Ergebnis teilen">
      <div>
        <h2>Deinen Fortschritt teilen</h2>
        <p>Teile dein Ergebnis als Text mit deinen Eltern. Das funktioniert auch offline.</p>
      </div>
      <button className="button secondary" onClick={() => void share()}>
        Ergebnis teilen
      </button>
      {expanded && (
        <div className="share-text">
          <label htmlFor="result-share">Dein Ergebnis als Text</label>
          <textarea
            id="result-share"
            readOnly
            value={text}
            rows={10}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button className="button secondary" onClick={() => void copy()}>
            Text kopieren
          </button>
        </div>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
