import type { JsonObject, JsonValue } from '@/domain/shared';
import { Err, Ok, type Result } from '@/primitives/result';
import { SafeJson } from '@/primitives/safe-json';
import { JsonValueSchema } from '@/validation/schemas';
import { validateWithSchema } from '@/validation/validate';
import { CliParseError } from './errors';

export function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function parseFieldOptions(fields: string[] = []): Result<JsonObject, CliParseError> {
  const result: JsonObject = {};

  for (const field of fields) {
    const separatorIndex = field.indexOf('=');
    if (separatorIndex <= 0) {
      return Err(new CliParseError(`Field must use key=value format: ${field}`, { field }));
    }

    const key = field.slice(0, separatorIndex).trim();
    const rawValue = field.slice(separatorIndex + 1).trim();
    if (key.length === 0) {
      return Err(new CliParseError(`Field key must not be empty: ${field}`, { field }));
    }

    const parsed = parseScalar(rawValue, key);
    if (!parsed.ok) {
      return parsed.asErr<JsonObject>();
    }
    result[key] = parsed.value;
  }

  return Ok(result);
}

function parseScalar(value: string, key: string): Result<JsonValue, CliParseError> {
  if (value === 'true') return Ok(true);
  if (value === 'false') return Ok(false);
  if (value === 'null') return Ok(null);
  if (isCanonicalNumberLiteral(value)) return Ok(Number(value));

  if (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  ) {
    return SafeJson.parse<unknown>(value)
      .mapErr(
        (error) =>
          new CliParseError(`Field "${key}" is not valid JSON: ${error.message}`, {
            key,
            value,
          })
      )
      .flatMap((parsed) =>
        validateWithSchema(JsonValueSchema, parsed, `field:${key}`).mapErr(
          (error) =>
            new CliParseError(`Field "${key}" is not a supported JSON value`, {
              key,
              issues: error.issues,
            })
        )
      );
  }

  return Ok(value);
}

function isCanonicalNumberLiteral(value: string): boolean {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
}
