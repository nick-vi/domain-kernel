import type { JsonPrimitive, JsonValue } from './json-value';

export const PROBLEM_DETAILS_JSON = 'application/problem+json';
export const ABOUT_BLANK_PROBLEM_TYPE = 'about:blank';

export type ProblemDetailsJsonPrimitive = JsonPrimitive;
export type ProblemDetailsJsonValue = JsonValue;

export type ProblemDetailsExtensions = Record<string, ProblemDetailsJsonValue>;

export type ProblemDetails = {
  type: string;
  title: string;
  status?: number | undefined;
  detail?: string | undefined;
  instance?: string | undefined;
} & ProblemDetailsExtensions;

export type ProblemDetailsInput = {
  type?: string | undefined;
  title: string;
  status?: number | undefined;
  detail?: string | undefined;
  instance?: string | undefined;
  extensions?: ProblemDetailsExtensions | undefined;
};

const RESERVED_MEMBERS = new Set(['type', 'title', 'status', 'detail', 'instance']);

export class ProblemDetailsError extends Error {
  override readonly name = 'ProblemDetailsError';
}

export function problemDetails(input: ProblemDetailsInput): ProblemDetails {
  assertProblemTitle(input.title);
  if (input.status != null) assertHttpStatus(input.status);
  if (input.extensions != null) assertExtensionMembers(input.extensions);

  return {
    type: input.type ?? ABOUT_BLANK_PROBLEM_TYPE,
    title: input.title,
    ...(input.status != null ? { status: input.status } : {}),
    ...(input.detail != null ? { detail: input.detail } : {}),
    ...(input.instance != null ? { instance: input.instance } : {}),
    ...(input.extensions ?? {}),
  };
}

export function problemFromError(
  error: unknown,
  input: Omit<ProblemDetailsInput, 'title' | 'detail'> & {
    title?: string | undefined;
    includeStack?: boolean | undefined;
  } = {}
): ProblemDetails {
  const normalized = normalizeError(error);
  const extensions: ProblemDetailsExtensions = {
    ...(input.extensions ?? {}),
    errorName: normalized.name,
  };

  if (input.includeStack === true && normalized.stack != null) {
    extensions.stack = normalized.stack;
  }

  return problemDetails({
    type: input.type,
    title: input.title ?? normalized.name,
    status: input.status,
    detail: normalized.message,
    instance: input.instance,
    extensions,
  });
}

export function isProblemDetails(value: unknown): value is ProblemDetails {
  if (!isRecord(value)) return false;
  if (typeof value.type !== 'string' || value.type.trim().length === 0) return false;
  if (typeof value.title !== 'string' || value.title.trim().length === 0) return false;
  if (value.status != null && !isHttpStatus(value.status)) return false;
  if (value.detail != null && typeof value.detail !== 'string') return false;
  if (value.instance != null && typeof value.instance !== 'string') return false;
  return true;
}

export function problemDetailsBody(problem: ProblemDetails): {
  contentType: typeof PROBLEM_DETAILS_JSON;
  body: ProblemDetails;
} {
  return {
    contentType: PROBLEM_DETAILS_JSON,
    body: problem,
  };
}

function assertProblemTitle(title: string): void {
  if (title.trim().length === 0) {
    throw new ProblemDetailsError('Problem title must not be empty');
  }
}

function assertHttpStatus(status: number): void {
  if (!isHttpStatus(status)) {
    throw new ProblemDetailsError('Problem status must be an integer HTTP status code');
  }
}

function assertExtensionMembers(extensions: ProblemDetailsExtensions): void {
  for (const key of Object.keys(extensions)) {
    if (RESERVED_MEMBERS.has(key)) {
      throw new ProblemDetailsError(`Problem extension "${key}" conflicts with a reserved member`);
    }
    if (!/^[A-Za-z][A-Za-z0-9_]{2,}$/.test(key)) {
      throw new ProblemDetailsError(
        `Problem extension "${key}" must start with a letter and contain at least three letters, digits, or underscores`
      );
    }
  }
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599;
}

function normalizeError(error: unknown): { name: string; message: string; stack?: string | undefined } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack != null ? { stack: error.stack } : {}),
    };
  }

  if (isRecord(error)) {
    return {
      name: typeof error.name === 'string' ? error.name : 'Error',
      message: typeof error.message === 'string' ? error.message : String(error),
    };
  }

  return {
    name: 'Error',
    message: String(error),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
