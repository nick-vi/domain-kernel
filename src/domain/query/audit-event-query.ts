import type { AuditEvent, AuditEventType } from '@/domain/event/audit-event';

export type AuditEventSort = 'occurred_at_desc' | 'occurred_at_asc';

export type AuditEventQuery = {
  workItemId?: string | undefined;
  type?: AuditEventType | undefined;
  actorId?: string | undefined;
  occurredAfter?: string | undefined;
  occurredBefore?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sort?: AuditEventSort | undefined;
};

export type AuditEventSearchResult = {
  events: AuditEvent[];
  total: number;
  offset: number;
  limit: number;
};
