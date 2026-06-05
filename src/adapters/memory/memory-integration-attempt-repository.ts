import { IdempotencyInProgressError, NotFoundError } from '@/domain/errors/domain-error';
import {
  assertIntegrationAttemptRequestCompatible,
  createPendingIntegrationAttempt,
  createSkippedIntegrationAttempt,
  filterIntegrationAttempts,
  findBlockingIntegrationAttemptByIdempotencyKey,
  findIntegrationAttemptByIdempotencyKey,
  markIntegrationAttemptFailed,
  markIntegrationAttemptSucceeded,
  type CreatePendingIntegrationAttemptInput,
  type IntegrationAttempt,
  type IntegrationAttemptListQuery,
  type MarkIntegrationAttemptFailedInput,
  type MarkIntegrationAttemptSucceededInput,
} from '@/domain/integration/integration-attempt';
import type { IntegrationAttemptRepository } from '@/ports/integration-attempt-repository';

export class InMemoryIntegrationAttemptRepository implements IntegrationAttemptRepository {
  private readonly attempts = new Map<string, IntegrationAttempt>();

  async createPending(
    input: CreatePendingIntegrationAttemptInput
  ): Promise<IntegrationAttempt> {
    const existing = this.findBlockingByIdempotencyKey(input.idempotencyKey);
    if (existing != null) {
      assertIntegrationAttemptRequestCompatible(existing, input);
      if (existing.status === 'pending') {
        throw new IdempotencyInProgressError('Integration attempt is already in progress', {
          idempotencyKey: input.idempotencyKey,
          attemptId: existing.id,
        });
      }
    }

    const attempt =
      existing?.status === 'succeeded'
        ? createSkippedIntegrationAttempt(input, existing)
        : createPendingIntegrationAttempt(input);

    this.attempts.set(attempt.id, structuredClone(attempt));
    return structuredClone(attempt);
  }

  async markSucceeded(
    input: MarkIntegrationAttemptSucceededInput
  ): Promise<IntegrationAttempt> {
    const attempt = this.requireById(input.id);
    const updated = markIntegrationAttemptSucceeded(attempt, input);
    this.attempts.set(updated.id, structuredClone(updated));
    return structuredClone(updated);
  }

  async markFailed(input: MarkIntegrationAttemptFailedInput): Promise<IntegrationAttempt> {
    const attempt = this.requireById(input.id);
    const updated = markIntegrationAttemptFailed(attempt, input);
    this.attempts.set(updated.id, structuredClone(updated));
    return structuredClone(updated);
  }

  async getById(id: string): Promise<IntegrationAttempt | null> {
    const attempt = this.attempts.get(id);
    return attempt == null ? null : structuredClone(attempt);
  }

  async findByIdempotencyKey(key: string): Promise<IntegrationAttempt | null> {
    const attempt = findIntegrationAttemptByIdempotencyKey([...this.attempts.values()], key);
    return attempt == null ? null : structuredClone(attempt);
  }

  async list(query: IntegrationAttemptListQuery = {}): Promise<IntegrationAttempt[]> {
    return filterIntegrationAttempts([...this.attempts.values()], query).map((attempt) =>
      structuredClone(attempt)
    );
  }

  private requireById(id: string): IntegrationAttempt {
    const attempt = this.attempts.get(id);
    if (attempt == null) {
      throw new NotFoundError(`Integration attempt "${id}" was not found`, {
        integrationAttemptId: id,
      });
    }
    return structuredClone(attempt);
  }

  private findBlockingByIdempotencyKey(key: string): IntegrationAttempt | null {
    return findBlockingIntegrationAttemptByIdempotencyKey([...this.attempts.values()], key);
  }
}
