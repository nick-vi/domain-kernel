import type { ApplicationDependencies } from '@/application/dependencies';
import { ValidationError } from '@/domain/errors/domain-error';
import type {
  AppliedPackageMigration,
  PackageMigration,
  PackageMigrationKind,
} from '@/domain/package/domain-package';
import { compareVersions, planMigrations } from '@/primitives/migration';

export type PackageMigrationContext = {
  deps: ApplicationDependencies;
  packageName: string;
  step: PackageMigration;
  dryRun: boolean;
};

export type PackageMigrationHandler = (
  context: PackageMigrationContext
) => Promise<void> | void;

export type PackageMigrationHandlers = Partial<Record<PackageMigrationKind, PackageMigrationHandler>>;

export type RunPackageMigrationsInput = {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  dryRun?: boolean | undefined;
  requireHandlers?: boolean | undefined;
  handlers?: PackageMigrationHandlers | undefined;
};

export type PackageMigrationRunResult = {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  dryRun: boolean;
  planned: PackageMigration[];
  applied: AppliedPackageMigration[];
};

export async function runPackageMigrations(
  deps: ApplicationDependencies,
  input: RunPackageMigrationsInput
): Promise<PackageMigrationRunResult> {
  const versions = await deps.packages.listVersions(input.packageName);
  if (versions.length === 0) {
    throw new ValidationError(`Domain package "${input.packageName}" was not found`, {
      packageName: input.packageName,
    });
  }

  const source = versions.find((domainPackage) => domainPackage.version === input.fromVersion);
  if (source == null) {
    throw new ValidationError(
      `Domain package "${input.packageName}" version "${input.fromVersion}" was not found`,
      { packageName: input.packageName, fromVersion: input.fromVersion }
    );
  }

  const target = versions.find((domainPackage) => domainPackage.version === input.toVersion);
  if (target == null) {
    throw new ValidationError(
      `Domain package "${input.packageName}" version "${input.toVersion}" was not found`,
      { packageName: input.packageName, toVersion: input.toVersion }
    );
  }

  const compared = compareVersions(input.fromVersion, input.toVersion);
  if (!compared.ok) {
    throw new ValidationError(compared.error.message, {
      packageName: input.packageName,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
    });
  }
  if (compared.value >= 0) {
    throw new ValidationError('Migration target version must be newer than source version', {
      packageName: input.packageName,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
    });
  }

  const steps = versions.flatMap((domainPackage) => domainPackage.migrations);
  const planned = planMigrations(steps, {
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
  });
  if (!planned.ok) {
    throw new ValidationError(planned.error.message, {
      packageName: input.packageName,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
    });
  }

  const dryRun = input.dryRun === true;
  const applied: AppliedPackageMigration[] = [];

  for (const step of planned.value) {
    const existing = await deps.migrations.get({
      packageName: input.packageName,
      migrationId: step.id,
    });
    if (existing?.status === 'applied') {
      applied.push(existing);
      continue;
    }

    const handler = input.handlers?.[step.kind];
    if (handler == null && input.requireHandlers === true) {
      throw new ValidationError(`No migration handler registered for "${step.kind}"`, {
        packageName: input.packageName,
        migrationId: step.id,
        kind: step.kind,
      });
    }

    if (dryRun) continue;

    try {
      await handler?.({
        deps,
        packageName: input.packageName,
        step,
        dryRun,
      });
      const record = migrationRecord(input.packageName, step, 'applied', deps.clock.now());
      await deps.migrations.save(record);
      applied.push(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const record = migrationRecord(input.packageName, step, 'failed', deps.clock.now(), message);
      await deps.migrations.save(record);
      throw error;
    }
  }

  deps.logger.info('Package migrations processed', {
    packageName: input.packageName,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    dryRun,
    planned: planned.value.length,
    applied: applied.length,
  });

  return {
    packageName: input.packageName,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    dryRun,
    planned: planned.value,
    applied,
  };
}

function migrationRecord(
  packageName: string,
  step: PackageMigration,
  status: AppliedPackageMigration['status'],
  appliedAt: string,
  errorMessage?: string
): AppliedPackageMigration {
  return {
    packageName,
    migrationId: step.id,
    kind: step.kind,
    fromVersion: step.fromVersion,
    toVersion: step.toVersion,
    status,
    appliedAt,
    ...(errorMessage != null ? { errorMessage } : {}),
  };
}
