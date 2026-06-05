import type { WorkItem } from '@/domain/work-item/work-item';
import { VersionConflictError } from '@/domain/errors/domain-error';
import type {
  SaveWorkItemOptions,
  WorkItemListQuery,
  WorkItemRepository,
} from '@/ports/work-item-repository';
import type { Clock } from '@/ports/clock';
import { compareStrings } from '@/primitives/string';
import type { SleepFunction } from '@/primitives/timing';
import { WorkItemSchema } from '@/validation/schemas';
import {
  filenameForId,
  listFilesRecursive,
  pathExists,
  readJson,
  safeJoin,
  type FileTempNames,
  withFileLock,
  writeJsonAtomic,
} from './fs-utils';

export class FsWorkItemRepository implements WorkItemRepository {
  private readonly root: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly sleep: SleepFunction,
    private readonly tempNames: FileTempNames
  ) {
    this.root = safeJoin(dataDir, 'work-items');
  }

  async save(workItem: WorkItem, options: SaveWorkItemOptions = {}): Promise<void> {
    const path = this.pathFor(workItem.id);
    await withFileLock(path, async () => {
      if (options.expectedVersion != null) {
        const current = (await pathExists(path))
          ? await readJson<WorkItem>(path, WorkItemSchema)
          : null;
        const actualVersion = current?.version ?? 0;
        if (actualVersion !== options.expectedVersion) {
          throw new VersionConflictError(options.expectedVersion, actualVersion, {
            workItemId: workItem.id,
          });
        }
      }

      await writeJsonAtomic(path, workItem, this.tempNames);
    }, { clock: this.clock, sleep: this.sleep });
  }

  async getById(id: string): Promise<WorkItem | null> {
    const path = this.pathFor(id);
    if (!(await pathExists(path))) {
      return null;
    }
    return readJson<WorkItem>(path, WorkItemSchema);
  }

  async list(query: WorkItemListQuery = {}): Promise<WorkItem[]> {
    const files = await listFilesRecursive(this.root);
    const items = await Promise.all(files.map((file) => readJson<WorkItem>(file, WorkItemSchema)));
    return items
      .filter((item) => query.type == null || item.type === query.type)
      .filter((item) => query.status == null || item.status === query.status)
      .filter((item) => query.assigneeId == null || item.assigneeId === query.assigneeId)
      .sort(
        (left, right) =>
          compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id)
      );
  }

  private pathFor(id: string): string {
    return safeJoin(this.root, filenameForId(id));
  }
}
