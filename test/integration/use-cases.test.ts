import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { registerWorkflow } from '@/application/use-cases';
import { registerDomainPackage } from '@/application/use-cases';
import { createWorkItemUseCase } from '@/application/use-cases';
import { transitionWorkItemUseCase } from '@/application/use-cases';
import { getHistoryUseCase } from '@/application/use-cases';
import { filenameForId } from '@/adapters/fs';
import {
  createFsDeps,
  createMemoryDeps,
  createTempDir,
  adminActor,
  operatorActor,
  removeTempDir,
  sampleOrderFieldSchema,
  sampleOrderWorkflow,
  viewerActor,
} from '../support/application';

describe('memory-backed use cases', () => {
  it('creates, transitions, and records audit history', async () => {
    const deps = createMemoryDeps();
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });

    const created = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: { customer: 'acme', priority: 'high', lines: [{ sku: 'peas', quantity: 12 }] },
      actor: operatorActor,
    });
    const transitioned = await transitionWorkItemUseCase(deps, {
      workItemId: created.id,
      action: 'submit',
      actor: operatorActor,
    });
    const history = await getHistoryUseCase(deps, { workItemId: created.id, actor: viewerActor });

    expect(transitioned.status).toBe('received');
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      type: 'WorkItemTransitioned',
      workItemId: created.id,
      from: 'draft',
      to: 'received',
      actorId: 'operator',
      occurredAt: '2026-06-02T17:41:22.000Z',
    });
  });

  it('returns a domain error for invalid transitions', async () => {
    const deps = createMemoryDeps();
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
    const created = await createWorkItemUseCase(deps, {
      type: 'order',
      actor: operatorActor,
    });

    await expect(
      transitionWorkItemUseCase(deps, {
        workItemId: created.id,
        action: 'release',
        actor: operatorActor,
      })
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('filesystem-backed use cases', () => {
  it('persists work items and event history across dependency recreation', async () => {
    const dataDir = await createTempDir();
    try {
      const deps = createFsDeps(dataDir);
      await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
      const created = await createWorkItemUseCase(deps, {
        type: 'order',
        fields: { customer: 'acme', lines: [{ sku: 'peas', quantity: 12 }] },
        actor: operatorActor,
      });
      await transitionWorkItemUseCase(deps, {
        workItemId: created.id,
        action: 'submit',
        actor: operatorActor,
      });

      const restarted = createFsDeps(dataDir);
      const reloaded = await restarted.workItems.getById(created.id);
      const history = await getHistoryUseCase(restarted, {
        workItemId: created.id,
        actor: viewerActor,
      });

      expect(reloaded?.status).toBe('received');
      expect(history.map((event) => event.type)).toEqual([
        'WorkItemCreated',
        'WorkItemTransitioned',
      ]);
    } finally {
      await removeTempDir(dataDir);
    }
  });

  it('validates persisted work item records at read time', async () => {
    const dataDir = await createTempDir();
    try {
      const workItemsDir = join(dataDir, 'work-items');
      await mkdir(workItemsDir, { recursive: true });
      await writeFile(
        join(workItemsDir, filenameForId('work_bad')),
        JSON.stringify({
          id: 'work_bad',
          type: 'order',
          status: '',
          fields: {},
          resources: [],
          decisions: [],
          comments: [],
          createdAt: 'not-a-date',
          updatedAt: 'not-a-date',
          version: 1,
        }),
        'utf8'
      );

      await expect(createFsDeps(dataDir).workItems.getById('work_bad')).rejects.toMatchObject({
        name: 'RuntimeValidationError',
      });
    } finally {
      await removeTempDir(dataDir);
    }
  });

  it('persists registered packages and workflows across dependency recreation', async () => {
    const dataDir = await createTempDir();
    try {
      const deps = createFsDeps(dataDir);
      await registerDomainPackage(deps, {
        name: 'sample-orders',
        workflow: sampleOrderWorkflow,
        schema: sampleOrderFieldSchema,
        fixtures: ['basic-order.json'],
        sourcePath: '/example/sample-orders',
        actor: adminActor,
      });

      const restarted = createFsDeps(dataDir);
      const reloadedPackage = await restarted.packages.getByName('sample-orders');
      const reloadedWorkflow = await restarted.workflows.getByType('order');

      expect(reloadedPackage?.name).toBe('sample-orders');
      expect(reloadedPackage?.schema.fields.customer?.required).toBe(true);
      expect(reloadedWorkflow?.transitions[0]?.requires).toEqual(['customer', 'lines']);
    } finally {
      await removeTempDir(dataDir);
    }
  });
});
