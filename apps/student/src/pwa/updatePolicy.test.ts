import { describe, expect, it, vi } from 'vitest';
import { activateWaitingWorker, applySafeUpdate } from './updatePolicy';

function setup() {
  const worker = { postMessage: vi.fn() } as unknown as ServiceWorker;
  return {
    worker,
    options: {
      isBlocked: vi.fn(() => false),
      canUpdate: vi.fn(async () => true),
      waitingWorker: vi.fn(() => worker),
      activate: vi.fn(async () => {}),
      reload: vi.fn(),
    },
  };
}
describe('deliberate service-worker updates', () => {
  it('never reloads or activates during a local round or pending save', async () => {
    const { options } = setup();
    options.isBlocked.mockReturnValue(true);
    expect(await applySafeUpdate(options)).toBe('blocked');
    expect(options.canUpdate).not.toHaveBeenCalled();
    expect(options.activate).not.toHaveBeenCalled();
    expect(options.reload).not.toHaveBeenCalled();
  });
  it('checks durable sessions in other profiles/tabs before activation', async () => {
    const { options } = setup();
    options.canUpdate.mockResolvedValue(false);
    expect(await applySafeUpdate(options)).toBe('blocked');
    expect(options.activate).not.toHaveBeenCalled();
    expect(options.reload).not.toHaveBeenCalled();
  });
  it('rechecks local state after the asynchronous database guard', async () => {
    const { options } = setup();
    options.isBlocked.mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(await applySafeUpdate(options)).toBe('blocked');
    expect(options.activate).not.toHaveBeenCalled();
  });
  it('reloads only after the requested worker has activated', async () => {
    const { options, worker } = setup();
    const events: string[] = [];
    options.activate.mockImplementation(async () => {
      events.push('activated');
    });
    options.reload.mockImplementation(() => {
      events.push('reload');
    });
    expect(await applySafeUpdate(options)).toBe('updated');
    expect(options.activate).toHaveBeenCalledWith(worker);
    expect(events).toEqual(['activated', 'reload']);
  });
  it('does not reload if a new round starts while the waiting worker activates', async () => {
    const { options } = setup();
    options.activate.mockImplementation(async () => {
      options.isBlocked.mockReturnValue(true);
    });
    expect(await applySafeUpdate(options)).toBe('blocked');
    expect(options.reload).not.toHaveBeenCalled();
  });
  it('rechecks durable sessions after activation before reloading the requesting tab', async () => {
    const { options } = setup();
    options.canUpdate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await applySafeUpdate(options)).toBe('blocked');
    expect(options.reload).not.toHaveBeenCalled();
  });
  it('does not reload when there is no waiting update', async () => {
    const { options } = setup();
    const missing = { ...options, waitingWorker: () => null };
    expect(await applySafeUpdate(missing)).toBe('unavailable');
    expect(options.reload).not.toHaveBeenCalled();
  });
  it('preserves the current page if checking or activation fails', async () => {
    const { options } = setup();
    options.activate.mockRejectedValue(new Error('failed'));
    await expect(applySafeUpdate(options)).rejects.toThrow('failed');
    expect(options.reload).not.toHaveBeenCalled();
  });
  it('requests skipWaiting and waits for controller change', async () => {
    const target = new EventTarget();
    const worker = { postMessage: vi.fn() } as unknown as ServiceWorker;
    const activated = activateWaitingWorker(target as ServiceWorkerContainer, worker);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    target.dispatchEvent(new Event('controllerchange'));
    await activated;
  });
  it('times out safely if the browser does not activate the worker', async () => {
    vi.useFakeTimers();
    try {
      const target = new EventTarget();
      const worker = { postMessage: vi.fn() } as unknown as ServiceWorker;
      const pending = activateWaitingWorker(target as ServiceWorkerContainer, worker, 10);
      const assertion = expect(pending).rejects.toThrow('noch nicht aktiviert');
      await vi.advanceTimersByTimeAsync(11);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
