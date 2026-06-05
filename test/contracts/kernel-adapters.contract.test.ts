import { describe, expect, it } from 'vitest';
import { FsCache } from '@/adapters/fs/fs-cache';
import { FsCommandIdempotencyStore } from '@/adapters/fs/fs-command-idempotency-store';
import { FsDomainPackageRepository } from '@/adapters/fs/fs-domain-package-repository';
import { FsEventStore } from '@/adapters/fs/fs-event-store';
import { FsHealthReporter } from '@/adapters/fs/fs-health-reporter';
import { FsIntegrationAttemptRepository } from '@/adapters/fs/fs-integration-attempt-repository';
import { FsMetricsRecorder } from '@/adapters/fs/fs-metrics-recorder';
import { FsMigrationStateRepository } from '@/adapters/fs/fs-migration-state-repository';
import { FsOutboxRepository } from '@/adapters/fs/fs-outbox-repository';
import { FsProcessStore } from '@/adapters/fs/fs-process-store';
import { FsProjectionStore } from '@/adapters/fs/fs-projection-store';
import { FsResourceRepository } from '@/adapters/fs/fs-resource-repository';
import { FsResourceReservationPort } from '@/adapters/fs/fs-resource-reservation-port';
import { FsSyncStateRepository } from '@/adapters/fs/fs-sync-state-repository';
import { FsWorkItemRepository } from '@/adapters/fs/fs-work-item-repository';
import { FsWorkflowRepository } from '@/adapters/fs/fs-workflow-repository';
import { MemoryCache } from '@/adapters/memory/memory-cache';
import { InMemoryCommandIdempotencyStore } from '@/adapters/memory/memory-command-idempotency-store';
import { InMemoryDomainPackageRepository } from '@/adapters/memory/memory-domain-package-repository';
import { InMemoryEventStore } from '@/adapters/memory/memory-event-store';
import { InMemoryHealthReporter } from '@/adapters/memory/memory-health-reporter';
import { InMemoryIntegrationAttemptRepository } from '@/adapters/memory/memory-integration-attempt-repository';
import { InMemoryMetricsRecorder } from '@/adapters/memory/memory-metrics-recorder';
import { InMemoryMigrationStateRepository } from '@/adapters/memory/memory-migration-state-repository';
import { InMemoryOutboxRepository } from '@/adapters/memory/memory-outbox-repository';
import { InMemoryProcessStore } from '@/adapters/memory/memory-process-store';
import { InMemoryProjectionStore } from '@/adapters/memory/memory-projection-store';
import { InMemoryResourceRepository } from '@/adapters/memory/memory-resource-repository';
import { InMemoryResourceReservationPort } from '@/adapters/memory/memory-resource-reservation-port';
import { InMemorySyncStateRepository } from '@/adapters/memory/memory-sync-state-repository';
import { InMemoryWorkItemRepository } from '@/adapters/memory/memory-work-item-repository';
import { InMemoryWorkflowRepository } from '@/adapters/memory/memory-workflow-repository';
import type { AuditEvent } from '@/domain/event/audit-event';
import type { FieldSchema } from '@/domain/package/domain-package';
import { createResource } from '@/domain/resource/resource';
import { createWorkItem } from '@/domain/work-item/work-item';
import {
  normalizeWorkflowDefinition,
  type NormalizedWorkflowDefinition,
} from '@/domain/workflow/workflow-definition';
import type { AuditEventQueryPort } from '@/ports/audit-event-query';
import type { Cache } from '@/ports/cache';
import type { CommandIdempotencyStore } from '@/ports/command-idempotency-store';
import type { DomainPackageRepository } from '@/ports/domain-package';
import type { EventStore } from '@/ports/event-store';
import { ExpectedStreamRevision } from '@/ports/event-store';
import type { HealthReporter } from '@/ports/health';
import type { IntegrationAttemptRepository } from '@/ports/integration-attempt-repository';
import type { MetricsRecorder } from '@/ports/metrics';
import type { MigrationStateRepository } from '@/ports/migration-state-repository';
import type { OutboxRepository } from '@/ports/outbox-repository';
import type { ProcessStore } from '@/ports/process-store';
import type { ProjectionStore } from '@/ports/projection-store';
import type { ResourceRepository } from '@/ports/resource-repository';
import type { ResourceReservationPort } from '@/ports/resource-reservation';
import type { SyncStateRepository } from '@/ports/sync-state-repository';
import type { WorkItemRepository } from '@/ports/work-item-repository';
import type { WorkflowRepository } from '@/ports/workflow-repository';
import {
  advanceProjectionCheckpoint,
  advanceSyncCheckpoint,
  createOutboxMessage,
  createProjectionRecord,
  createProjectionSnapshot,
  createProcess,
  createSyncCheckpoint,
  eventEnvelope,
  healthCheckResult,
  HealthStatus,
  metric,
  MetricKind,
  OutboxStatus,
  RuntimeOptionError,
  scheduleProcessTimeout,
  scope,
} from '@/primitives';
import {
  createTempDir,
  immediateSleep,
  removeTempDir,
  SequenceFileTempNames,
} from '../support/application';

type AdapterContext = {
  cache: Cache;
  commandIdempotency: CommandIdempotencyStore;
  events: EventStore;
  eventQueries: AuditEventQueryPort;
  health: HealthReporter;
  integrations: IntegrationAttemptRepository;
  metrics: MetricsRecorder;
  migrations: MigrationStateRepository;
  outbox: OutboxRepository;
  packages: DomainPackageRepository;
  processes: ProcessStore;
  projections: ProjectionStore;
  resources: ResourceRepository;
  resourceReservations: ResourceReservationPort;
  syncStates: SyncStateRepository;
  workItems: WorkItemRepository;
  workflows: WorkflowRepository;
  clock: MutableClock;
  reload(): AdapterContext;
  dispose(): Promise<void>;
};

