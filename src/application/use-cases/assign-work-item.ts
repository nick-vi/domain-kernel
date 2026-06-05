import { NotFoundError } from '@/domain/errors/domain-error';
import type { WorkItemAssignedEvent } from '@/domain/event/audit-event';
import { assignWorkItem, type WorkItem } from '@/domain/work-item/work-item';
import type { Actor } from '@/domain/auth/auth';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';
import { recordAuditEvent } from '@/application/audit';
import { assertExpectedVersion } from '@/application/versioning';
import { getWorkflowOrThrow } from './workflow-cache';

export type AssignWorkItemInput = {
  workItemId: string;
  assigneeId: string;
  expectedVersion?: number | undefined;
  actor: Actor;
};

export async function assignWorkItemUseCase(
  deps: ApplicationDependencies,
  input: AssignWorkItemInput
): Promise<WorkItem> {
  return deps.tracer.span(
    'assignWorkItem',
    { workItemId: input.workItemId, assigneeId: input.assigneeId },
    async () => {
      authorize(deps, input.actor, 'work:assign');
      const current = await deps.workItems.getById(input.workItemId);
      if (current == null) {
        throw new NotFoundError(`Work item "${input.workItemId}" was not found`, {
          workItemId: input.workItemId,
        });
      }
      assertExpectedVersion(current, input.expectedVersion);

      const workflow = await getWorkflowOrThrow(deps, current.type);
      const occurredAt = deps.clock.now();
      const updated = assignWorkItem({
        workItem: current,
        workflow,
        assigneeId: input.assigneeId,
        occurredAt,
      });

      const event: WorkItemAssignedEvent = {
        id: deps.ids.nextId('evt'),
        type: 'WorkItemAssigned',
        workItemId: updated.id,
        assigneeId: input.assigneeId,
        ...(current.assigneeId != null ? { previousAssigneeId: current.assigneeId } : {}),
        previousVersion: current.version,
        nextVersion: updated.version,
        actorId: input.actor.id,
        occurredAt,
      };

      await deps.unitOfWork.run(async () => {
        await deps.workItems.save(updated, { expectedVersion: current.version });
        await recordAuditEvent(deps, event);
      }, { name: 'assignWorkItem' });
      deps.logger.info('Work item assigned', {
        workItemId: updated.id,
        assigneeId: input.assigneeId,
      });
      return updated;
    }
  );
}
