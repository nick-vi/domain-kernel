import { Err, Ok, type Result } from './result';

export type NumberingSequenceConfig = {
  name: string;
  start?: bigint | number | undefined;
  increment?: bigint | number | undefined;
  min?: bigint | number | undefined;
  max?: bigint | number | undefined;
  cycle?: boolean | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
  padTo?: number | undefined;
};

export type NumberingSequenceState = {
  current?: string | undefined;
};

export type NumberingSequenceNext = {
  value: bigint;
  formatted: string;
  state: NumberingSequenceState;
};

export class NumberingSequenceError extends Error {
  override readonly name = 'NumberingSequenceError';

  constructor(
    readonly code: 'invalid_sequence' | 'sequence_exhausted',
    message: string
  ) {
    super(message);
  }
}

export class NumberingSequence {
  private current: bigint | undefined;
  private readonly start: bigint;
  private readonly increment: bigint;
  private readonly min: bigint | undefined;
  private readonly max: bigint | undefined;

  constructor(
    private readonly config: NumberingSequenceConfig,
    state: NumberingSequenceState = {}
  ) {
    if (config.name.trim().length === 0) {
      throw new NumberingSequenceError('invalid_sequence', 'Sequence name must be non-empty');
    }

    this.start = toBigInt(config.start ?? 1);
    this.increment = toBigInt(config.increment ?? 1);
    if (this.increment === 0n) {
      throw new NumberingSequenceError('invalid_sequence', 'Sequence increment must not be zero');
    }
    this.min = config.min != null ? toBigInt(config.min) : undefined;
    this.max = config.max != null ? toBigInt(config.max) : undefined;
    this.current = state.current != null ? BigInt(state.current) : undefined;
  }

  next(): Result<NumberingSequenceNext, NumberingSequenceError> {
    const candidate = this.current == null ? this.start : this.current + this.increment;
    const value = this.applyBounds(candidate);
    if (!value.ok) return value.asErr<NumberingSequenceNext>();

    this.current = value.value;
    return Ok({
      value: value.value,
      formatted: this.format(value.value),
      state: this.toState(),
    });
  }

  peek(): Result<NumberingSequenceNext, NumberingSequenceError> {
    const snapshot = this.current;
    const result = this.next();
    this.current = snapshot;
    return result;
  }

  setCurrent(value: bigint | number): void {
    this.current = toBigInt(value);
  }

  toState(): NumberingSequenceState {
    return {
      ...(this.current != null ? { current: this.current.toString() } : {}),
    };
  }

  private applyBounds(candidate: bigint): Result<bigint, NumberingSequenceError> {
    if (this.max != null && candidate > this.max) {
      if (this.config.cycle === true && this.min != null) return Ok(this.min);
      return Err(new NumberingSequenceError('sequence_exhausted', `Sequence "${this.config.name}" exceeded max`));
    }

    if (this.min != null && candidate < this.min) {
      if (this.config.cycle === true && this.max != null) return Ok(this.max);
      return Err(new NumberingSequenceError('sequence_exhausted', `Sequence "${this.config.name}" exceeded min`));
    }

    return Ok(candidate);
  }

  private format(value: bigint): string {
    const sign = value < 0n ? '-' : '';
    const absolute = (value < 0n ? -value : value).toString();
    const padded =
      this.config.padTo != null ? absolute.padStart(this.config.padTo, '0') : absolute;
    return `${this.config.prefix ?? ''}${sign}${padded}${this.config.suffix ?? ''}`;
  }
}

function toBigInt(value: bigint | number): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isInteger(value)) {
    throw new NumberingSequenceError('invalid_sequence', 'Sequence values must be integers');
  }
  return BigInt(value);
}
