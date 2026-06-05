import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createWorkItemUseCase } from '@/application/use-cases';
import { queryAuditEventsUseCase } from '@/application/use-cases';
import { queryWorkItemsUseCase } from '@/application/use-cases';
import { registerDomainPackage } from '@/application/use-cases';
import { reportCountsUseCase } from '@/application/use-cases';
import { transitionWorkItemUseCase } from '@/application/use-cases';
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
import type { ApplicationDependencies } from '@/application/dependencies';
import type { WorkItemSearchResult } from '@/domain/query/work-item-query';
import type { AuditEventSearchResult } from '@/domain/query/audit-event-query';
import type { CountReport } from '@/domain/query/report';

const execFileAsync = promisify(execFile);
const unauthorizedActor = { id: 'blocked', roles: ['blocked'] };

describe('query and reporting primitives', () => {
  it('queries work items by type', async () => {
    const deps = createMemoryDeps();
    await seedQueryFixture(deps);

    const result = await queryWorkItemsUseCase(deps, {
      actor: viewerActor,
      query: { type: 'order' },
    });

    expect(result.items).toHaveLength(3);
    expect(result.items.every((item) => item.type === 'order')).toBe(true);
  });

  it('queries work items by status', async () => {
    const deps = createMemoryDeps();
    await seedQueryFixture(deps);

    const result = await queryWorkItemsUseCase(deps, {
      actor: viewerActor,
      query: { status: 'received' },
    });

    expect(result.items.map((item) => item.status)).toEqual(['received']);
  });

  it('queries work items by field equality', async () => {
    const deps = createMemoryDeps();
    await seedQueryFixture(deps);

    const result = await queryWorkItemsUseCase(deps, {
      actor: viewerActor,
      query: { fieldEquals: { priority: 'high' }, sort: 'created_at_asc' },
    });

    expect(result.items.map((item) => item.fields.customer)).toEqual(['acme', 'initech']);
  });

  it('queries object fields independent of JSON key insertion order', async () => {
    const deps = createMemoryDeps();
    await registerDomainPackage(deps, {
      name: 'sample-orders',
      workflow: sampleOrderWorkflow,
      schema: {
        ...sampleOrderFieldSchema,
        fields: {
          ...sampleOrderFieldSchema.fields,
          metadata: { type: 'object' },
        },
      },
      actor: adminActor,
    });
    const created = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: {
        customer: 'acme',
        priority: 'high',
        lines: [{ sku: 'frozen-peas', quantity: 12 }],
        metadata: { a: 1, b: 2 },
      },
      actor: operatorActor,
    });

    const result = await queryWorkItemsUseCase(deps, {
      actor: viewerActor,
      query: { fieldEquals: { metadata: { b: 2, a: 1 } } },
    });

    expect(result.items.map((item) => item.id)).toEqual([created.id]);
  });

  it('queries work items with limit and offset', async () => {
    const deps = createMemoryDeps();
    await seedQueryFixture(deps);

    const result = await queryWorkItemsUseCase(deps, {
      actor: viewerActor,
      query: { type: 'order', sort: 'created_at_asc', limit: 1, offset: 1 },
    });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.fields.customer).toBe('globex');
  });

  it('queries audit events by work item id', async () => {
    const deps = createMemoryDeps();
    const fixture = await seedQueryFixture(deps);

    const result = await queryAuditEventsUseCase(deps, {
      actor: viewerActor,
      query: { workItemId: fixture.received.id },
    });

    expect(result.events.map((event) => event.type)).toEqual([
      'WorkItemCreated',
      'WorkItemTransitioned',
    ]);
  });

  it('queries audit events by event type', async () => {
    const deps = createMemoryDeps();
    await seedQueryFixture(deps);

    const result = await queryAuditEventsUseCase(deps, {
      actor: viewerActor,
      query: { type: 'WorkItemTransitioned' },
    });

    expect(result.events).toHaveLength(3);
    expect(result.events.every((event) => event.type === 'WorkItemTransitioned')).toBe(true);
  });

  it('returns the same memory and filesystem query results', async () => {
    const dataDir = await createTempDir();
    try {
      const memory = createMemoryDeps();
      const fs = createFsDeps(dataDir);
      await seedQueryFixture(memory);
      await seedQueryFixture(fs);

      const memoryResult = await queryWorkItemsUseCase(memory, {
        actor: viewerActor,
        query: { fieldEquals: { priority: 'high' }, sort: 'created_at_asc' },
      });
      const fsResult = await queryWorkItemsUseCase(fs, {
        actor: viewerActor,
        query: { fieldEquals: { priority: 'high' }, sort: 'created_at_asc' },
      });

      expect(summarizeItems(fsResult)).toEqual(summarizeItems(memoryResult));
    } finally {
      await removeTempDir(dataDir);
    }
  });

  it('reports counts by status', async () => {
    const deps = createMemoryDeps();
    await seedQueryFixture(deps);

    const report = await reportCountsUseCase(deps, {
      actor: viewerActor,
      groupBy: 'status',
    });

    expect(report.counts).toEqual([
      { value: 'draft', count: 1 },
      { value: 'received', count: 1 },
      { value: 'validated', count: 1 },
    ]);
  });

  it('reports counts by type', async () => {
    const deps = createMemoryDeps();
    await seedQueryFixture(deps);

    const report = await reportCountsUseCase(deps, {
      actor: viewerActor,
      groupBy: 'type',
    });

    expect(report.counts).toEqual([{ value: 'order', count: 3 }]);
  });

  it('lets viewers query and rejects unauthorized actors', async () => {
    const deps = createMemoryDeps();
    await seedQueryFixture(deps);

    await expect(
      queryWorkItemsUseCase(deps, { actor: viewerActor, query: { type: 'order' } })
    ).resolves.toMatchObject({ total: 3 });
    await expect(
      queryAuditEventsUseCase(deps, { actor: viewerActor, query: { type: 'WorkItemCreated' } })
    ).resolves.toMatchObject({ total: 3 });
    await expect(
      reportCountsUseCase(deps, { actor: viewerActor, groupBy: 'type' })
    ).resolves.toMatchObject({ counts: [{ value: 'order', count: 3 }] });

    await expect(
      queryWorkItemsUseCase(deps, { actor: unauthorizedActor, query: { type: 'order' } })
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: { permission: 'work:query' },
    });
    await expect(
      queryAuditEventsUseCase(deps, {
        actor: unauthorizedActor,
        query: { type: 'WorkItemCreated' },
      })
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: { permission: 'event:query' },
    });
    await expect(
      reportCountsUseCase(deps, { actor: unauthorizedActor, groupBy: 'type' })
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: { permission: 'report:read' },
    });
  });

  it('supports JSON query and report commands', async () => {
    const dataDir = await createTempDir();
    try {
      await runCli(dataDir, ['init']);
      await runCli(dataDir, ['package', 'register', 'examples/packages/sample-orders', '--json']);
      const created = await runCliJson<{ id: string }>(dataDir, [
        '--actor',
        'operator',
        'create',
        'order',
        '--field',
        'customer=acme',
        '--field',
        'priority=high',
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

      const workResult = await runCliJson<WorkItemSearchResult>(dataDir, [
        'query',
        'work',
        '--field',
        'priority=high',
        '--json',
      ]);
      const eventResult = await runCliJson<AuditEventSearchResult>(dataDir, [
        'query',
        'events',
        '--type',
        'WorkItemTransitioned',
        '--json',
      ]);
      const report = await runCliJson<CountReport>(dataDir, [
        'report',
        'counts',
        '--group-by',
        'status',
        '--json',
      ]);

      expect(workResult.total).toBe(1);
      expect(workResult.items[0]?.id).toBe(created.id);
      expect(eventResult.events).toHaveLength(1);
      expect(report.counts).toEqual([{ value: 'received', count: 1 }]);
    } finally {
      await removeTempDir(dataDir);
    }
  });
});

