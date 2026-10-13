import type { ReactNode } from 'react';
import type { StudentProfile } from '@shared/types';
import { Brand, BookArt, Arrow } from './LearningVisuals';
export function ProfilePicker({
  profiles,
  busy,
  error,
  onSelect,
  onManage,
  status,
}: {
  profiles: StudentProfile[];
  onManage?: () => void;
  status?: ReactNode;
  busy: boolean;
  error: string;
  onSelect: (p: StudentProfile) => void;
}) {
  const selectProfile = onSelect;
  return (
    <div className="welcome-page">
      <header className="welcome-header">
        <Brand />
        <span className="quiet-label">
          <span className="status-dot" /> Dein persönlicher Lernraum
        </span>
      </header>
      <main className="welcome-main">
        <div className="welcome-copy">
          <span className="eyebrow">NEUGIER IST EIN GUTER ANFANG</span>
          <h1>
            Ein guter Tag,
            <br />
            um Neues zu <em>lernen.</em>
          </h1>
          <p>
            Ein Schritt nach dem anderen. In deinem Tempo.
            <br />
            Mit Platz zum Ausprobieren und Weiterkommen.
          </p>
        </div>
        <div className="welcome-art">
          <BookArt />
        </div>
        <section className="profile-section" aria-labelledby="profile-heading">
          <div className="section-heading">
            <h2 id="profile-heading">Wer lernt heute?</h2>
            <span>Wähle deinen Lernraum</span>
          </div>
          {busy && <p role="status">Dein Lernraum wird vorbereitet …</p>}
          {error && (
            <div role="alert" className="error-box">
              {error}
              <button onClick={() => window.location.reload()}>Erneut laden</button>
            </div>
          )}
          <div className="profile-grid">
            {profiles.map((p, i) => (
              <button
                className={`profile-card tone-${i % 3}`}
                key={p.id}
                onClick={() => void selectProfile(p)}
                disabled={busy}
              >
                <span className="profile-avatar">
                  {p.name.slice(0, 1)}
                  <span className="avatar-star" aria-hidden="true">
                    ✦
                  </span>
                </span>
                <span className="profile-name">{p.name}</span>
                <span className="profile-caption">{p.grade} · Dein eigener Lernraum</span>
                <span className="profile-arrow">
                  <Arrow />
                </span>
              </button>
            ))}
          </div>
          {onManage && (
            <button
              className="button secondary profile-manage-button"
              onClick={onManage}
              disabled={busy}
            >
              + Schüler · Profile verwalten
            </button>
          )}
        </section>
        {status}
      </main>
      <footer className="welcome-footer">
        <span>MIT KLEINEN SCHRITTEN WÄCHST DEIN WISSEN.</span>
        <span>Deine Daten bleiben auf diesem Gerät</span>
      </footer>
    </div>
  );
}
