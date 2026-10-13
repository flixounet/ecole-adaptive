import { useEffect, useRef, useState } from 'react';
import type { StudentProfile } from '@shared/types';
import type { CatalogEntry, ContentCatalog, ContentPackage } from '@shared/content';
import { installContentPackage } from '../storage/repositories';
import { fetchCatalog, fetchPackage, sameGrade } from '../services/contentClient';
import { subjectLabel } from './format';

export function ContentView({
  profile,
  packages,
  blocked,
  onInstalled,
}: {
  profile: StudentProfile;
  packages: ContentPackage[];
  blocked: boolean;
  onInstalled: () => Promise<void>;
}) {
  const [catalog, setCatalog] = useState<ContentCatalog | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('all');
  const [allGrades, setAllGrades] = useState(false);
  const controller = useRef<AbortController | null>(null);
  async function load() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy('catalog');
    setError('');
    setMessage('');
    try {
      const next = await fetchCatalog(current.signal);
      if (!current.signal.aborted) setCatalog(next);
    } catch (e) {
      if (!current.signal.aborted)
        setError(
          navigator.onLine
            ? e instanceof Error
              ? e.message
              : 'Katalog konnte nicht geladen werden.'
            : 'Du bist offline. Bereits heruntergeladene Inhalte findest du unter „Meine Fächer“.',
        );
    } finally {
      if (!current.signal.aborted) setBusy('');
    }
  }
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [profile.id]);
  async function download(entry: CatalogEntry) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(entry.id);
    setError('');
    setMessage('');
    try {
      const pkg = await fetchPackage(entry, current.signal);
      if (current.signal.aborted) return;
      const installed = await installContentPackage(profile.id, pkg);
      if (current.signal.aborted) return;
      await onInstalled();
      setMessage(
        installed.status === 'unchanged'
          ? 'Dieses Paket ist bereits offline verfügbar.'
          : `${entry.title} ist jetzt offline verfügbar.`,
      );
    } catch (e) {
      if (!current.signal.aborted)
        setError(
          e instanceof Error ? e.message : 'Download fehlgeschlagen. Bitte erneut versuchen.',
        );
    } finally {
      if (!current.signal.aborted) setBusy('');
    }
  }
  const assigned =
    catalog?.packages.filter(
      (p) => p.studentIds.includes(profile.id) && profile.subjects.includes(p.subject),
    ) ?? [];
  const visible = assigned.filter(
    (p) =>
      (allGrades || sameGrade(p.grade, profile.grade)) &&
      (subject === 'all' || p.subject === subject),
  );
  return (
    <section className="content-page">
      <span className="eyebrow">DEIN UNTERRICHT ZUM MITNEHMEN</span>
      <div className="content-heading">
        <h1>Neue Inhalte</h1>
        <button className="button secondary" disabled={Boolean(busy)} onClick={() => void load()}>
          Katalog aktualisieren
        </button>
      </div>
      <p>
        Lade passende Aufgabenpakete für {profile.name} herunter. Danach kannst du sie ohne Internet
        unter „Meine Fächer“ öffnen.
      </p>
      {blocked && (
        <p className="local-notice">
          Schließe deine offene Runde ab, bevor du Inhalte installierst oder aktualisierst.
        </p>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <p role="status">{busy === 'catalog' ? 'Katalog wird geladen …' : message}</p>
      <div className="content-filter">
        <label>
          Fach{' '}
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="all">Alle aktiven Fächer</option>
            {profile.subjects.map((s) => (
              <option key={s} value={s}>
                {subjectLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={allGrades}
            onChange={(e) => setAllGrades(e.target.checked)}
          />{' '}
          Auch andere Klassenstufen anzeigen
        </label>
      </div>
      {visible.map((entry) => {
        const installed = packages.find((p) => p.id === entry.id);
        const current = installed && installed.version >= entry.version;
        const inconsistent =
          installed?.version === entry.version && installed.contentHash !== entry.contentHash;
        return (
          <article className="package-card" key={entry.id}>
            <span className="eyebrow">
              {subjectLabel(entry.subject)} · {entry.grade}
            </span>
            <h2>{entry.title}</h2>
            <p>{entry.chapter}</p>
            <div className="package-details">
              <span>Version {entry.version}</span>
              <span>
                {entry.modes.map((m) => (m === 'exam' ? 'Klassenarbeit' : 'Lernen')).join(' + ')}
              </span>
              <span>{new Date(entry.createdAt).toLocaleDateString('de-DE')}</span>
            </div>
            {inconsistent ? (
              <p className="error-box">
                Diese Paketversion wurde nachträglich verändert. Bitte im Teacher Studio eine neue
                Version veröffentlichen.
              </p>
            ) : current ? (
              <p className="package-state">
                ✓ Offline verfügbar
                {installed.version > entry.version ? ' · Neuere Version bereits installiert' : ''}
              </p>
            ) : (
              <button
                className="button primary"
                disabled={Boolean(busy) || blocked}
                onClick={() => void download(entry)}
              >
                {busy === entry.id
                  ? 'Wird geprüft und gespeichert …'
                  : installed
                    ? 'Aktualisierung herunterladen'
                    : 'Herunterladen'}
              </button>
            )}
          </article>
        );
      })}
      {catalog && !visible.length && (
        <div className="empty-state">
          <h2>Noch keine neuen Pakete</h2>
          <p>
            Im Katalog sind für dieses Profil und die gewählten Filter keine Inhalte verfügbar.
            Veröffentliche im Teacher Studio ein Paket für die Profil-ID{' '}
            <strong>{profile.id}</strong>.
          </p>
        </div>
      )}
      {packages.length > 0 && (
        <p className="local-notice">
          {packages.length} Paket{packages.length === 1 ? '' : 'e'} für {profile.name} auf diesem
          Gerät gespeichert.
        </p>
      )}
    </section>
  );
}
