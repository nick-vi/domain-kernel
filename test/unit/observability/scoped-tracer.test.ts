import { describe, expect, it } from 'vitest';
import { SimpleTracer } from '@/adapters/observability/simple-tracer';
import { NoopLogger } from '@/adapters/observability/noop-logger';
import type { Clock } from '@/ports/clock';
import type { IdGenerator } from '@/ports/id-generator';
import { AlwaysOffTraceSampler, serviceTelemetryResource } from '@/primitives';
import {
  type ObservabilityExporter,
  type SpanRecord,
  SpanKind,
  SpanStatus,
  type TraceEventRecord,
  type TraceRecord,
  TraceStatus,
} from '@/ports/tracer';

describe('SimpleTracer', () => {
  it('keeps existing span calls scoped under an implicit trace', async () => {
    const records = createRecordingExporter();
    const tracer = createTracer(records.exporter);

    const result = await tracer.span('createWorkItem', { type: 'case' }, async (span) => {
      expect(tracer.getCurrentContext()).toMatchObject({
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
        spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
        traceParent: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/),
        traceFlags: '01',
        sampled: true,
        recording: true,
      });

      span.setAttribute('workItemId', 'work_123');
      span.setOutput({ status: 'created' });
      span.addEvent('validated', { valid: true });
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(tracer.getActiveTraceCount()).toBe(0);
    expect(records.traceStarts).toMatchObject([
      { name: 'createWorkItem', traceFlags: '01', recording: true, sampled: true },
    ]);
    expect(records.traceStarts[0]?.id).toMatch(/^[0-9a-f]{32}$/);
    expect(records.traceEnds).toMatchObject([
      { id: records.traceStarts[0]?.id, status: TraceStatus.OK, name: 'createWorkItem' },
    ]);
    expect(records.spanStarts).toMatchObject([
      {
        traceId: records.traceStarts[0]?.id,
        name: 'createWorkItem',
        traceFlags: '01',
        sampled: true,
        recording: true,
      },
    ]);
    expect(records.spanStarts[0]?.id).toMatch(/^[0-9a-f]{16}$/);
    expect(records.spanStarts[0]?.traceParent).toBe(
      `00-${records.traceStarts[0]?.id}-${records.spanStarts[0]?.id}-01`
    );
    expect(records.spanEnds).toMatchObject([
      {
        id: records.spanStarts[0]?.id,
        traceId: records.traceStarts[0]?.id,
        status: SpanStatus.OK,
        attributes: { type: 'case', workItemId: 'work_123' },
        output: { status: 'created' },
      },
    ]);
    expect(records.events).toMatchObject([
      {
        id: 'event_001',
        traceId: records.traceStarts[0]?.id,
        spanId: records.spanStarts[0]?.id,
        name: 'validated',
        attributes: { valid: true },
      },
    ]);
  });

  it('ends spans and traces on thrown errors', async () => {
    const records = createRecordingExporter();
    const tracer = createTracer(records.exporter);

    await expect(
      tracer.trace('sync.external', { provider: 'external' }, async (trace) => {
        await trace.span('post.entries', { batchId: 'batch_001' }, () => {
          throw new Error('posting failed');
        });
      })
    ).rejects.toThrow('posting failed');

    expect(tracer.getActiveTraceCount()).toBe(0);
    expect(records.spanEnds).toMatchObject([
      {
        status: SpanStatus.ERROR,
        error: { message: 'posting failed', name: 'Error' },
      },
    ]);
    expect(records.traceEnds).toMatchObject([
      {
        status: TraceStatus.ERROR,
        error: { message: 'posting failed', name: 'Error' },
      },
    ]);
  });

  it('keeps nested span parentage isolated across parallel branches', async () => {
    const records = createRecordingExporter();
    const tracer = createTracer(records.exporter);

    await tracer.trace('root', {}, async (trace) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const branchA = trace.span('branch.a', {}, async () => {
        await gate;
        await trace.span('branch.a.child', {}, () => undefined);
      });
      const branchB = trace.span('branch.b', {}, () => undefined);

      release();
      await Promise.all([branchA, branchB]);
    });

    const parent = records.spanStarts.find((span) => span.name === 'branch.a');
    const child = records.spanStarts.find((span) => span.name === 'branch.a.child');
    const sibling = records.spanStarts.find((span) => span.name === 'branch.b');

    expect(parent).toBeDefined();
    expect(child).toMatchObject({
      traceId: parent?.traceId,
      parentSpanId: parent?.id,
    });
    expect(sibling?.parentSpanId).toBeUndefined();
  });

  it('records explicit span kinds without breaking plain attributes', async () => {
    const records = createRecordingExporter();
    const tracer = createTracer(records.exporter);

    await tracer.trace('sync', {}, async (trace) => {
      await trace.span(
        'fetch.items',
        { kind: SpanKind.HTTP, attributes: { method: 'GET', url: '/items' } },
        () => undefined
      );
      await trace.span('business.kind.attribute', { kind: 'http', url: '/not-options' }, () => undefined);
    });

    expect(records.spanStarts).toMatchObject([
      {
        name: 'fetch.items',
        kind: SpanKind.HTTP,
        attributes: { method: 'GET', url: '/items' },
      },
      {
        name: 'business.kind.attribute',
        kind: SpanKind.INTERNAL,
        attributes: { kind: 'http', url: '/not-options' },
      },
    ]);
  });

  it('prunes stale active traces through the injected clock', async () => {
    const records = createRecordingExporter();
    const clock = new ManualClock('2026-06-04T10:00:00.000Z');
    const tracer = new SimpleTracer(new NoopLogger(), {
      clock,
      ids: new TestIds(),
      exporters: [records.exporter],
      staleTraceTtlMs: 1000,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const running = tracer.trace('stuck.trace', {}, async () => {
      await gate;
    });
    for (let attempt = 0; attempt < 5 && tracer.getActiveTraceCount() === 0; attempt++) {
      await Promise.resolve();
    }
    expect(tracer.getActiveTraceCount()).toBe(1);

    clock.advance(1001);
    await tracer.trace('next.trace', {}, () => undefined);

    expect(records.traceEnds.find((trace) => trace.name === 'stuck.trace')).toMatchObject({
      name: 'stuck.trace',
      status: TraceStatus.ERROR,
    });

    release();
    await running;
  });

  it('drops spans when sampling says not to record', async () => {
    const records = createRecordingExporter();
    const tracer = new SimpleTracer(new NoopLogger(), {
      clock: new TestClock(),
      ids: new TestIds(),
      exporters: [records.exporter],
      sampler: AlwaysOffTraceSampler,
    });

    const result = await tracer.span('ignored', { expensive: true }, (span) => {
      expect(span.recording).toBe(false);
      expect(span.sampled).toBe(false);
      expect(span.addEvent('ignored.event')).toBeUndefined();
      expect(tracer.getCurrentContext()).toMatchObject({
        recording: false,
        sampled: false,
        traceFlags: '00',
      });
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(records.traceStarts).toEqual([]);
    expect(records.spanStarts).toEqual([]);
    expect(records.events).toEqual([]);
  });

  it('flushes and shuts down exporters explicitly', async () => {
    const records = createRecordingExporter();
    const logger = new CountingLogger();
    let flushed = 0;
    let shutDown = 0;
    const tracer = new SimpleTracer(logger, {
      clock: new TestClock(),
      ids: new TestIds(),
      exporters: [
        {
          ...records.exporter,
          forceFlush: () => {
            flushed += 1;
          },
          shutdown: () => {
            shutDown += 1;
          },
        },
      ],
      resource: serviceTelemetryResource({ serviceName: 'domain-kernel-test' }),
    });

    await tracer.span('flush.me', {}, () => undefined);
    await tracer.forceFlush();
    await tracer.shutdown();

    expect(flushed).toBe(1);
    expect(shutDown).toBe(1);
    expect(logger.flushes).toBe(2);
    expect(logger.closes).toBe(0);
    expect(records.spanStarts[0]?.resource).toMatchObject({
      attributes: { 'service.name': 'domain-kernel-test' },
    });
    await expect(tracer.span('after.shutdown', {}, () => undefined)).rejects.toThrow(
      'SimpleTracer has been shut down'
    );
  });
});

function createTracer(exporter: ObservabilityExporter): SimpleTracer {
  return new SimpleTracer(new NoopLogger(), {
    clock: new TestClock(),
    ids: new TestIds(),
    exporters: [exporter],
  });
}

class CountingLogger extends NoopLogger {
  flushes = 0;
  closes = 0;

  override async flush(): Promise<void> {
    this.flushes += 1;
  }

  override async close(): Promise<void> {
    this.closes += 1;
  }
}

function createRecordingExporter(): {
  exporter: ObservabilityExporter;
  traceStarts: TraceRecord[];
  traceEnds: TraceRecord[];
  spanStarts: SpanRecord[];
  spanEnds: SpanRecord[];
  events: TraceEventRecord[];
} {
  const traceStarts: TraceRecord[] = [];
  const traceEnds: TraceRecord[] = [];
  const spanStarts: SpanRecord[] = [];
  const spanEnds: SpanRecord[] = [];
  const events: TraceEventRecord[] = [];

  return {
    traceStarts,
    traceEnds,
    spanStarts,
    spanEnds,
    events,
    exporter: {
      awaited: true,
      onTraceStart: (trace) => {
        traceStarts.push(trace);
      },
      onTraceEnd: (trace) => {
        traceEnds.push(trace);
      },
      onSpanStart: (span) => {
        spanStarts.push(span);
      },
      onSpanEnd: (span) => {
        spanEnds.push(span);
      },
      onEvent: (event) => {
        events.push(event);
      },
    },
  };
}

class TestClock implements Clock {
  private time = Date.parse('2026-06-04T10:00:00.000Z');

  now(): string {
    const value = new Date(this.time).toISOString();
    this.time += 1000;
    return value;
  }
}

class ManualClock implements Clock {
  private time: number;

  constructor(timestamp: string) {
    this.time = Date.parse(timestamp);
  }

  now(): string {
    return new Date(this.time).toISOString();
  }

  advance(milliseconds: number): void {
    this.time += milliseconds;
  }
}

class TestIds implements IdGenerator {
  private readonly counters = new Map<string, number>();

  nextId(prefix: string): string {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}_${String(next).padStart(3, '0')}`;
  }
}
