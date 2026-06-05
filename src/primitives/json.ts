import {
  JsonSerializeError,
  JsonSerializableError,
  JsonSyntaxError,
  JsonValidationError,
  type JsonValidationIssue,
} from './json-errors';
import { computeContentHash } from './hash';
import { Err, Ok, type Result } from './result';
import {
  formatValidationIssues,
  type SafeParseSchema,
  validationIssuesFromSafeParseError,
} from './schema';

export type JsonParseOptions<T = unknown> = {
  schema?: SafeParseSchema<T> | undefined;
  unwrapEncoded?: boolean | undefined;
};

export const Json = {
  parse<T = unknown>(
    input: string,
    options: JsonParseOptions<T> = {}
  ): Result<T, JsonSyntaxError | JsonValidationError> {
    let parsed: Result<unknown, JsonSyntaxError>;
    try {
      parsed = Ok(JSON.parse(input));
    } catch (error) {
      parsed = Err(
        new JsonSyntaxError(error instanceof Error ? error.message : 'Invalid JSON', input, {
          cause: error,
        })
      );
    }

    if (!parsed.ok) return parsed.asErr<T>();

    const value = options.unwrapEncoded === true ? unwrapDoubleEncoded(parsed.value) : parsed.value;
    if (options.schema == null) return Ok(value as T);

    const validated = options.schema.safeParse(value);
    if (validated.success) return Ok(validated.data);

    const issues: JsonValidationIssue[] = validationIssuesFromSafeParseError(validated.error);

    return Err(
      new JsonValidationError(
        `Schema validation failed: ${formatValidationIssues(issues)}`,
        value,
        issues
      )
    );
  },

  stringify(value: unknown, space?: number): Result<string, JsonSerializeError> {
    try {
      Json.assertSerializable(value);
      const serialized = JSON.stringify(value, null, space);
      if (typeof serialized === 'string') return Ok(serialized);
      return Err(new JsonSerializeError('JSON serialization produced no output', value));
    } catch (error) {
      return Err(
        new JsonSerializeError(
          error instanceof Error ? error.message : 'JSON serialization failed',
          value,
          { cause: error }
        )
      );
    }
  },

  stableStringify(value: unknown): Result<string, JsonSerializeError> {
    try {
      Json.assertSerializable(value);
      return Ok(stableSerializeJsonValue(value));
    } catch (error) {
      return Err(
        new JsonSerializeError(
          error instanceof Error ? error.message : 'Stable JSON serialization failed',
          value,
          { cause: error }
        )
      );
    }
  },

  stableContentHash(value: unknown): Result<string, JsonSerializeError> {
    return Json.stableStringify(value).map((serialized) => computeContentHash(serialized));
  },

  assertSerializable(value: unknown, source = 'value'): void {
    assertJsonSerializable(value, source, new Set<object>());
  },

  isSerializable(value: unknown): boolean {
    try {
      assertJsonSerializable(value, 'value', new Set<object>());
      return true;
    } catch {
      return false;
    }
  },

  sort: sortJsonValue,
  unwrapEncoded: unwrapDoubleEncoded,
};

function assertJsonSerializable(
  value: unknown,
  path: string,
  seen: Set<object>
): void {
  if (value === null) return;

  switch (typeof value) {
    case 'string':
      assertJsonString(value, path);
      return;
    case 'boolean':
      return;
    case 'number':
      if (Number.isFinite(value)) return;
      throw new JsonSerializableError(`JSON value at "${path}" must be a finite number`, value, path);
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new JsonSerializableError(
        `JSON value at "${path}" is not serializable`,
        value,
        path
      );
    case 'object':
      break;
  }

  if (seen.has(value)) {
    throw new JsonSerializableError(`JSON value at "${path}" contains a cycle`, value, path);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertJsonSerializable(item, `${path}[${index}]`, seen);
    }
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new JsonSerializableError(
      `JSON value at "${path}" must be a plain object`,
      value,
      path
    );
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    assertJsonSerializable(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function tryParseJsonObject(value: string): object | null {
  for (let trim = 0; trim <= 3; trim++) {
    try {
      const candidate = trim === 0 ? value : value.slice(0, -trim);
      const parsed = JSON.parse(candidate);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      // Try the next trim level.
    }
  }
  return null;
}

function unwrapDoubleEncoded(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = tryParseJsonObject(value);
      if (parsed !== null) return unwrapDoubleEncoded(parsed);
    }
    return value;
  }

  if (Array.isArray(value)) return value.map(unwrapDoubleEncoded);

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      result[key] = unwrapDoubleEncoded(entryValue);
    }
    return result;
  }

  return value;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJsonValue(item));
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareJsonKeys(left, right))
      .map(([key, entryValue]) => [key, sortJsonValue(entryValue)])
  );
}

function stableSerializeJsonValue(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean': {
      const serialized = JSON.stringify(value);
      if (typeof serialized === 'string') return serialized;
      throw new JsonSerializableError('JSON serialization produced no output', value, 'value');
    }
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new JsonSerializableError('JSON value is not serializable', value, 'value');
    case 'object':
      break;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerializeJsonValue(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort(compareJsonKeys)
    .map((key) => `${stableSerializeJsonValue(key)}:${stableSerializeJsonValue(record[key])}`);

  return `{${entries.join(',')}}`;
}

function compareJsonKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertJsonString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      throw new JsonSerializableError(
        `JSON string at "${path}" contains an unpaired surrogate`,
        value,
        path
      );
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new JsonSerializableError(
        `JSON string at "${path}" contains an unpaired surrogate`,
        value,
        path
      );
    }
  }
}
