import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ApplicationDependencies } from '@/application/dependencies';
import { StaticAuthorizer } from '@/adapters/authorization';
import { NoopEventPublisher } from '@/adapters/events';
import { AllowAllPolicyEngine } from '@/adapters/policy';
import { ReservationAvailabilityPort } from '@/adapters/resources';
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
import { InMemoryUnitOfWorkManager } from '@/adapters/memory/memory-unit-of-work-manager';
import { InMemoryWorkItemRepository } from '@/adapters/memory/memory-work-item-repository';
import { InMemoryWorkflowRepository } from '@/adapters/memory/memory-workflow-repository';
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
import { FsUnitOfWorkManager } from '@/adapters/fs/fs-unit-of-work-manager';
import { FsWorkItemRepository } from '@/adapters/fs/fs-work-item-repository';
import { FsWorkflowRepository } from '@/adapters/fs/fs-workflow-repository';
import type { FileTempNames } from '@/adapters/fs';
import { NoopLogger } from '@/adapters/observability/noop-logger';
import { NoopTracer } from '@/adapters/observability/noop-tracer';
import { RepositoryWorkItemQueryPort } from '@/adapters/query';
import type { Clock } from '@/ports/clock';
import type { IdGenerator } from '@/ports/id-generator';
import type { SleepFunction } from '@/primitives/timing';
import type { WorkflowDefinition } from '@/domain/workflow/workflow-definition';
import type { FieldSchema } from '@/domain/package/domain-package';
import type { Actor } from '@/domain/auth/auth';

export const adminActor: Actor = { id: 'local-admin', roles: ['admin'] };
export const operatorActor: Actor = { id: 'operator', roles: ['operator'] };
export const viewerActor: Actor = { id: 'viewer', roles: ['viewer'] };

export const sampleOrderWorkflow: WorkflowDefinition = {
  type: 'order',
  states: ['draft', 'received', 'validated', 'released', 'closed'],
  transitions: [
    { action: 'submit', from: 'draft', to: 'received', requires: ['customer', 'lines'] },
    { action: 'validate', from: 'received', to: 'validated' },
    { action: 'release', from: 'validated', to: 'released' },
    { action: 'close', from: 'released', to: 'closed' },
  ],
  closedStates: ['closed'],
};

export const sampleOrderFieldSchema: FieldSchema = {
  type: 'order',
  fields: {
    customer: { type: 'string', required: true, minLength: 1 },
    lines: { type: 'array', required: true, minItems: 1 },
    priority: { type: 'enum', values: ['low', 'normal', 'high'] },
    requiresReview: { type: 'boolean' },
  },
};

export class SequenceClock implements Clock {
  private index = 0;

  constructor(
    private readonly values = [
      '2026-06-02T17:40:22.000Z',
      '2026-06-02T17:41:22.000Z',
      '2026-06-02T17:42:22.000Z',
      '2026-06-02T17:43:22.000Z',
      '2026-06-02T17:44:22.000Z',
      '2026-06-02T17:45:22.000Z',
    ]
  ) {}

  now(): string {
    const value = this.values[Math.min(this.index, this.values.length - 1)]!;
    this.index += 1;
    return value;
  }
}

export class SequenceIdGenerator implements IdGenerator {
  private readonly counters = new Map<string, number>();

  nextId(prefix: string): string {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}_${String(next).padStart(3, '0')}`;
  }
}

export class SequenceFileTempNames implements FileTempNames {
  private index = 0;

  nextTempName(): string {
    this.index += 1;
    return `tmp_${String(this.index).padStart(3, '0')}`;
  }
}

export const immediateSleep: SleepFunction = async () => undefined;

export function createMemoryDeps(): ApplicationDependencies {
  const workItems = new InMemoryWorkItemRepository();
  const events = new InMemoryEventStore();
  const resourceReservations = new InMemoryResourceReservationPort();
  const clock = new SequenceClock();

  return {
    authorizer: new StaticAuthorizer(),
    policyEngine: new AllowAllPolicyEngine(),
    workItems,
    workItemQueries: new RepositoryWorkItemQueryPort(workItems, events),
    workflows: new InMemoryWorkflowRepository(),
    packages: new InMemoryDomainPackageRepository(),
    events,
    eventQueries: events,
    outbox: new InMemoryOutboxRepository(),
    eventPublisher: new NoopEventPublisher(),
    unitOfWork: new InMemoryUnitOfWorkManager(),
    syncStates: new InMemorySyncStateRepository(),
    projections: new InMemoryProjectionStore(),
    resources: new InMemoryResourceRepository(),
    resourceAvailability: new ReservationAvailabilityPort(resourceReservations),
    resourceReservations,
    integrations: new InMemoryIntegrationAttemptRepository(),
    migrations: new InMemoryMigrationStateRepository(),
    processes: new InMemoryProcessStore(),
    cache: new MemoryCache(clock),
    commandIdempotency: new InMemoryCommandIdempotencyStore(),
    health: new InMemoryHealthReporter(),
    metrics: new InMemoryMetricsRecorder(),
    logger: new NoopLogger(),
    tracer: new NoopTracer(),
    clock,
    ids: new SequenceIdGenerator(),
  };
}

export function createFsDeps(dataDir: string): ApplicationDependencies {
  const clock = new SequenceClock();
  const tempNames = new SequenceFileTempNames();
  const workItems = new FsWorkItemRepository(dataDir, clock, immediateSleep, tempNames);
  const events = new FsEventStore(dataDir, clock, immediateSleep);
  const resourceReservations = new FsResourceReservationPort(
    dataDir,
    clock,
    immediateSleep,
    tempNames
  );

  return {
    authorizer: new StaticAuthorizer(),
    policyEngine: new AllowAllPolicyEngine(),
    workItems,
    workItemQueries: new RepositoryWorkItemQueryPort(workItems, events),
    workflows: new FsWorkflowRepository(dataDir, tempNames),
    packages: new FsDomainPackageRepository(dataDir, tempNames),
    events,
    eventQueries: events,
    outbox: new FsOutboxRepository(dataDir, clock, immediateSleep, tempNames),
    eventPublisher: new NoopEventPublisher(),
    unitOfWork: new FsUnitOfWorkManager(dataDir, clock, immediateSleep),
    syncStates: new FsSyncStateRepository(dataDir, clock, immediateSleep, tempNames),
    projections: new FsProjectionStore(dataDir, clock, immediateSleep, tempNames),
    resources: new FsResourceRepository(dataDir, tempNames),
    resourceAvailability: new ReservationAvailabilityPort(resourceReservations),
    resourceReservations,
    integrations: new FsIntegrationAttemptRepository(dataDir, clock, immediateSleep, tempNames),
    migrations: new FsMigrationStateRepository(dataDir, tempNames),
    processes: new FsProcessStore(dataDir, clock, immediateSleep, tempNames),
    cache: new FsCache(dataDir, clock, tempNames),
    commandIdempotency: new FsCommandIdempotencyStore(
      dataDir,
      clock,
      immediateSleep,
      tempNames
    ),
    health: new FsHealthReporter(dataDir, clock, immediateSleep, tempNames),
    metrics: new FsMetricsRecorder(dataDir, clock, immediateSleep),
    logger: new NoopLogger(),
    tracer: new NoopTracer(),
    clock,
    ids: new SequenceIdGenerator(),
  };
}

export async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'domain-kernel-'));
}

export async function removeTempDir(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}
