import { describe, expect, it } from 'vitest';
import {
  advanceProjectionCheckpoint,
  advanceSyncCheckpoint,
  compareVersions,
  createProjectionRecord,
  createSyncCheckpoint,
  externalReferenceKey,
  failSyncCheckpoint,
  isGlobalScope,
  parseVersion,
  planMigrations,
  scope,
  scopeKey,
  SyncCheckpointStatus,
  updateProjectionRecord,
} from '@/primitives';

describe('kernel foundation primitives', () => {
  it('normalizes scopes into stable partition keys', () => {
    const value = scope({
      tenantId: ' tenant_a ',
      workspaceId: 'main',
      environment: 'prod',
    });

    expect(scopeKey(value)).toBe('tenant:tenant_a|workspace:main|environment:prod');
    expect(scopeKey()).toBe('global');
    expect(isGlobalScope({})).toBe(true);
  });

  it('parses and compares semantic versions', () => {
    expect(parseVersion('1.2.3').unwrap()).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(compareVersions('1.2.3', '1.3.0').unwrap()).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0').unwrap()).toBe(-1);
  });

  it('plans declarative migrations across adjacent versions', () => {
    const plan = planMigrations(
      [
        { id: '001', kind: 'schema', fromVersion: '1.0.0', toVersion: '1.1.0' },
        { id: '002', kind: 'data', fromVersion: '1.1.0', toVersion: '1.2.0' },
      ],
      { fromVersion: '1.0.0', toVersion: '1.2.0' }
    ).unwrap();

    expect(plan.map((step) => step.id)).toEqual(['001', '002']);
  });

  it('models sync checkpoints and external reference keys', () => {
    const checkpoint = createSyncCheckpoint({
      id: 'sync_001',
      source: 'external',
      stream: 'customers',
      cursor: 'cursor_1',
      now: '2026-06-04T12:00:00.000Z',
    });
    const advanced = advanceSyncCheckpoint(checkpoint, {
      cursor: 'cursor_2',
      highWatermark: '2026-06-04T12:01:00.000Z',
      now: '2026-06-04T12:02:00.000Z',
    });
    const failed = failSyncCheckpoint(advanced, {
      error: 'expired token',
      now: '2026-06-04T12:03:00.000Z',
    });

    expect(advanced.cursor).toBe('cursor_2');
    expect(failed.status).toBe(SyncCheckpointStatus.FAILED);
    expect(externalReferenceKey({ system: 'erp', entityType: 'customer', externalId: '123' })).toBe(
      'erp:customer:123'
    );
  });

  it('models projection records and checkpoints', () => {
    const created = createProjectionRecord({
      projectionName: 'customers',
      id: 'customer_001',
      value: { name: 'Acme' },
      now: '2026-06-04T12:00:00.000Z',
    });
    const updated = updateProjectionRecord(created, {
      value: { name: 'Acme Ltd' },
      now: '2026-06-04T12:01:00.000Z',
    });
    const checkpoint = advanceProjectionCheckpoint(undefined, {
      projectionName: 'customers',
      cursor: 'evt_10',
      sequence: 10,
      now: '2026-06-04T12:02:00.000Z',
    });

    expect(updated.version).toBe(2);
    expect(updated.value.name).toBe('Acme Ltd');
    expect(checkpoint).toMatchObject({ cursor: 'evt_10', sequence: 10 });
  });
});
