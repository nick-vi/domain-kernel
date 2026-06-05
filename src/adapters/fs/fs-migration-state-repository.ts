import type { AppliedPackageMigration } from '@/domain/package/domain-package';
import type { MigrationStateRepository } from '@/ports/migration-state-repository';
import { compareStrings } from '@/primitives/string';
import { AppliedPackageMigrationSchema } from '@/validation/schemas';
import {
  filenameForId,
  listFilesRecursive,
  pathExists,
  readJson,
  safeJoin,
  type FileTempNames,
  writeJsonAtomic,
} from './fs-utils';

export class FsMigrationStateRepository implements MigrationStateRepository {
  private readonly root: string;

  constructor(dataDir: string, private readonly tempNames: FileTempNames) {
    this.root = safeJoin(dataDir, 'migrations');
  }

  async save(record: AppliedPackageMigration): Promise<void> {
    await writeJsonAtomic(
      this.pathFor(record.packageName, record.migrationId),
      record,
      this.tempNames
    );
  }

  async get(input: {
    packageName: string;
    migrationId: string;
  }): Promise<AppliedPackageMigration | null> {
    const path = this.pathFor(input.packageName, input.migrationId);
    if (!(await pathExists(path))) return null;
    return readJson<AppliedPackageMigration>(path, AppliedPackageMigrationSchema);
  }

  async list(packageName: string): Promise<AppliedPackageMigration[]> {
    const files = await listFilesRecursive(this.root);
    const records = await Promise.all(
      files.map((file) => readJson<AppliedPackageMigration>(file, AppliedPackageMigrationSchema))
    );
    return records
      .filter((record) => record.packageName === packageName)
      .sort(
        (left, right) =>
          compareStrings(left.appliedAt, right.appliedAt) ||
          compareStrings(left.migrationId, right.migrationId)
      );
  }

  private pathFor(packageName: string, migrationId: string): string {
    return safeJoin(this.root, filenameForId(`${packageName}:${migrationId}`));
  }
}
