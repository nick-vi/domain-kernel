import type { ApplicationDependencies } from '@/application/dependencies';
import { ValidationError } from '@/domain/errors/domain-error';
import type { CommandEnvelope } from '@/primitives/command';
import {
  IdempotencyError,
  IdempotencyStatus,
  idempotencyFingerprint,
} from '@/primitives/idempotency';
import { Err, Ok, type Result } from '@/primitives/result';
import { optionalPositiveIntegerOption } from '@/primitives/runtime-options';
import {
  formatValidationIssues,
  validateUnknown,
  type SafeParseSchema,
  type Validator,
} from '@/primitives/schema';
import { compareStrings } from '@/primitives/string';
import { addMillisecondsToIsoTimestamp } from '@/primitives/time';

export type CommandExecutionContext<TPayload> = {
  deps: ApplicationDependencies;
  command: CommandEnvelope<TPayload>;
};

export type CommandPayloadValidator<TPayload> = {
  schema?: SafeParseSchema<TPayload> | undefined;
  validate?: Validator<TPayload> | undefined;
};

export type CommandHandler<TPayload = unknown, TResult = unknown> = {
  type: string;
  unitOfWork?: boolean | undefined;
  payload?: CommandPayloadValidator<TPayload> | undefined;
  authorize?: (context: CommandExecutionContext<TPayload>) => Promise<void> | void;
  handle: (context: CommandExecutionContext<TPayload>) => Promise<TResult> | TResult;
};

export type CommandBusOptions = {
  idempotencyInProgressTtlMs?: number | undefined;
  idempotencyReplayTtlMs?: number | undefined;
};

export class CommandBus {
  private readonly handlers = new Map<string, CommandHandler<unknown, unknown>>();
  private readonly options: CommandBusOptions;

  constructor(
    private readonly deps: ApplicationDependencies,
    options: CommandBusOptions = {}
  ) {
    const idempotencyInProgressTtlMs = optionalPositiveIntegerOption(
      'idempotencyInProgressTtlMs',
      options.idempotencyInProgressTtlMs
    );
    const idempotencyReplayTtlMs = optionalPositiveIntegerOption(
      'idempotencyReplayTtlMs',
      options.idempotencyReplayTtlMs
    );
    this.options = {
      ...(idempotencyInProgressTtlMs != null ? { idempotencyInProgressTtlMs } : {}),
      ...(idempotencyReplayTtlMs != null ? { idempotencyReplayTtlMs } : {}),
    };
  }

  register<TPayload, TResult>(handler: CommandHandler<TPayload, TResult>): this {
    if (this.handlers.has(handler.type)) {
      throw new ValidationError(`Command handler already registered for "${handler.type}"`, {
        commandType: handler.type,
      });
    }

    this.handlers.set(handler.type, handler as CommandHandler<unknown, unknown>);
    return this;
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  listTypes(): string[] {
    return [...this.handlers.keys()].sort(compareStrings);
  }

  async dispatch<TResult = unknown>(command: CommandEnvelope): Promise<TResult> {
    const handler = this.handlers.get(command.type);
    if (handler == null) {
      throw new ValidationError(`No command handler registered for "${command.type}"`, {
        commandType: command.type,
      });
    }

    const payload = validatePayload(command, handler);
    const typedCommand = { ...command, payload };
    const context = { deps: this.deps, command: typedCommand };

    const run = async () => {
      await handler.authorize?.(context);
      return handler.handle(context);
    };

    const execute = async () =>
      handler.unitOfWork === true
        ? this.deps.unitOfWork.run(run, { name: `command:${command.type}` })
        : run();

    if (command.idempotencyKey == null) {
      return (await execute()) as TResult;
    }

    const now = this.deps.clock.now();
    const started = await this.deps.commandIdempotency.begin({
      key: command.idempotencyKey,
      fingerprint: commandFingerprint(typedCommand),
      commandId: command.id,
      commandType: command.type,
      now,
      ...(this.options.idempotencyInProgressTtlMs != null
        ? {
            inProgressExpiresAt: addMillisecondsToIsoTimestamp(
              now,
              this.options.idempotencyInProgressTtlMs
            ).unwrap(),
          }
        : {}),
    });
    if (!started.ok) throw started.error;

    if (started.value.outcome === 'replayed') {
      const record = started.value.record;
      if (record.status === IdempotencyStatus.SUCCEEDED) {
        return record.response as TResult;
      }

      if (record.status === IdempotencyStatus.FAILED) {
        throw new IdempotencyError(
          'replayed_failure',
          record.error ?? `Idempotent command "${command.idempotencyKey}" failed previously`
        );
      }

      throw new IdempotencyError(
        'in_progress',
        `Idempotency key "${command.idempotencyKey}" is already in progress`
      );
    }

    try {
      const result = (await execute()) as TResult;
      await this.deps.commandIdempotency.markSucceeded({
        key: command.idempotencyKey,
        ...this.completionLeaseInput(),
        response: result,
      });
      return result;
    } catch (error) {
      await this.deps.commandIdempotency.markFailed({
        key: command.idempotencyKey,
        ...this.completionLeaseInput(),
        error: errorMessage(error),
      });
      throw error;
    }
  }

  async safeDispatch<TResult = unknown>(
    command: CommandEnvelope
  ): Promise<Result<TResult, unknown>> {
    try {
      return Ok(await this.dispatch<TResult>(command));
    } catch (error) {
      return Err(error);
    }
  }

  private completionLeaseInput(): { now: string; replayExpiresAt?: string | undefined } {
    const now = this.deps.clock.now();
    return {
      now,
      ...(this.options.idempotencyReplayTtlMs != null
        ? {
            replayExpiresAt: addMillisecondsToIsoTimestamp(
              now,
              this.options.idempotencyReplayTtlMs
            ).unwrap(),
          }
        : {}),
    };
  }
}

function commandFingerprint(command: CommandEnvelope): string {
  return idempotencyFingerprint({
    type: command.type,
    payload: command.payload,
    ...(command.actorId != null ? { actorId: command.actorId } : {}),
    ...(command.metadata != null ? { metadata: command.metadata } : {}),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validatePayload<TPayload>(
  command: CommandEnvelope,
  handler: CommandHandler<TPayload, unknown>
): TPayload {
  const validated = validateUnknown(command.payload, {
    schema: handler.payload?.schema,
    validate: handler.payload?.validate,
    source: command.type,
  });

  if (validated.ok) return validated.value;

  const message = formatValidationIssues(validated.error.issues);
  throw new ValidationError(`Invalid command payload for "${command.type}": ${message}`, {
    commandType: command.type,
    issues: validated.error.issues,
  });
}
