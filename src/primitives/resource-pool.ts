import { OperationAbortedError } from './concurrency';

export type PooledResource<T> = {
  resource: T;
  maxConcurrent: number;
  inFlight: number;
};

export type ResourcePoolConfig<T> = {
  resources: Array<{ resource: T; maxConcurrent: number }>;
};

export type PoolStats = {
  total: number;
  available: number;
  inFlight: number;
  queued: number;
};

export type ResourcePoolRunOptions = {
  signal?: AbortSignal | undefined;
};

type ResourcePoolWaiter<T> = {
  resolve(resource: PooledResource<T>): void;
  onAbort(): void;
};

export class ResourcePool<T> {
  private readonly resources: PooledResource<T>[];
  private readonly waitQueue: Array<ResourcePoolWaiter<T>> = [];

  constructor(config: ResourcePoolConfig<T>) {
    if (config.resources.length === 0) throw new Error('ResourcePool requires at least one resource');
    this.resources = config.resources.map((entry) => ({
      resource: entry.resource,
      maxConcurrent: entry.maxConcurrent,
      inFlight: 0,
    }));
    for (const entry of this.resources) {
      if (entry.maxConcurrent < 1) throw new Error('Resource maxConcurrent must be at least 1');
    }
  }

  async withResource<R>(
    fn: (resource: T) => Promise<R>,
    options: ResourcePoolRunOptions = {}
  ): Promise<R> {
    const pooled = await this.acquire(options.signal);
    try {
      return await fn(pooled.resource);
    } finally {
      this.release(pooled);
    }
  }

  get stats(): PoolStats {
    let available = 0;
    let inFlight = 0;

    for (const resource of this.resources) {
      inFlight += resource.inFlight;
      if (resource.inFlight < resource.maxConcurrent) available++;
    }

    return {
      total: this.resources.length,
      available,
      inFlight,
      queued: this.waitQueue.length,
    };
  }

  private acquire(signal?: AbortSignal | undefined): Promise<PooledResource<T>> {
    if (signal?.aborted === true) {
      return Promise.reject(new OperationAbortedError());
    }

    const available = this.findAvailable();
    if (available != null) {
      available.inFlight++;
      return Promise.resolve(available);
    }

    return new Promise<PooledResource<T>>((resolve, reject) => {
      let waiter: ResourcePoolWaiter<T>;
      const cleanup = () => {
        signal?.removeEventListener('abort', waiter.onAbort);
      };
      waiter = {
        resolve: (resource) => {
          cleanup();
          resource.inFlight++;
          resolve(resource);
        },
        onAbort: () => {
          if (!this.removeWaiter(waiter)) return;
          cleanup();
          reject(new OperationAbortedError());
        },
      };

      this.waitQueue.push(waiter);
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
    });
  }

  private release(pooled: PooledResource<T>): void {
    pooled.inFlight--;

    if (this.waitQueue.length === 0) return;
    const available = this.findAvailable();
    const waiter = this.waitQueue.shift();
    if (available != null && waiter != null) {
      waiter.resolve(available);
    }
  }

  private removeWaiter(waiter: ResourcePoolWaiter<T>): boolean {
    const index = this.waitQueue.indexOf(waiter);
    if (index === -1) return false;
    this.waitQueue.splice(index, 1);
    return true;
  }

  private findAvailable(): PooledResource<T> | undefined {
    let best: PooledResource<T> | undefined;
    let lowestLoad = Number.POSITIVE_INFINITY;

    for (const resource of this.resources) {
      if (resource.inFlight < resource.maxConcurrent && resource.inFlight < lowestLoad) {
        best = resource;
        lowestLoad = resource.inFlight;
      }
    }

    return best;
  }
}
