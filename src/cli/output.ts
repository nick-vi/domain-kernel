import { DomainError } from '@/domain/errors/domain-error';
import { Json } from '@/primitives/json';
import { JsonError } from '@/primitives/json-errors';
import { UnwrapError } from '@/primitives/result';
import { RuntimeValidationError } from '@/validation/runtime-validation-error';
import { CliParseError } from './errors';

export function printJson(value: unknown): void {
  console.log(Json.stringify(value, 2).unwrap());
}

export async function runAction(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof DomainError) {
      printError(error.code, error.message, error.details);
    } else if (error instanceof CliParseError) {
      printError('CLI_PARSE_ERROR', error.message, error.details);
    } else if (error instanceof RuntimeValidationError) {
      printError('RUNTIME_VALIDATION_ERROR', error.message, {
        source: error.source,
        issues: error.issues,
      });
    } else if (error instanceof JsonError) {
      printError('JSON_ERROR', error.message);
    } else if (error instanceof UnwrapError) {
      printError('UNWRAP_ERROR', error.message);
    } else {
      printError('UNEXPECTED_ERROR', error instanceof Error ? error.message : String(error));
    }

    process.exitCode = 1;
  }
}

function printError(code: string, message: string, details?: Record<string, unknown>): void {
  const serialized = Json.stringify(
    {
      error: {
        code,
        message,
        ...(details != null ? { details } : {}),
      },
    },
    2
  );

  if (serialized.ok) {
    console.error(serialized.value);
    return;
  }

  console.error(
    JSON.stringify(
      {
        error: {
          code,
          message,
          details: { serializationError: serialized.error.message },
        },
      },
      null,
      2
    )
  );
}
