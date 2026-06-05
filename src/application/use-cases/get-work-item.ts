import { NotFoundError } from '@/domain/errors/domain-error';
import type { Actor } from '@/domain/auth/auth';
import type { WorkItem } from '@/domain/work-item/work-item';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';

export type GetWorkItemInput = {
  workItemId: string;
  actor: Actor;
};

export async function getWorkItemUseCase(
  deps: ApplicationDependencies,
  input: GetWorkItemInput
): Promise<WorkItem> {
  return deps.tracer.span('getWorkItem', { workItemId: input.workItemId }, async () => {
    authorize(deps, input.actor, 'work:read');
    const workItem = await deps.workItems.getById(input.workItemId);
    if (workItem == null) {
      throw new NotFoundError(`Work item "${input.workItemId}" was not found`, {
        workItemId: input.workItemId,
      });
    }
    return workItem;
  });
}
