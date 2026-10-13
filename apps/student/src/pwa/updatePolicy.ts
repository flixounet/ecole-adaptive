export type UpdateResult = 'updated' | 'blocked' | 'unavailable';

export interface UpdateOptions {
  isBlocked: () => boolean;
  canUpdate: () => Promise<boolean>;
  waitingWorker: () => ServiceWorker | null;
  activate: (worker: ServiceWorker) => Promise<void>;
  reload: () => void;
}

/** Only a deliberate request may reload this tab; another tab's activation never does. */
export async function applySafeUpdate(options: UpdateOptions): Promise<UpdateResult> {
  if (options.isBlocked() || !(await options.canUpdate()) || options.isBlocked()) return 'blocked';
  const worker = options.waitingWorker();
  if (!worker) return 'unavailable';
  await options.activate(worker);
  // Activation can take time; starting a new round in this interval must also stay safe.
  if (options.isBlocked() || !(await options.canUpdate()) || options.isBlocked()) return 'blocked';
  options.reload();
  return 'updated';
}

export function activateWaitingWorker(
  container: ServiceWorkerContainer,
  worker: ServiceWorker,
  timeoutMs = 15_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      container.removeEventListener('controllerchange', onChange);
    };
    const onChange = () => {
      cleanup();
      resolve();
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Das Update konnte noch nicht aktiviert werden. Bitte erneut versuchen.'));
    }, timeoutMs);
    container.addEventListener('controllerchange', onChange);
    try {
      worker.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
