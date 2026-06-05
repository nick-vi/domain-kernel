import { describe, expect, it } from 'vitest';
import {
  addCalendarPeriod,
  claimDueOutboxMessages,
  command,
  createOutboxMessage,
  createStateMachine,
  Decimal,
  eventCausedBy,
  eventEnvelope,
  formatCalendarDate,
  formatIsoPeriod,
  idempotencyFingerprint,
  idempotencyRecordIsExpired,
  IdempotencyStatus,
  isErr,
  markIdempotencyFailed,
  markIdempotencySucceeded,
  markOutboxFailed,
  markOutboxPublished,
  measurement,
  NumberingSequence,
  OutboxStatus,
  parseCalendarDate,
  parseIsoPeriod,
  periodToMilliseconds,
  quantity,
  resolveIdempotency,
  RoundingMode,
  startIdempotency,
  unit,
  UnitConverter,
} from '@/primitives';

describe('decimal, quantity, and unit primitives', () => {
  it('parses and rounds exact decimal values without binary floating point', () => {
    const left = Decimal.parse('0.1').unwrap();
    const right = Decimal.parse('0.2').unwrap();
    const sum = left.add(right);

    expect(sum.toString()).toBe('0.3');
    expect(Decimal.parse('2.5').unwrap().quantize({ scale: 0, rounding: { mode: RoundingMode.HALF_EVEN } }).toString()).toBe(
      '2'
    );
    expect(Decimal.parse('3.5').unwrap().quantize({ scale: 0, rounding: { mode: RoundingMode.HALF_EVEN } }).toString()).toBe(
      '4'
    );
    expect(
      Decimal.parse('1')
        .unwrap()
        .divide(Decimal.parse('3').unwrap(), {
          scale: 2,
          rounding: { mode: RoundingMode.HALF_UP },
        })
        .unwrap()
        .toString()
    ).toBe('0.33');
  });

  it('models quantities and converts compatible units', () => {
    const kilogram = unit('kg', { system: 'ucum', dimension: 'mass' }).unwrap();
    const gram = unit('g', { system: 'ucum', dimension: 'mass' }).unwrap();
    const meter = unit('m', { system: 'ucum', dimension: 'length' }).unwrap();
    const converter = new UnitConverter([
      {
        from: kilogram,
        to: gram,
        factor: Decimal.parse('1000').unwrap(),
      },
    ]);

    const weight = quantity('2.5', kilogram).unwrap();
    const converted = converter.convert(weight, gram).unwrap();

    expect(converted.amount.toString()).toBe('2500.0');
    expect(converted.unit).toEqual(gram);
    expect(isErr(converter.convert(weight, meter))).toBe(true);
    expect(measurement(weight, { source: 'scale' })).toMatchObject({
      quantity: weight,
      source: 'scale',
    });
  });
});

describe('period, calendar, and sequence primitives', () => {
  it('parses ISO-style periods and respects calendar-month ambiguity', () => {
    const parsed = parseIsoPeriod('P1Y2M3DT4H5M6S').unwrap();

    expect(formatIsoPeriod(parsed)).toBe('P1Y2M3DT4H5M6S');
    expect(periodToMilliseconds(parseIsoPeriod('PT1H30M').unwrap()).unwrap()).toBe(5_400_000);
    expect(isErr(periodToMilliseconds(parsed))).toBe(true);
    expect(formatCalendarDate(addCalendarPeriod('2026-01-31', parseIsoPeriod('P1M').unwrap()).unwrap())).toBe(
      '2026-02-28'
    );
    expect(formatCalendarDate(addCalendarPeriod('0001-01-31', parseIsoPeriod('P1M').unwrap()).unwrap())).toBe(
      '0001-02-28'
    );
    expect(isErr(parseCalendarDate('0000-01-01'))).toBe(true);
    expect(
      isErr(
        addCalendarPeriod(parseCalendarDate('2026-01-31').unwrap(), parseIsoPeriod('P1M').unwrap(), {
          overflow: 'reject',
        })
      )
    ).toBe(true);
  });

  it('generates formatted sequence numbers and preserves state', () => {
    const sequence = new NumberingSequence({
      name: 'document',
      prefix: 'DOC-',
      padTo: 4,
      max: 2,
      cycle: true,
      min: 1,
    });

    expect(sequence.next().unwrap().formatted).toBe('DOC-0001');
    expect(sequence.next().unwrap().formatted).toBe('DOC-0002');
    expect(sequence.next().unwrap().formatted).toBe('DOC-0001');

    const restored = new NumberingSequence({ name: 'document', prefix: 'DOC-', padTo: 4 }, sequence.toState());
    expect(restored.next().unwrap().formatted).toBe('DOC-0002');
  });
});

