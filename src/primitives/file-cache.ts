import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { Json } from './json';
import { Err, isErr, Ok, type Result } from './result';
import {
  optionalPositiveIntegerOption,
  positiveIntegerOption,
} from './runtime-options';
import { compareStrings } from './string';
import {
  formatValidationIssues,
  type SafeParseSchema,
  type ValidationIssue,
  type Validator,
  validationIssuesFromSafeParseError,
} from './schema';
import { Singleflight } from './singleflight';

export const FileCacheErrorKind = Object.freeze({
  InvalidKey: 'invalid-key',
  Read: 'read',
  Write: 'write',
  Serialization: 'serialization',
  Validation: 'validation',
} as const);

export type FileCacheErrorKind = (typeof FileCacheErrorKind)[keyof typeof FileCacheErrorKind];

export class FileCacheError extends Error {
  override readonly name = 'FileCacheError';
  readonly namespace: string | undefined;
  readonly key: string | undefined;
  readonly path: string | undefined;
  readonly issues: readonly ValidationIssue[] | undefined;

  constructor(
    readonly kind: FileCacheErrorKind,
    message: string,
    options: {
      namespace?: string | undefined;
      key?: string | undefined;
      path?: string | undefined;
      issues?: readonly ValidationIssue[] | undefined;
      cause?: unknown;
    } = {}
  ) {
    super(message, { cause: options.cause });
    this.namespace = options.namespace;
    this.key = options.key;
    this.path = options.path;
    this.issues = options.issues;
  }
}

export type FileCacheSerializer = {
  /** File extension without the leading dot. Empty string means no extension. */
  extension: string;
  serialize(value: unknown): Result<string | Uint8Array, unknown>;
  deserialize(raw: Uint8Array): Result<unknown, unknown>;
};

const textDecoder = new TextDecoder();

export const FileCacheJsonSerializer: FileCacheSerializer = {
  extension: 'json',
  serialize(value) {
    return Json.stringify(value);
  },
  deserialize(raw) {
    return Json.parse(textDecoder.decode(raw));
  },
};

export const FileCacheTextSerializer: FileCacheSerializer = {
  extension: '',
  serialize(value) {
    return Ok(typeof value === 'string' ? value : String(value));
  },
  deserialize(raw) {
    return Ok(textDecoder.decode(raw));
  },
};

export const FileCacheEvictionReason = Object.freeze({
  Ttl: 'ttl',
  Lru: 'lru',
  Manual: 'manual',
  Version: 'version',
  Invalid: 'invalid',
} as const);

export type FileCacheEvictionReason =
  (typeof FileCacheEvictionReason)[keyof typeof FileCacheEvictionReason];

export type FileCacheHooks = {
  onHit?: (namespace: string, key: string) => void;
  onMiss?: (namespace: string, key: string) => void;
  onEvict?: (namespace: string, key: string, reason: FileCacheEvictionReason) => void;
  onError?: (namespace: string, error: FileCacheError, operation: string) => void;
};

export type FileCacheValidator<T> = Validator<T, unknown>;

export type FileCacheNamespace<TKey = unknown, TValue = unknown> = {
  /** Can return slashes to create directory nesting under the namespace. */
  keyOf: (input: TKey) => string;
  /** Defaults to 1. Bump to invalidate older namespace directories. */
  version?: number | undefined;
  /** Milliseconds. `null` or omitted means never expire by file mtime. */
  ttlMs?: number | null | undefined;
  serializer?: FileCacheSerializer | undefined;
  schema?: SafeParseSchema<TValue> | undefined;
  validate?: FileCacheValidator<TValue> | undefined;
  maxEntries?: number | undefined;
  negative?: { ttlMs: number } | undefined;
};

export type FileCacheLookup<T> = {
  readonly hit: boolean;
  readonly negative: boolean;
  readonly value: T | null;
  unwrapOr<U>(fallback: U): T | U;
  unwrapOrElse<U>(factory: () => U): T | U;
  orSet<E>(
    factory: () => Promise<Result<T, E>> | Result<T, E>
  ): Promise<Result<T | null, E | FileCacheError>>;
};

