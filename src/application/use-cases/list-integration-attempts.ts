import { authorize } from '@/application/authorization';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { Actor } from '@/domain/auth/auth';
import type {
  IntegrationAttempt,
  IntegrationAttemptListQuery,
} from '@/domain/integration/integration-attempt';

export type ListIntegrationAttemptsInput = {
  actor: Actor;
  query?: IntegrationAttemptListQuery | undefined;
};

export async function listIntegrationAttemptsUseCase(
  deps: ApplicationDependencies,
  input: ListIntegrationAttemptsInput
): Promise<IntegrationAttempt[]> {
  return deps.tracer.span('listIntegrationAttempts', input.query ?? {}, async () => {
    authorize(deps, input.actor, 'integration:list');
    return deps.integrations.list(input.query);
  });
}
