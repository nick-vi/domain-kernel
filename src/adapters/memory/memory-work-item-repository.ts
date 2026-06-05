import type { WorkItem } from '@/domain/work-item/work-item';
import { VersionConflictError } from '@/domain/errors/domain-error';
import type {
  SaveWorkItemOptions,
  WorkItemListQuery,
  WorkItemRepository,
} from '@/ports/work-item-repository';
import { compareStrings } from '@/primitives/string';

export class InMemoryWorkItemRepository implements WorkItemRepository {
  private readonly items = new Map<string, WorkItem>();

  async save(workItem: WorkItem, options: SaveWorkItemOptions = {}): Promise<void> {
    if (options.expectedVersion != null) {
      const current = this.items.get(workItem.id);
      const actualVersion = current?.version ?? 0;
      if (actualVersion !== options.expectedVersion) {
        throw new VersionConflictError(options.expectedVersion, actualVersion, {
          workItemId: workItem.id,
        });
      }
    }

    this.items.set(workItem.id, structuredClone(workItem));
  }

  async getById(id: string): Promise<WorkItem | null> {
    const item = this.items.get(id);
    return item == null ? null : structuredClone(item);
  }

  async list(query: WorkItemListQuery = {}): Promise<WorkItem[]> {
    return [...this.items.values()]
      .filter((item) => query.type == null || item.type === query.type)
      .filter((item) => query.status == null || item.status === query.status)
      .filter((item) => query.assigneeId == null || item.assigneeId === query.assigneeId)
      .map((item) => structuredClone(item))
      .sort(
        (left, right) =>
          compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id)
      );
  }
}
