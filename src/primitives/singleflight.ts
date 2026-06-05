export class Singleflight {
  private readonly inflight = new Map<string, Promise<unknown>>();

  has(key: string): boolean {
    return this.inflight.has(key);
  }

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing != null) return existing as Promise<T>;

    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.inflight.size;
  }
}
