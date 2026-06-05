import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from './time';
import { Err, Ok, type Result } from './result';

export type Period = {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export type CalendarOverflow = 'constrain' | 'reject';

export class CalendarError extends Error {
  override readonly name = 'CalendarError';

  constructor(
    readonly code: 'invalid_date' | 'invalid_period' | 'unsupported_duration',
    message: string,
    readonly input?: unknown
  ) {
    super(message);
  }
}

const ZERO_PERIOD: Period = Object.freeze({
  years: 0,
  months: 0,
  weeks: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
});

export function period(input: Partial<Period>): Period {
  return {
    years: input.years ?? 0,
    months: input.months ?? 0,
    weeks: input.weeks ?? 0,
    days: input.days ?? 0,
    hours: input.hours ?? 0,
    minutes: input.minutes ?? 0,
    seconds: input.seconds ?? 0,
  };
}

export function parseIsoPeriod(input: string): Result<Period, CalendarError> {
  const match =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      input
    );
  if (match == null || input === 'P' || input === 'PT') {
    return Err(new CalendarError('invalid_period', `Invalid ISO period: ${input}`, input));
  }

  return Ok({
    years: numberPart(match[1]),
    months: numberPart(match[2]),
    weeks: numberPart(match[3]),
    days: numberPart(match[4]),
    hours: numberPart(match[5]),
    minutes: numberPart(match[6]),
    seconds: numberPart(match[7]),
  });
}

export function formatIsoPeriod(value: Period): string {
  const dateParts = [
    value.years !== 0 ? `${value.years}Y` : '',
    value.months !== 0 ? `${value.months}M` : '',
    value.weeks !== 0 ? `${value.weeks}W` : '',
    value.days !== 0 ? `${value.days}D` : '',
  ].join('');
  const timeParts = [
    value.hours !== 0 ? `${value.hours}H` : '',
    value.minutes !== 0 ? `${value.minutes}M` : '',
    value.seconds !== 0 ? `${value.seconds}S` : '',
  ].join('');

  if (dateParts.length === 0 && timeParts.length === 0) return 'PT0S';
  return `P${dateParts}${timeParts.length > 0 ? `T${timeParts}` : ''}`;
}

export function periodToMilliseconds(value: Period): Result<number, CalendarError> {
  if (value.years !== 0 || value.months !== 0) {
    return Err(
      new CalendarError(
        'unsupported_duration',
        'Cannot convert calendar years or months to milliseconds without a reference date'
      )
    );
  }

  return Ok(
    value.weeks * 7 * DAY_MS +
      value.days * DAY_MS +
      value.hours * HOUR_MS +
      value.minutes * MINUTE_MS +
      value.seconds * SECOND_MS
  );
}

export function parseCalendarDate(input: string): Result<CalendarDate, CalendarError> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (match == null) {
    return Err(new CalendarError('invalid_date', `Invalid calendar date: ${input}`, input));
  }

  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  if (!isValidCalendarDate(date)) {
    return Err(new CalendarError('invalid_date', `Invalid calendar date: ${input}`, input));
  }
  return Ok(date);
}

export function formatCalendarDate(date: CalendarDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(
    date.day
  ).padStart(2, '0')}`;
}

export function addCalendarPeriod(
  date: CalendarDate | string,
  value: Period,
  options: { overflow?: CalendarOverflow | undefined } = {}
): Result<CalendarDate, CalendarError> {
  const parsed = typeof date === 'string' ? parseCalendarDate(date) : Ok(date);
  if (!parsed.ok) return parsed;
  if (!isValidCalendarDate(parsed.value)) {
    return Err(new CalendarError('invalid_date', 'Invalid calendar date', parsed.value));
  }

  const overflow = options.overflow ?? 'constrain';
  const monthIndex = parsed.value.month - 1 + value.years * 12 + value.months;
  const targetYear = parsed.value.year + Math.floor(monthIndex / 12);
  const targetMonth = positiveModulo(monthIndex, 12) + 1;
  const targetMonthDays = daysInMonth(targetYear, targetMonth);

  if (overflow === 'reject' && parsed.value.day > targetMonthDays) {
    return Err(
      new CalendarError(
        'invalid_date',
        `Day ${parsed.value.day} does not exist in target month ${targetYear}-${targetMonth}`
      )
    );
  }

  const constrainedDay = Math.min(parsed.value.day, targetMonthDays);
  const result = utcDate(
    targetYear,
    targetMonth - 1,
    constrainedDay + value.weeks * 7 + value.days,
    value.hours,
    value.minutes,
    value.seconds
  );

  return Ok({
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  });
}

export function isZeroPeriod(value: Period): boolean {
  return (
    value.years === ZERO_PERIOD.years &&
    value.months === ZERO_PERIOD.months &&
    value.weeks === ZERO_PERIOD.weeks &&
    value.days === ZERO_PERIOD.days &&
    value.hours === ZERO_PERIOD.hours &&
    value.minutes === ZERO_PERIOD.minutes &&
    value.seconds === ZERO_PERIOD.seconds
  );
}

function numberPart(value: string | undefined): number {
  return value == null ? 0 : Number(value);
}

function isValidCalendarDate(date: CalendarDate): boolean {
  if (!Number.isInteger(date.year) || !Number.isInteger(date.month) || !Number.isInteger(date.day)) {
    return false;
  }
  if (date.year < 1) return false;
  return date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= daysInMonth(date.year, date.month);
}

function daysInMonth(year: number, month: number): number {
  return utcDate(year, month, 0).getUTCDate();
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function utcDate(
  year: number,
  monthIndex: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0
): Date {
  const date = new Date(Date.UTC(0, monthIndex, day, hours, minutes, seconds));
  date.setUTCFullYear(year);
  return date;
}
