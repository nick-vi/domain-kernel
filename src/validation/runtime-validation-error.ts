import {
  type ValidationIssue,
  validationIssuesFromSafeParseError,
} from '@/primitives/schema';

export type RuntimeValidationIssue = {
  path: string;
  message: string;
  code: string;
};

export class RuntimeValidationError extends Error {
  override readonly name = 'RuntimeValidationError';
  readonly issues: RuntimeValidationIssue[];
  readonly source: string | undefined;

  constructor(message: string, issues: RuntimeValidationIssue[], source?: string) {
    super(message);
    this.issues = issues;
    this.source = source;
  }
}

export function validationIssuesToRuntimeIssues(
  issues: readonly ValidationIssue[]
): RuntimeValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path || '<root>',
    message: issue.message,
    code: 'invalid',
  }));
}

export function safeParseErrorToRuntimeIssues(error: unknown): RuntimeValidationIssue[] {
  return validationIssuesToRuntimeIssues(validationIssuesFromSafeParseError(error));
}

export const zodIssuesToRuntimeIssues = safeParseErrorToRuntimeIssues;
