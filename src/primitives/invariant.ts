import { Err, Ok, type Result } from './result';
import { parseIsoTimestamp } from './time';

export type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export class InvariantError extends Error {
  override readonly name = 'InvariantError';

  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown> | undefined
  ) {
    super(message);
  }
}

export function nonEmptyString<TBrand extends string = 'NonEmptyString'>(
  value: string,
  fieldName = 'value'
): Result<Brand<string, TBrand>, InvariantError> {
  if (value.trim().length === 0) {
    return Err(
      new InvariantError('non_empty_string', `${fieldName} must not be empty`, { fieldName })
    );
  }
  return Ok(value as Brand<string, TBrand>);
}

export function isoTimestamp<TBrand extends string = 'IsoTimestamp'>(
  value: string,
  fieldName = 'value'
): Result<Brand<string, TBrand>, InvariantError> {
  const parsed = parseIsoTimestamp(value, fieldName);
  if (!parsed.ok) {
    return Err(
      new InvariantError('iso_timestamp', `${fieldName} must be an ISO timestamp`, {
        fieldName,
        value,
      })
    );
  }
  return Ok(value as Brand<string, TBrand>);
}

export function integerAtLeast<TBrand extends string = 'Integer'>(
  value: number,
  minimum: number,
  fieldName = 'value'
): Result<Brand<number, TBrand>, InvariantError> {
  if (!Number.isInteger(value) || value < minimum) {
    return Err(
      new InvariantError('integer_at_least', `${fieldName} must be an integer >= ${minimum}`, {
        fieldName,
        value,
        minimum,
      })
    );
  }
  return Ok(value as Brand<number, TBrand>);
}