async function seedQueryFixture(deps: ApplicationDependencies) {
  await registerDomainPackage(deps, {
    name: 'sample-orders',
    workflow: sampleOrderWorkflow,
    schema: sampleOrderFieldSchema,
    actor: adminActor,
  });

  const receivedDraft = await createOrder(deps, 'acme', 'high');
  const received = await transitionWorkItemUseCase(deps, {
    workItemId: receivedDraft.id,
    action: 'submit',
    expectedVersion: 1,
    actor: operatorActor,
  });
  const draft = await createOrder(deps, 'globex', 'low');
  const validatedDraft = await createOrder(deps, 'initech', 'high');
  const validatedReceived = await transitionWorkItemUseCase(deps, {
    workItemId: validatedDraft.id,
    action: 'submit',
    expectedVersion: 1,
    actor: operatorActor,
  });
  const validated = await transitionWorkItemUseCase(deps, {
    workItemId: validatedReceived.id,
    action: 'validate',
    expectedVersion: 2,
    actor: operatorActor,
  });

  return { received, draft, validated };
}

async function createOrder(
  deps: ApplicationDependencies,
  customer: string,
  priority: 'low' | 'normal' | 'high'
) {
  return createWorkItemUseCase(deps, {
    type: 'order',
    fields: {
      customer,
      priority,
      lines: [{ sku: 'frozen-peas', quantity: 12 }],
    },
    actor: operatorActor,
  });
}

function summarizeItems(result: WorkItemSearchResult) {
  return result.items.map((item) => ({
    id: item.id,
    status: item.status,
    customer: item.fields.customer,
    priority: item.fields.priority,
  }));
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
