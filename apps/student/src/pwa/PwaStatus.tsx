import type { PwaState } from './usePwaStatus';
import './pwa.css';

export function PwaStatus({ pwa }: { pwa: PwaState }) {
  return (
    <div className="pwa-status" aria-label="App und Verbindung">
      <div className="pwa-status-line" role="status">
        <span className={`pwa-dot ${pwa.online ? 'online' : 'offline'}`} aria-hidden="true" />
        {pwa.online ? 'Online' : 'Offline – heruntergeladene Inhalte verfügbar'}
        {pwa.offlineReady && pwa.online && <span className="pwa-ready">· App offline bereit</span>}
      </div>
      {pwa.updateAvailable && (
        <div className="pwa-update" role="status">
          <p>Eine neue Version von École ist verfügbar.</p>
          <button
            className="button primary"
            type="button"
            disabled={pwa.updateBlocked || pwa.updating}
            onClick={() => void pwa.requestUpdate()}
          >
            {pwa.updating ? 'Wird aktualisiert …' : 'Aktualisieren'}
          </button>
          {pwa.updateBlocked && <small>Nach der laufenden Runde aktualisieren.</small>}
        </div>
      )}
      {pwa.error && (
        <p className="pwa-error" role="alert">
          {pwa.error}
        </p>
      )}
      {!pwa.standalone && (
        <details className="pwa-install">
          <summary>App installieren</summary>
          <p>
            Auf dem iPad diese Seite in <strong>Safari</strong> öffnen, auf <strong>Teilen</strong>{' '}
            tippen und <strong>Zum Home-Bildschirm</strong> wählen.
          </p>
          <p>
            Einmal online öffnen und auf „App offline bereit“ warten. Gewünschte Aufgabenpakete
            herunterladen; danach stehen sie auch ohne Internet bereit.
          </p>
          {!pwa.supported && (
            <p>
              Für die Installation mit Offline-Start ist eine HTTPS-Adresse erforderlich. Der lokale
              HTTP-Zugriff im WLAN genügt dafür nicht.
            </p>
          )}
        </details>
      )}
      <small className="pwa-version">École Adaptive {pwa.version}</small>
    </div>
  );
}
