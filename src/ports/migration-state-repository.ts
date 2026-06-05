import type { AppliedPackageMigration } from '@/domain/package/domain-package';

export interface MigrationStateRepository {
  save(record: AppliedPackageMigration): Promise<void>;
  get(input: { packageName: string; migrationId: string }): Promise<AppliedPackageMigration | null>;
  list(packageName: string): Promise<AppliedPackageMigration[]>;
}
