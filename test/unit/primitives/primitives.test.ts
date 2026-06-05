import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  boundedMapSettled,
  CircuitBreaker,
  CircuitBreakerOpenError,
  CircuitState,
  createContext,
  Err,
  HttpErrorKind,
  isErr,
  isOk,
  JitterMode,
  Json,
  Ok,
  OperationAbortedError,
  resource,
  ResourcePool,
  requestJson,
  SafeJson,
  Semaphore,
  Singleflight,
  type FetchTransport,
  type RequestAbortSignals,
  type SleepFunction,
  withRetry,
} from '@/primitives';

const immediateSleep: SleepFunction = async () => undefined;

describe('primitives', () => {
  it('retries transient failures with deterministic backoff options', async () => {
    let attempts = 0;
    const computedDelays: number[] = [];

    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) return Err(new Error('not yet'));
        return Ok('ok');
      },
      {
        maxRetries: 2,
        sleep: immediateSleep,
        baseDelayMs: 10,
        maxDelayMs: 10,
        retryDelay: (_error, _attempt, computedDelayMs) => {
          computedDelays.push(computedDelayMs);
          return 0;
        },
      }
    );

    expect(result.unwrap()).toBe('ok');
    expect(attempts).toBe(3);
    expect(computedDelays).toEqual([10, 10]);
  });

  it('requires an injected random source for full retry jitter', async () => {
    await expect(
      withRetry(async () => Err(new Error('retry me')), {
        maxRetries: 1,
        sleep: immediateSleep,
        baseDelayMs: 10,
        maxDelayMs: 10,
        jitter: JitterMode.FULL,
      })
    ).rejects.toThrow('RetryPolicy random source is required for full jitter');

    await expect(
      withRetry(async () => Err(new Error('retry me')), {
        maxRetries: 1,
        sleep: immediateSleep,
        baseDelayMs: 10,
        maxDelayMs: 10,
        jitter: JitterMode.FULL,
        random: () => 1,
      })
    ).rejects.toThrow('RetryPolicy random source must return a finite number in [0, 1)');
  });

  it('uses injected randomness for full retry jitter', async () => {
    let attempts = 0;
    const computedDelays: number[] = [];

    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) return Err(new Error('not yet'));
        return Ok('ok');
      },
      {
        maxRetries: 1,
        sleep: immediateSleep,
        baseDelayMs: 20,
        maxDelayMs: 20,
        jitter: JitterMode.FULL,
        random: () => 0.25,
        retryDelay: (_error, _attempt, computedDelayMs) => {
          computedDelays.push(computedDelayMs);
          return 0;
        },
      }
    );

    expect(result.unwrap()).toBe('ok');
    expect(computedDelays).toEqual([5]);
  });

  it('deduplicates concurrent work by singleflight key', async () => {
    const singleflight = new Singleflight();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = singleflight.run('customer:123', async () => {
      calls++;
      await gate;
      return calls;
    });
    const second = singleflight.run('customer:123', async () => 999);

    await Promise.resolve();
    expect(calls).toBe(1);
    expect(singleflight.size).toBe(1);

    release();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
    expect(singleflight.size).toBe(0);
  });

  it('bounds concurrent work and returns settled results', async () => {
    let active = 0;
    let maxActive = 0;

    const results = await boundedMapSettled(
      [1, 2, 3, 4],
      async (value) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active--;
        return value * 2;
      },
      2
    );

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 4 },
      { status: 'fulfilled', value: 6 },
      { status: 'fulfilled', value: 8 },
    ]);
  });

  it('removes aborted semaphore waiters', async () => {
    const semaphore = new Semaphore(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = semaphore.run(async () => {
      await gate;
      return 'first';
    });
    const controller = new AbortController();
    const second = semaphore.run(async () => 'second', { signal: controller.signal });

    expect(semaphore.pendingCount).toBe(1);
    controller.abort();

    await expect(second).rejects.toBeInstanceOf(OperationAbortedError);
    expect(semaphore.pendingCount).toBe(0);
    release();
    await expect(first).resolves.toBe('first');
  });

  it('rejects queued bounded work when the signal aborts', async () => {
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = boundedMapSettled(
      [1, 2],
      async (value) => {
        if (value === 1) {
          controller.abort();
          await gate;
        }
        return value;
      },
      1,
      controller.signal
    );

    await Promise.resolve();
    release();
    const results = await pending;
    const first = results[0]!;
    const second = results[1]!;

    expect(first).toEqual({ status: 'fulfilled', value: 1 });
    expect(second.status).toBe('rejected');
    if (second.status === 'rejected') {
      expect(second.reason).toBeInstanceOf(OperationAbortedError);
    }
  });

  it('removes aborted resource pool waiters', async () => {
    const pool = new ResourcePool({
      resources: [{ resource: 'primary', maxConcurrent: 1 }],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = pool.withResource(async (resourceName) => {
      await gate;
      return resourceName;
    });
    const controller = new AbortController();
    const second = pool.withResource(async () => 'secondary', { signal: controller.signal });

    expect(pool.stats.queued).toBe(1);
    controller.abort();

    await expect(second).rejects.toBeInstanceOf(OperationAbortedError);
    expect(pool.stats.queued).toBe(0);
    release();
    await expect(first).resolves.toBe('primary');
  });

  it('opens a circuit after configured failures', async () => {
    let now = 1000;
    const breaker = new CircuitBreaker({
      clock: { now: () => now },
      failureThreshold: 1,
      recoveryTimeoutMs: 100,
    });
    let calls = 0;

    const result = await breaker.execute(async () => {
      calls++;
      return Err(new Error('provider down'));
    });
    const skipped = await breaker.execute(async () => {
      calls++;
      return Ok('should not run');
    });

    expect(isErr(result)).toBe(true);
    expect(isErr(skipped)).toBe(true);
    if (isErr(skipped)) {
      expect(skipped.error).toBeInstanceOf(CircuitBreakerOpenError);
    }
    expect(calls).toBe(1);
    expect(breaker.state).toBe(CircuitState.Open);

    now = 1100;
    expect(breaker.state).toBe(CircuitState.HalfOpen);
    await expect(breaker.execute(async () => Ok('recovered'))).resolves.toEqual(Ok('recovered'));
    expect(breaker.state).toBe(CircuitState.Closed);
  });

  it('manages lazy resources and reinitializes after disposal', async () => {
    let initialized = 0;
    let disposed = 0;
    const handle = resource({
      signals: false,
      init: () => ({ id: ++initialized }),
      dispose: () => {
        disposed++;
      },
    });

    expect(handle.isReady()).toBe(false);
    await expect(handle.get()).resolves.toEqual({ id: 1 });
    expect(handle.isReady()).toBe(true);

    await handle.dispose();
    expect(disposed).toBe(1);
    expect(handle.isReady()).toBe(false);
    await expect(handle.get()).resolves.toEqual({ id: 2 });
  });

  it('propagates async context and freezes metadata', async () => {
    const context = createContext<{ actorId: string; count: number; metadata: { traceId: string } }>(
      { name: 'test-context' }
    );

    await context.provide(
      { actorId: 'operator', count: 0, metadata: { traceId: 'trace_123' } },
      async () => {
        await Promise.resolve();
        expect(context.use().actorId).toBe('operator');
        expect(Object.isFrozen(context.use().metadata)).toBe(true);

        context.mutate((value) => {
          value.count++;
        });
        expect(context.use().count).toBe(1);
      }
    );

    expect(context.tryUse()).toBeUndefined();
  });

  it('parses JSON with schema validation and encoded unwrapping', () => {
    const schema = z.object({
      payload: z.object({ count: z.number() }),
    });

    const parsed = Json.parse('{"payload":"{\\"count\\":2}"}', {
      unwrapEncoded: true,
      schema,
    });

    expect(isOk(parsed)).toBe(true);
    expect(parsed.unwrap()).toEqual({ payload: { count: 2 } });

    const invalid = Json.parse('{"payload":{"count":"2"}}', { schema });
    expect(invalid.ok).toBe(false);
  });

  it('rejects values that cannot be represented as stable JSON', () => {
    expect(Json.stringify({ ok: true }).unwrap()).toBe('{"ok":true}');
    expect(Json.stringify(undefined).ok).toBe(false);
    expect(Json.stringify({ dropped: undefined }).ok).toBe(false);
    expect(Json.stringify([1, undefined]).ok).toBe(false);
    expect(Json.stringify({ invalid: Number.NaN }).ok).toBe(false);
    expect(Json.stringify({ invalid: BigInt(1) }).ok).toBe(false);
    expect(Json.stringify({ invalid: '\ud800' }).ok).toBe(false);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(Json.stringify(cyclic).ok).toBe(false);
    expect(SafeJson.stringify({ dropped: undefined }).ok).toBe(false);
  });

  it('serializes and hashes stable JSON without native object key reordering', () => {
    const left = {
      '2': 'two',
      '10': 'ten',
      nested: { b: true, a: true },
      array: [{ '2': 'two', '10': 'ten' }],
    };
    const right = {
      array: [{ '10': 'ten', '2': 'two' }],
      nested: { a: true, b: true },
      '10': 'ten',
      '2': 'two',
    };

    expect(Json.stableStringify(left).unwrap()).toBe(
      '{"10":"ten","2":"two","array":[{"10":"ten","2":"two"}],"nested":{"a":true,"b":true}}'
    );
    expect(Json.stableStringify(left).unwrap()).toBe(Json.stableStringify(right).unwrap());
    expect(Json.stableContentHash(left).unwrap()).toBe(Json.stableContentHash(right).unwrap());
    expect(Json.stableStringify({ invalid: '\ud800' }).ok).toBe(false);
  });

  it('performs typed JSON HTTP requests without throwing for validation failures', async () => {
    const fetchJson: FetchTransport = async () =>
      new Response('{"total":3}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const valid = await requestJson('https://example.test/totals', {
      fetch: fetchJson,
      schema: z.object({ total: z.number() }),
    });
    expect(valid.ok).toBe(true);
    expect(valid.unwrap()).toEqual({ total: 3 });

    const invalid = await requestJson('https://example.test/totals', {
      fetch: fetchJson,
      schema: z.object({ total: z.string() }),
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.unwrapOrElse((error) => error.kind)).toBe(HttpErrorKind.Validation);
  });

  it('uses explicit abort signals for JSON HTTP timeouts', async () => {
    const timeout = new AbortController();
    const abortSignals: RequestAbortSignals = {
      timeout: () => timeout.signal,
      any: (signals) => AbortSignal.any([...signals]),
    };
    const fetchPending: FetchTransport = async (_url, init) => {
      const signal = init.signal;
      if (signal == null) throw new Error('expected request signal');
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        timeout.abort();
      });
    };

    const result = await requestJson('https://example.test/slow', {
      fetch: fetchPending,
      abortSignals,
      timeoutMs: 10,
    });

    expect(result.ok).toBe(false);
    expect(result.unwrapOrElse((error) => error.kind)).toBe(HttpErrorKind.Timeout);
  });
});
