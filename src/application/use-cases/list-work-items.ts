import type { Actor } from '@/domain/auth/auth';
import type { WorkItem } from '@/domain/work-item/work-item';
import type { WorkItemListQuery } from '@/ports/work-item-repository';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';

export async function listWorkItemsUseCase(
  deps: ApplicationDependencies,
  actor: Actor,
  query?: WorkItemListQuery
): Promise<WorkItem[]> {
  return deps.tracer.span('listWorkItems', query ?? {}, async () => {
    authorize(deps, actor, 'work:list');
    return deps.workItems.list(query);
  });
}
