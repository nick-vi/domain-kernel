import { Err, Ok, type Result } from './result';

export type ValidationIssue = {
  path: string;
  message: string;
};

export class ValidationError extends Error {
  override readonly name = 'ValidationError';

  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[],
    readonly source?: string | undefined,
    options?: { cause?: unknown } | undefined
  ) {
    super(message, options);
  }
}

export type SafeParseSuccess<T> = {
  success: true;
  data: T;
};

export type SafeParseFailure = {
  success: false;
  error: unknown;
};

export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;

export type SafeParseSchema<T> = {
  safeParse(input: unknown): SafeParseResult<T>;
};

export type Validator<T, E = ValidationError> = (value: unknown) => Result<T, E>;

export type ValidateUnknownOptions<T, E = ValidationError> = {
  schema?: SafeParseSchema<T> | undefined;
  validate?: Validator<T, E> | undefined;
  source?: string | undefined;
};

export function validateUnknown<T, E = ValidationError>(
  value: unknown,
  options: ValidateUnknownOptions<T, E> = {}
): Result<T, E | ValidationError> {
  if (options.validate != null) return options.validate(value);
  if (options.schema == null) return Ok(value as T);

  const parsed = options.schema.safeParse(value);
  if (parsed.success) return Ok(parsed.data);

  const issues = validationIssuesFromSafeParseError(parsed.error);
  return Err(
    new ValidationError(
      `Validation failed${options.source != null ? ` for ${options.source}` : ''}`,
      issues,
      options.source,
      { cause: parsed.error }
    )
  );
}

export function validationIssuesFromSafeParseError(error: unknown): ValidationIssue[] {
  if (isRecord(error) && Array.isArray(error.issues)) {
    return error.issues.map((issue) => {
      if (!isRecord(issue)) return { path: '', message: String(issue) };
      return {
        path: formatIssuePath(issue.path),
        message: typeof issue.message === 'string' ? issue.message : String(issue),
      };
    });
  }

  if (error instanceof Error) {
    return [{ path: '', message: error.message }];
  }

  return [{ path: '', message: String(error) }];
}

export function formatValidationIssues(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) return 'validation failed';
  return issues.map((issue) => issue.message).join('; ');
}

function formatIssuePath(path: unknown): string {
  if (!Array.isArray(path)) return '';
  return path.map((part) => String(part)).join('.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
