import type { ApplicationDependencies } from '@/application/dependencies';
import type { Authorizer } from '@/ports/authorizer';
import type { Clock } from '@/ports/clock';
import type { EventPublisher } from '@/ports/event-publisher';
import type { IdGenerator } from '@/ports/id-generator';
import type { Logger } from '@/ports/logger';
import type { PolicyEngine } from '@/ports/policy-engine';
import type { Tracer } from '@/ports/tracer';
import { ReservationAvailabilityPort } from '@/adapters/resources';
import { RepositoryWorkItemQueryPort } from '@/adapters/query';
import { MemoryCache } from './memory-cache';
import { InMemoryCommandIdempotencyStore } from './memory-command-idempotency-store';
import { InMemoryDomainPackageRepository } from './memory-domain-package-repository';
import { InMemoryEventStore } from './memory-event-store';
import { InMemoryHealthReporter } from './memory-health-reporter';
import { InMemoryIntegrationAttemptRepository } from './memory-integration-attempt-repository';
import { InMemoryMetricsRecorder } from './memory-metrics-recorder';
import { InMemoryMigrationStateRepository } from './memory-migration-state-repository';
import { InMemoryOutboxRepository } from './memory-outbox-repository';
import { InMemoryProcessStore } from './memory-process-store';
import { InMemoryProjectionStore } from './memory-projection-store';
import { InMemoryResourceRepository } from './memory-resource-repository';
import { InMemoryResourceReservationPort } from './memory-resource-reservation-port';
import { InMemorySyncStateRepository } from './memory-sync-state-repository';
import { InMemoryUnitOfWorkManager } from './memory-unit-of-work-manager';
import { InMemoryWorkItemRepository } from './memory-work-item-repository';
import { InMemoryWorkflowRepository } from './memory-workflow-repository';

export type MemoryKernelDependenciesOptions = {
  authorizer: Authorizer;
  policyEngine: PolicyEngine;
  eventPublisher: EventPublisher;
  logger: Logger;
  tracer: Tracer;
  clock: Clock;
  ids: IdGenerator;
};

export function createMemoryKernelDependencies(
  options: MemoryKernelDependenciesOptions
): ApplicationDependencies {
  const workItems = new InMemoryWorkItemRepository();
  const events = new InMemoryEventStore();
  const resourceReservations = new InMemoryResourceReservationPort();

  return {
    authorizer: options.authorizer,
    policyEngine: options.policyEngine,
    workItems,
    workItemQueries: new RepositoryWorkItemQueryPort(workItems, events),
    workflows: new InMemoryWorkflowRepository(),
    packages: new InMemoryDomainPackageRepository(),
    events,
    eventQueries: events,
    outbox: new InMemoryOutboxRepository(),
    eventPublisher: options.eventPublisher,
    unitOfWork: new InMemoryUnitOfWorkManager(),
    syncStates: new InMemorySyncStateRepository(),
    projections: new InMemoryProjectionStore(),
    resources: new InMemoryResourceRepository(),
    resourceAvailability: new ReservationAvailabilityPort(resourceReservations),
    resourceReservations,
    integrations: new InMemoryIntegrationAttemptRepository(),
    migrations: new InMemoryMigrationStateRepository(),
    processes: new InMemoryProcessStore(),
    cache: new MemoryCache(options.clock),
    commandIdempotency: new InMemoryCommandIdempotencyStore(),
    health: new InMemoryHealthReporter(),
    metrics: new InMemoryMetricsRecorder(),
    logger: options.logger,
    tracer: options.tracer,
    clock: options.clock,
    ids: options.ids,
  };
}
