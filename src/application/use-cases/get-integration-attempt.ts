import { authorize } from '@/application/authorization';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { Actor } from '@/domain/auth/auth';
import { NotFoundError } from '@/domain/errors/domain-error';
import type { IntegrationAttempt } from '@/domain/integration/integration-attempt';

export type GetIntegrationAttemptInput = {
  id: string;
  actor: Actor;
};

export async function getIntegrationAttemptUseCase(
  deps: ApplicationDependencies,
  input: GetIntegrationAttemptInput
): Promise<IntegrationAttempt> {
  return deps.tracer.span('getIntegrationAttempt', { id: input.id }, async () => {
    authorize(deps, input.actor, 'integration:read');
    const attempt = await deps.integrations.getById(input.id);
    if (attempt == null) {
      throw new NotFoundError(`Integration attempt "${input.id}" was not found`, {
        integrationAttemptId: input.id,
      });
    }
    return attempt;
  });
}
