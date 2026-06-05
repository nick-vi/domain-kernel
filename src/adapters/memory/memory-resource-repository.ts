import type { Resource, ResourceListQuery } from '@/domain/resource/resource';
import type { ResourceRepository } from '@/ports/resource-repository';
import { compareStrings } from '@/primitives/string';

export class InMemoryResourceRepository implements ResourceRepository {
  private readonly resources = new Map<string, Resource>();

  async save(resource: Resource): Promise<void> {
    this.resources.set(resource.id, structuredClone(resource));
  }

  async getById(id: string): Promise<Resource | null> {
    const resource = this.resources.get(id);
    return resource == null ? null : structuredClone(resource);
  }

  async list(query: ResourceListQuery = {}): Promise<Resource[]> {
    return [...this.resources.values()]
      .filter((resource) => query.type == null || resource.type === query.type)
      .map((resource) => structuredClone(resource))
      .sort(
        (left, right) =>
          compareStrings(left.type, right.type) || compareStrings(left.id, right.id)
      );
  }
}
