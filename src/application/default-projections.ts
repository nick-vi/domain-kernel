import type { AuditEvent } from '@/domain/event/audit-event';
import type { ProjectionDefinition } from '@/application/projection-worker';
import type {
  ProjectionJsonObject,
  ProjectionJsonValue,
} from '@/primitives/projection';
import type { Scope } from '@/primitives/scope';
import { compareStrings } from '@/primitives/string';

export const KernelProjectionName = Object.freeze({
  WorkItemSummary: 'kernel.work_item_summary',
  AuditTimeline: 'kernel.audit_timeline',
  ResourceReservations: 'kernel.resource_reservations',
} as const);

export type KernelProjectionName =
  (typeof KernelProjectionName)[keyof typeof KernelProjectionName];

export type KernelProjectionOptions = {
  name?: string | undefined;
  scope?: Scope | undefined;
};

export function createWorkItemSummaryProjection(
  options: KernelProjectionOptions = {}
): ProjectionDefinition {
  return {
    name: options.name ?? KernelProjectionName.WorkItemSummary,
    scope: options.scope,
    eventTypes: [
      'WorkItemCreated',
      'WorkItemFieldsUpdated',
      'WorkItemTransitioned',
      'WorkItemAssigned',
      'DecisionAdded',
      'CommentAdded',
    ],
    project: async ({ event, upsertRecord }) => {
      if (!('workItemId' in event)) return;

      await upsertRecord(event.workItemId, (current) =>
        workItemSummaryValue(event, current)
      );
    },
  };
}

export function createAuditTimelineProjection(
  options: KernelProjectionOptions = {}
): ProjectionDefinition {
  return {
    name: options.name ?? KernelProjectionName.AuditTimeline,
    scope: options.scope,
    project: async ({ event, saveRecord }) => {
      await saveRecord(event.id, auditTimelineValue(event));
    },
  };
}

export function createResourceReservationsProjection(
  options: KernelProjectionOptions = {}
): ProjectionDefinition {
  return {
    name: options.name ?? KernelProjectionName.ResourceReservations,
    scope: options.scope,
    eventTypes: ['ResourceCreated', 'ResourceReserved', 'ResourceReservationReleased'],
    project: async ({ event, upsertRecord }) => {
      if (!('resourceId' in event)) return;

      await upsertRecord(event.resourceId, (current) =>
        resourceReservationValue(event, current)
      );
    },
  };
}

export function createKernelProjections(
  options: KernelProjectionOptions = {}
): ProjectionDefinition[] {
  return [
    createWorkItemSummaryProjection(options),
    createAuditTimelineProjection(options),
    createResourceReservationsProjection(options),
  ];
}

function workItemSummaryValue(
  event: AuditEvent,
  current: ProjectionJsonObject | undefined
): ProjectionJsonObject {
  const base = current ?? {};
  const commentsCount = numberValue(base.commentsCount);
  const decisionsCount = numberValue(base.decisionsCount);

  switch (event.type) {
    case 'WorkItemCreated':
      return {
        id: event.workItemId,
        type: event.workItemType,
        status: event.state,
        fields: event.fields,
        version: event.version,
        commentsCount,
        decisionsCount,
        createdAt: event.occurredAt,
        updatedAt: event.occurredAt,
      };
    case 'WorkItemFieldsUpdated':
      return {
        ...base,
        id: event.workItemId,
        fields: {
          ...objectValue(base.fields),
          ...event.fields,
        },
        version: event.nextVersion,
        updatedAt: event.occurredAt,
      };
    case 'WorkItemTransitioned':
      return {
        ...base,
        id: event.workItemId,
        status: event.to,
        version: event.nextVersion,
        updatedAt: event.occurredAt,
      };
    case 'WorkItemAssigned':
      return {
        ...base,
        id: event.workItemId,
        assigneeId: event.assigneeId,
        version: event.nextVersion,
        updatedAt: event.occurredAt,
      };
    case 'DecisionAdded':
      return {
        ...base,
        id: event.workItemId,
        decisionsCount: decisionsCount + 1,
        version: event.nextVersion,
        updatedAt: event.occurredAt,
      };
    case 'CommentAdded':
      return {
        ...base,
        id: event.workItemId,
        commentsCount: commentsCount + 1,
        version: event.nextVersion,
        updatedAt: event.occurredAt,
      };
    default:
      return base;
  }
}