describe('state machine primitive', () => {
  it('transitions with guards and final-state awareness', () => {
    const machine = createStateMachine<{ approved: boolean }>({
      states: ['draft', 'submitted', 'approved'],
      initial: 'draft',
      final: ['approved'],
      transitions: [
        { from: 'draft', event: 'submit', to: 'submitted' },
        {
          from: 'submitted',
          event: 'approve',
          to: 'approved',
          guard: ({ context }) => context.approved,
        },
      ],
    }).unwrap();

    expect(machine.transition(machine.initial, 'submit', { approved: false }).unwrap()).toMatchObject({
      from: 'draft',
      to: 'submitted',
      final: false,
    });
    expect(isErr(machine.transition('submitted', 'approve', { approved: false }))).toBe(true);
    expect(machine.transition('submitted', 'approve', { approved: true }).unwrap()).toMatchObject({
      to: 'approved',
      final: true,
    });
  });
});

describe('command, event, outbox, and idempotency primitives', () => {
  it('connects command causation to event envelopes', () => {
    const created = command({
      id: 'cmd_001',
      type: 'case.create',
      payload: { caseId: 'case_001' },
      occurredAt: '2026-06-04T12:00:00.000Z',
      actorId: 'actor_001',
    });
    const event = eventCausedBy(
      {
        id: 'evt_001',
        source: '/cases',
        type: 'com.example.case.created.v1',
        time: '2026-06-04T12:00:01.000Z',
        data: { caseId: 'case_001' },
      },
      created
    );

    expect(event).toMatchObject({
      specversion: '1.0',
      causationId: 'cmd_001',
      correlationId: 'cmd_001',
      actorId: 'actor_001',
    });
  });

  it('models outbox lifecycle without publishing inside the transaction', () => {
    const event = eventEnvelope({
      id: 'evt_001',
      source: '/cases',
      type: 'com.example.case.created.v1',
      time: '2026-06-04T12:00:00.000Z',
    });
    const message = createOutboxMessage({
      id: 'outbox_001',
      event,
      now: '2026-06-04T12:00:00.000Z',
    });

    expect(claimDueOutboxMessages([message], '2026-06-04T12:00:01.000Z')).toMatchObject([
      { status: OutboxStatus.PUBLISHING },
    ]);

    const failed = markOutboxFailed(message, {
      now: '2026-06-04T12:00:02.000Z',
      error: 'network',
      maxAttempts: 1,
    });
    expect(failed.status).toBe(OutboxStatus.DEAD);
    expect(markOutboxPublished(message, '2026-06-04T12:00:03.000Z').status).toBe(OutboxStatus.PUBLISHED);
  });

  it('uses idempotency fingerprints to replay matching completed work', () => {
    const fingerprint = idempotencyFingerprint({ amount: '10.00', customer: 'A' });
    expect(fingerprint).toBe(idempotencyFingerprint({ customer: 'A', amount: '10.00' }));

    const started = startIdempotency<{ id: string }>({
      key: 'request_001',
      fingerprint,
      now: '2026-06-04T12:00:00.000Z',
      inProgressExpiresAt: '2026-06-04T12:00:01.000Z',
    });
    expect(idempotencyRecordIsExpired(started, '2026-06-04T12:00:01.000Z')).toBe(true);
    expect(
      resolveIdempotency(started, {
        key: started.key,
        fingerprint,
        now: '2026-06-04T12:00:01.000Z',
      }).unwrap()
    ).toBe('start');
    expect(resolveIdempotency(started, { key: started.key, fingerprint, now: started.createdAt }).unwrapOr('blocked')).toBe(
      'blocked'
    );

    const succeeded = markIdempotencySucceeded(started, {
      now: '2026-06-04T12:00:02.000Z',
      response: { id: 'case_001' },
      replayExpiresAt: '2026-06-04T12:10:00.000Z',
    });
    expect(succeeded.status).toBe(IdempotencyStatus.SUCCEEDED);
    expect('error' in succeeded).toBe(false);
    expect('inProgressExpiresAt' in succeeded).toBe(false);
    expect(
      resolveIdempotency(succeeded, { key: succeeded.key, fingerprint, now: succeeded.updatedAt }).unwrap()
    ).toEqual({ replay: succeeded });
    expect(
      resolveIdempotency(succeeded, {
        key: succeeded.key,
        fingerprint,
        now: '2026-06-04T12:10:00.000Z',
      }).unwrap()
    ).toBe('start');
    const failed = markIdempotencyFailed(succeeded, {
      now: '2026-06-04T12:00:03.000Z',
      error: 'failed',
    });
    expect(failed.status).toBe(IdempotencyStatus.FAILED);
    expect('response' in failed).toBe(false);
    expect(
      isErr(
        resolveIdempotency(succeeded, {
          key: succeeded.key,
          fingerprint: idempotencyFingerprint({ amount: '11.00' }),
          now: succeeded.updatedAt,
        })
      )
    ).toBe(true);
  });

  it('rejects idempotency fingerprints for non-JSON values', () => {
    expect(() => idempotencyFingerprint({ ok: true })).not.toThrow();
    expect(() => idempotencyFingerprint({ invalid: undefined })).toThrow(/not serializable/);
    expect(() => idempotencyFingerprint({ invalid: Number.POSITIVE_INFINITY })).toThrow(/finite number/);
  });
});
