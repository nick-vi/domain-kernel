import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  CompositeEventPublisher,
  InMemoryEventPublisher,
} from '@/adapters/events';
import { runAuditOutboxWorker } from '@/application/outbox-worker';
import { createResourceUseCase } from '@/application/use-cases';
import { createWorkItemUseCase } from '@/application/use-cases';
import { registerDomainPackage } from '@/application/use-cases';
import { releaseResourceReservationUseCase } from '@/application/use-cases';
import { reserveResourceUseCase } from '@/application/use-cases';
import { transitionWorkItemUseCase } from '@/application/use-cases';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { AuditEvent } from '@/domain/event/audit-event';
import type { PolicyContext, PolicyDecision } from '@/domain/policy/policy';
import type { AuditEventSearchResult } from '@/domain/query/audit-event-query';
import type { PolicyEngine } from '@/ports/policy-engine';
import type { EventPublisher, EventSubscriber } from '@/ports/event-publisher';
import { OutboxStatus } from '@/primitives/outbox';
import {
  adminActor,
  createFsDeps,
  createMemoryDeps,
  createTempDir,
  operatorActor,
  removeTempDir,
  sampleOrderFieldSchema,
  sampleOrderWorkflow,
  viewerActor,
} from '../support/application';

const execFileAsync = promisify(execFile);

