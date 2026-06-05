import {
  safeNormalizeWorkflowDefinition,
  type NormalizedWorkflowDefinition,
  type WorkflowDefinition,
} from '@/domain/workflow/workflow-definition';
import type { Actor } from '@/domain/auth/auth';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';

export type RegisterWorkflowInput = {
  workflow: WorkflowDefinition;
  actor: Actor;
};

export async function registerWorkflow(
  deps: ApplicationDependencies,
  input: RegisterWorkflowInput
): Promise<NormalizedWorkflowDefinition> {
  return deps.tracer.span('registerWorkflow', { type: input.workflow.type }, async () => {
    authorize(deps, input.actor, 'workflow:register');
    const workflowResult = safeNormalizeWorkflowDefinition(input.workflow);
    if (!workflowResult.ok) {
      throw workflowResult.error;
    }

    const workflow = workflowResult.value;
    await deps.workflows.save(workflow);
    await deps.cache.set(`workflow:${workflow.type}`, workflow);
    deps.logger.info('Workflow registered', { type: workflow.type });
    return workflow;
  });
}
