import type {
  CreatePendingIntegrationAttemptInput,
  IntegrationAttempt,
  IntegrationAttemptListQuery,
  MarkIntegrationAttemptFailedInput,
  MarkIntegrationAttemptSucceededInput,
} from '@/domain/integration/integration-attempt';

export interface IntegrationAttemptRepository {
  createPending(input: CreatePendingIntegrationAttemptInput): Promise<IntegrationAttempt>;
  markSucceeded(input: MarkIntegrationAttemptSucceededInput): Promise<IntegrationAttempt>;
  markFailed(input: MarkIntegrationAttemptFailedInput): Promise<IntegrationAttempt>;
  getById(id: string): Promise<IntegrationAttempt | null>;
  findByIdempotencyKey(key: string): Promise<IntegrationAttempt | null>;
  list(query?: IntegrationAttemptListQuery): Promise<IntegrationAttempt[]>;
}
