import { resolve } from 'node:path';
import type { ApplicationDependencies } from '@/application/dependencies';
import { StaticAuthorizer } from '@/adapters/authorization';
import { NoopEventPublisher } from '@/adapters/events';
import { AllowAllPolicyEngine } from '@/adapters/policy';
import { ReservationAvailabilityPort } from '@/adapters/resources';
import {
  FsCache,
  FsCommandIdempotencyStore,
  FsDomainPackageRepository,
  FsEventStore,
  FsHealthReporter,
  FsIntegrationAttemptRepository,
  FsMetricsRecorder,
  FsMigrationStateRepository,
  FsOutboxRepository,
  FsProcessStore,
  FsProjectionStore,
  FsWorkItemRepository,
  FsWorkflowRepository,
  FsResourceRepository,
  FsResourceReservationPort,
  FsSyncStateRepository,
  FsUnitOfWorkManager,
  ensureDir,
  RandomFileTempNames,
} from '@/adapters/fs';
import {
  ConsoleLogger,
  CorrelatedLogger,
  CryptoIdGenerator,
  JsonLogger,
  NoopLogger,
  NoopTracer,
  SimpleTracer,
  SystemClock,
} from '@/adapters/observability';
import { RepositoryWorkItemQueryPort } from '@/adapters/query';
import { resolveKernelConfig } from '@/application/config';
import type { Actor } from '@/domain/auth/auth';
import type { Clock } from '@/ports/clock';
import type { Logger } from '@/ports/logger';
import { branch } from '@/primitives/branch';
import { sleep } from '@/primitives/timing';

export type CliGlobalOptions = {
  dataDir?: string;
  actor?: string;
  logs?: 'none' | 'console' | 'json';
  trace?: boolean;
};

export function resolveDataDir(dataDir?: string): string {
  return resolveKernelConfig({ dataDir, env: process.env }).dataDir.value;
}

export function resolveActor(actor?: string): Actor {
  const config = resolveKernelConfig({ actor, env: process.env });

  return {
    id: config.actorId.value,
    roles: config.actorRoles.value,
  };
}

export function createCliDependencies(options: CliGlobalOptions): ApplicationDependencies {
  const config = resolveKernelConfig({ ...options, env: process.env });
  const dataDir = config.dataDir.value;
  const clock = new SystemClock();
  const baseLogger = createLogger(config.logs.value, clock);
  const ids = new CryptoIdGenerator();
  const tracer = config.trace.value ? new SimpleTracer(baseLogger, { clock, ids }) : new NoopTracer();
  const logger = config.trace.value ? new CorrelatedLogger(baseLogger, tracer) : baseLogger;
  const tempNames = new RandomFileTempNames();
  const workItems = new FsWorkItemRepository(dataDir, clock, sleep, tempNames);
  const events = new FsEventStore(dataDir, clock, sleep);
  const resourceReservations = new FsResourceReservationPort(dataDir, clock, sleep, tempNames);

  return {
    authorizer: new StaticAuthorizer(),
    policyEngine: new AllowAllPolicyEngine(),
    workItems,
    workItemQueries: new RepositoryWorkItemQueryPort(workItems, events),
    workflows: new FsWorkflowRepository(dataDir, tempNames),
    packages: new FsDomainPackageRepository(dataDir, tempNames),
    events,
    eventQueries: events,
    outbox: new FsOutboxRepository(dataDir, clock, sleep, tempNames),
    eventPublisher: new NoopEventPublisher(),
    unitOfWork: new FsUnitOfWorkManager(dataDir, clock, sleep),
    syncStates: new FsSyncStateRepository(dataDir, clock, sleep, tempNames),
    projections: new FsProjectionStore(dataDir, clock, sleep, tempNames),
    resources: new FsResourceRepository(dataDir, tempNames),
    resourceAvailability: new ReservationAvailabilityPort(resourceReservations),
    resourceReservations,
    integrations: new FsIntegrationAttemptRepository(dataDir, clock, sleep, tempNames),
    migrations: new FsMigrationStateRepository(dataDir, tempNames),
    processes: new FsProcessStore(dataDir, clock, sleep, tempNames),
    cache: new FsCache(dataDir, clock, tempNames),
    commandIdempotency: new FsCommandIdempotencyStore(dataDir, clock, sleep, tempNames),
    health: new FsHealthReporter(dataDir, clock, sleep, tempNames),
    metrics: new FsMetricsRecorder(dataDir, clock, sleep),
    logger,
    tracer,
    clock,
    ids,
  };
}

export async function initializeDataDir(dataDir: string): Promise<void> {
  await Promise.all([
    ensureDir(dataDir),
    ensureDir(resolve(dataDir, 'work-items')),
    ensureDir(resolve(dataDir, 'workflows')),
    ensureDir(resolve(dataDir, 'packages')),
    ensureDir(resolve(dataDir, 'events')),
    ensureDir(resolve(dataDir, 'outbox')),
    ensureDir(resolve(dataDir, 'unit-of-work')),
    ensureDir(resolve(dataDir, 'sync')),
    ensureDir(resolve(dataDir, 'projections')),
    ensureDir(resolve(dataDir, 'resources')),
    ensureDir(resolve(dataDir, 'resource-reservations')),
    ensureDir(resolve(dataDir, 'integrations')),
    ensureDir(resolve(dataDir, 'migrations')),
    ensureDir(resolve(dataDir, 'processes')),
    ensureDir(resolve(dataDir, 'cache')),
    ensureDir(resolve(dataDir, 'commands', 'idempotency')),
    ensureDir(resolve(dataDir, 'observability', 'health')),
  ]);
}

function createLogger(mode: 'none' | 'console' | 'json', clock: Clock): Logger {
  return branch<Logger>()
    .if(mode === 'console', () => new ConsoleLogger({ clock }))
    .if(mode === 'json', () => new JsonLogger({ clock }))
    .else(() => new NoopLogger());
}
