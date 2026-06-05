import { createComment, type Comment } from '@/domain/comment/comment';
import { createDecision, type Decision } from '@/domain/decision/decision';
import { ValidationError, WorkItemClosedError } from '@/domain/errors/domain-error';
import type { JsonValue } from '@/domain/shared';
import type { ResourceRef } from '@/domain/resource/resource-ref';
import type { JsonObject } from '@/domain/shared';
import {
  findTransition,
  isClosedState,
  type NormalizedWorkflowDefinition,
  type TransitionDefinition,
} from '@/domain/workflow/workflow-definition';

export type WorkItem = {
  id: string;
  type: string;
  status: string;
  fields: JsonObject;
  resources: ResourceRef[];
  decisions: Decision[];
  comments: Comment[];
  assigneeId?: string | undefined;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | undefined;
  version: number;
};

export function createWorkItem(input: {
  id: string;
  type: string;
  fields?: JsonObject;
  workflow: NormalizedWorkflowDefinition;
  occurredAt: string;
}): WorkItem {
  if (input.type !== input.workflow.type) {
    throw new ValidationError('Work item type must match workflow type', {
      workItemType: input.type,
      workflowType: input.workflow.type,
    });
  }

  return {
    id: input.id,
    type: input.type,
    status: input.workflow.initialState,
    fields: input.fields ?? {},
    resources: [],
    decisions: [],
    comments: [],
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    version: 1,
  };
}

export function transitionWorkItem(input: {
  workItem: WorkItem;
  workflow: NormalizedWorkflowDefinition;
  action: string;
  occurredAt: string;
}): WorkItem {
  const transition = validateWorkItemTransition(input);

  return {
    ...input.workItem,
    status: transition.to,
    updatedAt: input.occurredAt,
    ...(isClosedState(input.workflow, transition.to) ? { closedAt: input.occurredAt } : {}),
    version: input.workItem.version + 1,
  };
}

export function validateWorkItemTransition(input: {
  workItem: WorkItem;
  workflow: NormalizedWorkflowDefinition;
  action: string;
}): TransitionDefinition {
  assertCanModify(input.workItem, input.workflow);
  const transition = findTransition(input.workflow, input.workItem.status, input.action);
  const missingFields = (transition.requires ?? []).filter(
    (field) => !hasRequiredFieldValue(input.workItem.fields[field])
  );
  if (missingFields.length > 0) {
    throw new ValidationError(
      `Transition "${input.action}" requires missing fields: ${missingFields.join(', ')}`,
      {
        workItemId: input.workItem.id,
        action: input.action,
        missingFields,
      }
    );
  }

  return transition;
}

export function assignWorkItem(input: {
  workItem: WorkItem;
  workflow: NormalizedWorkflowDefinition;
  assigneeId: string;
  occurredAt: string;
}): WorkItem {
  assertCanModify(input.workItem, input.workflow);

  if (input.assigneeId.trim().length === 0) {
    throw new ValidationError('Assignee id is required');
  }

  return {
    ...input.workItem,
    assigneeId: input.assigneeId,
    updatedAt: input.occurredAt,
    version: input.workItem.version + 1,
  };
}

export function updateWorkItemFields(input: {
  workItem: WorkItem;
  workflow: NormalizedWorkflowDefinition;
  fields: JsonObject;
  occurredAt: string;
}): WorkItem {
  assertCanModify(input.workItem, input.workflow);

  if (Object.keys(input.fields).length === 0) {
    throw new ValidationError('At least one field update is required');
  }

  return {
    ...input.workItem,
    fields: { ...input.workItem.fields, ...input.fields },
    updatedAt: input.occurredAt,
    version: input.workItem.version + 1,
  };
}

export function addDecisionToWorkItem(input: {
  workItem: WorkItem;
  workflow: NormalizedWorkflowDefinition;
  decisionId: string;
  decisionType: string;
  reason: string;
  actorId: string;
  occurredAt: string;
}): WorkItem {
  assertCanModify(input.workItem, input.workflow);
  const decision = createDecision({
    id: input.decisionId,
    type: input.decisionType,
    reason: input.reason,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
  });

  return {
    ...input.workItem,
    decisions: [...input.workItem.decisions, decision],
    updatedAt: input.occurredAt,
    version: input.workItem.version + 1,
  };
}

export function addCommentToWorkItem(input: {
  workItem: WorkItem;
  workflow: NormalizedWorkflowDefinition;
  commentId: string;
  text: string;
  actorId: string;
  occurredAt: string;
}): WorkItem {
  assertCanModify(input.workItem, input.workflow);
  const comment = createComment({
    id: input.commentId,
    text: input.text,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
  });

  return {
    ...input.workItem,
    comments: [...input.workItem.comments, comment],
    updatedAt: input.occurredAt,
    version: input.workItem.version + 1,
  };
}

export function assertCanModify(
  workItem: WorkItem,
  workflow: NormalizedWorkflowDefinition
): void {
  if (isClosedState(workflow, workItem.status)) {
    throw new WorkItemClosedError(`Work item "${workItem.id}" is closed`, {
      workItemId: workItem.id,
      status: workItem.status,
    });
  }
}

function hasRequiredFieldValue(value: JsonValue | undefined): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
