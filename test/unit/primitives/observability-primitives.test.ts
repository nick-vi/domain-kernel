import { describe, expect, it } from 'vitest';
import {
  AlwaysOffTraceSampler,
  AlwaysOnTraceSampler,
  createParentBasedTraceSampler,
  createTraceIdRatioSampler,
  mergeTelemetryResources,
  metric,
  metricExemplarFromContext,
  MetricKind,
  METRIC_OVERFLOW_ATTRIBUTE,
  normalizeMetricAttributes,
  RecordOnlyTraceSampler,
  serviceTelemetryResource,
  telemetryResource,
  TraceSamplingDecision,
  traceFlagsForSamplingDecision,
} from '@/primitives';

describe('trace sampling primitives', () => {
  it('models drop, record-only, and record-and-sample decisions explicitly', () => {
    expect(AlwaysOnTraceSampler.shouldSample(traceInput()).decision).toBe(
      TraceSamplingDecision.RecordAndSample
    );
    expect(AlwaysOffTraceSampler.shouldSample(traceInput()).decision).toBe(
      TraceSamplingDecision.Drop
    );
    expect(RecordOnlyTraceSampler.shouldSample(traceInput()).decision).toBe(
      TraceSamplingDecision.RecordOnly
    );
    expect(traceFlagsForSamplingDecision(TraceSamplingDecision.RecordAndSample)).toBe('01');
    expect(traceFlagsForSamplingDecision(TraceSamplingDecision.RecordOnly)).toBe('00');
  });

  it('keeps child sampling aligned with the parent sampled flag', () => {
    const sampler = createParentBasedTraceSampler(AlwaysOffTraceSampler);

    expect(
      sampler.shouldSample({
        ...traceInput(),
        parent: { traceFlags: '01', sampled: true },
      })
    ).toMatchObject({
      decision: TraceSamplingDecision.RecordAndSample,
      reason: 'parent_sampled',
    });
    expect(
      sampler.shouldSample({
        ...traceInput(),
        parent: { traceFlags: '00', sampled: false },
      })
    ).toMatchObject({
      decision: TraceSamplingDecision.Drop,
      reason: 'parent_not_sampled',
    });
    expect(sampler.shouldSample(traceInput())).toMatchObject({
      decision: TraceSamplingDecision.Drop,
      reason: 'always_off',
    });
  });

  it('samples deterministically from trace ids', () => {
    const sampler = createTraceIdRatioSampler(0.5);

    expect(
      sampler.shouldSample({
        ...traceInput(),
        traceId: '00000000000000000000000000000001',
      }).decision
    ).toBe(TraceSamplingDecision.RecordAndSample);
    expect(
      sampler.shouldSample({
        ...traceInput(),
        traceId: 'ffffffffffffffffffffffffffffffff',
      }).decision
    ).toBe(TraceSamplingDecision.Drop);
  });
});

describe('metric safety primitives', () => {
  it('limits metric attributes deterministically and marks overflow', () => {
    const normalized = normalizeMetricAttributes(
      { z: 'last', a: 'first', m: 'middle' },
      { maxAttributes: 2 }
    );

    expect(normalized).toEqual({
      attributes: { a: 'first', [METRIC_OVERFLOW_ATTRIBUTE]: true },
      droppedAttributes: 2,
      overflow: true,
    });
  });

  it('rejects metric attributes that are not finite scalar values', () => {
    expect(() =>
      metric({
        name: 'bad.metric',
        kind: MetricKind.Counter,
        value: 1,
        observedAt: '2026-06-05T10:00:00.000Z',
        attributes: { nested: { ok: true } as never },
      })
    ).toThrow('finite scalar');
  });

  it('adds exemplars only when a sampled span context exists', () => {
    expect(
      metricExemplarFromContext(
        {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          spanId: '00f067aa0ba902b7',
          traceFlags: '01',
          sampled: true,
        },
        { value: 42, observedAt: '2026-06-05T10:00:00.000Z' }
      )
    ).toMatchObject({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sampled: true,
    });
    expect(
      metricExemplarFromContext(
        {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          spanId: '00f067aa0ba902b7',
          sampled: false,
        },
        { value: 42, observedAt: '2026-06-05T10:00:00.000Z' }
      )
    ).toBeUndefined();
  });
});

describe('telemetry resources', () => {
  it('merges resource attributes with updating attributes taking precedence', () => {
    const base = serviceTelemetryResource({
      serviceName: 'kernel-service',
      serviceVersion: '1.0.0',
      attributes: { 'service.name': 'wrong', region: 'eu' },
      schemaUrl: 'https://opentelemetry.io/schemas/1.0.0',
    });
    const updating = telemetryResource({
      attributes: { region: 'us', worker: true },
      schemaUrl: 'https://opentelemetry.io/schemas/1.0.0',
    });

    expect(mergeTelemetryResources(base, updating).unwrap()).toEqual({
      schemaUrl: 'https://opentelemetry.io/schemas/1.0.0',
      attributes: {
        'service.name': 'kernel-service',
        'service.version': '1.0.0',
        region: 'us',
        worker: true,
      },
    });
  });

  it('rejects resource merges with conflicting schema URLs', () => {
    const merged = mergeTelemetryResources(
      telemetryResource({ attributes: {}, schemaUrl: 'schema-a' }),
      telemetryResource({ attributes: {}, schemaUrl: 'schema-b' })
    );

    expect(merged.ok).toBe(false);
  });
});

function traceInput() {
  return {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    name: 'test.span',
    kind: 'internal',
  };
}
