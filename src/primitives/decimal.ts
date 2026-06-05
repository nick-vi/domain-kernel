import { Err, Ok, type Result } from './result';

export const RoundingMode = Object.freeze({
  CEILING: 'ceiling',
  DOWN: 'down',
  FLOOR: 'floor',
  HALF_DOWN: 'half_down',
  HALF_EVEN: 'half_even',
  HALF_UP: 'half_up',
  UP: 'up',
} as const);

export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

export type RoundingPolicy = {
  mode: RoundingMode;
};

export type ScalePolicy = {
  scale: number;
  rounding: RoundingPolicy;
};

export const DEFAULT_ROUNDING_POLICY: RoundingPolicy = Object.freeze({
  mode: RoundingMode.HALF_EVEN,
});

export class DecimalError extends Error {
  override readonly name = 'DecimalError';

  constructor(
    readonly code: 'invalid_decimal' | 'division_by_zero' | 'invalid_scale',
    message: string,
    readonly input?: unknown
  ) {
    super(message);
  }
}

export class Decimal {
  private constructor(
    readonly coefficient: bigint,
    readonly scale: number
  ) {}

  static fromParts(coefficient: bigint, scale = 0): Result<Decimal, DecimalError> {
    if (!Number.isInteger(scale) || scale < 0) {
      return Err(new DecimalError('invalid_scale', 'Decimal scale must be a non-negative integer', scale));
    }
    return Ok(new Decimal(coefficient === 0n ? 0n : coefficient, scale));
  }

  static parse(input: string | number | bigint): Result<Decimal, DecimalError> {
    if (typeof input === 'bigint') return Ok(new Decimal(input, 0));

    const text = String(input).trim();
    const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(text);
    if (match == null) {
      return Err(new DecimalError('invalid_decimal', `Invalid decimal value: ${text}`, input));
    }

    const sign = match[1] === '-' ? -1n : 1n;
    const integer = match[2]!;
    const fraction = match[3] ?? '';
    const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, '');
    const coefficient = BigInt(digits) * sign;

    return Ok(new Decimal(coefficient === 0n ? 0n : coefficient, fraction.length));
  }

  static zero(scale = 0): Decimal {
    assertScale(scale);
    return new Decimal(0n, scale);
  }

  add(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    const left = this.coefficient * pow10(scale - this.scale);
    const right = other.coefficient * pow10(scale - other.scale);
    return new Decimal(left + right, scale);
  }

  subtract(other: Decimal): Decimal {
    return this.add(other.negate());
  }

  multiply(other: Decimal): Decimal {
    return new Decimal(this.coefficient * other.coefficient, this.scale + other.scale);
  }

  divide(
    other: Decimal,
    policy: ScalePolicy
  ): Result<Decimal, DecimalError> {
    if (other.coefficient === 0n) {
      return Err(new DecimalError('division_by_zero', 'Cannot divide Decimal by zero'));
    }
    assertScale(policy.scale);

    const numerator = this.coefficient * pow10(other.scale + policy.scale);
    const denominator = other.coefficient * pow10(this.scale);
    return Ok(new Decimal(roundQuotient(numerator, denominator, policy.rounding.mode), policy.scale));
  }

  negate(): Decimal {
    return new Decimal(-this.coefficient, this.scale);
  }

  abs(): Decimal {
    return this.coefficient < 0n ? this.negate() : this;
  }

  quantize(policy: ScalePolicy): Decimal {
    assertScale(policy.scale);
    if (policy.scale >= this.scale) {
      return new Decimal(this.coefficient * pow10(policy.scale - this.scale), policy.scale);
    }

    const divisor = pow10(this.scale - policy.scale);
    return new Decimal(roundQuotient(this.coefficient, divisor, policy.rounding.mode), policy.scale);
  }

  normalize(): Decimal {
    if (this.coefficient === 0n) return new Decimal(0n, 0);

    let coefficient = this.coefficient;
    let scale = this.scale;
    while (scale > 0 && coefficient % 10n === 0n) {
      coefficient /= 10n;
      scale--;
    }
    return new Decimal(coefficient, scale);
  }

  compare(other: Decimal): -1 | 0 | 1 {
    const scale = Math.max(this.scale, other.scale);
    const left = this.coefficient * pow10(scale - this.scale);
    const right = other.coefficient * pow10(scale - other.scale);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  equals(other: Decimal): boolean {
    return this.compare(other) === 0;
  }

  isZero(): boolean {
    return this.coefficient === 0n;
  }

  toString(): string {
    const sign = this.coefficient < 0n ? '-' : '';
    const digits = absBigInt(this.coefficient).toString();
    if (this.scale === 0) return `${sign}${digits}`;

    const padded = digits.padStart(this.scale + 1, '0');
    const integer = padded.slice(0, padded.length - this.scale);
    const fraction = padded.slice(padded.length - this.scale);
    return `${sign}${integer}.${fraction}`;
  }

  toJSON(): string {
    return this.toString();
  }
}

function roundQuotient(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) throw new Error('Cannot round quotient with zero denominator');

  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const absoluteNumerator = absBigInt(numerator);
  const absoluteDenominator = absBigInt(denominator);
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;

  if (remainder === 0n) return quotient * sign;

  const increment = shouldIncrement(sign, quotient, remainder, absoluteDenominator, mode) ? 1n : 0n;
  return (quotient + increment) * sign;
}

function shouldIncrement(
  sign: bigint,
  quotient: bigint,
  remainder: bigint,
  denominator: bigint,
  mode: RoundingMode
): boolean {
  switch (mode) {
    case RoundingMode.DOWN:
      return false;
    case RoundingMode.UP:
      return true;
    case RoundingMode.CEILING:
      return sign > 0n;
    case RoundingMode.FLOOR:
      return sign < 0n;
    case RoundingMode.HALF_UP:
      return remainder * 2n >= denominator;
    case RoundingMode.HALF_DOWN:
      return remainder * 2n > denominator;
    case RoundingMode.HALF_EVEN: {
      const doubled = remainder * 2n;
      return doubled > denominator || (doubled === denominator && quotient % 2n !== 0n);
    }
  }
}

function pow10(exponent: number): bigint {
  assertScale(exponent);
  return 10n ** BigInt(exponent);
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new DecimalError('invalid_scale', 'Decimal scale must be a non-negative integer', scale);
  }
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}
