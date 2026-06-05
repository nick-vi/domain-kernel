import type { HealthQuery, HealthReporter } from '@/ports/health';
import type { Clock } from '@/ports/clock';
import type { HealthCheckResult } from '@/primitives/health';
import { compareStrings } from '@/primitives/string';
import type { SleepFunction } from '@/primitives/timing';
import { HealthCheckResultSchema } from '@/validation/schemas';
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

export class FsHealthReporter implements HealthReporter {
  private readonly root: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly sleep: SleepFunction,
    private readonly tempNames: FileTempNames
  ) {
    this.root = safeJoin(dataDir, 'observability', 'health');
  }

  async report(result: HealthCheckResult): Promise<void> {
    const path = this.pathFor(result.name);
    await withFileLock(path, async () => {
      await writeJsonAtomic(path, result, this.tempNames);
    }, { clock: this.clock, sleep: this.sleep });
  }

  async get(name: string): Promise<HealthCheckResult | null> {
    const path = this.pathFor(name);
    if (!(await pathExists(path))) return null;
    return readJson<HealthCheckResult>(path, HealthCheckResultSchema);
  }

  async list(query: HealthQuery = {}): Promise<HealthCheckResult[]> {
    const files = await listFilesRecursive(this.root);
    const results = await Promise.all(
      files.map((file) => readJson<HealthCheckResult>(file, HealthCheckResultSchema))
    );
    return results
      .filter((result) => query.status == null || result.status === query.status)
      .sort(
        (left, right) =>
          compareStrings(left.checkedAt, right.checkedAt) || compareStrings(left.name, right.name)
      );
  }

  private pathFor(name: string): string {
    return safeJoin(this.root, filenameForId(name));
  }
}
