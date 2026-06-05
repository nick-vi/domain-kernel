import { positiveIntegerOption } from './runtime-options';

export class Lock {
  private queue: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const acquired = new Promise<void>((resolve) => {
      release = resolve;
    });

    const waitForPrevious = this.queue;
    this.queue = acquired;
    await waitForPrevious;

    try {
      return await fn();
    } finally {
      release?.();
    }
  }
}

export class OperationAbortedError extends Error {
  override readonly name = 'OperationAbortedError';

  constructor() {
    super('Operation aborted');
  }
}

export type SemaphoreRunOptions = {
  signal?: AbortSignal | undefined;
};

type SemaphoreWaiter = {
  resolve(): void;
  onAbort(): void;
};

export class Semaphore {
  private running = 0;
  private readonly waiting: SemaphoreWaiter[] = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = positiveIntegerOption('limit', limit);
  }

  async run<T>(fn: () => Promise<T>, options: SemaphoreRunOptions = {}): Promise<T> {
    await this.acquire(options.signal);

    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get availableSlots(): number {
    return this.limit - this.running;
  }

  get pendingCount(): number {
    return this.waiting.length;
  }

  private acquire(signal?: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted === true) {
      return Promise.reject(new OperationAbortedError());
    }

    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let waiter: SemaphoreWaiter;
      const cleanup = () => {
        signal?.removeEventListener('abort', waiter.onAbort);
      };
      waiter = {
        resolve: () => {
          cleanup();
          this.running++;
          resolve();
        },
        onAbort: () => {
          if (!this.removeWaiter(waiter)) return;
          cleanup();
          reject(new OperationAbortedError());
        },
      };

      this.waiting.push(waiter);
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
    });
  }

  private release(): void {
    this.running--;
    const next = this.waiting.shift();
    next?.resolve();
  }

  private removeWaiter(waiter: SemaphoreWaiter): boolean {
    const index = this.waiting.indexOf(waiter);
    if (index === -1) return false;
    this.waiting.splice(index, 1);
    return true;
  }
}

export async function boundedMapSettled<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
  signal?: AbortSignal | undefined
): Promise<PromiseSettledResult<R>[]> {
  const semaphore = new Semaphore(concurrency);

  return Promise.allSettled(
    items.map((item, index) =>
      semaphore.run(async () => {
        if (signal?.aborted === true) throw new OperationAbortedError();
        return fn(item, index);
      }, { signal })
    )
  );
}
