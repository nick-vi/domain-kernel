import type {
  AuditEventQuery,
  AuditEventSearchResult,
} from '@/domain/query/audit-event-query';

export interface AuditEventQueryPort {
  search(query: AuditEventQuery): Promise<AuditEventSearchResult>;
}
