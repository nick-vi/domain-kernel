import { Err, isErr, Ok, type Result } from './result';

export const CircuitState = Object.freeze({
  Closed: 'closed',
  Open: 'open',
  HalfOpen: 'half-open',
} as const);

export type CircuitState = (typeof CircuitState)[keyof typeof CircuitState];

export type CircuitBreakerClock = {
  now(): number;
};

export type CircuitBreakerOptions = {
  clock: CircuitBreakerClock;
  failureThreshold?: number | undefined;
  recoveryTimeoutMs?: number | undefined;
  immediateOpenCodes?: readonly string[] | undefined;
};

export class CircuitBreakerOpenError extends Error {
  override readonly name = 'CircuitBreakerOpenError';

  constructor(readonly state: CircuitState = CircuitState.Open) {
    super(`Circuit breaker is ${state}`);
  }
}

export class CircuitBreaker {
  private currentState: CircuitState = CircuitState.Closed;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly immediateOpenCodes: Set<string>;
  private readonly clock: CircuitBreakerClock;

  constructor(options: CircuitBreakerOptions) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 5000;
    this.immediateOpenCodes = new Set(options.immediateOpenCodes ?? []);
    this.clock = options.clock;
  }

  get state(): CircuitState {
    if (
      this.currentState === CircuitState.Open &&
      this.now() - this.lastFailureTime >= this.recoveryTimeoutMs
    ) {
      this.currentState = CircuitState.HalfOpen;
    }
    return this.currentState;
  }

  async execute<T, E>(
    fn: () => Promise<Result<T, E>> | Result<T, E>
  ): Promise<Result<T, E | CircuitBreakerOpenError>> {
    if (this.state === CircuitState.Open) {
      return Err(new CircuitBreakerOpenError(this.currentState));
    }

    const result = await fn();
    if (!isErr(result)) {
      this.onSuccess();
      return Ok(result.value);
    }

    this.onFailure(result.error);
    return result.asErr<T>();
  }

  reset(): void {
    this.currentState = CircuitState.Closed;
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
  }

  shouldImmediatelyOpen(error: unknown): boolean {
    const code = extractErrorCode(error);
    return code != null && this.immediateOpenCodes.has(code);
  }

  private onSuccess(): void {
    this.currentState = CircuitState.Closed;
    this.consecutiveFailures = 0;
  }

  private onFailure(error: unknown): void {
    this.consecutiveFailures++;
    this.lastFailureTime = this.now();

    if (
      this.shouldImmediatelyOpen(error) ||
      this.consecutiveFailures >= this.failureThreshold ||
      this.currentState === CircuitState.HalfOpen
    ) {
      this.currentState = CircuitState.Open;
    }
  }

  private now(): number {
    const value = this.clock.now();
    if (!Number.isFinite(value)) {
      throw new Error('CircuitBreaker clock must return a finite number');
    }
    return value;
  }
}

function extractErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error && typeof error.cause === 'object' && error.cause !== null) {
    const cause = error.cause as Record<string, unknown>;
    if (typeof cause.code === 'string') return cause.code;
  }
  return null;
}
