import type { Resource, ResourceListQuery } from '@/domain/resource/resource';
import type { ResourceRepository } from '@/ports/resource-repository';
import { compareStrings } from '@/primitives/string';
import { ResourceSchema } from '@/validation/schemas';
import {
  filenameForId,
  listFilesRecursive,
  pathExists,
  readJson,
  safeJoin,
  type FileTempNames,
  writeJsonAtomic,
} from './fs-utils';

export class FsResourceRepository implements ResourceRepository {
  private readonly root: string;

  constructor(dataDir: string, private readonly tempNames: FileTempNames) {
    this.root = safeJoin(dataDir, 'resources');
  }

  async save(resource: Resource): Promise<void> {
    await writeJsonAtomic(this.pathFor(resource.id), resource, this.tempNames);
  }

  async getById(id: string): Promise<Resource | null> {
    const path = this.pathFor(id);
    if (!(await pathExists(path))) {
      return null;
    }
    return readJson<Resource>(path, ResourceSchema);
  }

  async list(query: ResourceListQuery = {}): Promise<Resource[]> {
    const files = await listFilesRecursive(this.root);
    const resources = await Promise.all(
      files.map((file) => readJson<Resource>(file, ResourceSchema))
    );
    return resources
      .filter((resource) => query.type == null || resource.type === query.type)
      .sort(
        (left, right) =>
          compareStrings(left.type, right.type) || compareStrings(left.id, right.id)
      );
  }

  private pathFor(id: string): string {
    return safeJoin(this.root, filenameForId(id));
  }
}
