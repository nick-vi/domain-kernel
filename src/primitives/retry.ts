import { Err, isErr, type Result } from './result';
import { SleepAbortedError, type SleepFunction } from './timing';

export const JitterMode = Object.freeze({
  FULL: 'full',
  NONE: 'none',
} as const);

export type JitterMode = (typeof JitterMode)[keyof typeof JitterMode];

export type RandomSource = () => number;

export type RetryPolicy<E = unknown> = {
  maxRetries: number;
  sleep: SleepFunction;
  baseDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  jitter?: JitterMode | ((delayMs: number) => number) | undefined;
  random?: RandomSource | undefined;
  shouldRetry?: ((error: E, attempt: number) => boolean) | undefined;
  retryDelay?: ((error: E, attempt: number, computedDelayMs: number) => number) | undefined;
  onRetry?: ((error: E, attempt: number, delayMs: number) => void) | undefined;
  signal?: AbortSignal | undefined;
};

export class RetryExhaustedError<E = unknown> extends Error {
  override readonly name = 'RetryExhaustedError';

  constructor(
    readonly attempts: number,
    readonly lastError: E,
    readonly errors: readonly E[]
  ) {
    super(`Retry exhausted after ${attempts} attempts`, { cause: lastError });
  }
}

export async function withRetry<T, E>(
  fn: () => Promise<Result<T, E>> | Result<T, E>,
  policy: RetryPolicy<E>
): Promise<Result<T, E | RetryExhaustedError<E> | SleepAbortedError>> {
  const {
    maxRetries,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    jitter,
    random,
    shouldRetry,
    retryDelay,
    onRetry,
    signal,
    sleep: sleepFor,
  } = policy;

  if (maxRetries < 0) throw new Error('maxRetries must be >= 0');
  if (baseDelayMs < 0) throw new Error('baseDelayMs must be >= 0');
  if (maxDelayMs < 0) throw new Error('maxDelayMs must be >= 0');
  if (typeof sleepFor !== 'function') throw new Error('RetryPolicy sleep function is required');

  const errors: E[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await fn();
    if (!isErr(result)) return result;

    const error = result.error;
    errors.push(error);

    if (shouldRetry != null && !shouldRetry(error, attempt)) return result.asErr<T>();
    if (attempt === maxRetries) {
      return Err(new RetryExhaustedError(attempt + 1, error, errors));
    }

    let delayMs = calculateBackoff(attempt, baseDelayMs, maxDelayMs);
    delayMs = applyJitter(delayMs, jitter, random);
    if (retryDelay != null) delayMs = retryDelay(error, attempt, delayMs);
    delayMs = Math.max(0, Math.min(delayMs, maxDelayMs));

    try {
      onRetry?.(error, attempt, delayMs);
    } catch {
      // Retry callbacks are observational only.
    }

    try {
      await sleepFor(delayMs, signal);
    } catch (sleepError) {
      if (sleepError instanceof SleepAbortedError) return Err(sleepError);
      throw sleepError;
    }
  }

  return Err(new RetryExhaustedError(maxRetries + 1, errors[errors.length - 1] as E, errors));
}

function calculateBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
}

function applyJitter(
  delayMs: number,
  jitter: RetryPolicy['jitter'],
  random: RandomSource | undefined
): number {
  if (jitter == null || jitter === JitterMode.NONE) return delayMs;
  if (jitter === JitterMode.FULL) {
    if (random == null) {
      throw new Error('RetryPolicy random source is required for full jitter');
    }
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error('RetryPolicy random source must return a finite number in [0, 1)');
    }
    return value * delayMs;
  }
  return jitter(delayMs);
}
