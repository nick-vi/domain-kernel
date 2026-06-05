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
import type { Clock } from '@/ports/clock';
import type { IntegrationAttemptRepository } from '@/ports/integration-attempt-repository';
import type { SleepFunction } from '@/primitives/timing';
import { IntegrationAttemptSchema } from '@/validation/schemas';
import {
  filenameForId,
  listFilesRecursive,
  pathExists,
  readJson,
  safeJoin,
  type FileTempNames,
  withFileLock,
  writeJsonAtomic,
} from './fs-utils';

export class FsIntegrationAttemptRepository implements IntegrationAttemptRepository {
  private readonly root: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly sleep: SleepFunction,
    private readonly tempNames: FileTempNames
  ) {
    this.root = safeJoin(dataDir, 'integrations');
  }

  async createPending(
    input: CreatePendingIntegrationAttemptInput
  ): Promise<IntegrationAttempt> {
    return withFileLock(this.idempotencyPathFor(input.idempotencyKey), async () => {
      const existing = await this.findBlockingByIdempotencyKey(input.idempotencyKey);
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

      await this.save(attempt);
      return attempt;
    }, { clock: this.clock, sleep: this.sleep });
  }

  async markSucceeded(
    input: MarkIntegrationAttemptSucceededInput
  ): Promise<IntegrationAttempt> {
    return withFileLock(this.pathFor(input.id), async () => {
      const attempt = await this.requireById(input.id);
      const updated = markIntegrationAttemptSucceeded(attempt, input);
      await this.save(updated);
      return updated;
    }, { clock: this.clock, sleep: this.sleep });
  }

  async markFailed(input: MarkIntegrationAttemptFailedInput): Promise<IntegrationAttempt> {
    return withFileLock(this.pathFor(input.id), async () => {
      const attempt = await this.requireById(input.id);
      const updated = markIntegrationAttemptFailed(attempt, input);
      await this.save(updated);
      return updated;
    }, { clock: this.clock, sleep: this.sleep });
  }

  async getById(id: string): Promise<IntegrationAttempt | null> {
    const path = this.pathFor(id);
    if (!(await pathExists(path))) {
      return null;
    }
    return readJson<IntegrationAttempt>(path, IntegrationAttemptSchema);
  }

  async findByIdempotencyKey(key: string): Promise<IntegrationAttempt | null> {
    return findIntegrationAttemptByIdempotencyKey(await this.list(), key);
  }

  async list(query: IntegrationAttemptListQuery = {}): Promise<IntegrationAttempt[]> {
    const files = await listFilesRecursive(this.root);
    const attempts = await Promise.all(
      files.map((file) => readJson<IntegrationAttempt>(file, IntegrationAttemptSchema))
    );

    return filterIntegrationAttempts(attempts, query);
  }

  private async requireById(id: string): Promise<IntegrationAttempt> {
    const attempt = await this.getById(id);
    if (attempt == null) {
      throw new NotFoundError(`Integration attempt "${id}" was not found`, {
        integrationAttemptId: id,
      });
    }
    return attempt;
  }

  private async findBlockingByIdempotencyKey(
    key: string
  ): Promise<IntegrationAttempt | null> {
    return findBlockingIntegrationAttemptByIdempotencyKey(await this.list(), key);
  }

  private async save(attempt: IntegrationAttempt): Promise<void> {
    await writeJsonAtomic(this.pathFor(attempt.id), attempt, this.tempNames);
  }

  private pathFor(id: string): string {
    return safeJoin(this.root, filenameForId(id));
  }

  private idempotencyPathFor(key: string): string {
    return safeJoin(this.root, 'idempotency', filenameForId(key));
  }
}
