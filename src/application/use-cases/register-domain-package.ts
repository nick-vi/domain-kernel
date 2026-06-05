import type {
  DomainPackage,
  FieldSchema,
  PackageCapability,
  PackageDependency,
  PackageLifecycle,
  PackageMigration,
} from '@/domain/package/domain-package';
import { ValidationError } from '@/domain/errors/domain-error';
import type { Actor } from '@/domain/auth/auth';
import {
  safeNormalizeWorkflowDefinition,
  type WorkflowDefinition,
} from '@/domain/workflow/workflow-definition';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';
import { assertPackageUpgradeAllowed } from '@/application/package-compatibility';
import { parseVersion } from '@/primitives/migration';
import { Json } from '@/primitives/json';
import { compareStrings } from '@/primitives/string';

export type RegisterDomainPackageInput = {
  name: string;
  version?: string | undefined;
  workflow: WorkflowDefinition;
  schema: FieldSchema;
  migrations?: PackageMigration[] | undefined;
  fixtures?: string[];
  kernelVersion?: string | undefined;
  dependencies?: PackageDependency[] | undefined;
  capabilities?: PackageCapability[] | undefined;
  lifecycle?: PackageLifecycle | undefined;
  sourcePath?: string;
  actor: Actor;
};

export async function registerDomainPackage(
  deps: ApplicationDependencies,
  input: RegisterDomainPackageInput
): Promise<DomainPackage> {
  return deps.tracer.span(
    'registerDomainPackage',
    { name: input.name, type: input.workflow.type },
    async () => {
      authorize(deps, input.actor, 'package:register');
      const version = input.version ?? '0.1.0';
      const versionResult = parseVersion(version);
      if (!versionResult.ok) {
        throw new ValidationError(versionResult.error.message, {
          packageName: input.name,
          version,
        });
      }
      const workflowResult = safeNormalizeWorkflowDefinition(input.workflow);
      if (!workflowResult.ok) {
        throw workflowResult.error;
      }

      const workflow = workflowResult.value;
      if (input.schema.type !== workflow.type) {
        throw new ValidationError(
          `Package schema type "${input.schema.type}" does not match workflow type "${workflow.type}"`,
          { packageName: input.name, schemaType: input.schema.type, workflowType: workflow.type }
        );
      }

      const domainPackage: DomainPackage = {
        name: input.name,
        version,
        workflowType: workflow.type,
        workflow,
        schema: input.schema,
        migrations: [...(input.migrations ?? [])].sort((left, right) =>
          compareStrings(left.fromVersion, right.fromVersion) ||
          compareStrings(left.id, right.id)
        ),
        fixtures: [...(input.fixtures ?? [])].sort(compareStrings),
        ...(input.kernelVersion != null ? { kernelVersion: input.kernelVersion } : {}),
        dependencies: [...(input.dependencies ?? [])].sort((left, right) =>
          compareStrings(left.name, right.name)
        ),
        capabilities: [...(input.capabilities ?? [])].sort(
          (left, right) =>
            compareStrings(left.kind, right.kind) || compareStrings(left.name, right.name)
        ),
        ...(input.lifecycle != null ? { lifecycle: input.lifecycle } : {}),
        ...(input.sourcePath != null ? { sourcePath: input.sourcePath } : {}),
        registeredAt: deps.clock.now(),
      };

      const existing = await deps.packages.getByNameAndVersion(input.name, version);
      if (existing != null) {
        assertSamePackageVersion(existing, domainPackage);
        return existing;
      }

      const latest = await deps.packages.getByName(input.name);
      if (latest != null) {
        assertPackageUpgradeAllowed(latest, domainPackage);
      }

      await deps.unitOfWork.run(async () => {
        await deps.workflows.save(workflow);
        await deps.cache.set(`workflow:${workflow.type}`, workflow);
        await deps.cache.set(`field-schema:${workflow.type}`, domainPackage.schema);
        await deps.packages.save(domainPackage);
      }, { name: 'registerDomainPackage' });
      deps.logger.info('Domain package registered', {
        name: domainPackage.name,
        version: domainPackage.version,
        workflowType: domainPackage.workflowType,
      });
      return domainPackage;
    }
  );
}

function assertSamePackageVersion(existing: DomainPackage, next: DomainPackage): void {
  if (stablePackageContent(existing) === stablePackageContent(next)) return;

  throw new ValidationError('Domain package version already exists with different content', {
    packageName: next.name,
    version: next.version,
  });
}

function stablePackageContent(domainPackage: DomainPackage): string {
  const comparable = {
    name: domainPackage.name,
    version: domainPackage.version,
    workflowType: domainPackage.workflowType,
    workflow: domainPackage.workflow,
    schema: domainPackage.schema,
    migrations: domainPackage.migrations,
    fixtures: domainPackage.fixtures,
    dependencies: domainPackage.dependencies ?? [],
    capabilities: domainPackage.capabilities ?? [],
    ...(domainPackage.kernelVersion != null ? { kernelVersion: domainPackage.kernelVersion } : {}),
    ...(domainPackage.lifecycle != null ? { lifecycle: domainPackage.lifecycle } : {}),
    ...(domainPackage.sourcePath != null ? { sourcePath: domainPackage.sourcePath } : {}),
  };
  return Json.stableStringify(comparable).unwrap();
}
