import type { AppliedPackageMigration } from '@/domain/package/domain-package';
import type { MigrationStateRepository } from '@/ports/migration-state-repository';
import { compareStrings } from '@/primitives/string';

export class InMemoryMigrationStateRepository implements MigrationStateRepository {
  private readonly records = new Map<string, AppliedPackageMigration>();

  async save(record: AppliedPackageMigration): Promise<void> {
    this.records.set(recordKey(record.packageName, record.migrationId), structuredClone(record));
  }

  async get(input: {
    packageName: string;
    migrationId: string;
  }): Promise<AppliedPackageMigration | null> {
    const record = this.records.get(recordKey(input.packageName, input.migrationId));
    return record == null ? null : structuredClone(record);
  }

  async list(packageName: string): Promise<AppliedPackageMigration[]> {
    return [...this.records.values()]
      .filter((record) => record.packageName === packageName)
      .map((record) => structuredClone(record))
      .sort(
        (left, right) =>
          compareStrings(left.appliedAt, right.appliedAt) ||
          compareStrings(left.migrationId, right.migrationId)
      );
  }
}

function recordKey(packageName: string, migrationId: string): string {
  return `${packageName}:${migrationId}`;
}
