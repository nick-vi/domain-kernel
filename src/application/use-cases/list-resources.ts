import { authorize } from '@/application/authorization';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { Actor } from '@/domain/auth/auth';
import type { Resource, ResourceListQuery } from '@/domain/resource/resource';

export async function listResourcesUseCase(
  deps: ApplicationDependencies,
  actor: Actor,
  query?: ResourceListQuery
): Promise<Resource[]> {
  return deps.tracer.span('listResources', query ?? {}, async () => {
    authorize(deps, actor, 'resource:list');
    return deps.resources.list(query);
  });
}
