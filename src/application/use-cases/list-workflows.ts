import type { Actor } from '@/domain/auth/auth';
import type { NormalizedWorkflowDefinition } from '@/domain/workflow/workflow-definition';
import { authorize } from '@/application/authorization';
import type { ApplicationDependencies } from '@/application/dependencies';

export async function listWorkflowsUseCase(
  deps: ApplicationDependencies,
  actor: Actor
): Promise<NormalizedWorkflowDefinition[]> {
  return deps.tracer.span('listWorkflows', {}, async () => {
    authorize(deps, actor, 'workflow:list');
    return deps.workflows.list();
  });
}
