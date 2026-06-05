import { NotFoundError } from '@/domain/errors/domain-error';
import type { DecisionAddedEvent } from '@/domain/event/audit-event';
import { addDecisionToWorkItem, type WorkItem } from '@/domain/work-item/work-item';
import type { Actor } from '@/domain/auth/auth';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';
import { recordAuditEvent } from '@/application/audit';
import { assertExpectedVersion } from '@/application/versioning';
import { getWorkflowOrThrow } from './workflow-cache';

export type AddDecisionInput = {
  workItemId: string;
  decisionType: string;
  reason: string;
  expectedVersion?: number | undefined;
  actor: Actor;
};

export async function addDecisionUseCase(
  deps: ApplicationDependencies,
  input: AddDecisionInput
): Promise<WorkItem> {
  return deps.tracer.span(
    'addDecision',
    { workItemId: input.workItemId, decisionType: input.decisionType },
    async () => {
      authorize(deps, input.actor, 'decision:add');
      const current = await deps.workItems.getById(input.workItemId);
      if (current == null) {
        throw new NotFoundError(`Work item "${input.workItemId}" was not found`, {
          workItemId: input.workItemId,
        });
      }
      assertExpectedVersion(current, input.expectedVersion);

      const workflow = await getWorkflowOrThrow(deps, current.type);
      const occurredAt = deps.clock.now();
      const decisionId = deps.ids.nextId('dec');
      const updated = addDecisionToWorkItem({
        workItem: current,
        workflow,
        decisionId,
        decisionType: input.decisionType,
        reason: input.reason,
        actorId: input.actor.id,
        occurredAt,
      });

      const event: DecisionAddedEvent = {
        id: deps.ids.nextId('evt'),
        type: 'DecisionAdded',
        workItemId: updated.id,
        decisionId,
        decisionType: input.decisionType,
        reason: input.reason,
        previousVersion: current.version,
        nextVersion: updated.version,
        actorId: input.actor.id,
        occurredAt,
      };

      await deps.unitOfWork.run(async () => {
        await deps.workItems.save(updated, { expectedVersion: current.version });
        await recordAuditEvent(deps, event);
      }, { name: 'addDecision' });
      deps.logger.info('Decision added', {
        workItemId: updated.id,
        decisionType: input.decisionType,
      });
      return updated;
    }
  );
}
