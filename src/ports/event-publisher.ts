import type { AuditEvent, AuditEventType } from '@/domain/event/audit-event';

export type EventSubscription = {
  id: string;
  eventTypes: AuditEventType[];
  handlerName: string;
};

export interface EventSubscriber {
  handle(event: AuditEvent): Promise<void>;
}

export interface EventPublisher {
  publish(event: AuditEvent): Promise<void>;
}
