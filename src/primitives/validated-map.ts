import { Json } from './json';
import { Err, isErr, Ok, type Result } from './result';
import {
  formatValidationIssues,
  type SafeParseSchema,
  validateUnknown,
  type ValidationIssue,
  type Validator,
} from './schema';

export const ValidatedMapErrorKind = Object.freeze({
  Readonly: 'readonly',
  InvalidKey: 'invalid-key',
  InvalidValue: 'invalid-value',
  Refine: 'refine',
  Invariant: 'invariant',
  Hook: 'hook',
  Parse: 'parse',
  Load: 'load',
} as const);

export type ValidatedMapErrorKind =
  (typeof ValidatedMapErrorKind)[keyof typeof ValidatedMapErrorKind];

export class ValidatedMapError extends Error {
  override readonly name = 'ValidatedMapError';

  constructor(
    readonly kind: ValidatedMapErrorKind,
    message: string,
    readonly issues: readonly ValidationIssue[] = [],
    options?: { cause?: unknown } | undefined
  ) {
    super(message, options);
  }
}

export type ValidatedMapLookup<V> = {
  readonly value: V | undefined;
  orSet(factory: () => V): Result<V, ValidatedMapError>;
  unwrapOr<U>(fallback: U): V | U;
  unwrapOrElse<U>(factory: () => U): V | U;
};

export type ValidatedMapRefinement<K, V> = (
  key: K,
  value: V
) => true | string | ValidationIssue | readonly ValidationIssue[];

export type ValidatedMapInvariant<K, V> = (
  entries: ReadonlyMap<K, V>
) => void | true | string | ValidationIssue | readonly ValidationIssue[];

export type ValidatedMapOptions<K, V> = {
  key?: SafeParseSchema<K> | undefined;
  value?: SafeParseSchema<V> | undefined;
  validateKey?: Validator<K, unknown> | undefined;
  validateValue?: Validator<V, unknown> | undefined;
  transform?: (key: K, value: V) => unknown;
  refine?: ValidatedMapRefinement<K, V> | undefined;
  invariant?: ValidatedMapInvariant<K, V> | undefined;
  onBeforeSet?: (key: K, value: V) => boolean | void;
  onAfterSet?: (key: K, value: V) => void;
  onBeforeDelete?: (key: K) => boolean | void;
  onAfterDelete?: (key: K) => void;
};

export type ReadonlyValidatedMap<K, V> = {
  readonly size: number;
  get(key: K): ValidatedMapLookup<V>;
  has(key: K): boolean;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
  forEach(fn: (value: V, key: K) => void): void;
  toJSON(): Record<string, V>;
  toEntries(): [K, V][];
  pick(keys: readonly K[]): ValidatedMap<K, V>;
  omit(keys: readonly K[]): ValidatedMap<K, V>;
  watch(key: K, callback: (value: V | undefined) => void): () => void;
  readonly(): ReadonlyValidatedMap<K, V>;
  [Symbol.iterator](): IterableIterator<[K, V]>;
};

export class ValidatedMap<K, V> implements ReadonlyValidatedMap<K, V> {
  private readonly inner = new Map<K, V>();
  private readonly watchers = new Map<K, Set<(value: V | undefined) => void>>();
  private frozen = false;

  constructor(private readonly options: ValidatedMapOptions<K, V> = {}) {}

  get size(): number {
    return this.inner.size;
  }

  get(key: K): ValidatedMapLookup<V> {
    const value = this.inner.get(key);
    return {
      value,
      orSet: (factory) => {
        if (value !== undefined) return Ok(value);
        return this.set(key, factory());
      },
      unwrapOr: (fallback) => (value !== undefined ? value : fallback),
      unwrapOrElse: (factory) => (value !== undefined ? value : factory()),
    };
  }

  has(key: K): boolean {
    return this.inner.has(key);
  }

  keys(): IterableIterator<K> {
    return this.inner.keys();
  }

  values(): IterableIterator<V> {
    return this.inner.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this.inner.entries();
  }

  forEach(fn: (value: V, key: K) => void): void {
    this.inner.forEach(fn);
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.inner.entries();
  }

