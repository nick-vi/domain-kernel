import type { Actor } from '@/domain/auth/auth';
import type { WorkItemQuery, WorkItemSearchResult } from '@/domain/query/work-item-query';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';

export type QueryWorkItemsInput = {
  actor: Actor;
  query: WorkItemQuery;
};

export async function queryWorkItemsUseCase(
  deps: ApplicationDependencies,
  input: QueryWorkItemsInput
): Promise<WorkItemSearchResult> {
  return deps.tracer.span('queryWorkItems', input.query, async () => {
    authorize(deps, input.actor, 'work:query');
    return deps.workItemQueries.search(input.query);
  });
}
