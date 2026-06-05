import { authorize } from '@/application/authorization';
import { recordAuditEvent } from '@/application/audit';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { Actor } from '@/domain/auth/auth';
import type { ResourceCreatedEvent } from '@/domain/event/audit-event';
import { createResource, type Resource } from '@/domain/resource/resource';
import type { JsonObject } from '@/domain/shared';

export type CreateResourceInput = {
  id: string;
  type: string;
  fields?: JsonObject | undefined;
  actor: Actor;
};

export async function createResourceUseCase(
  deps: ApplicationDependencies,
  input: CreateResourceInput
): Promise<Resource> {
  return deps.tracer.span('createResource', { resourceId: input.id, type: input.type }, async () => {
    authorize(deps, input.actor, 'resource:create');
    const occurredAt = deps.clock.now();
    const resource = createResource({
      id: input.id,
      type: input.type,
      fields: input.fields,
      occurredAt,
    });

    const event: ResourceCreatedEvent = {
      id: deps.ids.nextId('evt'),
      type: 'ResourceCreated',
      resourceId: resource.id,
      resourceType: resource.type,
      fields: resource.fields,
      actorId: input.actor.id,
      occurredAt,
    };

    await deps.unitOfWork.run(async () => {
      await deps.resources.save(resource);
      await recordAuditEvent(deps, event);
    }, { name: 'createResource' });
    deps.logger.info('Resource created', { resourceId: resource.id, type: resource.type });
    return resource;
  });
}
