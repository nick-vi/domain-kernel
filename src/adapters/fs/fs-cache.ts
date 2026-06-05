import { z } from 'zod';
import type { JsonValue } from '@/domain/shared';
import type { Cache } from '@/ports/cache';
import type { Clock } from '@/ports/clock';
import { clockEpochMilliseconds } from '@/adapters/clock-utils';
import { computeContentHash } from '@/primitives/hash';
import { optionalPositiveIntegerOption } from '@/primitives/runtime-options';
import { JsonValueSchema } from '@/validation/schemas';
import {
  filenameForId,
  pathExists,
  readJson,
  removePath,
  safeJoin,
  type FileTempNames,
  writeJsonAtomic,
} from './fs-utils';

type FsCacheEntry = {
  value: JsonValue;
  expiresAt?: number | undefined;
};

const FsCacheEntrySchema: z.ZodType<FsCacheEntry> = z
  .object({
    value: JsonValueSchema,
    expiresAt: z.number().int().positive().optional(),
  })
  .strict();

export class FsCache implements Cache {
  private readonly root: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly tempNames: FileTempNames
  ) {
    this.root = safeJoin(dataDir, 'cache');
  }

  async get<T>(key: string): Promise<T | null> {
    const path = this.pathFor(key);
    if (!(await pathExists(path))) {
      return null;
    }

    const entry = await readJson<FsCacheEntry>(path, FsCacheEntrySchema);
    if (entry.expiresAt != null && this.now() > entry.expiresAt) {
      await removePath(path);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = optionalPositiveIntegerOption('ttlMs', ttlMs);
    const entry: FsCacheEntry = {
      value: value as JsonValue,
      ...(ttl != null ? { expiresAt: this.now() + ttl } : {}),
    };
    await writeJsonAtomic(this.pathFor(key), entry, this.tempNames);
  }

  async delete(key: string): Promise<void> {
    await removePath(this.pathFor(key));
  }

  async clear(): Promise<void> {
    await removePath(this.root);
  }

  private pathFor(key: string): string {
    const hash = computeContentHash(key);
    return safeJoin(this.root, filenameForId(hash));
  }

  private now(): number {
    return clockEpochMilliseconds(this.clock);
  }
}