function auditTimelineValue(event: AuditEvent): ProjectionJsonObject {
  return compactObject({
    id: event.id,
    type: event.type,
    actorId: event.actorId,
    occurredAt: event.occurredAt,
    subjectType: subjectForEvent(event).type,
    subjectId: subjectForEvent(event).id,
    workItemId: 'workItemId' in event ? event.workItemId : undefined,
    resourceId: 'resourceId' in event ? event.resourceId : undefined,
    summary: summaryForEvent(event),
  });
}

function resourceReservationValue(
  event: AuditEvent,
  current: ProjectionJsonObject | undefined
): ProjectionJsonObject {
  const base = current ?? {};
  const activeReservations = numberValue(base.activeReservations);
  const reservedQuantity = numberValue(base.reservedQuantity);
  const reservationIds = stringArrayValue(base.reservationIds);

  switch (event.type) {
    case 'ResourceCreated':
      return {
        id: event.resourceId,
        type: event.resourceType,
        fields: event.fields,
        activeReservations,
        reservedQuantity,
        reservationIds,
        createdAt: event.occurredAt,
        updatedAt: event.occurredAt,
      };
    case 'ResourceReserved':
      return {
        ...base,
        id: event.resourceId,
        type: event.resourceType,
        activeReservations: activeReservations + 1,
        reservedQuantity: reservedQuantity + (event.quantity ?? 0),
        reservationIds: uniqueStrings([...reservationIds, event.reservationId]),
        updatedAt: event.occurredAt,
      };
    case 'ResourceReservationReleased':
      return {
        ...base,
        id: event.resourceId,
        type: event.resourceType,
        activeReservations: Math.max(0, activeReservations - 1),
        reservedQuantity: Math.max(0, reservedQuantity - (event.quantity ?? 0)),
        reservationIds: reservationIds.filter((id) => id !== event.reservationId),
        updatedAt: event.occurredAt,
      };
    default:
      return base;
  }
}

function subjectForEvent(event: AuditEvent): { type: string; id: string } {
  if ('workItemId' in event) return { type: 'work_item', id: event.workItemId };
  if ('resourceId' in event) return { type: 'resource', id: event.resourceId };
  return { type: 'event', id: (event as { id: string }).id };
}

function summaryForEvent(event: AuditEvent): string {
  switch (event.type) {
    case 'WorkItemCreated':
      return `${event.workItemType} created in ${event.state}`;
    case 'WorkItemFieldsUpdated':
      return `Fields updated: ${Object.keys(event.fields).sort(compareStrings).join(', ')}`;
    case 'WorkItemTransitioned':
      return `${event.action}: ${event.from} -> ${event.to}`;
    case 'WorkItemAssigned':
      return `Assigned to ${event.assigneeId}`;
    case 'DecisionAdded':
      return `Decision added: ${event.decisionType}`;
    case 'CommentAdded':
      return 'Comment added';
    case 'ResourceCreated':
      return `${event.resourceType} resource created`;
    case 'ResourceReserved':
      return `${event.resourceType} resource reserved`;
    case 'ResourceReservationReleased':
      return `${event.resourceType} reservation released`;
  }
}

function numberValue(value: ProjectionJsonValue | undefined): number {
  return typeof value === 'number' ? value : 0;
}

function objectValue(value: ProjectionJsonValue | undefined): ProjectionJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function stringArrayValue(value: ProjectionJsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compactObject(value: Record<string, ProjectionJsonValue | undefined>): ProjectionJsonObject {
  const out: ProjectionJsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out;
}
