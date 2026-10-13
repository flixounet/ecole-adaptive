import { useState } from 'react';
import { ProfileManager } from './components/ProfileManager';
import { BackupSettings } from './components/BackupSettings';
import { ContentView } from './components/ContentView';
import { PwaStatus } from './pwa/PwaStatus';
import { usePwaStatus } from './pwa/usePwaStatus';
import { hasAnyActiveSession } from './storage/repositories';
import './phase3.css';
import { useCatalogAvailability } from './hooks/useCatalogAvailability';
import { Brand } from './components/LearningVisuals';
import { ProfilePicker } from './components/ProfilePicker';
import { LibraryView } from './components/LibraryView';
import { SessionView } from './components/SessionView';
import { ResultView } from './components/ResultView';
import { MasteryView } from './components/MasteryView';
import { HistoryView } from './components/HistoryView';
import { ConfirmDialog } from './components/ConfirmDialog';
import { useLearningApp, type Section } from './hooks/useLearningApp';
import { modeLabel } from './components/format';

const sections: { id: Section; icon: string; label: string }[] = [
  { id: 'library', icon: '▦', label: 'Meine Fächer' },
  { id: 'mastery', icon: '◔', label: 'Mein Lernstand' },
  { id: 'history', icon: '◷', label: 'Meine Ergebnisse' },
  { id: 'content', icon: '↓', label: 'Neue Inhalte' },
  { id: 'settings', icon: '⚙', label: 'Profile & Backup' },
];
export default function App() {
  const app = useLearningApp();
  const [manageProfiles, setManageProfiles] = useState(false);
  const [help, setHelp] = useState(false);
  const { profile, session, result, busy, saving } = app;
  const availableCount = useCatalogAvailability(profile, app.packages);
  const pwa = usePwaStatus({
    busy: busy || saving,
    updateBlocked: Boolean(session || app.savedSession),
    canUpdateApp: async () => !(await hasAnyActiveSession()),
  });
  function changeProfile() {
    if (
      app.savedSession?.mode === 'exam' &&
      !window.confirm(
        'Deine Klassenarbeit läuft weiter, auch wenn du das Profil wechselst. Wirklich wechseln?',
      )
    )
      return;
    app.switchProfile();
  }
  if (manageProfiles)
    return (
      <>
        <ProfileManager onClose={() => setManageProfiles(false)} onChanged={app.reloadProfiles} />
        <PwaStatus pwa={pwa} />
      </>
    );
  if (!profile)
    return (
      <ProfilePicker
        profiles={app.profiles}
        busy={busy}
        error={app.error}
        onSelect={app.selectProfile}
        onManage={() => setManageProfiles(true)}
        status={<PwaStatus pwa={pwa} />}
      />
    );
  return (
    <div className={`app-shell ${session ? 'is-session' : ''}`}>
      <aside className="sidebar">
        <Brand />
        <div className="nav-caption">DEIN LERNRAUM</div>
        <nav className="main-nav" aria-label="Lernraum">
          {sections.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${app.section === item.id && !session && !result ? 'selected' : ''}`}
              disabled={busy || saving}
              aria-current={app.section === item.id && !session && !result ? 'page' : undefined}
              onClick={() => void app.navigate(item.id)}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.id === 'content' && availableCount > 0 ? ` (${availableCount})` : ''}
            </button>
          ))}
        </nav>
        <button
          className={`nav-item help-toggle ${help ? 'help-selected' : ''}`}
          onClick={() => setHelp(!help)}
        >
          <span aria-hidden="true">◉</span> So funktioniert’s
        </button>
        <div className="sidebar-bottom">
          <div className="little-note">
            <span>Ein bisschen jeden Tag.</span>
            <p>Fehler gehören zum Lernen. Du musst nicht alles sofort können.</p>
            <span aria-hidden="true">✳</span>
          </div>
          <div className="storage-note">
            <span className="status-dot" /> Auf diesem Gerät
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Mein Lernraum <span>/</span>{' '}
            {session
              ? modeLabel(session.mode)
              : result
                ? 'Dein Ergebnis'
                : sections.find((s) => s.id === app.section)?.label}
          </span>
          <button
            className="profile-switch"
            disabled={busy || Boolean(session)}
            onClick={changeProfile}
          >
            <span className={`mini-avatar ${profile.id}`}>{profile.name[0]}</span>
            {profile.name}
            <span aria-hidden="true">⌄</span>
          </button>
        </header>
        <main className="workspace">
          <PwaStatus pwa={pwa} />
          {app.error && (
            <div className="error-box" role="alert">
              {app.error}
              {session && (
                <button
                  disabled={busy || saving}
                  onClick={() => void app.persist(session).catch(() => {})}
                >
                  Erneut speichern
                </button>
              )}
              {!session && app.savedSession?.mode === 'exam' && (
                <button
                  disabled={busy}
                  onClick={() => void app.finish(app.savedSession ?? undefined)}
                >
                  Abgabe erneut versuchen
                </button>
              )}
            </div>
          )}
          {help && (
            <section className="help-panel">
              <button className="text-button help-close" onClick={() => setHelp(false)}>
                Schließen ×
              </button>
              <h2>Dein Lernen, dein Tempo.</h2>
              <p>
                <strong>Lernen:</strong> Nach einem Fehler hilft dir ein Hinweis, nach dem zweiten
                ein konkreter Tipp. Nach dem dritten Versuch siehst du die Lösung. Dein Lernstand
                ändert sich einmal pro abgeschlossener Aufgabe.
              </p>
              <p>
                <strong>Klassenarbeit:</strong> Du kannst Aufgaben überspringen und zurückgehen. Die
                Zeit läuft auch beim Verlassen weiter. Lösungen und Lernstand gibt es nach der
                Abgabe.
              </p>
              <p>
                <strong>Fehlertraining:</strong> Vom Ergebnis startest du passende neue Aufgaben zu
                deinen Fehlern. Dein Lernstand hilft bei der Auswahl; 50 % ist der Startwert und
                keine gemessene Leistung.
              </p>
              <p>
                Lade unter „Neue Inhalte“ deine Aufgaben herunter. Sobald die App offline bereit
                ist, kannst du sie auch ohne Internet neu öffnen. Demoaufgaben sind ausdrücklich
                gekennzeichnet. Unter „Profile & Backup“ sicherst du deine Lerndaten.
              </p>
            </section>
          )}
          {session ? (
            <SessionView
              session={session}
              now={app.now}
              busy={busy}
              saving={saving}
              saveFailed={app.saveFailed}
              onChange={(next) => {
                void app.persist(next).catch(() => {});
              }}
              onFinish={() => app.setConfirmSubmit(true)}
              onPause={() => void app.navigate('library')}
            />
          ) : result ? (
            <ResultView
              result={result}
              profile={profile}
              busy={busy}
              hasActiveSession={Boolean(app.savedSession)}
              onTrainErrors={() => app.trainErrors(result)}
              onBack={() => void app.navigate(app.section)}
            />
          ) : app.section === 'content' ? (
            <ContentView
              key={profile.id}
              profile={profile}
              packages={app.packages}
              blocked={Boolean(app.savedSession)}
              onInstalled={app.refreshCurrent}
            />
          ) : app.section === 'settings' ? (
            <BackupSettings
              onImported={app.reloadProfiles}
              onManageProfiles={() => setManageProfiles(true)}
            />
          ) : app.section === 'mastery' ? (
            <MasteryView
              studentId={profile.id}
              banks={app.banks}
              states={app.skillStates}
              attempts={app.attempts}
            />
          ) : app.section === 'history' ? (
            <HistoryView results={app.results} onResult={app.openResult} />
          ) : (
            <LibraryView
              key={profile.id}
              packages={app.packages}
              availableCount={availableCount}
              onContent={() => void app.navigate('content')}
              profile={profile}
              profiles={app.profiles}
              banks={app.banks}
              results={app.results}
              savedSession={app.savedSession}
              busy={busy}
              onStart={app.start}
              onResume={app.resume}
              onSelect={app.selectProfile}
              onResult={app.openResult}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>École Adaptive</span>
          <span>Neugierig bleiben. Jeden Tag ein kleines Stück.</span>
          <span>Lokal gespeichert · Offline lernen</span>
        </footer>
      </div>
      {session && (
        <ConfirmDialog
          open={app.confirmSubmit}
          busy={busy || saving}
          mode={session.mode}
          openCount={
            session.questionIds.filter((id) =>
              session.mode === 'exam'
                ? !session.answers[id].value.trim()
                : !session.answers[id].resolved,
            ).length
          }
          onCancel={() => app.setConfirmSubmit(false)}
          onConfirm={() => void app.finish()}
        />
      )}
    </div>
  );
}
