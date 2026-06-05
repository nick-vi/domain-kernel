import type { WorkItem } from '@/domain/work-item/work-item';

export type WorkItemListQuery = {
  type?: string;
  status?: string;
  assigneeId?: string;
};

export type SaveWorkItemOptions = {
  expectedVersion?: number | undefined;
};

export interface WorkItemRepository {
  save(workItem: WorkItem, options?: SaveWorkItemOptions): Promise<void>;
  getById(id: string): Promise<WorkItem | null>;
  list(query?: WorkItemListQuery): Promise<WorkItem[]>;
}