export type FileCacheNamespaceHandle<TKey, TValue> = {
  readonly path: string;
  get(key: TKey): Promise<Result<FileCacheLookup<TValue>, FileCacheError>>;
  has(key: TKey): Promise<Result<boolean, FileCacheError>>;
  set(key: TKey, value: TValue): Promise<Result<void, FileCacheError>>;
  delete(key: TKey): Promise<Result<boolean, FileCacheError>>;
  getMany(keys: readonly TKey[]): Promise<Result<Map<string, TValue | null>, FileCacheError>>;
  setMany(entries: readonly (readonly [TKey, TValue])[]): Promise<Result<void, FileCacheError>>;
  setNegative(key: TKey): Promise<Result<void, FileCacheError>>;
  listFilenamesUnderPrefix(prefix: string): Promise<Result<string[], FileCacheError>>;
  stats(): Promise<Result<FileCacheNamespaceStats, FileCacheError>>;
};

export type FileCacheNamespaceStats = {
  hits: number;
  misses: number;
  entries: number;
  bytes: number;
};

export type FileCacheStats = {
  namespaces: Record<string, FileCacheNamespaceStats>;
};

export type FileCachePurgeResult = {
  deleted: number;
  errors: number;
};

export type FileCacheNamespaceMap = Record<string, FileCacheNamespace<any, any>>;

type InferCacheKey<T> = T extends FileCacheNamespace<infer TKey, any> ? TKey : never;
type InferCacheValue<T> = T extends FileCacheNamespace<any, infer TValue> ? TValue : never;

export type FileCacheClock = {
  now(): number;
};

export type FileCacheTempNames = {
  nextTempName(): string;
};

export type FileCacheConfig<NS extends FileCacheNamespaceMap> = {
  root: string;
  dir?: string | undefined;
  clock: FileCacheClock;
  tempNames: FileCacheTempNames;
  namespaces: NS;
  hooks?: FileCacheHooks | undefined;
};

export type FileCache<NS extends FileCacheNamespaceMap> = {
  ns<K extends keyof NS & string>(
    name: K
  ): FileCacheNamespaceHandle<InferCacheKey<NS[K]>, InferCacheValue<NS[K]>>;
  purge(namespace?: keyof NS & string): Promise<Result<FileCachePurgeResult, FileCacheError>>;
  stats(namespace?: keyof NS & string): Promise<Result<FileCacheStats, FileCacheError>>;
};

const NEGATIVE_SENTINEL = '__negative__';

export function createFileCache<NS extends FileCacheNamespaceMap>(
  config: FileCacheConfig<NS>
): FileCache<NS> {
  const root = config.dir == null ? config.root : join(config.root, config.dir);
  const handles = new Map<string, FileCacheNamespaceHandleImpl<unknown, unknown>>();

  function getNamespace(name: string): FileCacheNamespaceHandleImpl<unknown, unknown> {
    const existing = handles.get(name);
    if (existing != null) return existing;

    const namespace = config.namespaces[name];
    if (namespace == null) {
      throw new Error(`Unknown file cache namespace: ${name}`);
    }

    const version = positiveIntegerOption(`${name}.version`, namespace.version ?? 1);
    const namespaceRoot = join(root, sanitizeFileCacheSegment(name), `v${version}`);
    const handle = new FileCacheNamespaceHandleImpl(
      namespaceRoot,
      name,
      namespace,
      config.clock,
      config.tempNames,
      config.hooks
    );
    handles.set(name, handle);
    return handle;
  }

  return {
    ns(name) {
      return getNamespace(name) as FileCacheNamespaceHandle<
        InferCacheKey<NS[typeof name]>,
        InferCacheValue<NS[typeof name]>
      >;
    },

    async purge(namespace) {
      const names = namespace == null ? Object.keys(config.namespaces) : [namespace];
      let deleted = 0;
      let errors = 0;

      for (const name of names) {
        const definition = config.namespaces[name];
        if (definition == null) continue;

        const namespaceRoot = join(root, sanitizeFileCacheSegment(name));
        const version = positiveIntegerOption(`${name}.version`, definition.version ?? 1);
        const versionPurge = await purgeOldVersions(
          namespaceRoot,
          version,
          name,
          config.hooks
        );
        deleted += versionPurge.deleted;
        errors += versionPurge.errors;

        if (definition.ttlMs == null) continue;

        const handle = getNamespace(name);
        const ttlPurge = await handle.purgeExpired();
        deleted += ttlPurge.deleted;
        errors += ttlPurge.errors;
      }

      return Ok({ deleted, errors });
    },

    async stats(namespace) {
      const names = namespace == null ? Object.keys(config.namespaces) : [namespace];
      const namespaces: Record<string, FileCacheNamespaceStats> = {};

      for (const name of names) {
        const stats = await getNamespace(name).stats();
        if (isErr(stats)) return stats.asErr<FileCacheStats>();
        namespaces[name] = stats.value;
      }

      return Ok({ namespaces });
    },
  };
}

