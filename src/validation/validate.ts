import { Err, Ok, type Result } from '@/primitives/result';
import {
  type SafeParseSchema,
  validationIssuesFromSafeParseError,
} from '@/primitives/schema';
import {
  RuntimeValidationError,
  validationIssuesToRuntimeIssues,
} from './runtime-validation-error';

export function validateWithSchema<T>(
  schema: SafeParseSchema<T>,
  value: unknown,
  source = 'value'
): Result<T, RuntimeValidationError> {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return Ok(parsed.data);
  }

  const issues = validationIssuesToRuntimeIssues(validationIssuesFromSafeParseError(parsed.error));
  return Err(new RuntimeValidationError(`Runtime validation failed for ${source}`, issues, source));
}
