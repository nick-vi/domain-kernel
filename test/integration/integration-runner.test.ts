import { describe, expect, it } from 'vitest';
import {
  computeIntegrationRequestHash,
  IntegrationRunner,
  type IntegrationRunResult,
} from '@/application/integration-runner';
import type {
  IntegrationOperationResult,
  IntegrationProvider,
} from '@/ports/integration-provider';
import {
  createFsDeps,
  createMemoryDeps,
  createTempDir,
  removeTempDir,
} from '../support/application';

type FakePayload = {
  orderId: string;
  lines: Array<{ sku: string; quantity: number }>;
};

type FakeResult = {
  exported: boolean;
};

describe('integration runner', () => {
  it('marks successful provider calls succeeded', async () => {
    const deps = createMemoryDeps();
    const payload = createPayload();
    const provider = new FakeProvider({ externalId: 'fake_order_123', result: { exported: true } });

    const result = await new IntegrationRunner(deps).run({
      provider: 'fake-erp',
      operation: 'export_order',
      eventId: 'evt_123',
      workItemId: 'work_001',
      payload,
      providerAdapter: provider,
    });
    const persisted = await deps.integrations.getById('attempt_001');

    expect(provider.calls).toEqual([payload]);
    expect(result).toMatchObject({
      status: 'succeeded',
      externalId: 'fake_order_123',
      result: { exported: true },
      attempt: {
        id: 'attempt_001',
        status: 'succeeded',
        externalId: 'fake_order_123',
      },
    });
    expect(persisted).toMatchObject({
      status: 'succeeded',
      externalId: 'fake_order_123',
    });
  });

  it('marks provider failures failed and returns a structured provider error', async () => {
    const deps = createMemoryDeps();
    const provider = new FakeProvider({
      error: { code: 'FAKE_PROVIDER_FAILURE', message: 'Fake provider failed' },
    });

    const result = await new IntegrationRunner(deps).run({
      provider: 'fake-erp',
      operation: 'export_order',
      eventId: 'evt_123',
      payload: createPayload(),
      providerAdapter: provider,
    });
    const persisted = await deps.integrations.getById('attempt_001');

    expect(provider.calls).toHaveLength(1);
    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'FAKE_PROVIDER_FAILURE',
        message: 'Fake provider failed',
      },
      attempt: {
        id: 'attempt_001',
        status: 'failed',
        errorCode: 'FAKE_PROVIDER_FAILURE',
        errorMessage: 'Fake provider failed',
      },
    });
    expect(persisted).toMatchObject({
      status: 'failed',
      errorCode: 'FAKE_PROVIDER_FAILURE',
      errorMessage: 'Fake provider failed',
    });
  });

  it('skips provider calls for duplicate succeeded idempotency keys', async () => {
    const deps = createMemoryDeps();
    const runner = new IntegrationRunner(deps);
    const firstProvider = new FakeProvider({
      externalId: 'fake_order_123',
      result: { exported: true },
    });
    const duplicateProvider = new FakeProvider({
      externalId: 'fake_order_duplicate',
      result: { exported: true },
    });

    await runner.run({
      provider: 'fake-erp',
      operation: 'export_order',
      eventId: 'evt_123',
      payload: createPayload(),
      providerAdapter: firstProvider,
    });
    const duplicate = await runner.run({
      provider: 'fake-erp',
      operation: 'export_order',
      eventId: 'evt_123',
      payload: createPayload(),
      providerAdapter: duplicateProvider,
    });
    const attempts = await deps.integrations.list();

    expect(duplicateProvider.calls).toHaveLength(0);
    expect(duplicate).toMatchObject({
      status: 'skipped',
      reason: 'already_succeeded',
      externalId: 'fake_order_123',
      attempt: {
        id: 'attempt_002',
        status: 'skipped',
        externalId: 'fake_order_123',
      },
      replayOf: {
        id: 'attempt_001',
        status: 'succeeded',
      },
    });
    expect(attempts.map((attempt) => attempt.status)).toEqual(['succeeded', 'skipped']);
  });

  it('returns in_progress without calling the provider for duplicate pending idempotency keys', async () => {
    const deps = createMemoryDeps();
    const runner = new IntegrationRunner(deps);
    const duplicateProvider = new FakeProvider({
      externalId: 'fake_order_duplicate',
      result: { exported: true },
    });
    let duplicateResult: IntegrationRunResult<FakeResult> | undefined;

    const first = await runner.run({
      provider: 'fake-erp',
      operation: 'export_order',
      eventId: 'evt_123',
      payload: createPayload(),
      providerAdapter: new FakeProvider({
        externalId: 'fake_order_123',
        result: { exported: true },
        beforeExecute: async () => {
          duplicateResult = await runner.run({
            provider: 'fake-erp',
            operation: 'export_order',
            eventId: 'evt_123',
            payload: createPayload(),
            providerAdapter: duplicateProvider,
          });
        },
      }),
    });
    const attempts = await deps.integrations.list();

    expect(first.status).toBe('succeeded');
    expect(duplicateProvider.calls).toHaveLength(0);
    expect(duplicateResult).toMatchObject({
      status: 'in_progress',
      reason: 'already_in_progress',
      attempt: {
        id: 'attempt_001',
        status: 'pending',
      },
    });
    expect(attempts.map((attempt) => attempt.status)).toEqual(['succeeded']);
  });

  it('rejects duplicate idempotency keys with different request hashes', async () => {
    const deps = createMemoryDeps();
    const runner = new IntegrationRunner(deps);

    await runner.run({
      provider: 'fake-erp',
      operation: 'export_order',
      eventId: 'evt_123',
      payload: createPayload(),
      providerAdapter: new FakeProvider({
        externalId: 'fake_order_123',
        result: { exported: true },
      }),
    });

    await expect(
      runner.run({
        provider: 'fake-erp',
        operation: 'export_order',
        eventId: 'evt_123',
        payload: { ...createPayload(), lines: [{ sku: 'frozen-corn', quantity: 1 }] },
        providerAdapter: new FakeProvider({
          externalId: 'fake_order_duplicate',
          result: { exported: true },
        }),
      })
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('allows a failed idempotency key to create a new pending attempt before retry execution', async () => {
    const deps = createMemoryDeps();
    const runner = new IntegrationRunner(deps);
    const pendingStatuses: string[] = [];
    await runner.run({
      provider: 'fake-erp',
      operation: 'export_order',
      eventId: 'evt_123',
      payload: createPayload(),
      providerAdapter: new FakeProvider({
        error: { code: 'FAKE_PROVIDER_FAILURE', message: 'Fake provider failed' },
      }),
    });

    const retry = await runner.run({
      provider: 'fake-erp',
      operation: 'export_order',
      eventId: 'evt_123',
      payload: createPayload(),
      providerAdapter: new FakeProvider({
        externalId: 'fake_order_123',
        result: { exported: true },
        beforeExecute: async () => {
          const attempt = await deps.integrations.getById('attempt_002');
          pendingStatuses.push(attempt?.status ?? 'missing');
        },
      }),
    });
    const attempts = await deps.integrations.list();

    expect(pendingStatuses).toEqual(['pending']);
    expect(retry).toMatchObject({
      status: 'succeeded',
      attempt: {
        id: 'attempt_002',
        status: 'succeeded',
      },
    });
    expect(attempts.map((attempt) => attempt.status)).toEqual(['failed', 'succeeded']);
  });

  it('persists external ids and request hashes', async () => {
    const deps = createMemoryDeps();
    const payload = createPayload();

    await new IntegrationRunner(deps).run({
      provider: 'fake-erp',
      operation: 'export_order',
      eventId: 'evt_123',
      payload,
      providerAdapter: new FakeProvider({
        externalId: 'fake_order_123',
        result: { exported: true },
      }),
    });
    const attempt = await deps.integrations.getById('attempt_001');

    expect(attempt).toMatchObject({
      externalId: 'fake_order_123',
      requestHash: computeIntegrationRequestHash(payload),
    });
  });

  it('preserves runner-created attempts across filesystem reload', async () => {
    const dataDir = await createTempDir();
    try {
      const deps = createFsDeps(dataDir);
      await new IntegrationRunner(deps).run({
        provider: 'fake-erp',
        operation: 'export_order',
        eventId: 'evt_123',
        resourceId: 'resource_001',
        payload: createPayload(),
        providerAdapter: new FakeProvider({
          externalId: 'fake_order_123',
          result: { exported: true },
        }),
      });

      const restarted = createFsDeps(dataDir);
      const attempt = await restarted.integrations.getById('attempt_001');

      expect(attempt).toMatchObject({
        id: 'attempt_001',
        status: 'succeeded',
        provider: 'fake-erp',
        operation: 'export_order',
        eventId: 'evt_123',
        resourceId: 'resource_001',
        externalId: 'fake_order_123',
      });
    } finally {
      await removeTempDir(dataDir);
    }
  });
});

function createPayload(): FakePayload {
  return {
    orderId: 'work_001',
    lines: [{ sku: 'frozen-peas', quantity: 12 }],
  };
}

class FakeProvider implements IntegrationProvider<FakePayload, FakeResult> {
  readonly calls: FakePayload[] = [];

  constructor(
    private readonly behavior:
      | (IntegrationOperationResult<FakeResult> & {
          beforeExecute?: (() => Promise<void>) | undefined;
        })
      | {
          error: { code: string; message: string };
          beforeExecute?: (() => Promise<void>) | undefined;
        }
  ) {}

  async execute(input: FakePayload): Promise<IntegrationOperationResult<FakeResult>> {
    this.calls.push(structuredClone(input));
    await this.behavior.beforeExecute?.();
    if ('error' in this.behavior) {
      throw this.behavior.error;
    }

    return {
      ...(this.behavior.externalId != null ? { externalId: this.behavior.externalId } : {}),
      result: this.behavior.result,
    };
  }
}
