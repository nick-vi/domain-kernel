import type { ApplicationDependencies } from '@/application/dependencies';
import { IdempotencyInProgressError } from '@/domain/errors/domain-error';
import {
  buildIntegrationIdempotencyKey,
  type IntegrationAttempt,
} from '@/domain/integration/integration-attempt';
import type {
  IntegrationOperationInput,
  IntegrationOperationResult,
  IntegrationProvider,
  IntegrationProviderError,
} from '@/ports/integration-provider';
import { Json } from '@/primitives/json';

export type IntegrationRunInput<TPayload, TResult> =
  IntegrationOperationInput<TPayload> & {
    providerAdapter: IntegrationProvider<TPayload, TResult>;
  };

export type IntegrationRunResult<TResult> =
  | {
      status: 'succeeded';
      attempt: IntegrationAttempt;
      externalId?: string | undefined;
      result: TResult;
    }
  | {
      status: 'failed';
      attempt: IntegrationAttempt;
      error: IntegrationProviderError;
    }
  | {
      status: 'skipped';
      attempt: IntegrationAttempt;
      reason: 'already_succeeded';
      replayOf?: IntegrationAttempt | undefined;
      externalId?: string | undefined;
    }
  | {
      status: 'in_progress';
      attempt: IntegrationAttempt;
      reason: 'already_in_progress';
    };

export class IntegrationRunner {
  constructor(private readonly deps: ApplicationDependencies) {}

  async run<TPayload, TResult>(
    input: IntegrationRunInput<TPayload, TResult>
  ): Promise<IntegrationRunResult<TResult>> {
    return this.deps.tracer.span(
      'runIntegrationOperation',
      { provider: input.provider, operation: input.operation, eventId: input.eventId },
      async () => {
        const idempotencyKey =
          input.idempotencyKey ??
          buildIntegrationIdempotencyKey({
            provider: input.provider,
            operation: input.operation,
            eventId: input.eventId,
          });
        const requestHash = input.requestHash ?? computeIntegrationRequestHash(input.payload);
        const attemptInput = {
          id: this.deps.ids.nextId('attempt'),
          provider: input.provider,
          operation: input.operation,
          idempotencyKey,
          eventId: input.eventId,
          ...(input.workItemId != null ? { workItemId: input.workItemId } : {}),
          ...(input.resourceId != null ? { resourceId: input.resourceId } : {}),
          requestHash,
          occurredAt: this.deps.clock.now(),
        };
        const attempt = await this.createPendingAttempt(attemptInput);

        if (attempt.status === 'pending' && attempt.id !== attemptInput.id) {
          return {
            status: 'in_progress',
            attempt,
            reason: 'already_in_progress',
          };
        }

        if (attempt.status === 'skipped') {
          const replayOf = await this.deps.integrations.findByIdempotencyKey(idempotencyKey);
          this.deps.logger.info('Integration operation skipped by idempotency', {
            attemptId: attempt.id,
            provider: input.provider,
            operation: input.operation,
            idempotencyKey,
          });
          return {
            status: 'skipped',
            attempt,
            reason: 'already_succeeded',
            ...(replayOf != null && replayOf.status === 'succeeded' ? { replayOf } : {}),
            ...(attempt.externalId != null ? { externalId: attempt.externalId } : {}),
          };
        }

        try {
          const providerResult = await input.providerAdapter.execute(input.payload);
          const succeeded = await this.markSucceeded(attempt, providerResult);
          this.deps.logger.info('Integration operation succeeded', {
            attemptId: succeeded.id,
            provider: input.provider,
            operation: input.operation,
            externalId: succeeded.externalId,
          });
          return {
            status: 'succeeded',
            attempt: succeeded,
            ...(providerResult.externalId != null ? { externalId: providerResult.externalId } : {}),
            result: providerResult.result,
          };
        } catch (error) {
          const providerError = normalizeProviderError(error);
          const failed = await this.deps.integrations.markFailed({
            id: attempt.id,
            errorCode: providerError.code,
            errorMessage: providerError.message,
            occurredAt: this.deps.clock.now(),
          });
          this.deps.logger.warn('Integration operation failed', {
            attemptId: failed.id,
            provider: input.provider,
            operation: input.operation,
            errorCode: providerError.code,
            errorMessage: providerError.message,
          });
          return {
            status: 'failed',
            attempt: failed,
            error: providerError,
          };
        }
      }
    );
  }

  private async markSucceeded<TResult>(
    attempt: IntegrationAttempt,
    result: IntegrationOperationResult<TResult>
  ): Promise<IntegrationAttempt> {
    return this.deps.integrations.markSucceeded({
      id: attempt.id,
      ...(result.externalId != null ? { externalId: result.externalId } : {}),
      occurredAt: this.deps.clock.now(),
    });
  }

  private async createPendingAttempt(
    input: Parameters<ApplicationDependencies['integrations']['createPending']>[0]
  ): Promise<IntegrationAttempt> {
    try {
      return await this.deps.integrations.createPending(input);
    } catch (error) {
      if (error instanceof IdempotencyInProgressError) {
        const existing = await this.deps.integrations.findByIdempotencyKey(input.idempotencyKey);
        if (existing != null && existing.status === 'pending') return existing;
      }
      throw error;
    }
  }
}

export function computeIntegrationRequestHash(payload: unknown): string {
  return `sha256:${Json.stableContentHash(payload).unwrap()}`;
}

function normalizeProviderError(error: unknown): IntegrationProviderError {
  if (isProviderErrorLike(error)) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    const maybeCoded = error as Error & { code?: unknown };
    return {
      code: typeof maybeCoded.code === 'string' ? maybeCoded.code : 'PROVIDER_ERROR',
      message: error.message,
    };
  }

  return {
    code: 'PROVIDER_ERROR',
    message: String(error),
  };
}

function isProviderErrorLike(error: unknown): error is IntegrationProviderError {
  if (typeof error !== 'object' || error == null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}
