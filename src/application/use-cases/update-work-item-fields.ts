import type { WorkItemFieldsUpdatedEvent } from '@/domain/event/audit-event';
import { NotFoundError } from '@/domain/errors/domain-error';
import type { Actor } from '@/domain/auth/auth';
import type { JsonObject } from '@/domain/shared';
import { updateWorkItemFields, type WorkItem } from '@/domain/work-item/work-item';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';
import { recordAuditEvent } from '@/application/audit';
import { getFieldSchemaForType } from '@/application/field-schema-cache';
import { validateInputFieldsAgainstSchema } from '@/application/field-validation';
import { assertExpectedVersion } from '@/application/versioning';
import { getWorkflowOrThrow } from './workflow-cache';

export type UpdateWorkItemFieldsInput = {
  workItemId: string;
  fields: JsonObject;
  expectedVersion?: number | undefined;
  actor: Actor;
};

export async function updateWorkItemFieldsUseCase(
  deps: ApplicationDependencies,
  input: UpdateWorkItemFieldsInput
): Promise<WorkItem> {
  return deps.tracer.span('updateWorkItemFields', { workItemId: input.workItemId }, async () => {
    authorize(deps, input.actor, 'work:update');
    const current = await deps.workItems.getById(input.workItemId);
    if (current == null) {
      throw new NotFoundError(`Work item "${input.workItemId}" was not found`, {
        workItemId: input.workItemId,
      });
    }
    assertExpectedVersion(current, input.expectedVersion);

    const workflow = await getWorkflowOrThrow(deps, current.type);
    const fieldSchema = await getFieldSchemaForType(deps, current.type);
    if (fieldSchema != null) {
      validateInputFieldsAgainstSchema(fieldSchema, input.fields, 'updateWorkItemFields');
    }

    const occurredAt = deps.clock.now();
    const updated = updateWorkItemFields({
      workItem: current,
      workflow,
      fields: input.fields,
      occurredAt,
    });

    const event: WorkItemFieldsUpdatedEvent = {
      id: deps.ids.nextId('evt'),
      type: 'WorkItemFieldsUpdated',
      workItemId: updated.id,
      fields: input.fields,
      previousFields: pickPreviousFields(current.fields, input.fields),
      previousVersion: current.version,
      nextVersion: updated.version,
      actorId: input.actor.id,
      occurredAt,
    };

    await deps.unitOfWork.run(async () => {
      await deps.workItems.save(updated, { expectedVersion: current.version });
      await recordAuditEvent(deps, event);
    }, { name: 'updateWorkItemFields' });
    deps.logger.info('Work item fields updated', {
      workItemId: updated.id,
      fields: Object.keys(input.fields),
    });
    return updated;
  });
}

function pickPreviousFields(currentFields: JsonObject, updatedFields: JsonObject): JsonObject {
  const previousFields: JsonObject = {};
  for (const fieldName of Object.keys(updatedFields)) {
    const previousValue = currentFields[fieldName];
    if (previousValue !== undefined) {
      previousFields[fieldName] = previousValue;
    }
  }
  return previousFields;
}
