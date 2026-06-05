import { NotFoundError } from '@/domain/errors/domain-error';
import type { WorkItemTransitionedEvent } from '@/domain/event/audit-event';
import {
  transitionWorkItem,
  validateWorkItemTransition,
  type WorkItem,
} from '@/domain/work-item/work-item';
import type { Actor } from '@/domain/auth/auth';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';
import { recordAuditEvent } from '@/application/audit';
import { getFieldSchemaForType } from '@/application/field-schema-cache';
import { validateRequiredFieldsAgainstSchema } from '@/application/field-validation';
import { evaluatePolicy } from '@/application/policies';
import { assertExpectedVersion } from '@/application/versioning';
import { getWorkflowOrThrow } from './workflow-cache';

export type TransitionWorkItemInput = {
  workItemId: string;
  action: string;
  expectedVersion?: number | undefined;
  actor: Actor;
};

export async function transitionWorkItemUseCase(
  deps: ApplicationDependencies,
  input: TransitionWorkItemInput
): Promise<WorkItem> {
  return deps.tracer.span(
    'transitionWorkItem',
    { workItemId: input.workItemId, action: input.action },
    async () => {
      authorize(deps, input.actor, 'work:transition');
      const current = await deps.workItems.getById(input.workItemId);
      if (current == null) {
        throw new NotFoundError(`Work item "${input.workItemId}" was not found`, {
          workItemId: input.workItemId,
        });
      }
      assertExpectedVersion(current, input.expectedVersion);

      const workflow = await getWorkflowOrThrow(deps, current.type);
      const transition = validateWorkItemTransition({
        workItem: current,
        workflow,
        action: input.action,
      });
      const fieldSchema = await getFieldSchemaForType(deps, current.type);
      if (fieldSchema != null) {
        validateRequiredFieldsAgainstSchema(
          fieldSchema,
          current.fields,
          transition.requires ?? [],
          'transitionWorkItem'
        );
      }
      await evaluatePolicy(deps, {
        actor: input.actor,
        action: input.action,
        workItem: current,
        workflow,
        input: {
          workItemId: input.workItemId,
          action: input.action,
          from: current.status,
          to: transition.to,
        },
      });
      const occurredAt = deps.clock.now();
      const updated = transitionWorkItem({
        workItem: current,
        workflow,
        action: input.action,
        occurredAt,
      });

      const event: WorkItemTransitionedEvent = {
        id: deps.ids.nextId('evt'),
        type: 'WorkItemTransitioned',
        workItemId: updated.id,
        action: input.action,
        from: current.status,
        to: updated.status,
        previousVersion: current.version,
        nextVersion: updated.version,
        actorId: input.actor.id,
        occurredAt,
      };

      await deps.unitOfWork.run(async () => {
        await deps.workItems.save(updated, { expectedVersion: current.version });
        await recordAuditEvent(deps, event);
      }, { name: 'transitionWorkItem' });
      deps.logger.info('Work item transitioned', {
        workItemId: updated.id,
        action: input.action,
        from: current.status,
        to: updated.status,
      });
      return updated;
    }
  );
}
