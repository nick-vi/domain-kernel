import type { ApplicationDependencies } from '@/application/dependencies';
import { PolicyDeniedError } from '@/domain/errors/domain-error';
import type { PolicyContext } from '@/domain/policy/policy';

export async function evaluatePolicy(
  deps: ApplicationDependencies,
  context: PolicyContext
): Promise<void> {
  const decision = await deps.policyEngine.evaluate(context);
  if (decision.allowed) return;

  throw new PolicyDeniedError(decision.reason, {
    action: context.action,
    actorId: context.actor.id,
    policyCode: decision.code,
    workItemId: context.workItem?.id,
    workflowType: context.workflow?.type,
  });
}
