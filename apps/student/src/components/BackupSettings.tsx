import { useState } from 'react';
import { exportBackup, importBackup, hasAnyActiveSession } from '../storage/repositories';

export function BackupSettings({
  onImported,
  onManageProfiles,
}: {
  onImported: () => Promise<void>;
  onManageProfiles: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setMessage(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Datensicherung ist fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    const backup = await exportBackup();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `ecole-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return 'Backup erstellt. Bewahre die Datei an einem sicheren Ort auf.';
  }
  async function restore() {
    if (!file) return 'Wähle zuerst eine Backup-Datei.';
    if (file.size > 100 * 1024 * 1024)
      throw new Error('Die Backup-Datei ist zu groß (maximal 100 MB).');
    if (await hasAnyActiveSession())
      throw new Error('Schließe vor dem Import alle offenen Runden ab.');
    const input: unknown = JSON.parse(await file.text());
    const report = await importBackup(input);
    await onImported();
    return `Backup geprüft und übernommen: ${report.added} neue Datensätze, ${report.unchanged} bereits vorhanden.`;
  }
  return (
    <section className="settings-page">
      <span className="eyebrow">AUF DIESEM GERÄT</span>
      <h1>Profile & Datensicherung</h1>
      <p className="local-notice">
        Die Schüler-App benötigt kein Konto. Regelmäßige Backups schützen deine Lerndaten beim
        Gerätewechsel oder wenn Browserdaten gelöscht werden.
      </p>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <p className="status-inline" role="status">
        {message}
      </p>
      <article className="settings-card">
        <h2>Schülerprofile</h2>
        <p>Name, Klassenstufe und aktive Fächer bearbeiten oder weitere Schüler hinzufügen.</p>
        <button className="button secondary" disabled={busy} onClick={onManageProfiles}>
          Schüler verwalten
        </button>
      </article>
      <article className="settings-card">
        <h2>Daten exportieren</h2>
        <p>
          Eine JSON-Datei enthält alle Profile dieses Geräts, Lernstände, Ergebnisse, Versuche und
          heruntergeladenen Pakete. Teile sie nur bewusst.
        </p>
        <button className="button primary" disabled={busy} onClick={() => void run(download)}>
          Daten exportieren
        </button>
      </article>
      <article className="settings-card">
        <h2>Backup wiederherstellen</h2>
        <p>
          Die Datei wird vor dem Import vollständig geprüft. Neue Daten werden ergänzt. Abweichende
          vorhandene Daten werden nicht überschrieben; bei einem Konflikt bleibt der gesamte Import
          unverändert.
        </p>
        <label htmlFor="backup-file">
          École-Backup auswählen
          <input
            className="backup-file"
            id="backup-file"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          className="button secondary"
          disabled={busy || !file}
          onClick={() => {
            if (
              window.confirm('Dieses Backup prüfen und fehlende Daten auf diesem Gerät ergänzen?')
            )
              void run(restore);
          }}
        >
          Backup prüfen und importieren
        </button>
      </article>
    </section>
  );
}
