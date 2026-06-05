import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { addCommentUseCase } from '@/application/use-cases';
import { addDecisionUseCase } from '@/application/use-cases';
import { assignWorkItemUseCase } from '@/application/use-cases';
import { createWorkItemUseCase } from '@/application/use-cases';
import { getHistoryUseCase } from '@/application/use-cases';
import { registerDomainPackage } from '@/application/use-cases';
import { transitionWorkItemUseCase } from '@/application/use-cases';
import { updateWorkItemFieldsUseCase } from '@/application/use-cases';
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

describe('work item versioning', () => {
  it('starts created work items at version 1', async () => {
    const deps = createMemoryDeps();
    await registerSamplePackage(deps);

    const order = await createValidOrder(deps);

    expect(order.version).toBe(1);
  });

  it('increments versions for transition, assignment, decision, comment, and field updates', async () => {
    const deps = createMemoryDeps();
    await registerSamplePackage(deps);
    const order = await createValidOrder(deps);

    const received = await transitionWorkItemUseCase(deps, {
      workItemId: order.id,
      action: 'submit',
      expectedVersion: 1,
      actor: operatorActor,
    });
    const assigned = await assignWorkItemUseCase(deps, {
      workItemId: order.id,
      assigneeId: 'operator-2',
      expectedVersion: 2,
      actor: operatorActor,
    });
    const decided = await addDecisionUseCase(deps, {
      workItemId: order.id,
      decisionType: 'substitution_approved',
      reason: 'Customer accepts substitution',
      expectedVersion: 3,
      actor: operatorActor,
    });
    const commented = await addCommentUseCase(deps, {
      workItemId: order.id,
      text: 'Customer notified',
      expectedVersion: 4,
      actor: operatorActor,
    });
    const updated = await updateWorkItemFieldsUseCase(deps, {
      workItemId: order.id,
      fields: { priority: 'high' },
      expectedVersion: 5,
      actor: operatorActor,
    });

    expect([
      received.version,
      assigned.version,
      decided.version,
      commented.version,
      updated.version,
    ]).toEqual([2, 3, 4, 5, 6]);
  });

  it('rejects stale expected versions and emits no audit event', async () => {
    const deps = createMemoryDeps();
    await registerSamplePackage(deps);
    const order = await createValidOrder(deps);
    await transitionWorkItemUseCase(deps, {
      workItemId: order.id,
      action: 'submit',
      expectedVersion: 1,
      actor: operatorActor,
    });

    await expect(
      updateWorkItemFieldsUseCase(deps, {
        workItemId: order.id,
        fields: { priority: 'high' },
        expectedVersion: 1,
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      message: 'Work item version conflict',
      details: {
        expectedVersion: 1,
        actualVersion: 2,
        workItemId: order.id,
      },
    });

    const reloaded = await deps.workItems.getById(order.id);
    const history = await getHistoryUseCase(deps, { workItemId: order.id, actor: viewerActor });

    expect(reloaded?.version).toBe(2);
    expect(reloaded?.fields.priority).toBe('normal');
    expect(history.map((event) => event.type)).toEqual([
      'WorkItemCreated',
      'WorkItemTransitioned',
    ]);
  });

  it('persists and reloads versions in the filesystem adapter', async () => {
    const dataDir = await createTempDir();
    try {
      const deps = createFsDeps(dataDir);
      await registerSamplePackage(deps);
      const order = await createValidOrder(deps);
      await updateWorkItemFieldsUseCase(deps, {
        workItemId: order.id,
        fields: { priority: 'high' },
        expectedVersion: 1,
        actor: operatorActor,
      });

      const restarted = createFsDeps(dataDir);
      const reloaded = await restarted.workItems.getById(order.id);

      expect(reloaded?.version).toBe(2);
      expect(reloaded?.fields.priority).toBe('high');
    } finally {
      await removeTempDir(dataDir);
    }
  });

  it('records previous and next versions in mutation history', async () => {
    const deps = createMemoryDeps();
    await registerSamplePackage(deps);
    const order = await createValidOrder(deps);
    await transitionWorkItemUseCase(deps, {
      workItemId: order.id,
      action: 'submit',
      expectedVersion: 1,
      actor: operatorActor,
    });
    await assignWorkItemUseCase(deps, {
      workItemId: order.id,
      assigneeId: 'operator-2',
      expectedVersion: 2,
      actor: operatorActor,
    });
    await addDecisionUseCase(deps, {
      workItemId: order.id,
      decisionType: 'substitution_approved',
      reason: 'Customer accepts substitution',
      expectedVersion: 3,
      actor: operatorActor,
    });
    await addCommentUseCase(deps, {
      workItemId: order.id,
      text: 'Customer notified',
      expectedVersion: 4,
      actor: operatorActor,
    });
    await updateWorkItemFieldsUseCase(deps, {
      workItemId: order.id,
      fields: { priority: 'high' },
      expectedVersion: 5,
      actor: operatorActor,
    });

    const history = await getHistoryUseCase(deps, { workItemId: order.id, actor: viewerActor });

    expect(history[0]).toMatchObject({ type: 'WorkItemCreated', version: 1 });
    expect(
      history.slice(1).map((event) => [
        event.type,
        'previousVersion' in event ? event.previousVersion : undefined,
        'nextVersion' in event ? event.nextVersion : undefined,
      ])
    ).toEqual([
      ['WorkItemTransitioned', 1, 2],
      ['WorkItemAssigned', 2, 3],
      ['DecisionAdded', 3, 4],
      ['CommentAdded', 4, 5],
      ['WorkItemFieldsUpdated', 5, 6],
    ]);
  });

  it('accepts --expected-version in the CLI', async () => {
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
        'priority=normal',
        '--field',
        'lines=[{"sku":"frozen-peas","quantity":12}]',
      ]);

      const transitioned = await runCliJson<{ version: number }>(dataDir, [
        '--actor',
        'operator',
        'transition',
        created.id,
        'submit',
        '--expected-version',
        '1',
      ]);

      expect(transitioned.version).toBe(2);
    } finally {
      await removeTempDir(dataDir);
    }
  });
});

async function registerSamplePackage(deps: ReturnType<typeof createMemoryDeps>): Promise<void> {
  await registerDomainPackage(deps, {
    name: 'sample-orders',
    workflow: sampleOrderWorkflow,
    schema: sampleOrderFieldSchema,
    actor: adminActor,
  });
}

async function createValidOrder(deps: ReturnType<typeof createMemoryDeps>) {
  return createWorkItemUseCase(deps, {
    type: 'order',
    fields: {
      customer: 'acme',
      priority: 'normal',
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
