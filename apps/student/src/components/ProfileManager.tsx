import { useEffect, useState } from 'react';
import type { StudentProfile } from '@shared/types';
import { defaultSubjects } from '@shared/profiles';
import {
  archiveProfile,
  createProfile,
  listProfiles,
  saveProfile,
  hasAnyActiveSession,
} from '../storage/repositories';
import { Brand } from './LearningVisuals';

const defaults = { name: '', grade: '', preferredLanguage: 'de', subjects: [...defaultSubjects] };
export function ProfileManager({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [profiles, setProfiles] = useState<StudentProfile[]>([]);
  const [editing, setEditing] = useState<StudentProfile | null>(null);
  const [draft, setDraft] = useState(defaults);
  const [subjectText, setSubjectText] = useState(defaults.subjects.join(', '));
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function reload() {
    setProfiles(await listProfiles(true));
  }
  useEffect(() => {
    void listProfiles(true)
      .then(setProfiles)
      .catch(() => setError('Die Profile konnten nicht geladen werden.'));
  }, []);
  function edit(profile: StudentProfile | null) {
    setEditing(profile);
    setDraft(profile ?? defaults);
    setSubjectText((profile?.subjects ?? defaults.subjects).join(', '));
    setFormOpen(true);
    setError('');
  }
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (await hasAnyActiveSession())
        throw new Error(
          'Schließe zunächst die offenen Lernrunden und Klassenarbeiten ab, bevor du Profile änderst.',
        );
      await action();
      await reload();
      await onChanged();
      setFormOpen(false);
      setMessage('Profil gespeichert. Vorhandene Lerndaten bleiben erhalten.');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Speichern fehlgeschlagen. Bitte erneut versuchen.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="manage-page">
      <Brand />
      <div className="manage-header">
        <h1>Schüler verwalten</h1>
        <button className="button secondary" disabled={busy} onClick={onClose}>
          Zurück
        </button>
      </div>
      <p className="local-notice">
        Jedes Profil hat seinen eigenen Lernstand. Profile und Ergebnisse bleiben auf diesem Gerät.
        Für Unterrichtspakete muss dieselbe Profil-ID auch im Teacher Studio verwendet werden.
      </p>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <p role="status">{message}</p>
      <div className="profile-list">
        {profiles.map((p) => (
          <article className="profile-row" key={p.id}>
            <div>
              <strong>
                {p.name}
                {p.archived ? ' · Archiviert' : ''}
              </strong>
              <p>
                {p.grade} · Profil-ID: {p.id}
              </p>
            </div>
            <button className="button secondary" disabled={busy} onClick={() => edit(p)}>
              Bearbeiten<span className="sr-only">: {p.name}</span>
            </button>
            <button
              className="text-button danger-outline"
              disabled={busy}
              onClick={() => {
                if (
                  p.archived ||
                  window.confirm(
                    `${p.name} archivieren? Alle Lerndaten bleiben erhalten. Das Profil kann jederzeit wieder aktiviert werden.`,
                  )
                )
                  void mutate(() => archiveProfile(p.id, !p.archived));
              }}
            >
              {p.archived ? 'Wieder aktivieren' : 'Archivieren'}
              <span className="sr-only">: {p.name}</span>
            </button>
          </article>
        ))}
      </div>
      <button
        className="button primary profile-manage-button"
        disabled={busy}
        onClick={() => edit(null)}
      >
        + Schüler hinzufügen
      </button>
      {formOpen && (
        <form
          className="profile-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(() => {
              const values = {
                ...draft,
                name: draft.name.trim(),
                grade: draft.grade.trim(),
                subjects: [
                  ...new Set(
                    subjectText
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  ),
                ],
              };
              return editing ? saveProfile({ ...editing, ...values }) : createProfile(values);
            });
          }}
        >
          <h2>{editing ? `${editing.name} bearbeiten` : 'Neues Schülerprofil'}</h2>
          <div className="form-grid">
            <label>
              Name
              <input
                required
                maxLength={100}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Klassenstufe
              <input
                required
                maxLength={100}
                placeholder="z. B. 3ème, 5ème, CM1"
                value={draft.grade}
                onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
              />
            </label>
            <label>
              Bevorzugte Sprache
              <select
                value={draft.preferredLanguage}
                onChange={(e) => setDraft({ ...draft, preferredLanguage: e.target.value })}
              >
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          <label>
            Aktive Fächer (durch Komma getrennt)
            <input required value={subjectText} onChange={(e) => setSubjectText(e.target.value)} />
          </label>
          <p className="small-note">
            Fach-IDs: maths, french, english, svt, history_geography. Eigene Fächer sind möglich.
            Verwende im Teacher Studio dieselben IDs.
          </p>
          <div className="form-actions">
            <button className="button primary" disabled={busy} type="submit">
              Profil speichern
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => setFormOpen(false)}
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
