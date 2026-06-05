import type { Cache } from '@/ports/cache';
import type { Clock } from '@/ports/clock';
import { clockEpochMilliseconds } from '@/adapters/clock-utils';
import { optionalPositiveIntegerOption } from '@/primitives/runtime-options';

type CacheEntry = {
  value: unknown;
  expiresAt?: number;
};

export class MemoryCache implements Cache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly clock: Clock) {}

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (entry == null) {
      return null;
    }

    if (entry.expiresAt != null && this.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }

    return structuredClone(entry.value) as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = optionalPositiveIntegerOption('ttlMs', ttlMs);
    this.entries.set(key, {
      value: structuredClone(value),
      ...(ttl != null ? { expiresAt: this.now() + ttl } : {}),
    });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  private now(): number {
    return clockEpochMilliseconds(this.clock);
  }
}
