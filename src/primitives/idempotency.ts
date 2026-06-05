import { Json } from './json';
import { Err, Ok, type Result } from './result';
import { isIsoTimestampAtOrBefore } from './time';

export const IdempotencyStatus = Object.freeze({
  STARTED: 'started',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const);

export type IdempotencyStatus = (typeof IdempotencyStatus)[keyof typeof IdempotencyStatus];

export type IdempotencyRecord<TResponse = unknown> = {
  key: string;
  fingerprint: string;
  status: IdempotencyStatus;
  createdAt: string;
  updatedAt: string;
  inProgressExpiresAt?: string | undefined;
  replayExpiresAt?: string | undefined;
  response?: TResponse | undefined;
  error?: string | undefined;
};

export class IdempotencyError extends Error {
  override readonly name = 'IdempotencyError';

  constructor(
    readonly code: 'key_conflict' | 'in_progress' | 'not_started' | 'replayed_failure',
    message: string
  ) {
    super(message);
  }
}

export function idempotencyFingerprint(input: unknown): string {
  return `sha256:${Json.stableContentHash(input).unwrap()}`;
}

export function startIdempotency<TResponse = unknown>(input: {
  key: string;
  fingerprint: string;
  now: string;
  inProgressExpiresAt?: string | undefined;
}): IdempotencyRecord<TResponse> {
  return {
    key: input.key,
    fingerprint: input.fingerprint,
    status: IdempotencyStatus.STARTED,
    createdAt: input.now,
    updatedAt: input.now,
    ...(input.inProgressExpiresAt != null
      ? { inProgressExpiresAt: input.inProgressExpiresAt }
      : {}),
  };
}

export function resolveIdempotency<TResponse>(
  existing: IdempotencyRecord<TResponse> | undefined,
  input: { key: string; fingerprint: string; now: string }
): Result<'start' | { replay: IdempotencyRecord<TResponse> }, IdempotencyError> {
  if (existing == null) return Ok('start');

  if (idempotencyRecordIsExpired(existing, input.now)) return Ok('start');

  if (existing.fingerprint !== input.fingerprint) {
    return Err(new IdempotencyError('key_conflict', `Idempotency key "${input.key}" was reused with a different request`));
  }

  if (existing.status === IdempotencyStatus.STARTED) {
    return Err(new IdempotencyError('in_progress', `Idempotency key "${input.key}" is already in progress`));
  }

  return Ok({ replay: existing });
}

export function markIdempotencySucceeded<TResponse>(
  record: IdempotencyRecord<TResponse>,
  input: { now: string; response: TResponse; replayExpiresAt?: string | undefined }
): IdempotencyRecord<TResponse> {
  const next = {
    ...record,
    status: IdempotencyStatus.SUCCEEDED,
    response: input.response,
    updatedAt: input.now,
  };
  delete next.error;
  delete next.inProgressExpiresAt;
  delete next.replayExpiresAt;
  if (input.replayExpiresAt != null) next.replayExpiresAt = input.replayExpiresAt;
  return next;
}

export function markIdempotencyFailed<TResponse>(
  record: IdempotencyRecord<TResponse>,
  input: { now: string; error: string; replayExpiresAt?: string | undefined }
): IdempotencyRecord<TResponse> {
  const next = {
    ...record,
    status: IdempotencyStatus.FAILED,
    error: input.error,
    updatedAt: input.now,
  };
  delete next.response;
  delete next.inProgressExpiresAt;
  delete next.replayExpiresAt;
  if (input.replayExpiresAt != null) next.replayExpiresAt = input.replayExpiresAt;
  return next;
}

export function idempotencyRecordIsExpired(
  record: IdempotencyRecord,
  now: string
): boolean {
  if (record.status === IdempotencyStatus.STARTED) {
    return (
      record.inProgressExpiresAt != null &&
      isIsoTimestampAtOrBefore(record.inProgressExpiresAt, now).unwrap()
    );
  }

  return (
    record.replayExpiresAt != null &&
    isIsoTimestampAtOrBefore(record.replayExpiresAt, now).unwrap()
  );
}
