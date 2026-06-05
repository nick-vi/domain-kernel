import type { ApplicationDependencies } from '@/application/dependencies';
import type { Authorizer } from '@/ports/authorizer';
import type { Clock } from '@/ports/clock';
import type { EventPublisher } from '@/ports/event-publisher';
import type { IdGenerator } from '@/ports/id-generator';
import type { Logger } from '@/ports/logger';
import type { PolicyEngine } from '@/ports/policy-engine';
import type { Tracer } from '@/ports/tracer';
import type { SleepFunction } from '@/primitives/timing';
import { ReservationAvailabilityPort } from '@/adapters/resources';
import { RepositoryWorkItemQueryPort } from '@/adapters/query';
import { FsCache } from './fs-cache';
import { FsCommandIdempotencyStore } from './fs-command-idempotency-store';
import { FsDomainPackageRepository } from './fs-domain-package-repository';
import { FsEventStore } from './fs-event-store';
import { FsHealthReporter } from './fs-health-reporter';
import { FsIntegrationAttemptRepository } from './fs-integration-attempt-repository';
import { FsMetricsRecorder } from './fs-metrics-recorder';
import { FsMigrationStateRepository } from './fs-migration-state-repository';
import { FsOutboxRepository } from './fs-outbox-repository';
import { FsProcessStore } from './fs-process-store';
import { FsProjectionStore } from './fs-projection-store';
import { FsResourceRepository } from './fs-resource-repository';
import { FsResourceReservationPort } from './fs-resource-reservation-port';
import { FsSyncStateRepository } from './fs-sync-state-repository';
import { FsUnitOfWorkManager } from './fs-unit-of-work-manager';
import { FsWorkItemRepository } from './fs-work-item-repository';
import { FsWorkflowRepository } from './fs-workflow-repository';
import type { FileTempNames } from './fs-utils';

export type FilesystemKernelDependenciesOptions = {
  dataDir: string;
  authorizer: Authorizer;
  policyEngine: PolicyEngine;
  eventPublisher: EventPublisher;
  logger: Logger;
  tracer: Tracer;
  clock: Clock;
  sleep: SleepFunction;
  tempNames: FileTempNames;
  ids: IdGenerator;
};

export function createFilesystemKernelDependencies(
  options: FilesystemKernelDependenciesOptions
): ApplicationDependencies {
  const workItems = new FsWorkItemRepository(
    options.dataDir,
    options.clock,
    options.sleep,
    options.tempNames
  );
  const events = new FsEventStore(options.dataDir, options.clock, options.sleep);
  const resourceReservations = new FsResourceReservationPort(
    options.dataDir,
    options.clock,
    options.sleep,
    options.tempNames
  );

  return {
    authorizer: options.authorizer,
    policyEngine: options.policyEngine,
    workItems,
    workItemQueries: new RepositoryWorkItemQueryPort(workItems, events),
    workflows: new FsWorkflowRepository(options.dataDir, options.tempNames),
    packages: new FsDomainPackageRepository(options.dataDir, options.tempNames),
    events,
    eventQueries: events,
    outbox: new FsOutboxRepository(
      options.dataDir,
      options.clock,
      options.sleep,
      options.tempNames
    ),
    eventPublisher: options.eventPublisher,
    unitOfWork: new FsUnitOfWorkManager(options.dataDir, options.clock, options.sleep),
    syncStates: new FsSyncStateRepository(
      options.dataDir,
      options.clock,
      options.sleep,
      options.tempNames
    ),
    projections: new FsProjectionStore(
      options.dataDir,
      options.clock,
      options.sleep,
      options.tempNames
    ),
    resources: new FsResourceRepository(options.dataDir, options.tempNames),
    resourceAvailability: new ReservationAvailabilityPort(resourceReservations),
    resourceReservations,
    integrations: new FsIntegrationAttemptRepository(
      options.dataDir,
      options.clock,
      options.sleep,
      options.tempNames
    ),
    migrations: new FsMigrationStateRepository(options.dataDir, options.tempNames),
    processes: new FsProcessStore(options.dataDir, options.clock, options.sleep, options.tempNames),
    cache: new FsCache(options.dataDir, options.clock, options.tempNames),
    commandIdempotency: new FsCommandIdempotencyStore(
      options.dataDir,
      options.clock,
      options.sleep,
      options.tempNames
    ),
    health: new FsHealthReporter(options.dataDir, options.clock, options.sleep, options.tempNames),
    metrics: new FsMetricsRecorder(options.dataDir, options.clock, options.sleep),
    logger: options.logger,
    tracer: options.tracer,
    clock: options.clock,
    ids: options.ids,
  };
}
