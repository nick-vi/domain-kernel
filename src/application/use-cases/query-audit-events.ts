import type { Actor } from '@/domain/auth/auth';
import type {
  AuditEventQuery,
  AuditEventSearchResult,
} from '@/domain/query/audit-event-query';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';

export type QueryAuditEventsInput = {
  actor: Actor;
  query: AuditEventQuery;
};

export async function queryAuditEventsUseCase(
  deps: ApplicationDependencies,
  input: QueryAuditEventsInput
): Promise<AuditEventSearchResult> {
  return deps.tracer.span('queryAuditEvents', input.query, async () => {
    authorize(deps, input.actor, 'event:query');
    return deps.eventQueries.search(input.query);
  });
}
