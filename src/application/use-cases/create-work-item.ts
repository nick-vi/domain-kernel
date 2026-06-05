import type { WorkItemCreatedEvent } from '@/domain/event/audit-event';
import { createWorkItem, type WorkItem } from '@/domain/work-item/work-item';
import type { JsonObject } from '@/domain/shared';
import type { Actor } from '@/domain/auth/auth';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';
import { recordAuditEvent } from '@/application/audit';
import { getFieldSchemaForType } from '@/application/field-schema-cache';
import { validateInputFieldsAgainstSchema } from '@/application/field-validation';
import { getWorkflowOrThrow } from './workflow-cache';

export type CreateWorkItemInput = {
  type: string;
  fields?: JsonObject;
  actor: Actor;
};

export async function createWorkItemUseCase(
  deps: ApplicationDependencies,
  input: CreateWorkItemInput
): Promise<WorkItem> {
  return deps.tracer.span('createWorkItem', { type: input.type }, async () => {
    authorize(deps, input.actor, 'work:create');
    const workflow = await getWorkflowOrThrow(deps, input.type);
    const fieldSchema = await getFieldSchemaForType(deps, input.type);
    if (fieldSchema != null) {
      validateInputFieldsAgainstSchema(fieldSchema, input.fields ?? {}, 'createWorkItem', {
        requireSchemaRequiredFields: true,
      });
    }

    const occurredAt = deps.clock.now();
    const workItem = createWorkItem({
      id: deps.ids.nextId('work'),
      type: input.type,
      ...(input.fields != null ? { fields: input.fields } : {}),
      workflow,
      occurredAt,
    });

    const event: WorkItemCreatedEvent = {
      id: deps.ids.nextId('evt'),
      type: 'WorkItemCreated',
      workItemId: workItem.id,
      workItemType: workItem.type,
      state: workItem.status,
      fields: workItem.fields,
      version: workItem.version,
      actorId: input.actor.id,
      occurredAt,
    };

    await deps.unitOfWork.run(async () => {
      await deps.workItems.save(workItem);
      await recordAuditEvent(deps, event);
    }, { name: 'createWorkItem' });
    deps.logger.info('Work item created', { workItemId: workItem.id, type: input.type });
    return workItem;
  });
}
