import type { NormalizedWorkflowDefinition } from '@/domain/workflow/workflow-definition';
import type { MigrationStep } from '@/primitives/migration';

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'enum';

export type BaseFieldDefinition = {
  required?: boolean | undefined;
  description?: string | undefined;
};

export type StringFieldDefinition = BaseFieldDefinition & {
  type: 'string';
  minLength?: number | undefined;
};

export type ScalarFieldDefinition = BaseFieldDefinition & {
  type: Exclude<FieldType, 'array' | 'enum' | 'string'>;
};

export type ArrayFieldDefinition = BaseFieldDefinition & {
  type: 'array';
  minItems?: number | undefined;
};

export type EnumFieldDefinition = BaseFieldDefinition & {
  type: 'enum';
  values: string[];
};

export type FieldDefinition =
  | StringFieldDefinition
  | ScalarFieldDefinition
  | ArrayFieldDefinition
  | EnumFieldDefinition;

export type FieldSchema = {
  type: string;
  fields: Record<string, FieldDefinition>;
  allowAdditionalFields?: boolean | undefined;
};

export type PackageMigrationKind = 'workflow' | 'schema' | 'data';

export type PackageMigration = MigrationStep<PackageMigrationKind>;

export type PackageDependency = {
  name: string;
  version?: string | undefined;
};

export type PackageCapabilityKind =
  | 'workflow'
  | 'schema'
  | 'command'
  | 'event'
  | 'projection'
  | 'process'
  | 'integration'
  | 'custom';

export type PackageCapability = {
  name: string;
  kind: PackageCapabilityKind;
  version?: string | undefined;
};

export type PackageLifecycleStatus = 'active' | 'deprecated' | 'replaced';

export type PackageReplacement = {
  name: string;
  version: string;
};

export type PackageLifecycle = {
  status: PackageLifecycleStatus;
  note?: string | undefined;
  deprecatedAt?: string | undefined;
  replacedBy?: PackageReplacement | undefined;
};

export type AppliedPackageMigrationStatus = 'applied' | 'failed';

export type AppliedPackageMigration = {
  packageName: string;
  migrationId: string;
  kind: PackageMigrationKind;
  fromVersion: string;
  toVersion: string;
  status: AppliedPackageMigrationStatus;
  appliedAt: string;
  errorMessage?: string | undefined;
};

export type DomainPackage = {
  name: string;
  version: string;
  workflowType: string;
  workflow: NormalizedWorkflowDefinition;
  schema: FieldSchema;
  migrations: PackageMigration[];
  fixtures: string[];
  kernelVersion?: string | undefined;
  dependencies?: PackageDependency[] | undefined;
  capabilities?: PackageCapability[] | undefined;
  lifecycle?: PackageLifecycle | undefined;
  sourcePath?: string | undefined;
  registeredAt: string;
};
