import { describe, expect, it } from 'vitest';
import { CorrelatedLogger, StructuredLogger } from '@/adapters/observability';
import {
  LogLevel,
  type LogContext,
  type LogEntry,
  type Logger,
  prepareLogData,
  safeStringifyLogValue,
  serializeLogError,
} from '@/ports/logger';

describe('StructuredLogger', () => {
  it('filters by level, redacts context, and supports object-first calls', () => {
    const entries: LogEntry[] = [];
    const logger = new StructuredLogger({
      clock: fixedClock('2026-06-04T12:00:00.000Z'),
      level: LogLevel.INFO,
      name: 'kernel',
      bindings: { service: 'domain-kernel' },
      transports: [{ write: (entry) => entries.push(entry) }],
    });

    logger.debug('ignored', { value: 1 });
    logger.info(
      {
        userId: 'actor_001',
        password: 'secret',
        nested: { token: 'abc', visible: true },
      },
      'actor authenticated'
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      levelLabel: LogLevel.INFO,
      message: 'actor authenticated',
      time: '2026-06-04T12:00:00.000Z',
      name: 'kernel',
      service: 'domain-kernel',
      userId: 'actor_001',
      password: '[REDACTED]',
      nested: { token: '[REDACTED]', visible: true },
    });
  });

  it('shares transports with child loggers', () => {
    const entries: LogEntry[] = [];
    const logger = new StructuredLogger({
      clock: fixedClock('2026-06-04T12:01:00.000Z'),
      transports: [{ write: (entry) => entries.push(entry) }],
    });
    const child = logger.child({ component: 'worker' });

    child.warn('stock below threshold', { sku: 'SKU-1' });

    expect(entries).toMatchObject([
      {
        levelLabel: LogLevel.WARN,
        message: 'stock below threshold',
        time: '2026-06-04T12:01:00.000Z',
        component: 'worker',
        sku: 'SKU-1',
      },
    ]);
  });

  it('serializes errors and stringifies circular values safely', () => {
    const error = new Error('provider failed');
    const circular: Record<string, unknown> = { name: 'root' };
    circular.self = circular;

    expect(serializeLogError(error)).toMatchObject({
      name: 'Error',
      message: 'provider failed',
    });
    expect(prepareLogData({ error, apiKey: 'secret', circular })).toMatchObject({
      error: { name: 'Error', message: 'provider failed' },
      apiKey: '[REDACTED]',
      circular: { name: 'root', self: '[Circular]' },
    });
    expect(prepareLogData({ token: error })).toMatchObject({
      token: '[REDACTED]',
    });
    expect(safeStringifyLogValue(circular)).toContain('[Circular]');
  });
});

describe('CorrelatedLogger', () => {
  it('adds active trace context to log entries without changing base logger calls', () => {
    const entries: LogEntry[] = [];
    const baseLogger = new StructuredLogger({
      clock: fixedClock('2026-06-04T12:02:00.000Z'),
      transports: [{ write: (entry) => entries.push(entry) }],
    });
    const logger = new CorrelatedLogger(baseLogger, {
      getCurrentContext: () => ({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceParent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        traceFlags: '01',
        sampled: true,
        recording: true,
      }),
    });

    logger.info('work item created', { workItemId: 'work_001' });

    expect(entries).toMatchObject([
      {
        message: 'work item created',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: '01',
        sampled: true,
        recording: true,
        workItemId: 'work_001',
      },
    ]);
  });

  it('adds active trace context to object-first logs without creating child loggers', () => {
    const entries: LogEntry[] = [];
    const baseLogger = new NoChildStructuredLogger({
      clock: fixedClock('2026-06-04T12:03:00.000Z'),
      transports: [{ write: (entry) => entries.push(entry) }],
    });
    const logger = new CorrelatedLogger(baseLogger, {
      getCurrentContext: () => ({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: '01',
        sampled: true,
      }),
    });

    logger.error(new Error('provider failed'), 'sync failed');

    expect(entries).toMatchObject([
      {
        message: 'sync failed',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        error: {
          name: 'Error',
          message: 'provider failed',
        },
      },
    ]);
  });
});

function fixedClock(value: string): { now(): string } {
  return {
    now: () => value,
  };
}

class NoChildStructuredLogger extends StructuredLogger {
  override child(_bindings: LogContext): Logger {
    throw new Error('CorrelatedLogger should not create child loggers per write');
  }
}
