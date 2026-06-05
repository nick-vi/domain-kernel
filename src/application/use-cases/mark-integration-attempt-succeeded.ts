import { authorize } from '@/application/authorization';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { Actor } from '@/domain/auth/auth';
import type { IntegrationAttempt } from '@/domain/integration/integration-attempt';

export type MarkIntegrationAttemptSucceededInput = {
  id: string;
  externalId?: string | undefined;
  actor: Actor;
};

export async function markIntegrationAttemptSucceededUseCase(
  deps: ApplicationDependencies,
  input: MarkIntegrationAttemptSucceededInput
): Promise<IntegrationAttempt> {
  return deps.tracer.span('markIntegrationAttemptSucceeded', { id: input.id }, async () => {
    authorize(deps, input.actor, 'integration:update');
    return deps.integrations.markSucceeded({
      id: input.id,
      ...(input.externalId != null ? { externalId: input.externalId } : {}),
      occurredAt: deps.clock.now(),
    });
  });
}