  set(key: unknown, value: unknown): Result<V, ValidatedMapError> {
    if (this.frozen) {
      return Err(
        new ValidatedMapError(ValidatedMapErrorKind.Readonly, 'Map is readonly', [
          { path: '', message: 'Cannot set on a readonly map' },
        ])
      );
    }

    const validKey = this.validateKey(key);
    if (isErr(validKey)) return validKey.asErr<V>();

    const transformed =
      this.options.transform == null
        ? value
        : this.options.transform(validKey.value, value as V);

    const validValue = this.validateValue(transformed);
    if (isErr(validValue)) return validValue.asErr<V>();

    const refined = this.runRefinement(validKey.value, validValue.value);
    if (isErr(refined)) return refined.asErr<V>();

    const invariant = this.runInvariant(validKey.value, validValue.value);
    if (isErr(invariant)) return invariant.asErr<V>();

    if (this.options.onBeforeSet?.(validKey.value, validValue.value) === false) {
      return Err(
        new ValidatedMapError(ValidatedMapErrorKind.Hook, 'Rejected by onBeforeSet', [
          { path: '', message: 'onBeforeSet returned false' },
        ])
      );
    }

    this.inner.set(validKey.value, validValue.value);
    this.options.onAfterSet?.(validKey.value, validValue.value);
    this.notifyWatchers(validKey.value, validValue.value);

    return Ok(validValue.value);
  }

  delete(key: K): boolean {
    if (this.frozen) return false;
    if (!this.inner.has(key)) return false;
    if (this.options.onBeforeDelete?.(key) === false) return false;

    const deleted = this.inner.delete(key);
    if (deleted) {
      this.options.onAfterDelete?.(key);
      this.notifyWatchers(key, undefined);
    }
    return deleted;
  }

  clear(): void {
    if (this.frozen) return;
    const keys = [...this.inner.keys()];
    this.inner.clear();
    for (const key of keys) {
      this.notifyWatchers(key, undefined);
    }
  }

  load(record: Record<string, unknown>): Result<number, ValidatedMapError[]> {
    return this.loadEntries(Object.entries(record));
  }

  loadEntries(entries: Iterable<readonly [unknown, unknown]>): Result<number, ValidatedMapError[]> {
    const errors: ValidatedMapError[] = [];
    let count = 0;

    for (const [key, value] of entries) {
      const result = this.set(key, value);
      if (result.ok) {
        count++;
      } else {
        errors.push(result.error);
      }
    }

    if (errors.length > 0) return Err(errors);
    return Ok(count);
  }

  merge(other: ReadonlyValidatedMap<K, V> | ReadonlyMap<K, V>): Result<number, ValidatedMapError[]> {
    return this.loadEntries(other.entries());
  }

  toJSON(): Record<string, V> {
    const out: Record<string, V> = {};
    for (const [key, value] of this.inner) {
      out[String(key)] = value;
    }
    return out;
  }

  toEntries(): [K, V][] {
    return [...this.inner.entries()];
  }

  pick(keys: readonly K[]): ValidatedMap<K, V> {
    const picked = new ValidatedMap(this.options);
    const keySet = new Set(keys);
    for (const [key, value] of this.inner) {
      if (keySet.has(key)) {
        picked.inner.set(key, value);
      }
    }
    return picked;
  }

  omit(keys: readonly K[]): ValidatedMap<K, V> {
    const omitted = new ValidatedMap(this.options);
    const keySet = new Set(keys);
    for (const [key, value] of this.inner) {
      if (!keySet.has(key)) {
        omitted.inner.set(key, value);
      }
    }
    return omitted;
  }

  watch(key: K, callback: (value: V | undefined) => void): () => void {
    let watchers = this.watchers.get(key);
    if (watchers == null) {
      watchers = new Set();
      this.watchers.set(key, watchers);
    }
    watchers.add(callback);

    return () => {
      watchers?.delete(callback);
      if (watchers?.size === 0) this.watchers.delete(key);
    };
  }

  readonly(): ReadonlyValidatedMap<K, V> {
    const clone = new ValidatedMap(this.options);
    for (const [key, value] of this.inner) {
      clone.inner.set(key, value);
    }
    clone.frozen = true;
    return clone;
  }

  private validateKey(value: unknown): Result<K, ValidatedMapError> {
    const result = validateUnknown<K, unknown>(value, {
      schema: this.options.key,
      validate: this.options.validateKey,
      source: 'map key',
    });
    if (result.ok) return Ok(result.value);
    return Err(
      validationFailureToMapError(
        ValidatedMapErrorKind.InvalidKey,
        'Invalid map key',
        result.error
      )
    );
  }

