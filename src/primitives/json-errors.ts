import type { ValidationIssue } from './schema';

export class JsonError extends Error {
  override readonly name: string = 'JsonError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class JsonSyntaxError extends JsonError {
  override readonly name = 'JsonSyntaxError';

  constructor(
    message: string,
    readonly input: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
  }
}

export class JsonSerializeError extends JsonError {
  override readonly name = 'JsonSerializeError';

  constructor(
    message: string,
    readonly value: unknown,
    options?: { cause?: unknown }
  ) {
    super(message, options);
  }
}

export class JsonSerializableError extends JsonError {
  override readonly name = 'JsonSerializableError';

  constructor(
    message: string,
    readonly value: unknown,
    readonly path: string
  ) {
    super(message);
  }
}

export type JsonValidationIssue = ValidationIssue;

export class JsonValidationError extends JsonError {
  override readonly name = 'JsonValidationError';

  constructor(
    message: string,
    readonly value: unknown,
    readonly issues: JsonValidationIssue[]
  ) {
    super(message);
  }
}
