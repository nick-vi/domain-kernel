import type { ApplicationDependencies } from '@/application/dependencies';
import type { AuditEvent } from '@/domain/event/audit-event';
import { eventEnvelope } from '@/primitives/event-envelope';
import {
  createOutboxMessage,
  type OutboxMessage,
} from '@/primitives/outbox';

export async function recordAuditEvent(
  deps: ApplicationDependencies,
  event: AuditEvent
): Promise<void> {
  await deps.events.append(event);
  await deps.outbox.save(createAuditOutboxMessage(event));
}

function createAuditOutboxMessage(event: AuditEvent): OutboxMessage<AuditEvent> {
  return createOutboxMessage({
    id: `audit:${event.id}`,
    event: eventEnvelope({
      id: event.id,
      source: auditEventSource(event),
      type: `domain.audit.${event.type}`,
      time: event.occurredAt,
      datacontenttype: 'application/json',
      data: event,
      actorId: event.actorId,
    }),
    now: event.occurredAt,
  });
}

function auditEventSource(event: AuditEvent): string {
  if ('workItemId' in event) return `/work-items/${event.workItemId}`;
  if ('resourceId' in event) return `/resources/${event.resourceId}`;
  return '/audit';
}
