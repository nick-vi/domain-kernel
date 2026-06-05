import { NotFoundError } from '@/domain/errors/domain-error';
import type { NormalizedWorkflowDefinition } from '@/domain/workflow/workflow-definition';
import type { ApplicationDependencies } from '@/application/dependencies';

export async function getWorkflowOrThrow(
  deps: ApplicationDependencies,
  type: string
): Promise<NormalizedWorkflowDefinition> {
  const cacheKey = `workflow:${type}`;
  const cached = await deps.cache.get<NormalizedWorkflowDefinition>(cacheKey);
  if (cached != null) {
    return cached;
  }

  const workflow = await deps.workflows.getByType(type);
  if (workflow == null) {
    throw new NotFoundError(`Workflow type "${type}" is not registered`, { type });
  }

  await deps.cache.set(cacheKey, workflow);
  return workflow;
}