class MutableClock {
  constructor(private current: string) {}

  now(): string {
    return this.current;
  }

  set(value: string): void {
    this.current = value;
  }
}

const adapters = [
  {
    name: 'memory',
    async create(): Promise<AdapterContext> {
      const events = new InMemoryEventStore();
      const clock = new MutableClock('2026-06-04T12:00:00.000Z');
      const context: AdapterContext = {
        cache: new MemoryCache(clock),
        commandIdempotency: new InMemoryCommandIdempotencyStore(),
        events,
        eventQueries: events,
        health: new InMemoryHealthReporter(),
        integrations: new InMemoryIntegrationAttemptRepository(),
        metrics: new InMemoryMetricsRecorder(),
        migrations: new InMemoryMigrationStateRepository(),
        outbox: new InMemoryOutboxRepository(),
        packages: new InMemoryDomainPackageRepository(),
        processes: new InMemoryProcessStore(),
        projections: new InMemoryProjectionStore(),
        resources: new InMemoryResourceRepository(),
        resourceReservations: new InMemoryResourceReservationPort(),
        syncStates: new InMemorySyncStateRepository(),
        workItems: new InMemoryWorkItemRepository(),
        workflows: new InMemoryWorkflowRepository(),
        clock,
        reload: () => context,
        dispose: async () => undefined,
      };
      return context;
    },
  },
  {
    name: 'filesystem',
    async create(): Promise<AdapterContext> {
      const dataDir = await createTempDir();
      const clock = new MutableClock('2026-06-04T12:00:00.000Z');
      const tempNames = new SequenceFileTempNames();
      const contextFor = (): AdapterContext => {
        const events = new FsEventStore(dataDir, clock, immediateSleep);
        return {
          cache: new FsCache(dataDir, clock, tempNames),
          commandIdempotency: new FsCommandIdempotencyStore(
            dataDir,
            clock,
            immediateSleep,
            tempNames
          ),
          events,
          eventQueries: events,
          health: new FsHealthReporter(dataDir, clock, immediateSleep, tempNames),
          integrations: new FsIntegrationAttemptRepository(
            dataDir,
            clock,
            immediateSleep,
            tempNames
          ),
          metrics: new FsMetricsRecorder(dataDir, clock, immediateSleep),
          migrations: new FsMigrationStateRepository(dataDir, tempNames),
          outbox: new FsOutboxRepository(dataDir, clock, immediateSleep, tempNames),
          packages: new FsDomainPackageRepository(dataDir, tempNames),
          processes: new FsProcessStore(dataDir, clock, immediateSleep, tempNames),
          projections: new FsProjectionStore(dataDir, clock, immediateSleep, tempNames),
          resources: new FsResourceRepository(dataDir, tempNames),
          resourceReservations: new FsResourceReservationPort(
            dataDir,
            clock,
            immediateSleep,
            tempNames
          ),
          syncStates: new FsSyncStateRepository(dataDir, clock, immediateSleep, tempNames),
          workItems: new FsWorkItemRepository(dataDir, clock, immediateSleep, tempNames),
          workflows: new FsWorkflowRepository(dataDir, tempNames),
          clock,
          reload: contextFor,
          dispose: async () => removeTempDir(dataDir),
        };
      };
      return contextFor();
    },
  },
] as const;

