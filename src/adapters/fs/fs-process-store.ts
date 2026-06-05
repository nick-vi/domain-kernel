import type {
  ProcessListQuery,
  ProcessStore,
  ProcessTimeoutQuery,
} from '@/ports/process-store';
import type { Clock } from '@/ports/clock';
import type { ProcessInstance } from '@/primitives/process-manager';
import { compareStrings } from '@/primitives/string';
import type { SleepFunction } from '@/primitives/timing';
import { ProcessInstanceSchema } from '@/validation/schemas';
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

export class FsProcessStore implements ProcessStore {
  private readonly root: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly sleep: SleepFunction,
    private readonly tempNames: FileTempNames
  ) {
    this.root = safeJoin(dataDir, 'processes');
  }

  async save(process: ProcessInstance): Promise<void> {
    const path = this.pathFor(process.id);
    await withFileLock(path, async () => {
      await writeJsonAtomic(path, process, this.tempNames);
    }, { clock: this.clock, sleep: this.sleep });
  }

  async getById(id: string): Promise<ProcessInstance | null> {
    const path = this.pathFor(id);
    if (!(await pathExists(path))) return null;
    return readJson<ProcessInstance>(path, ProcessInstanceSchema);
  }

  async list(query: ProcessListQuery = {}): Promise<ProcessInstance[]> {
    return sortProcesses(await this.loadAll())
      .filter((process) => query.type == null || process.type === query.type)
      .filter((process) => query.status == null || process.status === query.status)
      .filter((process) => query.waitingFor == null || process.waitingFor === query.waitingFor);
  }

  async listDueTimeouts(query: ProcessTimeoutQuery): Promise<ProcessInstance[]> {
    return sortProcesses(await this.loadAll())
      .filter((process) => query.type == null || process.type === query.type)
      .filter((process) =>
        process.timeouts.some(
          (timeout) => timeout.status === 'scheduled' && timeout.dueAt <= query.now
        )
      );
  }

  private async loadAll(): Promise<ProcessInstance[]> {
    const files = await listFilesRecursive(this.root);
    return Promise.all(files.map((file) => readJson<ProcessInstance>(file, ProcessInstanceSchema)));
  }

  private pathFor(id: string): string {
    return safeJoin(this.root, filenameForId(id));
  }
}

function sortProcesses(processes: ProcessInstance[]): ProcessInstance[] {
  return processes.sort(
    (left, right) =>
      compareStrings(left.startedAt, right.startedAt) || compareStrings(left.id, right.id)
  );
}
