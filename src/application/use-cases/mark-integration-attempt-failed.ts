import { authorize } from '@/application/authorization';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { Actor } from '@/domain/auth/auth';
import type { IntegrationAttempt } from '@/domain/integration/integration-attempt';

export type MarkIntegrationAttemptFailedInput = {
  id: string;
  errorCode?: string | undefined;
  errorMessage: string;
  actor: Actor;
};

export async function markIntegrationAttemptFailedUseCase(
  deps: ApplicationDependencies,
  input: MarkIntegrationAttemptFailedInput
): Promise<IntegrationAttempt> {
  return deps.tracer.span('markIntegrationAttemptFailed', { id: input.id }, async () => {
    authorize(deps, input.actor, 'integration:update');
    return deps.integrations.markFailed({
      id: input.id,
      ...(input.errorCode != null ? { errorCode: input.errorCode } : {}),
      errorMessage: input.errorMessage,
      occurredAt: deps.clock.now(),
    });
  });
}
