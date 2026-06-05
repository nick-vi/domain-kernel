import { authorize } from '@/application/authorization';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { Actor } from '@/domain/auth/auth';
import { ValidationError } from '@/domain/errors/domain-error';
import {
  buildIntegrationIdempotencyKey,
  type IntegrationAttempt,
} from '@/domain/integration/integration-attempt';

export type CreateIntegrationAttemptInput = {
  provider: string;
  operation: string;
  idempotencyKey?: string | undefined;
  eventId?: string | undefined;
  workItemId?: string | undefined;
  resourceId?: string | undefined;
  requestHash?: string | undefined;
  actor: Actor;
};

export async function createIntegrationAttemptUseCase(
  deps: ApplicationDependencies,
  input: CreateIntegrationAttemptInput
): Promise<IntegrationAttempt> {
  return deps.tracer.span(
    'createIntegrationAttempt',
    { provider: input.provider, operation: input.operation, eventId: input.eventId },
    async () => {
      authorize(deps, input.actor, 'integration:create');
      const occurredAt = deps.clock.now();
      const idempotencyKey = resolveIdempotencyKey(input);

      return deps.integrations.createPending({
        id: deps.ids.nextId('attempt'),
        provider: input.provider,
        operation: input.operation,
        idempotencyKey,
        ...(input.eventId != null ? { eventId: input.eventId } : {}),
        ...(input.workItemId != null ? { workItemId: input.workItemId } : {}),
        ...(input.resourceId != null ? { resourceId: input.resourceId } : {}),
        ...(input.requestHash != null ? { requestHash: input.requestHash } : {}),
        occurredAt,
      });
    }
  );
}

function resolveIdempotencyKey(input: CreateIntegrationAttemptInput): string {
  if (input.idempotencyKey != null) return input.idempotencyKey;
  if (input.eventId != null) {
    return buildIntegrationIdempotencyKey({
      provider: input.provider,
      operation: input.operation,
      eventId: input.eventId,
    });
  }

  throw new ValidationError('Integration attempt requires an idempotency key or event id', {
    provider: input.provider,
    operation: input.operation,
  });
}
