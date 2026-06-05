import type {
  CommandIdempotencyBeginInput,
  CommandIdempotencyBeginResult,
  CommandIdempotencyListQuery,
  CommandIdempotencyPruneInput,
  CommandIdempotencyPruneResult,
  CommandIdempotencyRecord,
  CommandIdempotencyStore,
} from '@/ports/command-idempotency-store';
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

export class InMemoryCommandIdempotencyStore implements CommandIdempotencyStore {
  private readonly records = new Map<string, CommandIdempotencyRecord>();

  async begin(
    input: CommandIdempotencyBeginInput
  ): Promise<Result<CommandIdempotencyBeginResult, IdempotencyError>> {
    const existing = this.records.get(input.key);
    const resolved = resolveIdempotency(existing, input);
    if (!resolved.ok) return Err(resolved.error);

    if (resolved.value !== 'start') {
      return Ok({
        outcome: 'replayed',
        record: structuredClone(resolved.value.replay) as CommandIdempotencyRecord,
      });
    }

    const record = createCommandIdempotencyRecord(input);
    this.records.set(input.key, structuredClone(record));
    return Ok({ outcome: 'started', record });
  }

  async get(key: string): Promise<CommandIdempotencyRecord | null> {
    const record = this.records.get(key);
    return record == null ? null : structuredClone(record);
  }

  async list(query: CommandIdempotencyListQuery = {}): Promise<CommandIdempotencyRecord[]> {
    return [...this.records.values()]
      .filter((record) => query.commandType == null || record.commandType === query.commandType)
      .filter((record) => query.status == null || record.status === query.status)
      .map((record) => structuredClone(record))
      .sort(
        (left, right) =>
          compareStrings(left.createdAt, right.createdAt) || compareStrings(left.key, right.key)
      );
  }

  async pruneExpired(input: CommandIdempotencyPruneInput): Promise<CommandIdempotencyPruneResult> {
    const limit = optionalPositiveIntegerOption('limit', input.limit);
    const expiredKeys: string[] = [];
    for (const [key, record] of this.records.entries()) {
      if (!idempotencyRecordIsExpired(record, input.now)) continue;
      expiredKeys.push(key);
    }

    const keys = expiredKeys.sort(compareStrings).slice(0, limit ?? expiredKeys.length);
    for (const key of keys) {
      this.records.delete(key);
    }

    return {
      pruned: keys.length,
      keys,
    };
  }

  async markSucceeded(input: {
    key: string;
    now: string;
    response: unknown;
    replayExpiresAt?: string | undefined;
  }): Promise<CommandIdempotencyRecord> {
    Json.assertSerializable(input.response, 'commandIdempotency.response');
    const current = requireRecord(this.records.get(input.key), input.key);
    const next = withCommandMetadata(markIdempotencySucceeded(current, input), current);
    this.records.set(input.key, structuredClone(next));
    return next;
  }

  async markFailed(input: {
    key: string;
    now: string;
    error: string;
    replayExpiresAt?: string | undefined;
  }): Promise<CommandIdempotencyRecord> {
    const current = requireRecord(this.records.get(input.key), input.key);
    const next = withCommandMetadata(markIdempotencyFailed(current, input), current);
    this.records.set(input.key, structuredClone(next));
    return next;
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
  record: CommandIdempotencyRecord | undefined,
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
