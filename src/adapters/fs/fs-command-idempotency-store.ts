import type {
  CommandIdempotencyBeginInput,
  CommandIdempotencyBeginResult,
  CommandIdempotencyListQuery,
  CommandIdempotencyPruneInput,
  CommandIdempotencyPruneResult,
  CommandIdempotencyRecord,
  CommandIdempotencyStore,
} from '@/ports/command-idempotency-store';
import type { Clock } from '@/ports/clock';
import type { SleepFunction } from '@/primitives/timing';
import {
  IdempotencyError,
  idempotencyRecordIsExpired,
  markIdempotencyFailed,
  markIdempotencySucceeded,
  resolveIdempotency,
  startIdempotency,
} from '@/primitives/idempotency';
import { Json } from '@/primitives/json';
import { Err, Ok, type Result } from '@/primitives/result';
import { optionalPositiveIntegerOption } from '@/primitives/runtime-options';
import { compareStrings } from '@/primitives/string';
import { CommandIdempotencyRecordSchema } from '@/validation/schemas';
import {
  filenameForId,
  listFilesRecursive,
  pathExists,
  readJson,
  removePath,
  safeJoin,
  type FileTempNames,
  withFileLock,
  writeJsonAtomic,
} from './fs-utils';

export class FsCommandIdempotencyStore implements CommandIdempotencyStore {
  private readonly root: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly sleep: SleepFunction,
    private readonly tempNames: FileTempNames
  ) {
    this.root = safeJoin(dataDir, 'commands', 'idempotency');
  }

  async begin(
    input: CommandIdempotencyBeginInput
  ): Promise<Result<CommandIdempotencyBeginResult, IdempotencyError>> {
    const path = this.pathFor(input.key);
    return withFileLock(path, async () => {
      const existing = await this.readRecord(input.key);
      const resolved = resolveIdempotency(existing ?? undefined, input);
      if (!resolved.ok) return Err(resolved.error);

      if (resolved.value !== 'start') {
        return Ok({
          outcome: 'replayed',
          record: resolved.value.replay as CommandIdempotencyRecord,
        });
      }

      const record = createCommandIdempotencyRecord(input);
      await writeJsonAtomic(path, record, this.tempNames);
      return Ok({ outcome: 'started', record });
    }, { clock: this.clock, sleep: this.sleep });
  }

  async get(key: string): Promise<CommandIdempotencyRecord | null> {
    return this.readRecord(key);
  }

  async list(query: CommandIdempotencyListQuery = {}): Promise<CommandIdempotencyRecord[]> {
    const files = await listFilesRecursive(this.root);
    const records = await Promise.all(
      files.map((file) => readJson<CommandIdempotencyRecord>(file, CommandIdempotencyRecordSchema))
    );
    return records
      .filter((record) => query.commandType == null || record.commandType === query.commandType)
      .filter((record) => query.status == null || record.status === query.status)
      .sort(
        (left, right) =>
          compareStrings(left.createdAt, right.createdAt) || compareStrings(left.key, right.key)
      );
  }

  async pruneExpired(input: CommandIdempotencyPruneInput): Promise<CommandIdempotencyPruneResult> {
    const limit = optionalPositiveIntegerOption('limit', input.limit);
    const expiredRecords = (await this.list())
      .filter((record) => idempotencyRecordIsExpired(record, input.now))
      .sort((left, right) => compareStrings(left.key, right.key));
    const expired = expiredRecords.slice(0, limit ?? expiredRecords.length);

    await Promise.all(expired.map((record) => removePath(this.pathFor(record.key))));

    return {
      pruned: expired.length,
      keys: expired.map((record) => record.key),
    };
  }

  async markSucceeded(input: {
    key: string;
    now: string;
    response: unknown;
    replayExpiresAt?: string | undefined;
  }): Promise<CommandIdempotencyRecord> {
    Json.assertSerializable(input.response, 'commandIdempotency.response');
    const path = this.pathFor(input.key);
    return withFileLock(path, async () => {
      const current = requireRecord(await this.readRecord(input.key), input.key);
      const next = withCommandMetadata(markIdempotencySucceeded(current, input), current);
      await writeJsonAtomic(path, next, this.tempNames);
      return next;
    }, { clock: this.clock, sleep: this.sleep });
  }

  async markFailed(input: {
    key: string;
    now: string;
    error: string;
    replayExpiresAt?: string | undefined;
  }): Promise<CommandIdempotencyRecord> {
    const path = this.pathFor(input.key);
    return withFileLock(path, async () => {
      const current = requireRecord(await this.readRecord(input.key), input.key);
      const next = withCommandMetadata(markIdempotencyFailed(current, input), current);
      await writeJsonAtomic(path, next, this.tempNames);
      return next;
    }, { clock: this.clock, sleep: this.sleep });
  }

  private async readRecord(key: string): Promise<CommandIdempotencyRecord | null> {
    const path = this.pathFor(key);
    if (!(await pathExists(path))) return null;
    return readJson<CommandIdempotencyRecord>(path, CommandIdempotencyRecordSchema);
  }

  private pathFor(key: string): string {
    return safeJoin(this.root, filenameForId(key));
  }
}

function createCommandIdempotencyRecord(
  input: CommandIdempotencyBeginInput
): CommandIdempotencyRecord {
  return {
    ...startIdempotency(input),
    commandId: input.commandId,
    commandType: input.commandType,
  };
}

function requireRecord(
  record: CommandIdempotencyRecord | null,
  key: string
): CommandIdempotencyRecord {
  if (record != null) return record;
  throw new IdempotencyError('not_started', `Idempotency key "${key}" has not started`);
}

function withCommandMetadata(
  record: ReturnType<typeof markIdempotencySucceeded> | ReturnType<typeof markIdempotencyFailed>,
  current: CommandIdempotencyRecord
): CommandIdempotencyRecord {
  return {
    ...record,
    commandId: current.commandId,
    commandType: current.commandType,
  };
}