describe('event subscriptions', () => {
  it('queues events after successful mutations and publishes them through the outbox worker', async () => {
    const deps = createMemoryDeps();
    const publisher = new InMemoryEventPublisher();
    deps.eventPublisher = publisher;
    await registerSampleOrders(deps);

    await createOrder(deps);

    expect(publisher.getPublishedEvents()).toEqual([]);
    await expect(deps.outbox.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'audit:evt_001',
        status: OutboxStatus.PENDING,
      }),
    ]);

    await expect(runAuditOutboxWorker(deps)).resolves.toMatchObject({
      claimed: 1,
      published: 1,
    });
    expect(publisher.getPublishedEvents()).toEqual([
      expect.objectContaining({ type: 'WorkItemCreated', workItemId: 'work_001' }),
    ]);
    await expect(deps.outbox.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'audit:evt_001',
        status: OutboxStatus.PUBLISHED,
      }),
    ]);
  });

  it('publishes the exact persisted audit event', async () => {
    const deps = createMemoryDeps();
    const publisher = new InMemoryEventPublisher();
    deps.eventPublisher = publisher;
    await registerSampleOrders(deps);

    const workItem = await createOrder(deps);
    const persistedEvents = await deps.events.getByWorkItemId(workItem.id);
    await runAuditOutboxWorker(deps);

    expect(publisher.getPublishedEvents()[0]).toEqual(persistedEvents[0]);
  });

  it('does not fail mutations when outbox publishing fails', async () => {
    const deps = createMemoryDeps();
    deps.eventPublisher = new FailingEventPublisher();
    await registerSampleOrders(deps);

    const workItem = await createOrder(deps);
    const persistedEvents = await deps.events.getByWorkItemId(workItem.id);
    await runAuditOutboxWorker(deps);
    const outboxMessages = await deps.outbox.list();

    expect(workItem.id).toBe('work_001');
    expect(persistedEvents).toHaveLength(1);
    expect(outboxMessages).toEqual([
      expect.objectContaining({
        id: 'audit:evt_001',
        status: OutboxStatus.FAILED,
        lastError: 'publisher failed',
      }),
    ]);
  });

  it('records failed outbox delivery instead of failing committed mutations', async () => {
    const deps = createMemoryDeps();
    deps.eventPublisher = new FailingEventPublisher();
    await registerSampleOrders(deps);

    const workItem = await createOrder(deps);
    await expect(runAuditOutboxWorker(deps, { maxAttempts: 1 })).resolves.toMatchObject({
      dead: 1,
    });
    const outboxMessages = await deps.outbox.list();

    expect(workItem.id).toBe('work_001');
    expect(outboxMessages).toEqual([
      expect.objectContaining({
        id: 'audit:evt_001',
        status: OutboxStatus.DEAD,
        lastError: 'publisher failed',
      }),
    ]);
  });

  it('persists filesystem outbox messages for audit events', async () => {
    const dataDir = await createTempDir();
    try {
      const deps = createFsDeps(dataDir);
      await registerSampleOrders(deps);

      await createOrder(deps);

      const restarted = createFsDeps(dataDir);
      await expect(restarted.outbox.list()).resolves.toEqual([
        expect.objectContaining({
          id: 'audit:evt_001',
          status: OutboxStatus.PENDING,
        }),
      ]);
    } finally {
      await removeTempDir(dataDir);
    }
  });

  it('publishes resource events', async () => {
    const deps = createMemoryDeps();
    await registerSampleOrders(deps);
    const workItem = await createOrder(deps);

    const publisher = new InMemoryEventPublisher();
    deps.eventPublisher = publisher;

    await createResourceUseCase(deps, {
      id: 'stock:sku_123',
      type: 'stock',
      fields: { quantity: 100 },
      actor: adminActor,
    });
    await reserveResourceUseCase(deps, {
      workItemId: workItem.id,
      resourceId: 'stock:sku_123',
      quantity: 10,
      actor: operatorActor,
    });
    await releaseResourceReservationUseCase(deps, {
      workItemId: workItem.id,
      resourceId: 'stock:sku_123',
      quantity: 10,
      actor: operatorActor,
    });

    await runAuditOutboxWorker(deps);

    expect(
      publisher
        .getPublishedEvents()
        .map((event) => event.type)
        .filter((type) => type.startsWith('Resource'))
    ).toEqual([
      'ResourceCreated',
      'ResourceReserved',
      'ResourceReservationReleased',
    ]);
  });

  it('publishes nothing for unauthorized or policy-denied actions', async () => {
    const deps = createMemoryDeps();
    await registerSampleOrders(deps);
    const workItem = await createOrder(deps);
    await createResourceUseCase(deps, {
      id: 'stock:sku_123',
      type: 'stock',
      actor: adminActor,
    });

    const publisher = new InMemoryEventPublisher();
    deps.eventPublisher = publisher;

    await expect(
      reserveResourceUseCase(deps, {
        workItemId: workItem.id,
        resourceId: 'stock:sku_123',
        quantity: 10,
        actor: viewerActor,
      })
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: { permission: 'resource:reserve' },
    });

    deps.policyEngine = new DenyPolicyEngine();
    await expect(
      transitionWorkItemUseCase(deps, {
        workItemId: workItem.id,
        action: 'submit',
        expectedVersion: 1,
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });

    expect(publisher.getPublishedEvents()).toHaveLength(0);
  });

  it('dispatches through composite publishers to all subscribers', async () => {
    const deps = createMemoryDeps();
    const first = new RecordingSubscriber();
    const second = new RecordingSubscriber();
    deps.eventPublisher = new CompositeEventPublisher([
      new InMemoryEventPublisher([{ subscriber: first }]),
      new InMemoryEventPublisher([{ subscriber: second, eventTypes: ['WorkItemCreated'] }]),
    ]);
    await registerSampleOrders(deps);

    await createOrder(deps);
    await runAuditOutboxWorker(deps);

    expect(first.events.map((event) => event.type)).toEqual(['WorkItemCreated']);
    expect(second.events.map((event) => event.type)).toEqual(['WorkItemCreated']);
  });

  it('tails events by type from the CLI', async () => {
    const dataDir = await createTempDir();
    try {
      await runCli(dataDir, ['init']);
      await runCli(dataDir, ['package', 'register', 'examples/packages/sample-orders']);
      const created = await runCliJson<{ id: string }>(dataDir, [
        '--actor',
        'operator',
        'create',
        'order',
        '--field',
        'customer=acme',
        '--field',
        'lines=[{"sku":"frozen-peas","quantity":12}]',
      ]);
      await runCli(dataDir, [
        '--actor',
        'operator',
        'transition',
        created.id,
        'submit',
        '--expected-version',
        '1',
      ]);

      const result = await runCliJson<AuditEventSearchResult>(dataDir, [
        'events',
        'tail',
        '--type',
        'WorkItemTransitioned',
        '--json',
      ]);

      expect(result.events).toEqual([
        expect.objectContaining({
          type: 'WorkItemTransitioned',
          workItemId: created.id,
        }),
      ]);
      expect(result.total).toBe(1);
    } finally {
      await removeTempDir(dataDir);
    }
  });
});

async function registerSampleOrders(deps: ApplicationDependencies): Promise<void> {
  await registerDomainPackage(deps, {
    name: 'sample-orders',
    workflow: sampleOrderWorkflow,
    schema: sampleOrderFieldSchema,
    actor: adminActor,
  });
}

async function createOrder(deps: ApplicationDependencies) {
  return createWorkItemUseCase(deps, {
    type: 'order',
    fields: {
      customer: 'acme',
      lines: [{ sku: 'frozen-peas', quantity: 12 }],
    },
    actor: operatorActor,
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

class FailingEventPublisher implements EventPublisher {
  async publish(_event: AuditEvent): Promise<void> {
    throw new Error('publisher failed');
  }
}

class RecordingSubscriber implements EventSubscriber {
  readonly events: AuditEvent[] = [];

  async handle(event: AuditEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

class DenyPolicyEngine implements PolicyEngine {
  async evaluate(_context: PolicyContext): Promise<PolicyDecision> {
    return {
      allowed: false,
      code: 'test_policy_denied',
      reason: 'Test policy denied this action',
    };
  }
}
