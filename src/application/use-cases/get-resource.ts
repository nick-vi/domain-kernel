import { authorize } from '@/application/authorization';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { Actor } from '@/domain/auth/auth';
import { NotFoundError } from '@/domain/errors/domain-error';
import type { Resource } from '@/domain/resource/resource';

export type GetResourceInput = {
  resourceId: string;
  actor: Actor;
};

export async function getResourceUseCase(
  deps: ApplicationDependencies,
  input: GetResourceInput
): Promise<Resource> {
  return deps.tracer.span('getResource', { resourceId: input.resourceId }, async () => {
    authorize(deps, input.actor, 'resource:read');
    const resource = await deps.resources.getById(input.resourceId);
    if (resource == null) {
      throw new NotFoundError(`Resource "${input.resourceId}" was not found`, {
        resourceId: input.resourceId,
      });
    }
    return resource;
  });
}
