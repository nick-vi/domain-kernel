import type { JsonObject } from '@/domain/shared';

export type AuditEventType =
  | 'WorkItemCreated'
  | 'WorkItemFieldsUpdated'
  | 'WorkItemTransitioned'
  | 'WorkItemAssigned'
  | 'DecisionAdded'
  | 'CommentAdded'
  | 'ResourceCreated'
  | 'ResourceReserved'
  | 'ResourceReservationReleased';

export type AuditEventBase = {
  id: string;
  type: AuditEventType;
  actorId: string;
  occurredAt: string;
};

export type WorkItemAuditEventBase = AuditEventBase & {
  workItemId: string;
};

export type WorkItemCreatedEvent = WorkItemAuditEventBase & {
  type: 'WorkItemCreated';
  workItemType: string;
  state: string;
  fields: JsonObject;
  version: number;
};

export type VersionedMutationEvent = {
  previousVersion: number;
  nextVersion: number;
};

export type WorkItemFieldsUpdatedEvent = WorkItemAuditEventBase &
  VersionedMutationEvent & {
  type: 'WorkItemFieldsUpdated';
  fields: JsonObject;
  previousFields: JsonObject;
};

export type WorkItemTransitionedEvent = WorkItemAuditEventBase &
  VersionedMutationEvent & {
  type: 'WorkItemTransitioned';
  action: string;
  from: string;
  to: string;
};

export type WorkItemAssignedEvent = WorkItemAuditEventBase &
  VersionedMutationEvent & {
  type: 'WorkItemAssigned';
  assigneeId: string;
  previousAssigneeId?: string | undefined;
};

export type DecisionAddedEvent = WorkItemAuditEventBase &
  VersionedMutationEvent & {
  type: 'DecisionAdded';
  decisionId: string;
  decisionType: string;
  reason: string;
};

export type CommentAddedEvent = WorkItemAuditEventBase &
  VersionedMutationEvent & {
  type: 'CommentAdded';
  commentId: string;
  text: string;
};

export type ResourceCreatedEvent = AuditEventBase & {
  type: 'ResourceCreated';
  resourceId: string;
  resourceType: string;
  fields: JsonObject;
};

export type ResourceReservedEvent = WorkItemAuditEventBase & {
  type: 'ResourceReserved';
  resourceId: string;
  resourceType: string;
  reservationId: string;
  quantity?: number | undefined;
};

export type ResourceReservationReleasedEvent = WorkItemAuditEventBase & {
  type: 'ResourceReservationReleased';
  resourceId: string;
  resourceType: string;
  reservationId: string;
  quantity?: number | undefined;
};

export type AuditEvent =
  | WorkItemCreatedEvent
  | WorkItemFieldsUpdatedEvent
  | WorkItemTransitionedEvent
  | WorkItemAssignedEvent
  | DecisionAddedEvent
  | CommentAddedEvent
  | ResourceCreatedEvent
  | ResourceReservedEvent
  | ResourceReservationReleasedEvent;

export function auditEventStreamId(event: AuditEvent): string {
  const workItemId = auditEventWorkItemId(event);
  if (workItemId != null) return workItemId;

  if ('resourceId' in event) {
    return `resource:${event.resourceId}`;
  }

  return event.id;
}

export function auditEventWorkItemId(event: AuditEvent): string | undefined {
  return 'workItemId' in event ? event.workItemId : undefined;
}
