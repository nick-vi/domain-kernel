import { JsonSerializeError, JsonSyntaxError } from './json-errors';
import { Json } from './json';
import { Err, Ok, type Result } from './result';

export const SafeJson = {
  parse<T = unknown>(input: string): Result<T, JsonSyntaxError> {
    try {
      return Ok(JSON.parse(input) as T);
    } catch (error) {
      return Err(
        new JsonSyntaxError(error instanceof Error ? error.message : 'Invalid JSON', input, {
          cause: error,
        })
      );
    }
  },

  stringify(value: unknown, space?: number): Result<string, JsonSerializeError> {
    return Json.stringify(value, space);
  },
};
