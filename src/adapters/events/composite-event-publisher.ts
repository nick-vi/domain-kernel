import type { AuditEvent } from '@/domain/event/audit-event';
import type { EventPublisher } from '@/ports/event-publisher';

export class CompositeEventPublisher implements EventPublisher {
  constructor(private readonly publishers: readonly EventPublisher[]) {}

  async publish(event: AuditEvent): Promise<void> {
    for (const publisher of this.publishers) {
      await publisher.publish(event);
    }
  }
}
