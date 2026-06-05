import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  createIntegrationAttemptUseCase,
  getIntegrationAttemptUseCase,
  listIntegrationAttemptsUseCase,
  markIntegrationAttemptFailedUseCase,
  markIntegrationAttemptSucceededUseCase,
} from '@/application/use-cases';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { IntegrationAttempt } from '@/domain/integration/integration-attempt';
import {
  adminActor,
  createFsDeps,
  createMemoryDeps,
  createTempDir,
  removeTempDir,
  viewerActor,
} from '../support/application';

const execFileAsync = promisify(execFile);

describe('integration attempt tracking and idempotency', () => {
  it('creates a pending integration attempt', async () => {
    const deps = createMemoryDeps();

    const attempt = await createIntegrationAttemptUseCase(deps, {
      provider: 'erp',
      operation: 'export_order',
      eventId: 'evt_123',
      workItemId: 'work_001',
      requestHash: 'sha256:abc',
      actor: adminActor,
    });

    expect(attempt).toEqual({
      id: 'attempt_001',
      provider: 'erp',
      operation: 'export_order',
      idempotencyKey: 'erp:export_order:evt_123',
      status: 'pending',
      eventId: 'evt_123',
      workItemId: 'work_001',
      requestHash: 'sha256:abc',
      attemptCount: 1,
      createdAt: '2026-06-02T17:40:22.000Z',
      updatedAt: '2026-06-02T17:40:22.000Z',
    });
  });

  it('marks an attempt succeeded', async () => {
    const deps = createMemoryDeps();
    await createAttempt(deps, 'evt_123');

    const succeeded = await markIntegrationAttemptSucceededUseCase(deps, {
      id: 'attempt_001',
      externalId: 'erp_order_123',
      actor: adminActor,
    });

    expect(succeeded).toMatchObject({
      id: 'attempt_001',
      status: 'succeeded',
      externalId: 'erp_order_123',
      attemptCount: 1,
      updatedAt: '2026-06-02T17:41:22.000Z',
    });
  });

  it('marks an attempt failed', async () => {
    const deps = createMemoryDeps();
    await createAttempt(deps, 'evt_123');

    const failed = await markIntegrationAttemptFailedUseCase(deps, {
      id: 'attempt_001',
      errorCode: 'ERP_TIMEOUT',
      errorMessage: 'ERP request timed out',
      actor: adminActor,
    });

    expect(failed).toMatchObject({
      id: 'attempt_001',
      status: 'failed',
      errorCode: 'ERP_TIMEOUT',
      errorMessage: 'ERP request timed out',
      updatedAt: '2026-06-02T17:41:22.000Z',
    });
  });

  it('finds an attempt by idempotency key', async () => {
    const deps = createMemoryDeps();
    await createAttempt(deps, 'evt_123');

    const found = await deps.integrations.findByIdempotencyKey('erp:export_order:evt_123');

    expect(found).toMatchObject({
      id: 'attempt_001',
      idempotencyKey: 'erp:export_order:evt_123',
    });
  });

  it('rejects a duplicate pending idempotency key', async () => {
    const deps = createMemoryDeps();
    await createAttempt(deps, 'evt_123');

    await expect(createAttempt(deps, 'evt_123')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
    });
  });

  it('detects duplicate succeeded idempotency keys and creates a skipped attempt', async () => {
    const deps = createMemoryDeps();
    await createAttempt(deps, 'evt_123');
    await markIntegrationAttemptSucceededUseCase(deps, {
      id: 'attempt_001',
      externalId: 'erp_order_123',
      actor: adminActor,
    });

    const duplicate = await createAttempt(deps, 'evt_123');
    const idempotentLookup = await deps.integrations.findByIdempotencyKey(
      'erp:export_order:evt_123'
    );

    expect(duplicate).toMatchObject({
      id: 'attempt_002',
      status: 'skipped',
      attemptCount: 0,
      idempotencyKey: 'erp:export_order:evt_123',
    });
    expect(idempotentLookup).toMatchObject({
      id: 'attempt_001',
      status: 'succeeded',
    });
  });

  it('preserves attempts across filesystem reload', async () => {
    const dataDir = await createTempDir();
    try {
      const deps = createFsDeps(dataDir);
      await createAttempt(deps, 'evt_123');
      await markIntegrationAttemptSucceededUseCase(deps, {
        id: 'attempt_001',
        externalId: 'erp_order_123',
        actor: adminActor,
      });

      const restarted = createFsDeps(dataDir);
      const found = await getIntegrationAttemptUseCase(restarted, {
        id: 'attempt_001',
        actor: viewerActor,
      });

      expect(found).toMatchObject({
        id: 'attempt_001',
        status: 'succeeded',
        externalId: 'erp_order_123',
      });
    } finally {
      await removeTempDir(dataDir);
    }
  });

  it('lists attempts by provider and status', async () => {
    const deps = createMemoryDeps();
    await createAttempt(deps, 'evt_erp_success');
    await markIntegrationAttemptSucceededUseCase(deps, {
      id: 'attempt_001',
      actor: adminActor,
    });
    await createIntegrationAttemptUseCase(deps, {
      provider: 'shipping',
      operation: 'create_shipment',
      eventId: 'evt_shipping',
      actor: adminActor,
    });
    await createAttempt(deps, 'evt_erp_failed');
    await markIntegrationAttemptFailedUseCase(deps, {
      id: 'attempt_003',
      errorMessage: 'ERP rejected the payload',
      actor: adminActor,
    });

    const erpAttempts = await listIntegrationAttemptsUseCase(deps, {
      actor: viewerActor,
      query: { provider: 'erp' },
    });
    const failedAttempts = await listIntegrationAttemptsUseCase(deps, {
      actor: viewerActor,
      query: { status: 'failed' },
    });

    expect(erpAttempts.map((attempt) => attempt.id)).toEqual(['attempt_001', 'attempt_003']);
    expect(failedAttempts).toEqual([
      expect.objectContaining({
        id: 'attempt_003',
        provider: 'erp',
        status: 'failed',
      }),
    ]);
  });

  it('does not require a real provider adapter', async () => {
    const deps = createMemoryDeps();

    const attempt = await createIntegrationAttemptUseCase(deps, {
      provider: 'future-provider',
      operation: 'sync_later',
      idempotencyKey: 'future-provider:sync_later:manual',
      actor: adminActor,
    });

    expect(attempt).toMatchObject({
      provider: 'future-provider',
      operation: 'sync_later',
      status: 'pending',
    });
  });

  it('supports JSON CLI inspection commands', async () => {
    const dataDir = await createTempDir();
    try {
      const deps = createFsDeps(dataDir);
      await createAttempt(deps, 'evt_123');
      await markIntegrationAttemptSucceededUseCase(deps, {
        id: 'attempt_001',
        externalId: 'erp_order_123',
        actor: adminActor,
      });

      const list = await runCliJson<IntegrationAttempt[]>(dataDir, [
        'integrations',
        'list',
        '--provider',
        'erp',
        '--status',
        'succeeded',
        '--json',
      ]);
      const shown = await runCliJson<IntegrationAttempt>(dataDir, [
        'integrations',
        'show',
        'attempt_001',
        '--json',
      ]);

      expect(list.map((attempt) => attempt.id)).toEqual(['attempt_001']);
      expect(shown).toMatchObject({
        id: 'attempt_001',
        status: 'succeeded',
        externalId: 'erp_order_123',
      });
    } finally {
      await removeTempDir(dataDir);
    }
  });
});

async function createAttempt(deps: ApplicationDependencies, eventId: string) {
  return createIntegrationAttemptUseCase(deps, {
    provider: 'erp',
    operation: 'export_order',
    eventId,
    workItemId: 'work_001',
    actor: adminActor,
  });
}

async function runCli(dataDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('node', [
    'dist/cli/index.js',
    '--data-dir',
    dataDir,
    ...args,
  ]);
  return stdout.trim();
}

async function runCliJson<T>(dataDir: string, args: string[]): Promise<T> {
  return JSON.parse(await runCli(dataDir, args)) as T;
}
