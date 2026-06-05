export type DomainErrorCode =
  | 'INVALID_WORKFLOW_DEFINITION'
  | 'INVALID_TRANSITION'
  | 'WORK_ITEM_CLOSED'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'POLICY_DENIED'
  | 'VERSION_CONFLICT'
  | 'EVENT_STREAM_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_IN_PROGRESS';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export class InvalidWorkflowDefinitionError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_WORKFLOW_DEFINITION', message, details);
    this.name = 'InvalidWorkflowDefinitionError';
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_TRANSITION', message, details);
    this.name = 'InvalidTransitionError';
  }
}

export class WorkItemClosedError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('WORK_ITEM_CLOSED', message, details);
    this.name = 'WorkItemClosedError';
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('NOT_FOUND', message, details);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('UNAUTHORIZED', message, details);
    this.name = 'UnauthorizedError';
  }
}

export class PolicyDeniedError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('POLICY_DENIED', message, details);
    this.name = 'PolicyDeniedError';
  }
}

export class VersionConflictError extends DomainError {
  constructor(expectedVersion: number, actualVersion: number, details?: Record<string, unknown>) {
    super('VERSION_CONFLICT', 'Work item version conflict', {
      expectedVersion,
      actualVersion,
      ...details,
    });
    this.name = 'VersionConflictError';
  }
}

export class EventStreamConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('EVENT_STREAM_CONFLICT', message, details);
    this.name = 'EventStreamConflictError';
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('IDEMPOTENCY_CONFLICT', message, details);
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotencyInProgressError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('IDEMPOTENCY_IN_PROGRESS', message, details);
    this.name = 'IdempotencyInProgressError';
  }
}
