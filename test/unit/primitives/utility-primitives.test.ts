import { describe, expect, it } from 'vitest';
import {
  chunk,
  chunkFlatMap,
  chunkForEach,
  chunkMap,
  compareStrings,
  compareStringsDescending,
  ContextMutationError,
  createContext,
  DAY_MS,
  Err,
  groupBy,
  HOUR_MS,
  addMillisecondsToIsoTimestamp,
  compareIsoTimestamps,
  isErr,
  isIsoTimestampAtOrBefore,
  keyBy,
  lazy,
  millisecondsBetweenIsoTimestamps,
  MINUTE_MS,
  nonNegativeIntegerOption,
  normalizePaginationOptions,
  normalizeForDedup,
  normalizeTextForDedup,
  Ok,
  parseIsoTimestamp,
  positiveIntegerOption,
  RoundRobin,
  RuntimeOptionError,
  SECOND_MS,
  sleep,
  SleepAbortedError,
  SlidingWindow,
  toSnakeCase,
  toTitleCase,
  uniqueBy,
  uniqueStrings,
} from '@/primitives';

describe('collection primitives', () => {
  it('chunks collections and passes chunk metadata', async () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);

    const seen: Array<[number[], number, number, number]> = [];
    const result = await chunkForEach([1, 2, 3], 2, (items, info) => {
      seen.push([items, info.chunkIndex, info.startIndex, info.endIndex]);
      return Ok(undefined);
    });

    expect(result.ok).toBe(true);
    expect(seen).toEqual([
      [[1, 2], 0, 0, 2],
      [[3], 1, 2, 3],
    ]);
  });

  it('maps chunks with Result short-circuiting', async () => {
    const mapped = await chunkMap([1, 2, 3, 4], 2, (items) =>
      Ok(items.reduce((sum, value) => sum + value, 0))
    );
    expect(mapped.unwrap()).toEqual([3, 7]);

    const flatMapped = await chunkFlatMap([1, 2, 3], 2, (items) =>
      Ok(items.map((value) => value * 10))
    );
    expect(flatMapped.unwrap()).toEqual([10, 20, 30]);

    const failed = await chunkMap([1, 2, 3], 2, (_items, info) =>
      info.chunkIndex === 1 ? Err('stop') : Ok(info.chunkIndex)
    );
    expect(isErr(failed)).toBe(true);
    if (isErr(failed)) expect(failed.error).toBe('stop');
  });

  it('groups, keys, and deduplicates collections', () => {
    const rows = [
      { id: 'a', type: 'order' },
      { id: 'b', type: 'order' },
      { id: 'a', type: 'return' },
    ];

    expect(groupBy(rows, (row) => row.type).get('order')?.length).toBe(2);
    expect(keyBy(rows, (row) => row.id).get('a')).toEqual({ id: 'a', type: 'return' });
    expect(uniqueBy(rows, (row) => row.id)).toEqual([
      { id: 'a', type: 'order' },
      { id: 'b', type: 'order' },
    ]);
    expect(uniqueStrings(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });
});

