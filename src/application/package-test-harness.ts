import type { Actor } from '@/domain/auth/auth';
import type {
  FieldSchema,
  PackageCapability,
  PackageDependency,
  PackageLifecycle,
  PackageMigration,
} from '@/domain/package/domain-package';
import type { JsonObject } from '@/domain/shared';
import {
  safeNormalizeWorkflowDefinition,
  type WorkflowDefinition,
} from '@/domain/workflow/workflow-definition';
import type { ApplicationDependencies } from '@/application/dependencies';
import { validateInputFieldsAgainstSchema } from '@/application/field-validation';
import { registerDomainPackage } from '@/application/use-cases/register-domain-package';
import { Err, Ok, type Result } from '@/primitives/result';
import { parseVersion } from '@/primitives/migration';

export type DomainPackageFixture = {
  name: string;
  fields: JsonObject;
};

export type DomainPackageTestInput = {
  name: string;
  version?: string | undefined;
  workflow: WorkflowDefinition;
  schema: FieldSchema;
  migrations?: PackageMigration[] | undefined;
  fixtures?: DomainPackageFixture[] | undefined;
  kernelVersion?: string | undefined;
  dependencies?: PackageDependency[] | undefined;
  capabilities?: PackageCapability[] | undefined;
  lifecycle?: PackageLifecycle | undefined;
  sourcePath?: string | undefined;
  actor?: Actor | undefined;
  register?: boolean | undefined;
};

export type DomainPackageTestReport = {
  packageName: string;
  version: string;
  workflowType: string;
  fixtureCount: number;
  registered: boolean;
  checks: DomainPackageTestCheck[];
};

export type DomainPackageTestCheck = {
  name: string;
  status: 'passed';
};

export class DomainPackageTestHarnessError extends Error {
  override readonly name = 'DomainPackageTestHarnessError';
}

export async function testDomainPackage(
  deps: ApplicationDependencies,
  input: DomainPackageTestInput
): Promise<Result<DomainPackageTestReport, Error>> {
  try {
    const version = input.version ?? '0.1.0';
    const versionResult = parseVersion(version);
    if (!versionResult.ok) return Err(versionResult.error);

    const workflowResult = safeNormalizeWorkflowDefinition(input.workflow);
    if (!workflowResult.ok) return Err(workflowResult.error);

    const workflow = workflowResult.value;
    if (input.schema.type !== workflow.type) {
      return Err(
        new DomainPackageTestHarnessError(
          `Package schema type "${input.schema.type}" does not match workflow type "${workflow.type}"`
        )
      );
    }

    const checks: DomainPackageTestCheck[] = [
      { name: 'version.parse', status: 'passed' },
      { name: 'workflow.normalize', status: 'passed' },
      { name: 'schema.workflow_type_match', status: 'passed' },
    ];

    for (const fixture of input.fixtures ?? []) {
      validateInputFieldsAgainstSchema(input.schema, fixture.fields, `fixture:${fixture.name}`, {
        requireSchemaRequiredFields: true,
      });
      checks.push({ name: `fixture.${fixture.name}.schema`, status: 'passed' });
    }

    const shouldRegister = input.register === true;
    if (shouldRegister) {
      if (input.actor == null) {
        return Err(new DomainPackageTestHarnessError('Actor is required when register is true'));
      }

      await registerDomainPackage(deps, {
        name: input.name,
        version,
        workflow: input.workflow,
        schema: input.schema,
        ...(input.migrations != null ? { migrations: input.migrations } : {}),
        fixtures: (input.fixtures ?? []).map((fixture) => fixture.name),
        ...(input.kernelVersion != null ? { kernelVersion: input.kernelVersion } : {}),
        ...(input.dependencies != null ? { dependencies: input.dependencies } : {}),
        ...(input.capabilities != null ? { capabilities: input.capabilities } : {}),
        ...(input.lifecycle != null ? { lifecycle: input.lifecycle } : {}),
        ...(input.sourcePath != null ? { sourcePath: input.sourcePath } : {}),
        actor: input.actor,
      });
      checks.push({ name: 'package.register', status: 'passed' });
    }

    return Ok({
      packageName: input.name,
      version,
      workflowType: workflow.type,
      fixtureCount: input.fixtures?.length ?? 0,
      registered: shouldRegister,
      checks,
    });
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}
