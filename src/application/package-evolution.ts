import {
  checkPackageCompatibility,
  type PackageCompatibilityFinding,
  type VersionBump,
} from '@/application/package-compatibility';
import type { DomainPackage, PackageMigrationKind } from '@/domain/package/domain-package';
import { compareStrings } from '@/primitives/string';

export type PackageEvolutionStatus = 'compatible' | 'requires_migration' | 'breaking';

export type PackageEvolutionMigrationRequirement = {
  kind: PackageMigrationKind;
  required: boolean;
  covered: boolean;
};

export type PackageEvolutionReport = {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  status: PackageEvolutionStatus;
  versionBump: VersionBump;
  requiredVersionBump: VersionBump;
  findings: PackageCompatibilityFinding[];
  migrationRequirements: PackageEvolutionMigrationRequirement[];
  migrations: Array<{
    id: string;
    kind: PackageMigrationKind;
    fromVersion: string;
    toVersion: string;
  }>;
};

export function buildPackageEvolutionReport(
  from: DomainPackage,
  to: DomainPackage
): PackageEvolutionReport {
  const compatibility = checkPackageCompatibility(from, to);
  const requiredKinds = requiredMigrationKinds(compatibility.findings);
  const migrations = to.migrations
    .filter(
      (migration) =>
        migration.fromVersion === from.version && migration.toVersion === to.version
    )
    .map((migration) => ({
      id: migration.id,
      kind: migration.kind,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
    }))
    .sort(
      (left, right) =>
        compareStrings(left.kind, right.kind) || compareStrings(left.id, right.id)
    );
  const coveredKinds = new Set(migrations.map((migration) => migration.kind));
  const migrationRequirements = [...requiredKinds]
    .sort(compareStrings)
    .map((kind) => ({
      kind,
      required: true,
      covered: coveredKinds.has(kind),
    }));

  const hasBreaking = compatibility.findings.some((finding) => finding.severity === 'breaking');
  const hasMissingMigration = migrationRequirements.some((requirement) => !requirement.covered);

  return {
    packageName: to.name,
    fromVersion: from.version,
    toVersion: to.version,
    status: hasBreaking ? 'breaking' : hasMissingMigration ? 'requires_migration' : 'compatible',
    versionBump: compatibility.versionBump,
    requiredVersionBump: compatibility.requiredVersionBump,
    findings: compatibility.findings,
    migrationRequirements,
    migrations,
  };
}

function requiredMigrationKinds(
  findings: readonly PackageCompatibilityFinding[]
): Set<PackageMigrationKind> {
  const kinds = new Set<PackageMigrationKind>();

  for (const finding of findings) {
    if (finding.severity === 'info') continue;
    if (finding.code.startsWith('schema_')) kinds.add('schema');
    if (finding.code.startsWith('workflow_')) kinds.add('workflow');
  }

  return kinds;
}
