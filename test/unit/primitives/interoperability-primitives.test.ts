import { describe, expect, it } from 'vitest';
import {
  ProcessStatus,
  baggageToRecord,
  buildTraceContext,
  completeProcess,
  completeProcessStep,
  createProcess,
  createProjectionRecord,
  createProjectionSnapshot,
  extractTraceContext,
  failProcess,
  formatBaggage,
  formatTraceparent,
  injectTraceContext,
  integerAtLeast,
  isProblemDetails,
  isoTimestamp,
  nonEmptyString,
  parseBaggage,
  parseTraceparent,
  planImport,
  problemDetails,
  startProcessStep,
  waitForProcess,
} from '@/primitives';

describe('trace context primitives', () => {
  it('parses and formats W3C traceparent values', () => {
    const parsed = parseTraceparent(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      'vendor=value'
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentId: '00f067aa0ba902b7',
      traceFlags: '01',
      sampled: true,
      traceState: 'vendor=value',
    });
    expect(formatTraceparent(parsed.value)).toBe(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    );
  });

  it('rejects invalid trace ids and parent ids', () => {
    expect(
      parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01').ok
    ).toBe(false);
    expect(
      parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01').ok
    ).toBe(false);
  });

  it('builds unsampled trace contexts explicitly', () => {
    const context = buildTraceContext({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentId: '00f067aa0ba902b7',
      sampled: false,
    });

    expect(context.traceFlags).toBe('00');
    expect(context.sampled).toBe(false);
  });

  it('extracts and injects trace context carriers', () => {
    const extracted = extractTraceContext({
      TraceParent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      baggage: ['tenant=acme', 'region=eu'],
    });

    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    expect(extracted.value.traceContext?.sampled).toBe(true);
    expect(baggageToRecord(extracted.value.baggage ?? { entries: [] })).toEqual({
      tenant: 'acme',
      region: 'eu',
    });

    const injected = injectTraceContext({}, extracted.value);
    expect(injected.ok).toBe(true);
    if (!injected.ok) return;
    expect(injected.value.traceparent).toBe(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    );
    expect(injected.value.baggage).toBe('tenant=acme,region=eu');
  });
});

describe('baggage primitives', () => {
  it('parses and formats W3C baggage entries with properties', () => {
    const parsed = parseBaggage('userId=Am%C3%A9lie;sampled=true, region = eu');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.entries).toMatchObject([
      { key: 'userId', value: decodeURIComponent('Am%C3%A9lie') },
      { key: 'region', value: 'eu' },
    ]);
    expect(parsed.value.entries[0]?.value).toBe(decodeURIComponent('Am%C3%A9lie'));
    expect(formatBaggage(parsed.value).unwrap()).toBe('userId=Am%C3%A9lie;sampled=true,region=eu');
  });
});

describe('problem details primitives', () => {
  it('creates RFC-style problem detail bodies with extensions', () => {
    const problem = problemDetails({
      type: 'https://example.test/problems/validation',
      title: 'Validation failed',
      status: 422,
      detail: 'Name is required',
      instance: '/requests/req_001',
      extensions: { request_id: 'req_001' },
    });

    expect(problem).toMatchObject({
      type: 'https://example.test/problems/validation',
      title: 'Validation failed',
      status: 422,
      request_id: 'req_001',
    });
    expect(isProblemDetails(problem)).toBe(true);
  });

  it('rejects reserved extension names', () => {
    expect(() =>
      problemDetails({
        title: 'Invalid',
        extensions: { status: 400 },
      })
    ).toThrow('reserved member');
  });
});

describe('import/export and invariant primitives', () => {
  it('plans idempotent creates, updates, skips, and conflicts', () => {
    const plan = planImport({
      incoming: [
        { externalId: 'a', value: { name: 'Alpha' } },
        { externalId: 'b', value: { name: 'Beta 2' } },
        { externalId: 'c', value: { name: 'Gamma' } },
        { externalId: 'c', value: { name: 'Duplicate Gamma' } },
      ],
      existing: [
        { localId: 'local_a', externalId: 'a', value: { name: 'Alpha' } },
        { localId: 'local_b', externalId: 'b', value: { name: 'Beta' } },
      ],
    });

    expect(plan).toMatchObject({
      creates: 1,
      updates: 1,
      skips: 1,
      conflicts: 1,
    });
    expect(plan.changes.map((change) => change.action)).toEqual([
      'skip',
      'update',
      'create',
      'conflict',
    ]);
  });

  it('returns typed invariant results', () => {
    expect(nonEmptyString('item_001').ok).toBe(true);
    expect(nonEmptyString('').ok).toBe(false);
    expect(isoTimestamp('2026-06-04T12:00:00.000Z').ok).toBe(true);
    expect(isoTimestamp('2026-06-04').ok).toBe(false);
    expect(integerAtLeast(2, 1).ok).toBe(true);
    expect(integerAtLeast(0, 1).ok).toBe(false);
  });
});

describe('process manager primitives', () => {
  it('tracks process steps and waiting state immutably', () => {
    const process = createProcess({
      id: 'process_001',
      type: 'order.fulfillment',
      state: { orderId: 'order_001' },
      now: '2026-06-04T12:00:00.000Z',
    });
    const started = startProcessStep(process, {
      name: 'reserve_inventory',
      now: '2026-06-04T12:01:00.000Z',
    });
    const completedStep = completeProcessStep(started, {
      name: 'reserve_inventory',
      now: '2026-06-04T12:02:00.000Z',
    });
    const waiting = waitForProcess(completedStep, {
      signal: 'payment.authorized',
      now: '2026-06-04T12:03:00.000Z',
    });

    expect(process.steps).toEqual([]);
    expect(waiting).toMatchObject({
      status: ProcessStatus.Waiting,
      waitingFor: 'payment.authorized',
      steps: [{ name: 'reserve_inventory', status: 'completed' }],
    });
  });

  it('completes open processes', () => {
    const process = createProcess({
      id: 'process_001',
      type: 'order.fulfillment',
      state: {},
      now: '2026-06-04T12:00:00.000Z',
    });

    expect(
      completeProcess(process, { now: '2026-06-04T12:01:00.000Z' })
    ).toMatchObject({
      status: ProcessStatus.Completed,
      completedAt: '2026-06-04T12:01:00.000Z',
    });
  });

  it('does not mutate failed processes through the happy path', () => {
    const failed = failProcess(
      createProcess({
        id: 'process_001',
        type: 'order.fulfillment',
        state: {},
        now: '2026-06-04T12:00:00.000Z',
      }),
      { error: 'payment failed', now: '2026-06-04T12:01:00.000Z' }
    );

    expect(() =>
      completeProcess(failed, { now: '2026-06-04T12:02:00.000Z' })
    ).toThrow('failed');
  });
});

describe('projection snapshot primitive', () => {
  it('captures projection records and checkpoint metadata', () => {
    const record = createProjectionRecord({
      projectionName: 'items',
      id: 'item_001',
      value: { name: 'Item' },
      now: '2026-06-04T12:00:00.000Z',
    });
    const snapshot = createProjectionSnapshot({
      id: 'snapshot_001',
      projectionName: 'items',
      records: [record],
      now: '2026-06-04T12:01:00.000Z',
    });

    expect(snapshot).toMatchObject({
      id: 'snapshot_001',
      projectionName: 'items',
      recordCount: 1,
      records: [{ id: 'item_001' }],
    });
  });
});