describe.each(adapters)('$name kernel adapter contracts', ({ create }) => {
  it('persists workflows and domain package versions', async () => {
    const context = await create();
    try {
      const workflow = contractWorkflow();
      await context.workflows.save(workflow);
      await context.packages.save(contractPackage(workflow, '1.0.0'));
      await context.packages.save(contractPackage(workflow, '1.1.0'));

      const reloaded = context.reload();
      await expect(reloaded.workflows.getByType('contract_item')).resolves.toMatchObject({
        type: 'contract_item',
        initialState: 'draft',
      });
      await expect(reloaded.workflows.list()).resolves.toHaveLength(1);
      await expect(reloaded.packages.getByName('contract-package')).resolves.toMatchObject({
        version: '1.1.0',
      });
      await expect(
        reloaded.packages.getByNameAndVersion('contract-package', '1.0.0')
      ).resolves.toMatchObject({ version: '1.0.0' });
      await expect(reloaded.packages.getByWorkflowType('contract_item')).resolves.toMatchObject({
        name: 'contract-package',
        version: '1.1.0',
      });
      await expect(reloaded.packages.listVersions('contract-package')).resolves.toHaveLength(2);
    } finally {
      await context.dispose();
    }
  });

  it('persists work items and enforces optimistic version conflicts', async () => {
    const context = await create();
    try {
      const workflow = contractWorkflow();
      const workItem = createWorkItem({
        id: 'work_001',
        type: workflow.type,
        workflow,
        fields: { name: 'Draft item' },
        occurredAt: '2026-06-04T12:00:00.000Z',
      });
      await context.workItems.save(workItem, { expectedVersion: 0 });
      const updated = {
        ...workItem,
        fields: { name: 'Updated item' },
        updatedAt: '2026-06-04T12:01:00.000Z',
        version: 2,
      };
      await context.workItems.save(updated, { expectedVersion: 1 });

      const reloaded = context.reload();
      await expect(reloaded.workItems.getById('work_001')).resolves.toMatchObject({
        version: 2,
        fields: { name: 'Updated item' },
      });
      await expect(
        reloaded.workItems.list({ type: 'contract_item', status: 'draft' })
      ).resolves.toHaveLength(1);
      await expect(reloaded.workItems.save(updated, { expectedVersion: 1 })).rejects.toThrow(
        'Work item version conflict'
      );
    } finally {
      await context.dispose();
    }
  });

  it('persists resources and reservations with release state', async () => {
    const context = await create();
    try {
      const resource = createResource({
        id: 'res_001',
        type: 'inventory',
        fields: { quantity: 5 },
        occurredAt: '2026-06-04T12:00:00.000Z',
      });
      await context.resources.save(resource);
      await context.resourceReservations.reserve({
        id: 'reservation_001',
        resource,
        workItemId: 'work_001',
        quantity: 3,
        fields: { reason: 'test' },
        occurredAt: '2026-06-04T12:01:00.000Z',
      });

      const reloaded = context.reload();
      await expect(reloaded.resources.getById('res_001')).resolves.toMatchObject({
        type: 'inventory',
      });
      await expect(reloaded.resources.list({ type: 'inventory' })).resolves.toHaveLength(1);
      await expect(
        reloaded.resourceReservations.list({ resourceId: 'res_001', status: 'active' })
      ).resolves.toHaveLength(1);

      await reloaded.resourceReservations.release({
        resourceId: 'res_001',
        workItemId: 'work_001',
        quantity: 3,
        occurredAt: '2026-06-04T12:02:00.000Z',
      });
      await expect(
        reloaded.resourceReservations.list({ resourceId: 'res_001', status: 'released' })
      ).resolves.toMatchObject([{ id: 'reservation_001', releasedAt: '2026-06-04T12:02:00.000Z' }]);
    } finally {
      await context.dispose();
    }
  });

  it('persists integration attempts and cache entries', async () => {
    const context = await create();
    try {
      await context.cache.set('workflow:contract_item', { type: 'contract_item' });
      const attempt = await context.integrations.createPending({
        id: 'integration_001',
        provider: 'erp',
        operation: 'sync.item',
        idempotencyKey: 'erp:sync.item:event_001',
        eventId: 'event_001',
        workItemId: 'work_001',
        requestHash: 'hash_001',
        occurredAt: '2026-06-04T12:00:00.000Z',
      });
      await context.integrations.markSucceeded({
        id: attempt.id,
        externalId: 'external_001',
        occurredAt: '2026-06-04T12:01:00.000Z',
      });

      const reloaded = context.reload();
      await expect(reloaded.cache.get('workflow:contract_item')).resolves.toEqual({
        type: 'contract_item',
      });
      await expect(
        reloaded.integrations.findByIdempotencyKey('erp:sync.item:event_001')
      ).resolves.toMatchObject({ status: 'succeeded', externalId: 'external_001' });

      await reloaded.integrations.createPending({
        id: 'integration_002',
        provider: 'erp',
        operation: 'sync.item',
        idempotencyKey: 'erp:sync.item:event_001',
        eventId: 'event_001',
        workItemId: 'work_001',
        requestHash: 'hash_001',
        occurredAt: '2026-06-04T12:02:00.000Z',
      });
      await expect(reloaded.integrations.list({ status: 'skipped' })).resolves.toMatchObject([
        { id: 'integration_002', externalId: 'external_001' },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it('expires cache entries through the injected clock', async () => {
    const context = await create();
    try {
      await context.cache.set('short', { ok: true }, 60_000);

      context.clock.set('2026-06-04T12:00:30.000Z');
      await expect(context.reload().cache.get('short')).resolves.toEqual({ ok: true });

      context.clock.set('2026-06-04T12:01:01.000Z');
      await expect(context.reload().cache.get('short')).resolves.toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it('rejects invalid runtime numeric options consistently', async () => {
    const context = await create();
    try {
      await expect(context.cache.set('bad-ttl', { ok: true }, 0)).rejects.toThrow(
        RuntimeOptionError
      );
      await expect(
        context.events.readStream({ streamId: 'work_001', fromRevision: -1 })
      ).rejects.toThrow(RuntimeOptionError);
      await expect(
        context.events.readStream({ streamId: 'work_001', limit: 0 })
      ).rejects.toThrow(RuntimeOptionError);
      await expect(
        context.commandIdempotency.pruneExpired({
          now: '2026-06-04T12:00:00.000Z',
          limit: 0,
        })
      ).rejects.toThrow(RuntimeOptionError);
      await expect(
        context.outbox.claimDue({
          now: '2026-06-04T12:00:00.000Z',
          limit: 0,
        })
      ).rejects.toThrow(RuntimeOptionError);
    } finally {
      await context.dispose();
    }
  });

  it('persists command idempotency records and replays matching keys', async () => {
    const context = await create();
    try {
      const started = await context.commandIdempotency.begin({
        key: 'idem_001',
        fingerprint: 'sha256:fingerprint_001',
        commandId: 'cmd_001',
        commandType: 'contract.command',
        now: '2026-06-04T12:00:00.000Z',
      });
      expect(started).toMatchObject({
        ok: true,
        value: { outcome: 'started' },
      });
      await context.commandIdempotency.markSucceeded({
        key: 'idem_001',
        now: '2026-06-04T12:01:00.000Z',
        response: { id: 'result_001' },
      });

      const reloaded = context.reload();
      await expect(reloaded.commandIdempotency.get('idem_001')).resolves.toMatchObject({
        status: 'succeeded',
        response: { id: 'result_001' },
      });

      const replayed = await reloaded.commandIdempotency.begin({
        key: 'idem_001',
        fingerprint: 'sha256:fingerprint_001',
        commandId: 'cmd_002',
        commandType: 'contract.command',
        now: '2026-06-04T12:02:00.000Z',
      });
      expect(replayed).toMatchObject({
        ok: true,
        value: {
          outcome: 'replayed',
          record: { response: { id: 'result_001' } },
        },
      });

      const conflicting = await reloaded.commandIdempotency.begin({
        key: 'idem_001',
        fingerprint: 'sha256:fingerprint_002',
        commandId: 'cmd_003',
        commandType: 'contract.command',
        now: '2026-06-04T12:03:00.000Z',
      });
      expect(conflicting.ok).toBe(false);
      await expect(
        reloaded.commandIdempotency.list({ commandType: 'contract.command' })
      ).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });

  it('prunes expired command idempotency records and rejects non-JSON responses', async () => {
    const context = await create();
    try {
      const started = await context.commandIdempotency.begin({
        key: 'idem_expired',
        fingerprint: 'sha256:fingerprint_expired',
        commandId: 'cmd_expired',
        commandType: 'contract.command',
        now: '2026-06-04T12:00:00.000Z',
      });
      expect(started.ok).toBe(true);
      await context.commandIdempotency.markSucceeded({
        key: 'idem_expired',
        now: '2026-06-04T12:00:30.000Z',
        response: { id: 'result_expired' },
        replayExpiresAt: '2026-06-04T12:01:00.000Z',
      });

      await expect(
        context.commandIdempotency.markSucceeded({
          key: 'idem_expired',
          now: '2026-06-04T12:00:45.000Z',
          response: { invalid: BigInt(1) },
        })
      ).rejects.toThrow(/not serializable|BigInt/);

      const pruned = await context.commandIdempotency.pruneExpired({
        now: '2026-06-04T12:02:00.000Z',
      });
      expect(pruned).toEqual({ pruned: 1, keys: ['idem_expired'] });
      await expect(context.commandIdempotency.get('idem_expired')).resolves.toBeNull();

      const restarted = await context.commandIdempotency.begin({
        key: 'idem_expired',
        fingerprint: 'sha256:fingerprint_expired',
        commandId: 'cmd_restarted',
        commandType: 'contract.command',
        now: '2026-06-04T12:03:00.000Z',
      });
      expect(restarted).toMatchObject({
        ok: true,
        value: { outcome: 'started' },
      });
    } finally {
      await context.dispose();
    }
  });

  it('allows expired in-progress command idempotency records to restart', async () => {
    const context = await create();
    try {
      const started = await context.commandIdempotency.begin({
        key: 'idem_started_expired',
        fingerprint: 'sha256:fingerprint_started',
        commandId: 'cmd_started_001',
        commandType: 'contract.command',
        now: '2026-06-04T12:00:00.000Z',
        inProgressExpiresAt: '2026-06-04T12:01:00.000Z',
      });
      expect(started).toMatchObject({
        ok: true,
        value: {
          outcome: 'started',
          record: { inProgressExpiresAt: '2026-06-04T12:01:00.000Z' },
        },
      });

      const restarted = await context.commandIdempotency.begin({
        key: 'idem_started_expired',
        fingerprint: 'sha256:fingerprint_started',
        commandId: 'cmd_started_002',
        commandType: 'contract.command',
        now: '2026-06-04T12:02:00.000Z',
      });
      expect(restarted).toMatchObject({
        ok: true,
        value: {
          outcome: 'started',
          record: { commandId: 'cmd_started_002' },
        },
      });
    } finally {
      await context.dispose();
    }
  });

  it('allows only one concurrent command idempotency begin for a new key', async () => {
    const context = await create();
    try {
      const results = await Promise.all([
        context.commandIdempotency.begin({
          key: 'idem_race',
          fingerprint: 'sha256:fingerprint_race',
          commandId: 'cmd_race_001',
          commandType: 'contract.command',
          now: '2026-06-04T12:00:00.000Z',
        }),
        context.commandIdempotency.begin({
          key: 'idem_race',
          fingerprint: 'sha256:fingerprint_race',
          commandId: 'cmd_race_002',
          commandType: 'contract.command',
          now: '2026-06-04T12:00:00.000Z',
        }),
      ]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toHaveLength(1);
      await expect(context.commandIdempotency.list({ commandType: 'contract.command' })).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });

  it('persists process instances and due timeouts', async () => {
    const context = await create();
    try {
      const process = scheduleProcessTimeout(
        createProcess({
          id: 'process_001',
          type: 'contract.process',
          state: { workItemId: 'work_001' },
          now: '2026-06-04T12:00:00.000Z',
        }),
        {
          id: 'timeout_001',
          name: 'wait_for_review',
          dueAt: '2026-06-04T12:10:00.000Z',
          now: '2026-06-04T12:01:00.000Z',
        }
      );
      await context.processes.save(process);

      const reloaded = context.reload();
      await expect(reloaded.processes.getById('process_001')).resolves.toMatchObject({
        id: 'process_001',
        type: 'contract.process',
      });
      await expect(reloaded.processes.list({ type: 'contract.process' })).resolves.toHaveLength(1);
      await expect(
        reloaded.processes.listDueTimeouts({
          type: 'contract.process',
          now: '2026-06-04T12:11:00.000Z',
        })
      ).resolves.toMatchObject([{ id: 'process_001' }]);
      await expect(
        reloaded.processes.listDueTimeouts({
          type: 'contract.process',
          now: '2026-06-04T12:09:00.000Z',
        })
      ).resolves.toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it('persists metric measurements and health reports', async () => {
    const context = await create();
    try {
      await context.metrics.record(
        metric({
          name: 'contract.commands',
          kind: MetricKind.Counter,
          value: 1,
          unit: 'count',
          attributes: { command: 'work.create' },
          observedAt: '2026-06-04T12:00:00.000Z',
        })
      );
      await context.health.report(
        healthCheckResult({
          name: 'contract.store',
          status: HealthStatus.Pass,
          checkedAt: '2026-06-04T12:01:00.000Z',
          details: { adapter: 'contract' },
        })
      );

      const reloaded = context.reload();
      await expect(reloaded.metrics.list({ name: 'contract.commands' })).resolves.toMatchObject([
        { name: 'contract.commands', kind: MetricKind.Counter, value: 1 },
      ]);
      await expect(reloaded.health.get('contract.store')).resolves.toMatchObject({
        name: 'contract.store',
        status: HealthStatus.Pass,
      });
      await expect(reloaded.health.list({ status: HealthStatus.Pass })).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });

  it('persists audit events and query filters', async () => {
    const context = await create();
    try {
      const event: AuditEvent = {
        id: 'audit_001',
        type: 'WorkItemCreated',
        actorId: 'admin',
        occurredAt: '2026-06-04T12:00:00.000Z',
        workItemId: 'work_001',
        workItemType: 'contract_item',
        state: 'draft',
        fields: { name: 'Draft item' },
        version: 1,
      };
      const stored = await context.events.append(event, {
        expectedRevision: ExpectedStreamRevision.NoStream,
      });

      const reloaded = context.reload();
      expect(stored).toMatchObject({
        streamId: 'work_001',
        revision: 0,
      });
      await expect(reloaded.events.getStreamState('work_001')).resolves.toEqual({
        streamId: 'work_001',
        revision: 0,
        exists: true,
      });
      await expect(reloaded.events.readStream({ streamId: 'work_001' })).resolves.toMatchObject([
        { id: 'audit_001', revision: 0, streamId: 'work_001' },
      ]);
      await expect(reloaded.events.getByWorkItemId('work_001')).resolves.toMatchObject([
        { id: 'audit_001', type: 'WorkItemCreated' },
      ]);
      await expect(
        reloaded.eventQueries.search({ type: 'WorkItemCreated', limit: 10 })
      ).resolves.toMatchObject({
        total: 1,
        events: [{ id: 'audit_001' }],
      });
      await expect(
        reloaded.events.append(
          {
            ...event,
            id: 'audit_002',
            occurredAt: '2026-06-04T12:01:00.000Z',
          },
          { expectedRevision: 0 }
        )
      ).resolves.toMatchObject({ id: 'audit_002', revision: 1 });
      await expect(
        reloaded.events.append(
          {
            ...event,
            id: 'audit_003',
            occurredAt: '2026-06-04T12:02:00.000Z',
          },
          { expectedRevision: 0 }
        )
      ).rejects.toThrow('Event stream revision conflict');
    } finally {
      await context.dispose();
    }
  });

  it('allows only one concurrent exact-revision event append', async () => {
    const context = await create();
    try {
      const base: AuditEvent = {
        id: 'audit_race_001',
        type: 'WorkItemCreated',
        actorId: 'admin',
        occurredAt: '2026-06-04T12:00:00.000Z',
        workItemId: 'work_race',
        workItemType: 'contract_item',
        state: 'draft',
        fields: { name: 'Race item' },
        version: 1,
      };
      await context.events.append(base, {
        expectedRevision: ExpectedStreamRevision.NoStream,
      });

      const results = await Promise.allSettled([
        context.events.append(
          { ...base, id: 'audit_race_002', occurredAt: '2026-06-04T12:01:00.000Z' },
          { expectedRevision: 0 }
        ),
        context.events.append(
          { ...base, id: 'audit_race_003', occurredAt: '2026-06-04T12:02:00.000Z' },
          { expectedRevision: 0 }
        ),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await expect(context.events.readStream({ streamId: 'work_race' })).resolves.toHaveLength(2);
    } finally {
      await context.dispose();
    }
  });

  it('claims due outbox messages exactly once', async () => {
    const context = await create();
    try {
      const message = createOutboxMessage({
        id: 'outbox_001',
        event: eventEnvelope({
          id: 'evt_001',
          source: '/test',
          type: 'test.created',
          time: '2026-06-04T12:00:00.000Z',
          data: { id: 'test_001' },
        }),
        now: '2026-06-04T12:00:00.000Z',
      });
      await context.outbox.save(message);

      const claimed = await context.outbox.claimDue({
        now: '2026-06-04T12:00:01.000Z',
        limit: 10,
      });
      const secondClaim = await context.outbox.claimDue({
        now: '2026-06-04T12:00:02.000Z',
        limit: 10,
      });
      const reloaded = context.reload();

      expect(claimed).toEqual([
        expect.objectContaining({ id: 'outbox_001', status: OutboxStatus.PUBLISHING }),
      ]);
      expect(secondClaim).toEqual([]);
      await expect(reloaded.outbox.getById('outbox_001')).resolves.toMatchObject({
        status: OutboxStatus.PUBLISHING,
      });
    } finally {
      await context.dispose();
    }
  });

  it('persists sync checkpoints and scoped external references', async () => {
    const context = await create();
    try {
      const partition = scope({ tenantId: 'tenant_a' });
      const checkpoint = advanceSyncCheckpoint(
        createSyncCheckpoint({
          id: 'sync_001',
          source: 'erp',
          stream: 'customers',
          scope: partition,
          cursor: 'cursor_1',
          now: '2026-06-04T12:00:00.000Z',
        }),
        { cursor: 'cursor_2', now: '2026-06-04T12:01:00.000Z' }
      );

      await context.syncStates.saveCheckpoint(checkpoint);
      await context.syncStates.saveExternalReference({
        system: 'erp',
        entityType: 'customer',
        externalId: '123',
        localId: 'work_001',
        scope: partition,
        seenAt: '2026-06-04T12:02:00.000Z',
      });

      const reloaded = context.reload();

      await expect(reloaded.syncStates.getCheckpoint('sync_001')).resolves.toMatchObject({
        cursor: 'cursor_2',
      });
      await expect(
        reloaded.syncStates.getExternalReference({
          system: 'erp',
          entityType: 'customer',
          externalId: '123',
          scope: partition,
        })
      ).resolves.toMatchObject({ localId: 'work_001' });
    } finally {
      await context.dispose();
    }
  });

  it('persists scoped projection records, checkpoints, and snapshots', async () => {
    const context = await create();
    try {
      const partition = scope({ tenantId: 'tenant_a' });
      const record = createProjectionRecord({
        projectionName: 'customers',
        id: 'customer_001',
        scope: partition,
        value: { name: 'Acme' },
        now: '2026-06-04T12:00:00.000Z',
      });
      const checkpoint = advanceProjectionCheckpoint(undefined, {
        projectionName: 'customers',
        scope: partition,
        cursor: 'evt_001',
        sequence: 1,
        now: '2026-06-04T12:01:00.000Z',
      });
      const snapshot = createProjectionSnapshot({
        id: 'snapshot_001',
        projectionName: 'customers',
        scope: partition,
        records: [record],
        checkpoint,
        now: '2026-06-04T12:02:00.000Z',
      });

      await context.projections.save(record);
      await context.projections.saveCheckpoint(checkpoint);
      await context.projections.saveSnapshot(snapshot);

      const reloaded = context.reload();
      await expect(
        reloaded.projections.get({
          projectionName: 'customers',
          id: 'customer_001',
          scope: partition,
        })
      ).resolves.toMatchObject({ value: { name: 'Acme' } });
      await expect(
        reloaded.projections.list({ projectionName: 'customers', scope: partition })
      ).resolves.toHaveLength(1);
      await expect(
        reloaded.projections.getCheckpoint({ projectionName: 'customers', scope: partition })
      ).resolves.toMatchObject({ cursor: 'evt_001', sequence: 1 });
      await expect(
        reloaded.projections.getLatestSnapshot({ projectionName: 'customers', scope: partition })
      ).resolves.toMatchObject({ id: 'snapshot_001', recordCount: 1 });

      await reloaded.projections.clear({ projectionName: 'customers', scope: partition });
      await expect(
        reloaded.projections.list({ projectionName: 'customers', scope: partition })
      ).resolves.toEqual([]);
      await expect(
        reloaded.projections.listSnapshots({ projectionName: 'customers', scope: partition })
      ).resolves.toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it('persists package migration state', async () => {
    const context = await create();
    try {
      await context.migrations.save({
        packageName: 'orders',
        migrationId: 'orders-001',
        kind: 'schema',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        status: 'applied',
        appliedAt: '2026-06-04T12:00:00.000Z',
      });

      const reloaded = context.reload();
      await expect(
        reloaded.migrations.get({ packageName: 'orders', migrationId: 'orders-001' })
      ).resolves.toMatchObject({
        packageName: 'orders',
        migrationId: 'orders-001',
        status: 'applied',
      });
      await expect(reloaded.migrations.list('orders')).resolves.toHaveLength(1);
      await expect(reloaded.migrations.list('invoices')).resolves.toEqual([]);
    } finally {
      await context.dispose();
    }
  });
});

type AdapterSnapshot = {
  cacheValue: unknown;
  commandIdempotency: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  externalReference: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
  migrations: Array<Record<string, unknown>>;
  metrics: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
  packageVersions: string[];
  process: Record<string, unknown> | null;
  projectionCheckpoint: Record<string, unknown> | null;
  projectionRecords: Array<Record<string, unknown>>;
  projectionSnapshots: Array<Record<string, unknown>>;
  resources: Array<Record<string, unknown>>;
  reservations: Array<Record<string, unknown>>;
  syncCheckpoints: Array<Record<string, unknown>>;
  workItem: Record<string, unknown> | null;
  workflow: Record<string, unknown> | null;
};

describe('kernel adapter equivalence', () => {
  it('matches observable memory and filesystem behavior after the same mixed operation sequence', async () => {
    const contexts: Array<{ name: string; context: AdapterContext }> = [];

    for (const adapter of adapters) {
      contexts.push({ name: adapter.name, context: await adapter.create() });
    }

    try {
      const snapshots = new Map<string, AdapterSnapshot>();

      for (const { name, context } of contexts) {
        await seedEquivalentAdapterState(context);
        snapshots.set(name, await readEquivalentAdapterSnapshot(context.reload()));
      }

      const memorySnapshot = snapshots.get('memory');
      expect(memorySnapshot).toBeDefined();
      expect(snapshots.get('filesystem')).toEqual(memorySnapshot);
    } finally {
      await Promise.all(contexts.map(({ context }) => context.dispose()));
    }
  });
});

async function seedEquivalentAdapterState(context: AdapterContext): Promise<void> {
  const workflow = contractWorkflow();
  const partition = scope({ tenantId: 'tenant_equivalence' });
  const workItem = createWorkItem({
    id: 'equiv_work_001',
    type: workflow.type,
    workflow,
    fields: { name: 'Equivalent item' },
    occurredAt: '2026-06-04T13:00:00.000Z',
  });
  const resource = createResource({
    id: 'equiv_resource_001',
    type: 'capacity',
    fields: { quantity: 10 },
    occurredAt: '2026-06-04T13:00:00.000Z',
  });
  const auditEvent: AuditEvent = {
    id: 'equiv_audit_001',
    type: 'WorkItemCreated',
    actorId: 'system',
    occurredAt: '2026-06-04T13:00:00.000Z',
    workItemId: workItem.id,
    workItemType: workItem.type,
    state: workItem.status,
    fields: workItem.fields,
    version: workItem.version,
  };
  const projectionRecord = createProjectionRecord({
    projectionName: 'equivalence.work_items',
    id: workItem.id,
    scope: partition,
    value: { name: 'Equivalent item', status: workItem.status },
    now: '2026-06-04T13:00:04.000Z',
  });
  const projectionCheckpoint = advanceProjectionCheckpoint(undefined, {
    projectionName: 'equivalence.work_items',
    scope: partition,
    cursor: 'equiv_audit_001',
    sequence: 1,
    now: '2026-06-04T13:00:05.000Z',
  });
  const syncCheckpoint = advanceSyncCheckpoint(
    createSyncCheckpoint({
      id: 'equiv_sync_001',
      source: 'external',
      stream: 'work_items',
      scope: partition,
      cursor: 'cursor_1',
      now: '2026-06-04T13:00:00.000Z',
    }),
    {
      cursor: 'cursor_2',
      highWatermark: '2026-06-04T13:00:06.000Z',
      now: '2026-06-04T13:00:06.000Z',
    }
  );
  const process = scheduleProcessTimeout(
    createProcess({
      id: 'equiv_process_001',
      type: 'equivalence.process',
      state: { workItemId: workItem.id },
      now: '2026-06-04T13:00:00.000Z',
    }),
    {
      id: 'equiv_timeout_001',
      name: 'wait_for_external_ack',
      dueAt: '2026-06-04T13:30:00.000Z',
      now: '2026-06-04T13:00:01.000Z',
    }
  );

  await context.workflows.save(workflow);
  await context.packages.save(contractPackage(workflow, '2.0.0'));
  await context.workItems.save(workItem, { expectedVersion: 0 });
  await context.resources.save(resource);
  await context.resourceReservations.reserve({
    id: 'equiv_reservation_001',
    resource,
    workItemId: workItem.id,
    quantity: 4,
    fields: { reason: 'equivalence' },
    occurredAt: '2026-06-04T13:00:01.000Z',
  });
  await context.events.append(auditEvent, { expectedRevision: ExpectedStreamRevision.NoStream });
  await context.cache.set('equivalence:work_item', { id: workItem.id, status: workItem.status });

  const commandStarted = await context.commandIdempotency.begin({
    key: 'equiv_idempotency_001',
    fingerprint: 'sha256:equiv_fingerprint_001',
    commandId: 'equiv_command_001',
    commandType: 'equivalence.command',
    now: '2026-06-04T13:00:01.000Z',
  });
  if (!commandStarted.ok) {
    throw commandStarted.error;
  }
  await context.commandIdempotency.markSucceeded({
    key: 'equiv_idempotency_001',
    now: '2026-06-04T13:00:02.000Z',
    response: { workItemId: workItem.id },
  });

  await context.outbox.save(
    createOutboxMessage({
      id: 'equiv_outbox_001',
      event: eventEnvelope({
        id: 'equiv_evt_001',
        source: '/test/equivalence',
        type: 'equivalence.work_item.created',
        time: '2026-06-04T13:00:02.000Z',
        data: { workItemId: workItem.id },
      }),
      now: '2026-06-04T13:00:02.000Z',
    })
  );
  await context.outbox.claimDue({ now: '2026-06-04T13:00:03.000Z', limit: 10 });

  await context.projections.save(projectionRecord);
  await context.projections.saveCheckpoint(projectionCheckpoint);
  await context.projections.saveSnapshot(
    createProjectionSnapshot({
      id: 'equiv_snapshot_001',
      projectionName: 'equivalence.work_items',
      scope: partition,
      records: [projectionRecord],
      checkpoint: projectionCheckpoint,
      now: '2026-06-04T13:00:06.000Z',
    })
  );
  await context.syncStates.saveCheckpoint(syncCheckpoint);
  await context.syncStates.saveExternalReference({
    system: 'external',
    entityType: 'work_item',
    externalId: 'remote_work_001',
    localId: workItem.id,
    scope: partition,
    checksum: 'sha256:equiv_checksum_001',
    seenAt: '2026-06-04T13:00:06.000Z',
  });
  await context.processes.save(process);
  await context.metrics.record(
    metric({
      name: 'equivalence.commands',
      kind: MetricKind.Counter,
      value: 1,
      unit: 'count',
      attributes: { command: 'equivalence.command' },
      observedAt: '2026-06-04T13:00:07.000Z',
    })
  );
  await context.health.report(
    healthCheckResult({
      name: 'equivalence.store',
      status: HealthStatus.Pass,
      checkedAt: '2026-06-04T13:00:08.000Z',
      details: { adapter: 'equivalence' },
    })
  );
  await context.migrations.save({
    packageName: 'contract-package',
    migrationId: 'equiv_migration_001',
    kind: 'schema',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    status: 'applied',
    appliedAt: '2026-06-04T13:00:09.000Z',
  });
}

async function readEquivalentAdapterSnapshot(context: AdapterContext): Promise<AdapterSnapshot> {
  const partition = scope({ tenantId: 'tenant_equivalence' });
  const workflow = await context.workflows.getByType('contract_item');
  const workItem = await context.workItems.getById('equiv_work_001');
  const process = await context.processes.getById('equiv_process_001');
  const projectionCheckpoint = await context.projections.getCheckpoint({
    projectionName: 'equivalence.work_items',
    scope: partition,
  });
  const externalReference = await context.syncStates.getExternalReference({
    system: 'external',
    entityType: 'work_item',
    externalId: 'remote_work_001',
    scope: partition,
  });
  const health = await context.health.get('equivalence.store');

  return {
    cacheValue: await context.cache.get('equivalence:work_item'),
    commandIdempotency: (await context.commandIdempotency.list({
      commandType: 'equivalence.command',
    })).map((record) => ({
      key: record.key,
      commandId: record.commandId,
      commandType: record.commandType,
      status: record.status,
      response: record.response,
    })),
    events: (await context.events.readStream({ streamId: 'equiv_work_001' })).map((event) => ({
      id: event.id,
      revision: event.revision,
      streamId: event.streamId,
      type: event.type,
    })),
    externalReference:
      externalReference == null
        ? null
        : {
            system: externalReference.system,
            entityType: externalReference.entityType,
            externalId: externalReference.externalId,
            localId: externalReference.localId,
            checksum: externalReference.checksum,
          },
    health:
      health == null
        ? null
        : {
            name: health.name,
            status: health.status,
            details: health.details,
          },
    migrations: (await context.migrations.list('contract-package')).map((migration) => ({
      packageName: migration.packageName,
      migrationId: migration.migrationId,
      kind: migration.kind,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      status: migration.status,
    })),
    metrics: (await context.metrics.list({ name: 'equivalence.commands' })).map((measurement) => ({
      name: measurement.name,
      kind: measurement.kind,
      value: measurement.value,
      unit: measurement.unit,
      attributes: measurement.attributes,
    })),
    outbox: sortRecordsById(
      (await context.outbox.list()).map((message) => ({
        id: message.id,
        status: message.status,
        eventType: message.event.type,
        attempts: message.attempts,
      }))
    ),
    packageVersions: (await context.packages.listVersions('contract-package')).map(
      (domainPackage) => domainPackage.version
    ),
    process:
      process == null
        ? null
        : {
            id: process.id,
            type: process.type,
            status: process.status,
            state: process.state,
            timeouts: process.timeouts.map((timeout) => ({
              id: timeout.id,
              name: timeout.name,
              status: timeout.status,
              dueAt: timeout.dueAt,
            })),
          },
    projectionCheckpoint:
      projectionCheckpoint == null
        ? null
        : {
            projectionName: projectionCheckpoint.projectionName,
            cursor: projectionCheckpoint.cursor,
            sequence: projectionCheckpoint.sequence,
          },
    projectionRecords: (await context.projections.list({
      projectionName: 'equivalence.work_items',
      scope: partition,
    })).map((record) => ({
      id: record.id,
      projectionName: record.projectionName,
      value: record.value,
      version: record.version,
    })),
    projectionSnapshots: (await context.projections.listSnapshots({
      projectionName: 'equivalence.work_items',
      scope: partition,
    })).map((snapshot) => ({
      id: snapshot.id,
      projectionName: snapshot.projectionName,
      recordCount: snapshot.recordCount,
      checkpoint: snapshot.checkpoint == null
        ? null
        : {
            cursor: snapshot.checkpoint.cursor,
            sequence: snapshot.checkpoint.sequence,
          },
    })),
    resources: sortRecordsById(
      (await context.resources.list({ type: 'capacity' })).map((resource) => ({
        id: resource.id,
        type: resource.type,
        fields: resource.fields,
        version: resource.version,
      }))
    ),
    reservations: sortRecordsById(
      (await context.resourceReservations.list({ resourceId: 'equiv_resource_001' })).map(
        (reservation) => ({
          id: reservation.id,
          resourceId: reservation.resourceId,
          workItemId: reservation.workItemId,
          quantity: reservation.quantity,
          status: reservation.status,
        })
      )
    ),
    syncCheckpoints: (await context.syncStates.listCheckpoints({
      source: 'external',
      stream: 'work_items',
      scope: partition,
    })).map((checkpoint) => ({
      id: checkpoint.id,
      source: checkpoint.source,
      stream: checkpoint.stream,
      cursor: checkpoint.cursor,
      highWatermark: checkpoint.highWatermark,
      status: checkpoint.status,
    })),
    workItem:
      workItem == null
        ? null
        : {
            id: workItem.id,
            type: workItem.type,
            status: workItem.status,
            fields: workItem.fields,
            version: workItem.version,
          },
    workflow:
      workflow == null
        ? null
        : {
            type: workflow.type,
            initialState: workflow.initialState,
            states: workflow.states,
          },
  };
}

function sortRecordsById<T extends { id: string }>(records: T[]): T[] {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function contractWorkflow(): NormalizedWorkflowDefinition {
  return normalizeWorkflowDefinition({
    type: 'contract_item',
    states: ['draft', 'approved'],
    transitions: [{ action: 'approve', from: 'draft', to: 'approved' }],
    closedStates: ['approved'],
  });
}

function contractFieldSchema(): FieldSchema {
  return {
    type: 'contract_item',
    fields: {
      name: { type: 'string', required: true, minLength: 1 },
    },
  };
}

function contractPackage(workflow: NormalizedWorkflowDefinition, version: string) {
  return {
    name: 'contract-package',
    version,
    workflowType: workflow.type,
    workflow,
    schema: contractFieldSchema(),
    migrations: [],
    fixtures: [],
    registeredAt: version === '1.0.0' ? '2026-06-04T12:00:00.000Z' : '2026-06-04T12:01:00.000Z',
  };
}
