import type { AuditEvent, AuditEventType } from '@/domain/event/audit-event';
import type { EventPublisher, EventSubscriber } from '@/ports/event-publisher';

export type InMemoryEventSubscriberRegistration = {
  subscriber: EventSubscriber;
  eventTypes?: readonly AuditEventType[] | undefined;
};

export class InMemoryEventPublisher implements EventPublisher {
  private readonly published: AuditEvent[] = [];
  private readonly subscribers: InMemoryEventSubscriberRegistration[] = [];

  constructor(subscribers: readonly InMemoryEventSubscriberRegistration[] = []) {
    this.subscribers.push(...subscribers);
  }

  subscribe(registration: InMemoryEventSubscriberRegistration): void {
    this.subscribers.push(registration);
  }

  async publish(event: AuditEvent): Promise<void> {
    const clonedEvent = structuredClone(event);
    this.published.push(clonedEvent);

    for (const registration of this.subscribers) {
      if (!matchesSubscription(registration, event)) continue;
      await registration.subscriber.handle(structuredClone(event));
    }
  }

  getPublishedEvents(): AuditEvent[] {
    return this.published.map((event) => structuredClone(event));
  }
}

function matchesSubscription(
  registration: InMemoryEventSubscriberRegistration,
  event: AuditEvent
): boolean {
  return registration.eventTypes == null || registration.eventTypes.includes(event.type);
}
