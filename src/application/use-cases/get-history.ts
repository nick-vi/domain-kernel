import type { Actor } from '@/domain/auth/auth';
import type { AuditEvent } from '@/domain/event/audit-event';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';

export type GetHistoryInput = {
  workItemId: string;
  actor: Actor;
};

export async function getHistoryUseCase(
  deps: ApplicationDependencies,
  input: GetHistoryInput
): Promise<AuditEvent[]> {
  return deps.tracer.span('getHistory', { workItemId: input.workItemId }, async () => {
    authorize(deps, input.actor, 'history:read');
    return deps.events.getByWorkItemId(input.workItemId);
  });
}
