import type { IdempotencyError, IdempotencyRecord } from '@/primitives/idempotency';
import type { Result } from '@/primitives/result';

export type CommandIdempotencyRecord<TResponse = unknown> = IdempotencyRecord<TResponse> & {
  commandId: string;
  commandType: string;
};

export type CommandIdempotencyBeginInput = {
  key: string;
  fingerprint: string;
  commandId: string;
  commandType: string;
  now: string;
  inProgressExpiresAt?: string | undefined;
};

export type CommandIdempotencyReplay<TResponse = unknown> = {
  outcome: 'replayed';
  record: CommandIdempotencyRecord<TResponse>;
};

export type CommandIdempotencyStarted<TResponse = unknown> = {
  outcome: 'started';
  record: CommandIdempotencyRecord<TResponse>;
};

export type CommandIdempotencyBeginResult<TResponse = unknown> =
  | CommandIdempotencyReplay<TResponse>
  | CommandIdempotencyStarted<TResponse>;

export type CommandIdempotencyListQuery = {
  commandType?: string | undefined;
  status?: CommandIdempotencyRecord['status'] | undefined;
};

export type CommandIdempotencyPruneInput = {
  now: string;
  limit?: number | undefined;
};

export type CommandIdempotencyPruneResult = {
  pruned: number;
  keys: string[];
};

export interface CommandIdempotencyStore {
  begin(
    input: CommandIdempotencyBeginInput
  ): Promise<Result<CommandIdempotencyBeginResult, IdempotencyError>>;
  get(key: string): Promise<CommandIdempotencyRecord | null>;
  list(query?: CommandIdempotencyListQuery): Promise<CommandIdempotencyRecord[]>;
  pruneExpired(input: CommandIdempotencyPruneInput): Promise<CommandIdempotencyPruneResult>;
  markSucceeded(input: {
    key: string;
    now: string;
    response: unknown;
    replayExpiresAt?: string | undefined;
  }): Promise<CommandIdempotencyRecord>;
  markFailed(input: {
    key: string;
    now: string;
    error: string;
    replayExpiresAt?: string | undefined;
  }): Promise<CommandIdempotencyRecord>;
}
