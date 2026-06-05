import { describe, expect, it } from 'vitest';
import { ValidationError, WorkItemClosedError } from '@/domain/errors/domain-error';
import {
  addCommentToWorkItem,
  addDecisionToWorkItem,
  createWorkItem,
  transitionWorkItem,
} from '@/domain/work-item/work-item';
import {
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
} from '@/domain/workflow/workflow-definition';
import { sampleOrderWorkflow } from '../../support/application';

describe('workflow definitions', () => {
  it('normalizes initial and closed states', () => {
    const workflow = normalizeWorkflowDefinition(sampleOrderWorkflow);

    expect(workflow.initialState).toBe('draft');
    expect(workflow.closedStates).toEqual(['closed']);
  });

  it('fails invalid workflow definitions clearly', () => {
    expect(() =>
      validateWorkflowDefinition({
        type: 'ticket',
        states: ['open'],
        transitions: [{ action: 'close', from: 'open', to: 'missing' }],
      })
    ).toThrow('ends at undeclared state');
  });
});

describe('work item behavior', () => {
  it('creates a work item in the workflow initial state', () => {
    const workflow = normalizeWorkflowDefinition(sampleOrderWorkflow);
    const workItem = createWorkItem({
      id: 'work_001',
      type: 'order',
      fields: { customer: 'acme', lines: [{ sku: 'peas', quantity: 12 }] },
      workflow,
      occurredAt: '2026-06-02T17:40:22.000Z',
    });

    expect(workItem.status).toBe('draft');
    expect(workItem.fields).toEqual({
      customer: 'acme',
      lines: [{ sku: 'peas', quantity: 12 }],
    });
  });

  it('allows valid transitions and rejects invalid ones', () => {
    const workflow = normalizeWorkflowDefinition(sampleOrderWorkflow);
    const draft = createWorkItem({
      id: 'work_001',
      type: 'order',
      fields: { customer: 'acme', lines: [{ sku: 'peas', quantity: 12 }] },
      workflow,
      occurredAt: '2026-06-02T17:40:22.000Z',
    });

    const received = transitionWorkItem({
      workItem: draft,
      workflow,
      action: 'submit',
      occurredAt: '2026-06-02T17:41:22.000Z',
    });

    expect(received.status).toBe('received');
    expect(() =>
      transitionWorkItem({
        workItem: received,
        workflow,
        action: 'release',
        occurredAt: '2026-06-02T17:42:22.000Z',
      })
    ).toThrow('not valid from state');
  });

  it('requires decision rationale', () => {
    const workflow = normalizeWorkflowDefinition(sampleOrderWorkflow);
    const workItem = createWorkItem({
      id: 'work_001',
      type: 'order',
      fields: { customer: 'acme', lines: [{ sku: 'peas', quantity: 12 }] },
      workflow,
      occurredAt: '2026-06-02T17:40:22.000Z',
    });

    expect(() =>
      addDecisionToWorkItem({
        workItem,
        workflow,
        decisionId: 'dec_001',
        decisionType: 'substitution_approved',
        reason: ' ',
        actorId: 'user_1',
        occurredAt: '2026-06-02T17:41:22.000Z',
      })
    ).toThrow(ValidationError);
  });

  it('does not allow closed items to be modified', () => {
    const workflow = normalizeWorkflowDefinition(sampleOrderWorkflow);
    const draft = createWorkItem({
      id: 'work_001',
      type: 'order',
      fields: { customer: 'acme', lines: [{ sku: 'peas', quantity: 12 }] },
      workflow,
      occurredAt: '2026-06-02T17:40:22.000Z',
    });
    const received = transitionWorkItem({
      workItem: draft,
      workflow,
      action: 'submit',
      occurredAt: '2026-06-02T17:41:22.000Z',
    });
    const validated = transitionWorkItem({
      workItem: received,
      workflow,
      action: 'validate',
      occurredAt: '2026-06-02T17:42:22.000Z',
    });
    const released = transitionWorkItem({
      workItem: validated,
      workflow,
      action: 'release',
      occurredAt: '2026-06-02T17:43:22.000Z',
    });
    const closed = transitionWorkItem({
      workItem: released,
      workflow,
      action: 'close',
      occurredAt: '2026-06-02T17:44:22.000Z',
    });

    expect(closed.status).toBe('closed');
    expect(() =>
      addCommentToWorkItem({
        workItem: closed,
        workflow,
        commentId: 'note_001',
        text: 'late note',
        actorId: 'user_1',
        occurredAt: '2026-06-02T17:45:22.000Z',
      })
    ).toThrow(WorkItemClosedError);
  });
});
