import type { Resource, ResourceListQuery } from '@/domain/resource/resource';

export interface ResourceRepository {
  save(resource: Resource): Promise<void>;
  getById(id: string): Promise<Resource | null>;
  list(query?: ResourceListQuery): Promise<Resource[]>;
}
