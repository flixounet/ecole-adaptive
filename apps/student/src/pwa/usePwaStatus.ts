import { useEffect, useRef, useState } from 'react';
import { activateWaitingWorker, applySafeUpdate } from './updatePolicy';

export interface PwaOptions {
  busy: boolean;
  updateBlocked: boolean;
  /** Recheck durable sessions across all profiles/tabs immediately before activation. */
  canUpdateApp: () => Promise<boolean>;
}

export function usePwaStatus(options: PwaOptions) {
  const [online, setOnline] = useState(navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(
    window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  );
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const latestOptions = useRef(options);
  const applying = useRef(false);
  latestOptions.current = options;
  const supported = 'serviceWorker' in navigator && window.isSecureContext;

  useEffect(() => {
    let disposed = false;
    let removeWorkerListener: (() => void) | undefined;
    let removeRegistrationListener: (() => void) | undefined;
    let lastUpdateCheck = 0;
    const media = window.matchMedia('(display-mode: standalone)');
    const onDisplayMode = () =>
      setStandalone(
        media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
    const checkForUpdate = () => {
      const now = Date.now();
      if (
        !navigator.onLine ||
        document.visibilityState === 'hidden' ||
        now - lastUpdateCheck < 60_000 ||
        !registration.current
      )
        return;
      lastUpdateCheck = now;
      // A failed update check must never interrupt local learning.
      void registration.current.update().catch(() => {});
    };
    const onOnline = () => {
      setOnline(true);
      checkForUpdate();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', checkForUpdate);
    media.addEventListener('change', onDisplayMode);
    const onControllerChange = () => {
      if (!disposed) setOfflineReady(true);
      // Deliberately no reload: another tab may still be taking an exam.
    };
    if (supported && import.meta.env.PROD) {
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      const base = import.meta.env.BASE_URL;
      void navigator.serviceWorker
        .register(`${base}sw.js`, {
          scope: base,
          updateViaCache: 'none',
        })
        .then((registered) => {
          if (disposed) return;
          registration.current = registered;
          if (registered.active) setOfflineReady(true);
          if (registered.waiting) setUpdateAvailable(true);
          const watchInstallingWorker = () => {
            removeWorkerListener?.();
            const worker = registered.installing;
            if (!worker) return;
            const onStateChange = () => {
              if (disposed) return;
              if (worker.state === 'installed') {
                if (navigator.serviceWorker.controller)
                  setUpdateAvailable(Boolean(registered.waiting));
                else setOfflineReady(true);
              }
            };
            worker.addEventListener('statechange', onStateChange);
            removeWorkerListener = () => worker.removeEventListener('statechange', onStateChange);
          };
          registered.addEventListener('updatefound', watchInstallingWorker);
          removeRegistrationListener = () =>
            registered.removeEventListener('updatefound', watchInstallingWorker);
          watchInstallingWorker();
          checkForUpdate();
        })
        .catch(() => {
          if (!disposed)
            setError(
              'Die App konnte noch nicht für den Offline-Start vorbereitet werden. Bitte online erneut öffnen.',
            );
        });
    }
    return () => {
      disposed = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', checkForUpdate);
      media.removeEventListener('change', onDisplayMode);
      if (supported)
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      removeWorkerListener?.();
      removeRegistrationListener?.();
    };
  }, [supported]);

  async function requestUpdate() {
    if (applying.current) return;
    applying.current = true;
    setUpdating(true);
    setError(null);
    try {
      const outcome = await applySafeUpdate({
        isBlocked: () => latestOptions.current.busy || latestOptions.current.updateBlocked,
        canUpdate: () => latestOptions.current.canUpdateApp(),
        waitingWorker: () => registration.current?.waiting ?? null,
        activate: (worker) => activateWaitingWorker(navigator.serviceWorker, worker),
        reload: () => window.location.reload(),
      });
      if (outcome === 'blocked')
        setError(
          'Bitte zuerst alle laufenden Runden abschließen. Dein Fortschritt bleibt erhalten.',
        );
      if (outcome === 'unavailable') setUpdateAvailable(false);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : 'Das Update ist im Moment nicht möglich.',
      );
    } finally {
      applying.current = false;
      setUpdating(false);
    }
  }
  return {
    online,
    offlineReady,
    updateAvailable,
    updating,
    error,
    standalone,
    supported,
    updateBlocked: options.busy || options.updateBlocked,
    version: import.meta.env.VITE_APP_VERSION as string,
    requestUpdate,
  };
}
export type PwaState = ReturnType<typeof usePwaStatus>;
