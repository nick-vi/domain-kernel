import { Decimal, type ScalePolicy } from './decimal';
import { Err, Ok, type Result } from './result';

export type UnitSystem = string;

export type Unit = {
  code: string;
  system: UnitSystem;
  dimension?: string | undefined;
};

export type Quantity = {
  amount: Decimal;
  unit: Unit;
};

export type Measurement<TMetadata extends Record<string, unknown> = Record<string, unknown>> = {
  quantity: Quantity;
  measuredAt?: string | undefined;
  source?: string | undefined;
  metadata?: TMetadata | undefined;
};

export type UnitConversion = {
  from: Unit;
  to: Unit;
  factor: Decimal;
  offset?: Decimal | undefined;
  scalePolicy?: ScalePolicy | undefined;
};

export class MeasurementError extends Error {
  override readonly name = 'MeasurementError';

  constructor(
    readonly code: 'invalid_quantity' | 'invalid_unit' | 'incompatible_unit' | 'conversion_not_found',
    message: string
  ) {
    super(message);
  }
}

export function unit(
  code: string,
  options: { system?: UnitSystem | undefined; dimension?: string | undefined } = {}
): Result<Unit, MeasurementError> {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return Err(new MeasurementError('invalid_unit', 'Unit code must be non-empty'));
  }
  return Ok({
    code: trimmed,
    system: options.system ?? 'custom',
    ...(options.dimension != null ? { dimension: options.dimension } : {}),
  });
}

export function quantity(amount: Decimal | string | number | bigint, unitValue: Unit): Result<Quantity, MeasurementError> {
  const parsed = amount instanceof Decimal ? Ok(amount) : Decimal.parse(amount);
  if (!parsed.ok) return Err(new MeasurementError('invalid_quantity', parsed.error.message));
  return Ok({ amount: parsed.value, unit: unitValue });
}

export function measurement<TMetadata extends Record<string, unknown> = Record<string, unknown>>(
  quantityValue: Quantity,
  options: {
    measuredAt?: string | undefined;
    source?: string | undefined;
    metadata?: TMetadata | undefined;
  } = {}
): Measurement<TMetadata> {
  return {
    quantity: quantityValue,
    ...(options.measuredAt != null ? { measuredAt: options.measuredAt } : {}),
    ...(options.source != null ? { source: options.source } : {}),
    ...(options.metadata != null ? { metadata: options.metadata } : {}),
  };
}

export function unitsEqual(left: Unit, right: Unit): boolean {
  return left.system === right.system && left.code === right.code;
}

export function unitsCommensurable(left: Unit, right: Unit): boolean {
  if (left.dimension == null || right.dimension == null) return unitsEqual(left, right);
  return left.dimension === right.dimension;
}

export class UnitConverter {
  private readonly conversions = new Map<string, UnitConversion>();

  constructor(conversions: readonly UnitConversion[] = []) {
    for (const conversion of conversions) {
      this.register(conversion);
    }
  }

  register(conversion: UnitConversion): void {
    this.conversions.set(conversionKey(conversion.from, conversion.to), conversion);
  }

  convert(value: Quantity, to: Unit, scalePolicy?: ScalePolicy | undefined): Result<Quantity, MeasurementError> {
    if (unitsEqual(value.unit, to)) {
      return Ok({ amount: scalePolicy != null ? value.amount.quantize(scalePolicy) : value.amount, unit: to });
    }

    if (!unitsCommensurable(value.unit, to)) {
      return Err(
        new MeasurementError(
          'incompatible_unit',
          `Cannot convert ${value.unit.code} to incompatible unit ${to.code}`
        )
      );
    }

    const conversion = this.conversions.get(conversionKey(value.unit, to));
    if (conversion == null) {
      return Err(new MeasurementError('conversion_not_found', `No conversion registered from ${value.unit.code} to ${to.code}`));
    }

    const converted = value.amount.multiply(conversion.factor).add(conversion.offset ?? Decimal.zero());
    const policy = scalePolicy ?? conversion.scalePolicy;
    return Ok({
      amount: policy != null ? converted.quantize(policy) : converted,
      unit: to,
    });
  }
}

function conversionKey(from: Unit, to: Unit): string {
  return `${from.system}:${from.code}->${to.system}:${to.code}`;
}
