import type { AuditEvent } from '@/domain/event/audit-event';
import type { EventPublisher } from '@/ports/event-publisher';

export class NoopEventPublisher implements EventPublisher {
  async publish(_event: AuditEvent): Promise<void> {}
}