describe('runtime option primitives', () => {
  it('normalizes positive, non-negative, and pagination options', () => {
    expect(positiveIntegerOption('limit', 2)).toBe(2);
    expect(nonNegativeIntegerOption('offset', 0)).toBe(0);
    expect(normalizePaginationOptions({ limit: 2, offset: 1 }, 10)).toEqual({
      limit: 2,
      offset: 1,
    });
    expect(normalizePaginationOptions({}, 10)).toEqual({ limit: 10, offset: 0 });
  });

  it('rejects unsafe, fractional, and out-of-range numeric options', () => {
    expect(() => positiveIntegerOption('limit', 0)).toThrow(RuntimeOptionError);
    expect(() => normalizePaginationOptions({ limit: null as unknown as number }, 10)).toThrow(
      RuntimeOptionError
    );
    expect(() => positiveIntegerOption('limit', 1.5)).toThrow(RuntimeOptionError);
    expect(() => positiveIntegerOption('limit', Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RuntimeOptionError
    );
    expect(() => nonNegativeIntegerOption('offset', -1)).toThrow(RuntimeOptionError);
    expect(() => normalizePaginationOptions({ limit: -1 }, 10)).toThrow(RuntimeOptionError);
  });
});

describe('lifecycle and scheduling primitives', () => {
  it('lazily initializes once and retries async failures', async () => {
    let calls = 0;
    const getValue = lazy(async () => {
      calls++;
      if (calls === 1) throw new Error('first failure');
      return { id: calls };
    });

    expect(getValue.isReady()).toBe(false);
    await expect(getValue()).rejects.toThrow('first failure');
    expect(getValue.isReady()).toBe(false);
    await expect(getValue()).resolves.toEqual({ id: 2 });
    expect(getValue.isReady()).toBe(true);
    await expect(getValue()).resolves.toEqual({ id: 2 });
    expect(calls).toBe(2);

    getValue.reset();
    expect(getValue.isReady()).toBe(false);
  });

  it('cycles through round-robin items', () => {
    const pool = new RoundRobin(['a', 'b']);

    expect(pool.peek()).toBe('a');
    expect(pool.next()).toBe('a');
    expect(pool.next()).toBe('b');
    expect(pool.next()).toBe('a');
    expect(pool.all()).toEqual(['a', 'b']);
  });

  it('tracks sliding-window availability with an injected clock', () => {
    let now = 1000;
    const window = new SlidingWindow({
      windowMs: 100,
      maxEvents: 2,
      clock: { now: () => now },
    });

    expect(window.record()).toBe(true);
    expect(window.record()).toBe(true);
    expect(window.record()).toBe(false);
    expect(window.remaining).toBe(0);
    expect(window.msUntilAvailable()).toBe(100);

    now = 1101;
    expect(window.canRecord()).toBe(true);
    expect(window.remaining).toBe(2);

    const restored = SlidingWindow.fromState({ timestamps: [1090, 1100] }, {
      windowMs: 100,
      maxEvents: 2,
      clock: { now: () => 1150 },
    });
    expect(restored.count).toBe(2);
    expect(restored.toState()).toEqual({ timestamps: [1090, 1100] });
  });

  it('cleans up sleep abort listeners after settling', async () => {
    const listeners = new Set<() => void>();
    const signal = trackedAbortSignal(listeners);

    await sleep(0, signal);

    expect(listeners.size).toBe(0);
  });

  it('cleans up sleep abort listeners after aborting', async () => {
    const listeners = new Set<() => void>();
    const signal = trackedAbortSignal(listeners);
    const pending = sleep(1000, signal);

    expect(listeners.size).toBe(1);
    for (const listener of [...listeners]) listener();

    await expect(pending).rejects.toBeInstanceOf(SleepAbortedError);
    expect(listeners.size).toBe(0);
  });
});

describe('string and time primitives', () => {
  it('normalizes casing and dedup values', () => {
    expect(toSnakeCase('OrderLineItem')).toBe('order_line_item');
    expect(toSnakeCase('order line-item')).toBe('order_line_item');
    expect(toTitleCase('order_line-item')).toBe('Order Line Item');
    expect(normalizeTextForDedup('  ACME   LTD  ')).toBe('acme ltd');
    expect(normalizeForDedup({ name: '  ACME  ', tags: [' Cold ', 'CHAIN'] })).toEqual({
      name: 'acme',
      tags: ['cold', 'chain'],
    });
  });

  it('compares strings by deterministic ordinal order', () => {
    expect(compareStrings('a', 'b')).toBe(-1);
    expect(compareStrings('b', 'a')).toBe(1);
    expect(compareStrings('a', 'a')).toBe(0);
    expect(compareStrings('Z', 'a')).toBe(-1);
    expect(compareStrings('10', '2')).toBe(-1);
    expect(compareStringsDescending('a', 'b')).toBe(1);
  });

  it('exports time constants', () => {
    expect(SECOND_MS).toBe(1000);
    expect(MINUTE_MS).toBe(60_000);
    expect(HOUR_MS).toBe(3_600_000);
    expect(DAY_MS).toBe(86_400_000);
  });

  it('parses and compares canonical UTC ISO timestamps explicitly', () => {
    expect(parseIsoTimestamp('2026-06-04T12:00:00.000Z').unwrap()).toBe(
      '2026-06-04T12:00:00.000Z'
    );
    expect(addMillisecondsToIsoTimestamp('2026-06-04T12:00:00.000Z', 90_000).unwrap()).toBe(
      '2026-06-04T12:01:30.000Z'
    );
    expect(
      millisecondsBetweenIsoTimestamps(
        '2026-06-04T12:00:00.000Z',
        '2026-06-04T12:01:30.000Z'
      ).unwrap()
    ).toBe(90_000);
    expect(compareIsoTimestamps('2026-06-04T12:00:00.000Z', '2026-06-04T12:01:00.000Z').unwrap()).toBe(
      -1
    );
    expect(isIsoTimestampAtOrBefore('2026-06-04T12:00:00.000Z', '2026-06-04T12:00:00.000Z').unwrap()).toBe(
      true
    );
  });

  it('rejects ambiguous or non-normalized timestamp strings', () => {
    expect(parseIsoTimestamp('2026-06-04T12:00:00Z').ok).toBe(false);
    expect(parseIsoTimestamp('2026-06-04T14:00:00.000+02:00').ok).toBe(false);
    expect(parseIsoTimestamp('2026-02-30T12:00:00.000Z').ok).toBe(false);
    expect(parseIsoTimestamp('Thu, 04 Jun 2026 12:00:00 GMT').ok).toBe(false);
    expect(addMillisecondsToIsoTimestamp('2026-06-04T12:00:00.000Z', 0.5).ok).toBe(false);
    expect(addMillisecondsToIsoTimestamp('9999-12-31T23:59:59.999Z', 1).ok).toBe(false);
  });
});

function trackedAbortSignal(listeners: Set<() => void>): AbortSignal {
  return {
    aborted: false,
    addEventListener: (_type: string, listener: unknown) => {
      if (typeof listener === 'function') listeners.add(listener as () => void);
    },
    removeEventListener: (_type: string, listener: unknown) => {
      if (typeof listener === 'function') listeners.delete(listener as () => void);
    },
  } as unknown as AbortSignal;
}

describe('context hardening', () => {
  it('prevents replacing metadata while allowing state mutation', () => {
    const context = createContext<{
      count: number;
      metadata: { traceId: string };
    }>({ name: 'guarded-context' });

    context.provide({ count: 0, metadata: { traceId: 'trace_1' } }, () => {
      context.mutate((value) => {
        value.count++;
      });
      expect(context.use().count).toBe(1);

      expect(() =>
        context.mutate((value) => {
          value.metadata = { traceId: 'trace_2' };
        })
      ).toThrow(ContextMutationError);
    });
  });
});
