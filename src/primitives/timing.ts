export class SleepAbortedError extends Error {
  override readonly name = 'SleepAbortedError';

  constructor() {
    super('Sleep aborted');
  }
}

export type SleepFunction = (ms: number, signal?: AbortSignal | undefined) => Promise<void>;

export function sleep(ms: number, signal?: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new SleepAbortedError());
      return;
    }

    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const settle = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      complete();
    };
    const onAbort = () => {
      settle(() => reject(new SleepAbortedError()));
    };

    timeoutId = setTimeout(() => {
      settle(resolve);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
