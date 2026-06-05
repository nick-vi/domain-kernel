import type { WorkItemQuery, WorkItemSearchResult } from '@/domain/query/work-item-query';

export interface WorkItemQueryPort {
  search(query: WorkItemQuery): Promise<WorkItemSearchResult>;
}
