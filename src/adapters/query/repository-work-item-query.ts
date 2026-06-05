import type { AuditEventQueryPort } from '@/ports/audit-event-query';
import type { WorkItemRepository } from '@/ports/work-item-repository';
import type { WorkItemQueryPort } from '@/ports/work-item-query';
import type { WorkItemQuery, WorkItemSearchResult } from '@/domain/query/work-item-query';
import type { WorkItem } from '@/domain/work-item/work-item';
import { compareStrings } from '@/primitives/string';
import { jsonValueEquals, paginate } from './query-utils';

export class RepositoryWorkItemQueryPort implements WorkItemQueryPort {
  constructor(
    private readonly workItems: WorkItemRepository,
    private readonly auditEvents: AuditEventQueryPort
  ) {}

  async search(query: WorkItemQuery): Promise<WorkItemSearchResult> {
    const actorWorkItemIds = await this.resolveActorWorkItemIds(query);
    const items = (await this.workItems.list())
      .filter((item) => query.type == null || item.type === query.type)
      .filter((item) => query.status == null || item.status === query.status)
      .filter((item) => query.assignedTo == null || item.assigneeId === query.assignedTo)
      .filter((item) => actorWorkItemIds == null || actorWorkItemIds.has(item.id))
      .filter((item) => matchesFieldEquals(item, query.fieldEquals))
      .filter((item) => query.createdAfter == null || item.createdAt >= query.createdAfter)
      .filter((item) => query.createdBefore == null || item.createdAt <= query.createdBefore)
      .filter((item) => query.updatedAfter == null || item.updatedAt >= query.updatedAfter)
      .filter((item) => query.updatedBefore == null || item.updatedAt <= query.updatedBefore)
      .sort((a, b) => compareWorkItems(a, b, query.sort ?? 'created_at_asc'));

    const result = paginate(items, query);
    return {
      items: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  private async resolveActorWorkItemIds(query: WorkItemQuery): Promise<Set<string> | null> {
    if (query.actorId == null) return null;
    const result = await this.auditEvents.search({ actorId: query.actorId });
    return new Set(
      result.events
        .map((event) => ('workItemId' in event ? event.workItemId : undefined))
        .filter((workItemId): workItemId is string => workItemId != null)
    );
  }
}

function matchesFieldEquals(
  item: WorkItem,
  fieldEquals: WorkItemQuery['fieldEquals']
): boolean {
  if (fieldEquals == null) return true;

  return Object.entries(fieldEquals).every(([field, expected]) =>
    jsonValueEquals(item.fields[field], expected)
  );
}

function compareWorkItems(
  left: WorkItem,
  right: WorkItem,
  sort: NonNullable<WorkItemQuery['sort']>
): number {
  switch (sort) {
    case 'created_at_desc':
      return compareStrings(right.createdAt, left.createdAt) || compareStrings(right.id, left.id);
    case 'updated_at_desc':
      return compareStrings(right.updatedAt, left.updatedAt) || compareStrings(right.id, left.id);
    case 'updated_at_asc':
      return compareStrings(left.updatedAt, right.updatedAt) || compareStrings(left.id, right.id);
    case 'created_at_asc':
      return compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id);
  }
}
