import { describe, expect, it } from 'vitest';
import { addCommentUseCase } from '@/application/use-cases';
import { addDecisionUseCase } from '@/application/use-cases';
import { createWorkItemUseCase } from '@/application/use-cases';
import { getHistoryUseCase } from '@/application/use-cases';
import { registerWorkflow } from '@/application/use-cases';
import { transitionWorkItemUseCase } from '@/application/use-cases';
import {
  adminActor,
  createMemoryDeps,
  operatorActor,
  sampleOrderWorkflow,
  viewerActor,
} from '../support/application';

describe('sample order acceptance scenario', () => {
  it('moves an order from draft to received and records actor, timestamp, from-state, and to-state', async () => {
    const deps = createMemoryDeps();
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });

    const order = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: {
        customer: 'acme',
        priority: 'high',
        lines: [{ sku: 'frozen-peas', quantity: 12 }],
      },
      actor: operatorActor,
    });

    const received = await transitionWorkItemUseCase(deps, {
      workItemId: order.id,
      action: 'submit',
      actor: operatorActor,
    });

    await addDecisionUseCase(deps, {
      workItemId: order.id,
      decisionType: 'substitution_approved',
      reason: 'Customer accepts equivalent item',
      actor: operatorActor,
    });

    await addCommentUseCase(deps, {
      workItemId: order.id,
      text: 'Called customer and confirmed delivery window',
      actor: operatorActor,
    });

    const history = await getHistoryUseCase(deps, { workItemId: order.id, actor: viewerActor });

    expect(received.status).toBe('received');
    expect(history).toEqual([
      expect.objectContaining({
        type: 'WorkItemCreated',
        workItemId: order.id,
        actorId: 'operator',
        occurredAt: '2026-06-02T17:40:22.000Z',
      }),
      expect.objectContaining({
        type: 'WorkItemTransitioned',
        workItemId: order.id,
        actorId: 'operator',
        occurredAt: '2026-06-02T17:41:22.000Z',
        from: 'draft',
        to: 'received',
      }),
      expect.objectContaining({
        type: 'DecisionAdded',
        decisionType: 'substitution_approved',
        reason: 'Customer accepts equivalent item',
      }),
      expect.objectContaining({
        type: 'CommentAdded',
        text: 'Called customer and confirmed delivery window',
      }),
    ]);
  });

  it('cannot submit an order without required fields', async () => {
    const deps = createMemoryDeps();
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });

    const order = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: { priority: 'high' },
      actor: operatorActor,
    });

    await expect(
      transitionWorkItemUseCase(deps, {
        workItemId: order.id,
        action: 'submit',
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { missingFields: ['customer', 'lines'] },
    });
  });

  it('cannot release an order before validation', async () => {
    const deps = createMemoryDeps();
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });

    const order = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: {
        customer: 'acme',
        lines: [{ sku: 'frozen-peas', quantity: 12 }],
      },
      actor: operatorActor,
    });

    await transitionWorkItemUseCase(deps, {
      workItemId: order.id,
      action: 'submit',
      actor: operatorActor,
    });

    await expect(
      transitionWorkItemUseCase(deps, {
        workItemId: order.id,
        action: 'release',
        actor: operatorActor,
      })
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});
