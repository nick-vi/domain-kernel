export type ResourceSignal = 'SIGINT' | 'SIGTERM' | 'beforeExit';

export type ResourceOptions<T> = {
  init: () => T | Promise<T>;
  dispose: (value: T) => void | Promise<void>;
  eager?: boolean | undefined;
  signals?: boolean | readonly ResourceSignal[] | undefined;
};

export type Resource<T> = {
  get(): Promise<T>;
  dispose(): Promise<void>;
  isReady(): boolean;
};

const ALL_SIGNALS: readonly ResourceSignal[] = ['SIGINT', 'SIGTERM', 'beforeExit'];

export function resource<T>(options: ResourceOptions<T>): Resource<T> {
  const { init, dispose: disposeFn, eager = false, signals = true } = options;

  let value: T | undefined;
  let initialized = false;
  let disposed = false;
  let initPromise: Promise<T> | undefined;
  let disposePromise: Promise<void> | undefined;

  const doInit = async (): Promise<T> => {
    if (initialized && !disposed) return value as T;
    if (disposePromise != null) await disposePromise;
    if (initPromise != null) return initPromise;

    disposed = false;
    initPromise = (async () => {
      try {
        const result = await init();
        value = result;
        initialized = true;
        return result;
      } catch (error) {
        initPromise = undefined;
        throw error;
      }
    })();
    return initPromise;
  };

  const doDispose = async (): Promise<void> => {
    if (!initialized && initPromise == null) return;
    if (disposePromise != null) return disposePromise;

    disposePromise = (async () => {
      try {
        if (initPromise != null) {
          try {
            await initPromise;
          } catch {
            initPromise = undefined;
            return;
          }
        }

        if (initialized && value !== undefined) await disposeFn(value);
        value = undefined;
        initialized = false;
        disposed = true;
        initPromise = undefined;
      } finally {
        disposePromise = undefined;
      }
    })();
    return disposePromise;
  };

  registerResourceSignals(signals, doDispose);

  if (eager) {
    doInit().catch(() => {
      // Surface eager initialization failures on the next get().
    });
  }

  return {
    get: doInit,
    dispose: doDispose,
    isReady: () => initialized && !disposed,
  };
}

function registerResourceSignals(
  signals: boolean | readonly ResourceSignal[],
  dispose: () => Promise<void>
): void {
  if (signals === false) return;
  const signalList = signals === true ? ALL_SIGNALS : signals;
  const processLike = (globalThis as { process?: { once(event: string, cb: () => void): void } })
    .process;
  if (processLike == null) return;

  for (const signal of signalList) {
    processLike.once(signal, () => {
      dispose().catch(() => {
        // Ignore cleanup errors during process shutdown.
      });
    });
  }
}
