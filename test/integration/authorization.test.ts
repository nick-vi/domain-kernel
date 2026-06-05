import { describe, expect, it } from 'vitest';
import { addCommentUseCase } from '@/application/use-cases';
import { addDecisionUseCase } from '@/application/use-cases';
import { assignWorkItemUseCase } from '@/application/use-cases';
import { createWorkItemUseCase } from '@/application/use-cases';
import { getHistoryUseCase } from '@/application/use-cases';
import { getWorkItemUseCase } from '@/application/use-cases';
import { listWorkItemsUseCase } from '@/application/use-cases';
import { registerDomainPackage } from '@/application/use-cases';
import { registerWorkflow } from '@/application/use-cases';
import { transitionWorkItemUseCase } from '@/application/use-cases';
import { resolveActor } from '@/cli/context';
import {
  adminActor,
  createMemoryDeps,
  operatorActor,
  sampleOrderFieldSchema,
  sampleOrderWorkflow,
  viewerActor,
} from '../support/application';

describe('RBAC authorization', () => {
  it('allows an operator to transition a work item', async () => {
    const deps = createMemoryDeps();
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
    const workItem = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: { customer: 'acme', lines: [{ sku: 'peas', quantity: 12 }] },
      actor: operatorActor,
    });

    const transitioned = await transitionWorkItemUseCase(deps, {
      workItemId: workItem.id,
      action: 'submit',
      actor: operatorActor,
    });

    expect(transitioned.status).toBe('received');
  });

  it('lets a viewer show, list, and read history', async () => {
    const deps = createMemoryDeps();
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
    const workItem = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: { customer: 'acme', lines: [{ sku: 'peas', quantity: 12 }] },
      actor: operatorActor,
    });

    await expect(
      getWorkItemUseCase(deps, { workItemId: workItem.id, actor: viewerActor })
    ).resolves.toMatchObject({ id: workItem.id });
    await expect(listWorkItemsUseCase(deps, viewerActor, { type: 'order' })).resolves.toHaveLength(
      1
    );
    await expect(
      getHistoryUseCase(deps, { workItemId: workItem.id, actor: viewerActor })
    ).resolves.toHaveLength(1);
  });

  it('rejects viewer transitions and emits no mutation audit event', async () => {
    const deps = createMemoryDeps();
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
    const workItem = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: { customer: 'acme', lines: [{ sku: 'peas', quantity: 12 }] },
      actor: operatorActor,
    });

    await expect(
      transitionWorkItemUseCase(deps, {
        workItemId: workItem.id,
        action: 'submit',
        actor: viewerActor,
      })
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: { permission: 'work:transition' },
    });

    const reloaded = await deps.workItems.getById(workItem.id);
    const history = await getHistoryUseCase(deps, { workItemId: workItem.id, actor: viewerActor });

    expect(reloaded?.status).toBe('draft');
    expect(history.map((event) => event.type)).toEqual(['WorkItemCreated']);
  });

  it('rejects unauthorized package registration', async () => {
    const deps = createMemoryDeps();

    await expect(
      registerDomainPackage(deps, {
        name: 'sample-orders',
        workflow: sampleOrderWorkflow,
        schema: sampleOrderFieldSchema,
        actor: viewerActor,
      })
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: { permission: 'package:register' },
    });

    await expect(deps.packages.list()).resolves.toHaveLength(0);
  });

  it('lets the default local-admin perform the full local workflow', async () => {
    const deps = createMemoryDeps();
    const previousActor = process.env.DOMAIN_KERNEL_ACTOR;
    const previousRoles = process.env.DOMAIN_KERNEL_ACTOR_ROLES;
    delete process.env.DOMAIN_KERNEL_ACTOR;
    delete process.env.DOMAIN_KERNEL_ACTOR_ROLES;
    const actor = resolveActor();
    if (previousActor != null) process.env.DOMAIN_KERNEL_ACTOR = previousActor;
    if (previousRoles != null) process.env.DOMAIN_KERNEL_ACTOR_ROLES = previousRoles;

    await registerDomainPackage(deps, {
      name: 'sample-orders',
      workflow: sampleOrderWorkflow,
      schema: sampleOrderFieldSchema,
      actor,
    });
    const workItem = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: { customer: 'acme', lines: [{ sku: 'peas', quantity: 12 }] },
      actor,
    });
    await transitionWorkItemUseCase(deps, {
      workItemId: workItem.id,
      action: 'submit',
      actor,
    });
    await assignWorkItemUseCase(deps, {
      workItemId: workItem.id,
      assigneeId: 'operator',
      actor,
    });
    await addDecisionUseCase(deps, {
      workItemId: workItem.id,
      decisionType: 'substitution_approved',
      reason: 'Customer accepts equivalent item',
      actor,
    });
    await addCommentUseCase(deps, {
      workItemId: workItem.id,
      text: 'Confirmed delivery window',
      actor,
    });

    const history = await getHistoryUseCase(deps, { workItemId: workItem.id, actor });
    expect(actor).toEqual({ id: 'local-admin', roles: ['admin'] });
    expect(history.map((event) => event.type)).toEqual([
      'WorkItemCreated',
      'WorkItemTransitioned',
      'WorkItemAssigned',
      'DecisionAdded',
      'CommentAdded',
    ]);
  });
});
