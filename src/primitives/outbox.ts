import type { EventEnvelope } from './event-envelope';
import {
  optionalPositiveIntegerOption,
  positiveIntegerOption,
} from './runtime-options';
import { isIsoTimestampAtOrBefore } from './time';

export const OutboxStatus = Object.freeze({
  PENDING: 'pending',
  PUBLISHING: 'publishing',
  PUBLISHED: 'published',
  FAILED: 'failed',
  DEAD: 'dead',
} as const);

export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

export type OutboxMessage<TData = unknown> = {
  id: string;
  event: EventEnvelope<TData>;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  publishedAt?: string | undefined;
  lastError?: string | undefined;
};

export function createOutboxMessage<TData>(input: {
  id: string;
  event: EventEnvelope<TData>;
  now: string;
  availableAt?: string | undefined;
}): OutboxMessage<TData> {
  return {
    id: input.id,
    event: input.event,
    status: OutboxStatus.PENDING,
    attempts: 0,
    createdAt: input.now,
    updatedAt: input.now,
    availableAt: input.availableAt ?? input.now,
  };
}

export function markOutboxPublishing<TData>(
  message: OutboxMessage<TData>,
  now: string
): OutboxMessage<TData> {
  return {
    ...message,
    status: OutboxStatus.PUBLISHING,
    updatedAt: now,
  };
}

export function markOutboxPublished<TData>(
  message: OutboxMessage<TData>,
  now: string
): OutboxMessage<TData> {
  return {
    ...message,
    status: OutboxStatus.PUBLISHED,
    updatedAt: now,
    publishedAt: now,
    lastError: undefined,
  };
}

export function markOutboxFailed<TData>(
  message: OutboxMessage<TData>,
  input: {
    now: string;
    error: string;
    retryAt?: string | undefined;
    maxAttempts?: number | undefined;
  }
): OutboxMessage<TData> {
  const attempts = message.attempts + 1;
  const maxAttempts = optionalPositiveIntegerOption('maxAttempts', input.maxAttempts);
  const dead = maxAttempts != null && attempts >= maxAttempts;
  return {
    ...message,
    attempts,
    status: dead ? OutboxStatus.DEAD : OutboxStatus.FAILED,
    updatedAt: input.now,
    availableAt: input.retryAt ?? input.now,
    lastError: input.error,
  };
}

export function outboxMessageIsDue(message: OutboxMessage, now: string): boolean {
  return (
    (message.status === OutboxStatus.PENDING || message.status === OutboxStatus.FAILED) &&
    isIsoTimestampAtOrBefore(message.availableAt, now).unwrap()
  );
}

export function claimDueOutboxMessages<TData>(
  messages: readonly OutboxMessage<TData>[],
  now: string,
  limit?: number | undefined
): OutboxMessage<TData>[] {
  const resolvedLimit = limit == null ? messages.length : positiveIntegerOption('limit', limit);
  return messages
    .filter((message) => outboxMessageIsDue(message, now))
    .slice(0, resolvedLimit)
    .map((message) => markOutboxPublishing(message, now));
}
