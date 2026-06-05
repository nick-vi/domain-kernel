import { describe, expect, it } from 'vitest';
import { addDecisionUseCase } from '@/application/use-cases';
import { createWorkItemUseCase } from '@/application/use-cases';
import { getHistoryUseCase } from '@/application/use-cases';
import { registerWorkflow } from '@/application/use-cases';
import { transitionWorkItemUseCase } from '@/application/use-cases';
import { AllowAllPolicyEngine, CompositePolicyEngine } from '@/adapters/policy';
import type { PolicyContext, PolicyDecision } from '@/domain/policy/policy';
import type { PolicyEngine } from '@/ports/policy-engine';
import {
  REVIEW_APPROVED_DECISION,
  SampleOrderReviewPolicyEngine,
} from '../../examples/packages/sample-orders/policies';
import {
  adminActor,
  createMemoryDeps,
  operatorActor,
  sampleOrderWorkflow,
  viewerActor,
} from '../support/application';

class RecordingPolicyEngine implements PolicyEngine {
  readonly calls: PolicyContext[] = [];

  constructor(private readonly decision: PolicyDecision = { allowed: true }) {}

  async evaluate(context: PolicyContext): Promise<PolicyDecision> {
    this.calls.push(context);
    return this.decision;
  }
}

describe('policy hooks', () => {
  it('lets AllowAllPolicyEngine preserve existing transition behavior', async () => {
    const deps = createMemoryDeps();
    deps.policyEngine = new AllowAllPolicyEngine();
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
    const order = await createReviewableOrder(deps, false);

    const received = await transitionWorkItemUseCase(deps, {
      workItemId: order.id,
      action: 'submit',
      actor: operatorActor,
    });

    expect(received.status).toBe('received');
  });

  it('blocks denied transitions with a structured policy error and no audit event', async () => {
    const policy = new RecordingPolicyEngine({
      allowed: false,
      code: 'sample_policy_denied',
      reason: 'Sample policy denied this transition',
    });
    const deps = createMemoryDeps();
    deps.policyEngine = policy;
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
    const order = await createReviewableOrder(deps, false);

    await expect(
      transitionWorkItemUseCase(deps, {
        workItemId: order.id,
        action: 'submit',
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'POLICY_DENIED',
      details: {
        action: 'submit',
        actorId: 'operator',
        policyCode: 'sample_policy_denied',
        workItemId: order.id,
        workflowType: 'order',
      },
    });

    const reloaded = await deps.workItems.getById(order.id);
    const history = await getHistoryUseCase(deps, { workItemId: order.id, actor: viewerActor });

    expect(policy.calls).toHaveLength(1);
    expect(policy.calls[0]).toMatchObject({
      action: 'submit',
      input: { from: 'draft', to: 'received' },
    });
    expect(reloaded?.status).toBe('draft');
    expect(history.map((event) => event.type)).toEqual(['WorkItemCreated']);
  });

  it('does not evaluate policy when RBAC rejects first', async () => {
    const policy = new RecordingPolicyEngine();
    const deps = createMemoryDeps();
    deps.policyEngine = policy;
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
    const order = await createReviewableOrder(deps, false);

    await expect(
      transitionWorkItemUseCase(deps, {
        workItemId: order.id,
        action: 'submit',
        actor: viewerActor,
      })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(policy.calls).toHaveLength(0);
  });

  it('does not evaluate policy until workflow transition requirements pass', async () => {
    const policy = new RecordingPolicyEngine();
    const deps = createMemoryDeps();
    deps.policyEngine = policy;
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
    const order = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: { customer: 'acme' },
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
      details: { missingFields: ['lines'] },
    });

    expect(policy.calls).toHaveLength(0);
  });

  it('blocks sample order release while required review is unresolved', async () => {
    const deps = createMemoryDeps();
    deps.policyEngine = new CompositePolicyEngine([new SampleOrderReviewPolicyEngine()]);
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
    const order = await createValidatedOrder(deps, true);

    await expect(
      transitionWorkItemUseCase(deps, {
        workItemId: order.id,
        action: 'release',
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'POLICY_DENIED',
      details: { policyCode: 'order_review_unresolved' },
    });

    const reloaded = await deps.workItems.getById(order.id);
    const history = await getHistoryUseCase(deps, { workItemId: order.id, actor: viewerActor });

    expect(reloaded?.status).toBe('validated');
    expect(history.map((event) => event.type)).toEqual([
      'WorkItemCreated',
      'WorkItemTransitioned',
      'WorkItemTransitioned',
    ]);
  });

  it('allows sample order release after review approval decision', async () => {
    const deps = createMemoryDeps();
    deps.policyEngine = new CompositePolicyEngine([new SampleOrderReviewPolicyEngine()]);
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
    const order = await createValidatedOrder(deps, true);
    await addDecisionUseCase(deps, {
      workItemId: order.id,
      decisionType: REVIEW_APPROVED_DECISION,
      reason: 'QA approved release',
      actor: operatorActor,
    });

    const released = await transitionWorkItemUseCase(deps, {
      workItemId: order.id,
      action: 'release',
      actor: operatorActor,
    });

    expect(released.status).toBe('released');
  });
});

async function createReviewableOrder(
  deps: ReturnType<typeof createMemoryDeps>,
  requiresReview: boolean
) {
  return createWorkItemUseCase(deps, {
    type: 'order',
    fields: {
      customer: 'acme',
      lines: [{ sku: 'frozen-peas', quantity: 12 }],
      requiresReview,
    },
    actor: operatorActor,
  });
}

async function createValidatedOrder(
  deps: ReturnType<typeof createMemoryDeps>,
  requiresReview: boolean
) {
  const order = await createReviewableOrder(deps, requiresReview);
  await transitionWorkItemUseCase(deps, {
    workItemId: order.id,
    action: 'submit',
    actor: operatorActor,
  });
  return transitionWorkItemUseCase(deps, {
    workItemId: order.id,
    action: 'validate',
    actor: operatorActor,
  });
}
