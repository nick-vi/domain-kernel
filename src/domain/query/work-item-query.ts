import type { JsonValue } from '@/domain/shared';
import type { WorkItem } from '@/domain/work-item/work-item';

export type WorkItemSort =
  | 'created_at_desc'
  | 'created_at_asc'
  | 'updated_at_desc'
  | 'updated_at_asc';

export type WorkItemQuery = {
  type?: string | undefined;
  status?: string | undefined;
  actorId?: string | undefined;
  assignedTo?: string | undefined;
  fieldEquals?: Record<string, JsonValue> | undefined;
  createdAfter?: string | undefined;
  createdBefore?: string | undefined;
  updatedAfter?: string | undefined;
  updatedBefore?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  sort?: WorkItemSort | undefined;
};

export type WorkItemSearchResult = {
  items: WorkItem[];
  total: number;
  offset: number;
  limit: number;
};
