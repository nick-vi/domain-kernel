import { IdempotencyConflictError } from '@/domain/errors/domain-error';
import { compareStrings } from '@/primitives/string';

export type IntegrationAttemptStatus = 'pending' | 'succeeded' | 'failed' | 'skipped';

export type IntegrationAttempt = {
  id: string;
  provider: string;
  operation: string;
  idempotencyKey: string;
  status: IntegrationAttemptStatus;
  eventId?: string | undefined;
  workItemId?: string | undefined;
  resourceId?: string | undefined;
  externalId?: string | undefined;
  requestHash?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationAttemptListQuery = {
  provider?: string | undefined;
  operation?: string | undefined;
  status?: IntegrationAttemptStatus | undefined;
  eventId?: string | undefined;
  workItemId?: string | undefined;
  resourceId?: string | undefined;
};

export type CreatePendingIntegrationAttemptInput = {
  id: string;
  provider: string;
  operation: string;
  idempotencyKey: string;
  eventId?: string | undefined;
  workItemId?: string | undefined;
  resourceId?: string | undefined;
  requestHash?: string | undefined;
  occurredAt: string;
};

export type MarkIntegrationAttemptSucceededInput = {
  id: string;
  externalId?: string | undefined;
  occurredAt: string;
};

export type MarkIntegrationAttemptFailedInput = {
  id: string;
  errorCode?: string | undefined;
  errorMessage: string;
  occurredAt: string;
};

export function createPendingIntegrationAttempt(
  input: CreatePendingIntegrationAttemptInput
): IntegrationAttempt {
  return {
    id: input.id,
    provider: input.provider,
    operation: input.operation,
    idempotencyKey: input.idempotencyKey,
    status: 'pending',
    ...(input.eventId != null ? { eventId: input.eventId } : {}),
    ...(input.workItemId != null ? { workItemId: input.workItemId } : {}),
    ...(input.resourceId != null ? { resourceId: input.resourceId } : {}),
    ...(input.requestHash != null ? { requestHash: input.requestHash } : {}),
    attemptCount: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
  };
}

export function createSkippedIntegrationAttempt(
  input: CreatePendingIntegrationAttemptInput,
  replayOf?: IntegrationAttempt | undefined
): IntegrationAttempt {
  return {
    ...createPendingIntegrationAttempt(input),
    status: 'skipped',
    attemptCount: 0,
    ...(replayOf?.externalId != null ? { externalId: replayOf.externalId } : {}),
  };
}

export function markIntegrationAttemptSucceeded(
  attempt: IntegrationAttempt,
  input: MarkIntegrationAttemptSucceededInput
): IntegrationAttempt {
  const { errorCode: _errorCode, errorMessage: _errorMessage, ...rest } = attempt;

  return {
    ...rest,
    status: 'succeeded',
    ...(input.externalId != null ? { externalId: input.externalId } : {}),
    updatedAt: input.occurredAt,
  };
}

export function markIntegrationAttemptFailed(
  attempt: IntegrationAttempt,
  input: MarkIntegrationAttemptFailedInput
): IntegrationAttempt {
  const { externalId: _externalId, ...rest } = attempt;

  return {
    ...rest,
    status: 'failed',
    ...(input.errorCode != null ? { errorCode: input.errorCode } : {}),
    errorMessage: input.errorMessage,
    updatedAt: input.occurredAt,
  };
}

export function buildIntegrationIdempotencyKey(input: {
  provider: string;
  operation: string;
  eventId: string;
}): string {
  return `${input.provider}:${input.operation}:${input.eventId}`;
}

export function filterIntegrationAttempts(
  attempts: readonly IntegrationAttempt[],
  query: IntegrationAttemptListQuery = {}
): IntegrationAttempt[] {
  return attempts
    .filter((attempt) => query.provider == null || attempt.provider === query.provider)
    .filter((attempt) => query.operation == null || attempt.operation === query.operation)
    .filter((attempt) => query.status == null || attempt.status === query.status)
    .filter((attempt) => query.eventId == null || attempt.eventId === query.eventId)
    .filter((attempt) => query.workItemId == null || attempt.workItemId === query.workItemId)
    .filter((attempt) => query.resourceId == null || attempt.resourceId === query.resourceId)
    .sort(compareIntegrationAttemptsByTimeline);
}

export function findIntegrationAttemptByIdempotencyKey(
  attempts: readonly IntegrationAttempt[],
  key: string
): IntegrationAttempt | null {
  return (
    attempts
      .filter((attempt) => attempt.idempotencyKey === key)
      .sort(compareIntegrationAttemptsByLookupPriority)[0] ?? null
  );
}

export function findBlockingIntegrationAttemptByIdempotencyKey(
  attempts: readonly IntegrationAttempt[],
  key: string
): IntegrationAttempt | null {
  return (
    attempts
      .filter((attempt) => attempt.idempotencyKey === key)
      .filter(isBlockingIntegrationAttempt)
      .sort(compareIntegrationAttemptsByLookupPriority)[0] ?? null
  );
}

export function compareIntegrationAttemptsByTimeline(
  left: IntegrationAttempt,
  right: IntegrationAttempt
): number {
  return compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id);
}

export function compareIntegrationAttemptsByLookupPriority(
  left: IntegrationAttempt,
  right: IntegrationAttempt
): number {
  const statusRank = integrationAttemptStatusRank(left.status) - integrationAttemptStatusRank(right.status);
  if (statusRank !== 0) return statusRank;

  return compareStrings(right.updatedAt, left.updatedAt) || compareStrings(right.id, left.id);
}

export function assertIntegrationAttemptRequestCompatible(
  existing: IntegrationAttempt,
  input: CreatePendingIntegrationAttemptInput
): void {
  if (
    existing.requestHash == null ||
    input.requestHash == null ||
    existing.requestHash === input.requestHash
  ) {
    return;
  }

  throw new IdempotencyConflictError(
    'Integration idempotency key was reused with a different request hash',
    {
      idempotencyKey: input.idempotencyKey,
      existingAttemptId: existing.id,
      existingRequestHash: existing.requestHash,
      requestHash: input.requestHash,
    }
  );
}

function isBlockingIntegrationAttempt(attempt: IntegrationAttempt): boolean {
  return attempt.status === 'succeeded' || attempt.status === 'pending';
}

function integrationAttemptStatusRank(status: IntegrationAttemptStatus): number {
  switch (status) {
    case 'succeeded':
      return 0;
    case 'pending':
      return 1;
    case 'failed':
      return 2;
    case 'skipped':
      return 3;
  }
}
