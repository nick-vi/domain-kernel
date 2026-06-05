import type { ApplicationDependencies } from '@/application/dependencies';
import type { EventPublisher } from '@/ports/event-publisher';
import type { OutboxPublisher } from '@/ports/outbox-publisher';
import type { OutboxMessage } from '@/primitives/outbox';
import { markOutboxFailed, markOutboxPublished } from '@/primitives/outbox';
import {
  optionalNonNegativeIntegerOption,
  optionalPositiveIntegerOption,
} from '@/primitives/runtime-options';
import { addMillisecondsToIsoTimestamp } from '@/primitives/time';
import { AuditEventSchema } from '@/validation/schemas';

export type OutboxWorkerOptions = {
  limit?: number | undefined;
  maxAttempts?: number | undefined;
  retryDelayMs?: number | undefined;
};

export type OutboxWorkerResult = {
  claimed: number;
  published: number;
  failed: number;
  dead: number;
};

export async function runOutboxWorker(
  deps: Pick<ApplicationDependencies, 'outbox' | 'clock' | 'logger'>,
  publisher: OutboxPublisher,
  options: OutboxWorkerOptions = {}
): Promise<OutboxWorkerResult> {
  const limit = optionalPositiveIntegerOption('limit', options.limit);
  const maxAttempts = optionalPositiveIntegerOption('maxAttempts', options.maxAttempts);
  const retryDelayMs = optionalNonNegativeIntegerOption(
    'retryDelayMs',
    options.retryDelayMs
  );
  const now = deps.clock.now();
  const messages = await deps.outbox.claimDue({ now, limit });
  const result: OutboxWorkerResult = {
    claimed: messages.length,
    published: 0,
    failed: 0,
    dead: 0,
  };

  for (const message of messages) {
    try {
      await publisher.publish(message);
      await deps.outbox.save(markOutboxPublished(message, deps.clock.now()));
      result.published++;
    } catch (error) {
      const failedAt = deps.clock.now();
      const failed = markOutboxFailed(message, {
        now: failedAt,
        error: error instanceof Error ? error.message : String(error),
        ...(retryDelayMs != null ? { retryAt: addMilliseconds(failedAt, retryDelayMs) } : {}),
        maxAttempts,
      });
      await deps.outbox.save(failed);
      if (failed.status === 'dead') {
        result.dead++;
      } else {
        result.failed++;
      }
      deps.logger.warn('Outbox message publishing failed', {
        messageId: message.id,
        eventType: message.event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export async function runAuditOutboxWorker(
  deps: ApplicationDependencies,
  options: OutboxWorkerOptions = {}
): Promise<OutboxWorkerResult> {
  return runOutboxWorker(deps, auditOutboxPublisher(deps.eventPublisher), options);
}

export function auditOutboxPublisher(eventPublisher: EventPublisher): OutboxPublisher {
  return {
    async publish(message: OutboxMessage): Promise<void> {
      const event = AuditEventSchema.safeParse(message.event.data);
      if (!event.success) {
        throw new Error(`Outbox message "${message.id}" does not contain an audit event`);
      }
      await eventPublisher.publish(event.data);
    },
  };
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return addMillisecondsToIsoTimestamp(timestamp, milliseconds).unwrap();
}