  private validateValue(value: unknown): Result<V, ValidatedMapError> {
    const result = validateUnknown<V, unknown>(value, {
      schema: this.options.value,
      validate: this.options.validateValue,
      source: 'map value',
    });
    if (result.ok) return Ok(result.value);
    return Err(
      validationFailureToMapError(
        ValidatedMapErrorKind.InvalidValue,
        'Invalid map value',
        result.error
      )
    );
  }

  private runRefinement(key: K, value: V): Result<void, ValidatedMapError> {
    if (this.options.refine == null) return Ok(undefined);
    return issueLikeToResult(
      ValidatedMapErrorKind.Refine,
      'Map refinement failed',
      this.options.refine(key, value)
    );
  }

  private runInvariant(key: K, value: V): Result<void, ValidatedMapError> {
    if (this.options.invariant == null) return Ok(undefined);
    const tentative = new Map(this.inner);
    tentative.set(key, value);
    return issueLikeToResult(
      ValidatedMapErrorKind.Invariant,
      'Map invariant failed',
      this.options.invariant(tentative)
    );
  }

  private notifyWatchers(key: K, value: V | undefined): void {
    const watchers = this.watchers.get(key);
    if (watchers == null) return;
    for (const watcher of watchers) {
      watcher(value);
    }
  }

  static fromJSON<K, V>(
    input: string,
    options: ValidatedMapOptions<K, V> = {}
  ): Result<ValidatedMap<K, V>, ValidatedMapError> {
    const parsed = Json.parse(input);
    if (!parsed.ok) {
      return Err(
        new ValidatedMapError(ValidatedMapErrorKind.Parse, 'Invalid map JSON', [
          { path: '', message: parsed.error.message },
        ])
      );
    }

    if (
      typeof parsed.value !== 'object' ||
      parsed.value === null ||
      Array.isArray(parsed.value)
    ) {
      return Err(
        new ValidatedMapError(ValidatedMapErrorKind.Parse, 'Expected map JSON object', [
          { path: '', message: 'Input must be a JSON object' },
        ])
      );
    }

    const map = new ValidatedMap<K, V>(options);
    const loaded = map.load(parsed.value as Record<string, unknown>);
    if (!loaded.ok) {
      return Err(
        new ValidatedMapError(
          ValidatedMapErrorKind.Load,
          `Failed to load ${loaded.error.length} map entries`,
          loaded.error.flatMap((error) => error.issues),
          { cause: loaded.error }
        )
      );
    }

    return Ok(map);
  }
}

export function createValidatedMap<K, V>(
  options: ValidatedMapOptions<K, V> = {}
): ValidatedMap<K, V> {
  return new ValidatedMap(options);
}

function validationFailureToMapError(
  kind: ValidatedMapErrorKind,
  fallbackMessage: string,
  error: unknown
): ValidatedMapError {
  if (error instanceof Error && 'issues' in error && Array.isArray(error.issues)) {
    const issues = error.issues as ValidationIssue[];
    return new ValidatedMapError(kind, `${fallbackMessage}: ${formatValidationIssues(issues)}`, issues, {
      cause: error,
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ValidatedMapError(kind, `${fallbackMessage}: ${message}`, [{ path: '', message }], {
    cause: error,
  });
}

function issueLikeToResult(
  kind: ValidatedMapErrorKind,
  fallbackMessage: string,
  value: void | true | string | ValidationIssue | readonly ValidationIssue[]
): Result<void, ValidatedMapError> {
  if (value === undefined || value === true) return Ok(undefined);

  const issues = normalizeIssues(value);
  return Err(
    new ValidatedMapError(kind, `${fallbackMessage}: ${formatValidationIssues(issues)}`, issues)
  );
}

function normalizeIssues(value: string | ValidationIssue | readonly ValidationIssue[]): ValidationIssue[] {
  if (typeof value === 'string') return [{ path: '', message: value }];
  if (isValidationIssueArray(value)) {
    return value.length > 0 ? [...value] : [{ path: '', message: 'failed' }];
  }
  return [value as ValidationIssue];
}

function isValidationIssueArray(value: unknown): value is readonly ValidationIssue[] {
  return Array.isArray(value);
}