class FileCacheNamespaceHandleImpl<TKey, TValue>
  implements FileCacheNamespaceHandle<TKey, TValue>
{
  private readonly singleflight = new Singleflight();
  private readonly serializer: FileCacheSerializer;
  private readonly ttlMs: number | null;
  private readonly negativeTtlMs: number | null;
  private readonly maxEntries: number | null;
  private readonly freshness = new Map<string, { value: TValue; expiresAt: number }>();
  private readonly lruOrder = new Map<string, true>();
  private readonly counters = { hits: 0, misses: 0 };

  constructor(
    private readonly baseDir: string,
    private readonly namespace: string,
    private readonly definition: FileCacheNamespace<TKey, TValue>,
    private readonly clock: FileCacheClock,
    private readonly tempNames: FileCacheTempNames,
    private readonly hooks?: FileCacheHooks | undefined
  ) {
    this.serializer = definition.serializer ?? FileCacheJsonSerializer;
    this.ttlMs =
      definition.ttlMs == null
        ? null
        : positiveIntegerOption(`${namespace}.ttlMs`, definition.ttlMs);
    this.negativeTtlMs =
      optionalPositiveIntegerOption(
        `${namespace}.negative.ttlMs`,
        definition.negative?.ttlMs
      ) ?? null;
    this.maxEntries =
      optionalPositiveIntegerOption(`${namespace}.maxEntries`, definition.maxEntries) ?? null;
  }

  get path(): string {
    return this.baseDir;
  }

  async get(key: TKey): Promise<Result<FileCacheLookup<TValue>, FileCacheError>> {
    const resolved = this.resolveKey(key);
    if (isErr(resolved)) return resolved.asErr<FileCacheLookup<TValue>>();

    const now = this.now();
    const fresh = this.freshness.get(resolved.value.key);
    if (fresh != null && now < fresh.expiresAt) {
      this.recordHit(resolved.value.key);
      return Ok(this.hitResult(fresh.value));
    }

    const expired = await this.isExpired(resolved.value.path, now);
    if (isErr(expired)) return expired.asErr<FileCacheLookup<TValue>>();
    if (expired.value) {
      await this.deleteResolved(
        resolved.value.key,
        resolved.value.path,
        FileCacheEvictionReason.Ttl
      );
      return Ok(this.missResult(resolved.value.key));
    }

    let raw: Uint8Array;
    try {
      raw = await readFile(resolved.value.path);
    } catch (error) {
      if (isNotFoundError(error)) {
        return Ok(this.missResult(resolved.value.key));
      }
      const cacheError = this.toError(
        FileCacheErrorKind.Read,
        `Failed to read cache entry '${resolved.value.key}'`,
        resolved.value.key,
        resolved.value.path,
        error
      );
      this.hooks?.onError?.(this.namespace, cacheError, 'get');
      return Err(cacheError);
    }

    const negative = await this.readNegative(raw, resolved.value.key, resolved.value.path, now);
    if (negative === true) {
      this.recordHit(resolved.value.key);
      return Ok(this.negativeResult());
    }
    if (negative === false) return Ok(this.missResult(resolved.value.key));

    const deserialized = this.serializer.deserialize(raw);
    if (isErr(deserialized)) {
      const cacheError = this.toError(
        FileCacheErrorKind.Serialization,
        `Failed to deserialize cache entry '${resolved.value.key}'`,
        resolved.value.key,
        resolved.value.path,
        deserialized.error
      );
      this.hooks?.onError?.(this.namespace, cacheError, 'deserialize');
      await this.deleteResolved(
        resolved.value.key,
        resolved.value.path,
        FileCacheEvictionReason.Invalid
      );
      return Ok(this.missResult(resolved.value.key));
    }

    const validated = this.validateValue(deserialized.value, resolved.value.key, resolved.value.path);
    if (isErr(validated)) {
      this.hooks?.onError?.(this.namespace, validated.error, 'validate');
      await this.deleteResolved(
        resolved.value.key,
        resolved.value.path,
        FileCacheEvictionReason.Invalid
      );
      return Ok(this.missResult(resolved.value.key));
    }

    this.freshness.set(resolved.value.key, {
      value: validated.value,
      expiresAt: this.expiresAt(now),
    });
    this.recordHit(resolved.value.key);
    return Ok(this.hitResult(validated.value));
  }

  async has(key: TKey): Promise<Result<boolean, FileCacheError>> {
    const lookup = await this.get(key);
    if (isErr(lookup)) return lookup.asErr<boolean>();
    return Ok(lookup.value.hit);
  }

  async set(key: TKey, value: TValue): Promise<Result<void, FileCacheError>> {
    const resolved = this.resolveKey(key);
    if (isErr(resolved)) return resolved.asErr<void>();
    return this.writeEntry(resolved.value.key, resolved.value.path, value);
  }

  async delete(key: TKey): Promise<Result<boolean, FileCacheError>> {
    const resolved = this.resolveKey(key);
    if (isErr(resolved)) return resolved.asErr<boolean>();
    return Ok(
      await this.deleteResolved(
        resolved.value.key,
        resolved.value.path,
        FileCacheEvictionReason.Manual
      )
    );
  }

  async getMany(
    keys: readonly TKey[]
  ): Promise<Result<Map<string, TValue | null>, FileCacheError>> {
    const results = new Map<string, TValue | null>();

    for (const key of keys) {
      const resolved = this.resolveKey(key);
      if (isErr(resolved)) return resolved.asErr<Map<string, TValue | null>>();

      const lookup = await this.get(key);
      if (isErr(lookup)) return lookup.asErr<Map<string, TValue | null>>();
      results.set(resolved.value.key, lookup.value.value);
    }

    return Ok(results);
  }

  async setMany(
    entries: readonly (readonly [TKey, TValue])[]
  ): Promise<Result<void, FileCacheError>> {
    for (const [key, value] of entries) {
      const result = await this.set(key, value);
      if (isErr(result)) return result;
    }
    return Ok(undefined);
  }

  async setNegative(key: TKey): Promise<Result<void, FileCacheError>> {
    if (this.negativeTtlMs == null) {
      return Err(
        new FileCacheError(
          FileCacheErrorKind.Write,
          `Negative caching is not enabled for namespace '${this.namespace}'`,
          { namespace: this.namespace }
        )
      );
    }

    const resolved = this.resolveKey(key);
    if (isErr(resolved)) return resolved.asErr<void>();

    try {
      const now = this.now();
      await writeFileAtomic(
        resolved.value.path,
        JSON.stringify({ [NEGATIVE_SENTINEL]: true, checkedAt: now }),
        this.tempNames,
        now
      );
    } catch (error) {
      const cacheError = this.toError(
        FileCacheErrorKind.Write,
        `Failed to write negative cache entry '${resolved.value.key}'`,
        resolved.value.key,
        resolved.value.path,
        error
      );
      this.hooks?.onError?.(this.namespace, cacheError, 'setNegative');
      return Err(cacheError);
    }

    this.freshness.delete(resolved.value.key);
    this.touchLru(resolved.value.key);
    await this.evictIfNeeded();
    return Ok(undefined);
  }

  async listFilenamesUnderPrefix(prefix: string): Promise<Result<string[], FileCacheError>> {
    try {
      const segments = prefix.split('/').filter(Boolean).map(sanitizeFileCacheSegment);
      if (segments.length === 0) return Ok([]);
      const dir = join(this.baseDir, ...segments);
      const entries = await readdir(dir, { withFileTypes: true });
      return Ok(
        entries
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .sort(compareStrings)
      );
    } catch (error) {
      if (isNotFoundError(error)) return Ok([]);
      const cacheError = this.toError(
        FileCacheErrorKind.Read,
        `Failed to list cache prefix '${prefix}'`,
        prefix,
        undefined,
        error
      );
      this.hooks?.onError?.(this.namespace, cacheError, 'list');
      return Err(cacheError);
    }
  }

  async stats(): Promise<Result<FileCacheNamespaceStats, FileCacheError>> {
    try {
      const files = await listFilesRecursive(this.baseDir);
      let bytes = 0;
      for (const file of files) {
        try {
          const info = await stat(file);
          bytes += info.size;
        } catch {
          // File disappeared between list and stat.
        }
      }
      return Ok({
        hits: this.counters.hits,
        misses: this.counters.misses,
        entries: files.length,
        bytes,
      });
    } catch (error) {
      const cacheError = this.toError(
        FileCacheErrorKind.Read,
        `Failed to compute cache stats for namespace '${this.namespace}'`,
        undefined,
        this.baseDir,
        error
      );
      this.hooks?.onError?.(this.namespace, cacheError, 'stats');
      return Err(cacheError);
    }
  }

  async purgeExpired(): Promise<FileCachePurgeResult> {
    if (this.ttlMs == null) return { deleted: 0, errors: 0 };

    let deleted = 0;
    let errors = 0;
    const now = this.now();
    const files = await listFilesRecursive(this.baseDir);

    for (const file of files) {
      try {
        const info = await stat(file);
        if (now - info.mtimeMs > this.ttlMs) {
          await rm(file, { force: true });
          deleted++;
          this.hooks?.onEvict?.(
            this.namespace,
            relative(this.baseDir, file),
            FileCacheEvictionReason.Ttl
          );
        }
      } catch {
        errors++;
      }
    }

    return { deleted, errors };
  }

  private resolveKey(key: TKey): Result<{ key: string; path: string }, FileCacheError> {
    let keyString: string;
    try {
      keyString = this.definition.keyOf(key);
      return Ok({
        key: keyString,
        path: join(this.baseDir, fileCacheKeyToPath(keyString, this.serializer.extension)),
      });
    } catch (error) {
      return Err(
        this.toError(
          FileCacheErrorKind.InvalidKey,
          error instanceof Error ? error.message : `Invalid cache key: ${String(key)}`,
          undefined,
          undefined,
          error
        )
      );
    }
  }

  private async writeEntry(
    key: string,
    path: string,
    value: TValue
  ): Promise<Result<void, FileCacheError>> {
    const validated = this.validateValue(value, key, path);
    if (isErr(validated)) return validated.asErr<void>();

    const serialized = this.serializer.serialize(validated.value);
    if (isErr(serialized)) {
      const cacheError = this.toError(
        FileCacheErrorKind.Serialization,
        `Failed to serialize cache entry '${key}'`,
        key,
        path,
        serialized.error
      );
      this.hooks?.onError?.(this.namespace, cacheError, 'serialize');
      return Err(cacheError);
    }

    try {
      const now = this.now();
      await writeFileAtomic(path, serialized.value, this.tempNames, now);
      this.freshness.set(key, { value: validated.value, expiresAt: this.expiresAt(now) });
    } catch (error) {
      const cacheError = this.toError(
        FileCacheErrorKind.Write,
        `Failed to write cache entry '${key}'`,
        key,
        path,
        error
      );
      this.hooks?.onError?.(this.namespace, cacheError, 'set');
      return Err(cacheError);
    }

    this.touchLru(key);
    await this.evictIfNeeded();
    return Ok(undefined);
  }

  private validateValue(value: unknown, key: string, path: string): Result<TValue, FileCacheError> {
    if (this.definition.validate != null) {
      const validated = this.definition.validate(value);
      if (!validated.ok) {
        return Err(
          this.toError(
            FileCacheErrorKind.Validation,
            `Cache entry '${key}' failed validation`,
            key,
            path,
            validated.error
          )
        );
      }
      return Ok(validated.value);
    }

    if (this.definition.schema != null) {
      const parsed = this.definition.schema.safeParse(value);
      if (!parsed.success) {
        const issues = validationIssuesFromSafeParseError(parsed.error);
        return Err(
          new FileCacheError(
            FileCacheErrorKind.Validation,
            `Cache entry '${key}' failed validation: ${formatValidationIssues(issues)}`,
            { namespace: this.namespace, key, path, issues, cause: parsed.error }
          )
        );
      }
      return Ok(parsed.data);
    }

    return Ok(value as TValue);
  }

  private async readNegative(
    raw: Uint8Array,
    key: string,
    path: string,
    now: number
  ): Promise<boolean | null> {
    if (this.negativeTtlMs == null) return null;

    const parsed = Json.parse<{ [NEGATIVE_SENTINEL]: true; checkedAt: number }>(
      textDecoder.decode(raw)
    );
    if (!parsed.ok) return null;
    const value = parsed.value as Record<string, unknown>;
    if (value[NEGATIVE_SENTINEL] !== true || typeof value.checkedAt !== 'number') return null;

    if (now - value.checkedAt < this.negativeTtlMs) return true;

    await this.deleteResolved(key, path, FileCacheEvictionReason.Ttl);
    return false;
  }

  private async isExpired(path: string, now: number): Promise<Result<boolean, FileCacheError>> {
    if (this.ttlMs == null) return Ok(false);

    try {
      const info = await stat(path);
      return Ok(now - info.mtimeMs > this.ttlMs);
    } catch (error) {
      if (isNotFoundError(error)) return Ok(false);
      return Err(
        this.toError(
          FileCacheErrorKind.Read,
          `Failed to stat cache entry '${path}'`,
          undefined,
          path,
          error
        )
      );
    }
  }

  private hitResult(value: TValue): FileCacheLookup<TValue> {
    return {
      hit: true,
      negative: false,
      value,
      unwrapOr: () => value,
      unwrapOrElse: () => value,
      orSet: async () => Ok(value),
    };
  }

  private negativeResult(): FileCacheLookup<TValue> {
    return {
      hit: true,
      negative: true,
      value: null,
      unwrapOr: (fallback) => fallback,
      unwrapOrElse: (factory) => factory(),
      orSet: async () => Ok(null),
    };
  }

  private missResult(key: string): FileCacheLookup<TValue> {
    this.recordMiss(key);
    return {
      hit: false,
      negative: false,
      value: null,
      unwrapOr: (fallback) => fallback,
      unwrapOrElse: (factory) => factory(),
      orSet: async <E>(
        factory: () => Promise<Result<TValue, E>> | Result<TValue, E>
      ): Promise<Result<TValue | null, E | FileCacheError>> => {
        return this.singleflight.run(key, async () => {
          const result = await factory();
          if (isErr(result)) return result.asErr<TValue | null>();

          const resolved = this.resolvePathForKeyString(key);
          if (isErr(resolved)) return resolved.asErr<TValue | null>();

          const written = await this.writeEntry(key, resolved.value, result.value);
          if (isErr(written)) return written.asErr<TValue | null>();

          return Ok(result.value);
        });
      },
    };
  }

  private resolvePathForKeyString(key: string): Result<string, FileCacheError> {
    try {
      return Ok(join(this.baseDir, fileCacheKeyToPath(key, this.serializer.extension)));
    } catch (error) {
      return Err(
        this.toError(
          FileCacheErrorKind.InvalidKey,
          error instanceof Error ? error.message : `Invalid cache key: ${key}`,
          key,
          undefined,
          error
        )
      );
    }
  }

  private expiresAt(now: number): number {
    return this.ttlMs == null ? Number.POSITIVE_INFINITY : now + this.ttlMs;
  }

  private now(): number {
    const value = this.clock.now();
    if (!Number.isFinite(value)) {
      throw new Error('FileCache clock must return a finite number');
    }
    return value;
  }

  private recordHit(key: string): void {
    this.counters.hits++;
    this.touchLru(key);
    this.hooks?.onHit?.(this.namespace, key);
  }

  private recordMiss(key: string): void {
    this.counters.misses++;
    this.hooks?.onMiss?.(this.namespace, key);
  }

  private touchLru(key: string): void {
    if (this.maxEntries == null) return;
    this.lruOrder.delete(key);
    this.lruOrder.set(key, true);
  }

  private async evictIfNeeded(): Promise<void> {
    if (this.maxEntries == null) return;

    while (this.lruOrder.size > this.maxEntries) {
      const oldest = this.lruOrder.keys().next().value;
      if (oldest == null) return;
      const resolved = this.resolvePathForKeyString(oldest);
      if (isErr(resolved)) {
        this.lruOrder.delete(oldest);
        continue;
      }
      await this.deleteResolved(oldest, resolved.value, FileCacheEvictionReason.Lru);
    }
  }

  private async deleteResolved(
    key: string,
    path: string,
    reason: FileCacheEvictionReason
  ): Promise<boolean> {
    this.freshness.delete(key);
    this.lruOrder.delete(key);

    try {
      await rm(path);
      this.hooks?.onEvict?.(this.namespace, key, reason);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      return false;
    }
  }

  private toError(
    kind: FileCacheErrorKind,
    message: string,
    key?: string | undefined,
    path?: string | undefined,
    cause?: unknown
  ): FileCacheError {
    return new FileCacheError(kind, message, {
      namespace: this.namespace,
      key,
      path,
      cause,
    });
  }
}

