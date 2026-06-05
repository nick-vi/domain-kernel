import type { AuditEvent } from '@/domain/event/audit-event';
import type { EventPublisher } from '@/ports/event-publisher';
import type { Logger } from '@/ports/logger';

export class LoggingEventPublisher implements EventPublisher {
  constructor(private readonly logger: Logger) {}

  async publish(event: AuditEvent): Promise<void> {
    this.logger.info('Audit event published', {
      eventId: event.id,
      eventType: event.type,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
    });
  }
}