export function fileCacheKeyToPath(key: string, extension: string): string {
  if (key.length === 0) throw new Error('Cache key must be non-empty');

  const segments = key.split('/').filter(Boolean);
  if (segments.length === 0) throw new Error('Cache key must be non-empty');

  const sanitized = segments.map(sanitizeFileCacheSegment);
  if (extension.length > 0) {
    const last = sanitized.length - 1;
    sanitized[last] = `${sanitized[last]}.${extension}`;
  }

  return join(...sanitized);
}

export function sanitizeFileCacheSegment(value: string): string {
  if (value.length === 0) throw new Error('Path segment must be non-empty');

  return value
    .replace(/\.\./g, '_')
    .replace(/[\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '_');
}

export function sortedJsonCacheKey(value: Record<string, unknown>): string {
  return Json.stableStringify(value).unwrap();
}

async function writeFileAtomic(
  path: string,
  content: string | Uint8Array,
  tempNames: FileCacheTempNames,
  mtimeMs?: number | undefined
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${sanitizeFileCacheSegment(tempNames.nextTempName())}.tmp`
  );
  try {
    if (typeof content === 'string') {
      await writeFile(tempPath, content, 'utf8');
    } else {
      await writeFile(tempPath, content);
    }
    await rename(tempPath, path);
    if (mtimeMs != null) {
      const timestamp = new Date(mtimeMs);
      await utimes(path, timestamp, timestamp);
    }
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function listFilesRecursive(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) return listFilesRecursive(path);
        if (entry.isFile()) return [path];
        return [];
      })
    );
    return nested.flat().sort(compareStrings);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

async function purgeOldVersions(
  namespaceRoot: string,
  currentVersion: number,
  namespace: string,
  hooks?: FileCacheHooks | undefined
): Promise<FileCachePurgeResult> {
  let deleted = 0;
  let errors = 0;

  let entries: Dirent[];
  try {
    entries = await readdir(namespaceRoot, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) return { deleted, errors };
    return { deleted, errors: errors + 1 };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = /^v(\d+)$/.exec(entry.name);
    if (match == null) continue;
    const version = Number(match[1]);
    if (version >= currentVersion) continue;

    try {
      await rm(join(namespaceRoot, entry.name), { recursive: true, force: true });
      deleted++;
      hooks?.onEvict?.(namespace, `${entry.name}/*`, FileCacheEvictionReason.Version);
    } catch {
      errors++;
    }
  }

  return { deleted, errors };
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
