import { ValidationError } from '@/domain/errors/domain-error';
import type {
  DomainPackage,
  FieldDefinition,
  FieldSchema,
} from '@/domain/package/domain-package';
import type { NormalizedWorkflowDefinition } from '@/domain/workflow/workflow-definition';
import { compareVersions, parseVersion } from '@/primitives/migration';

export type CompatibilitySeverity = 'breaking' | 'warning' | 'info';

export type PackageCompatibilityFinding = {
  severity: CompatibilitySeverity;
  code: string;
  path: string;
  message: string;
};

export type VersionBump = 'none' | 'patch' | 'minor' | 'major';

export type PackageCompatibilityReport = {
  fromVersion: string;
  toVersion: string;
  versionBump: VersionBump;
  requiredVersionBump: VersionBump;
  findings: PackageCompatibilityFinding[];
};

export function checkPackageCompatibility(
  from: DomainPackage,
  to: DomainPackage
): PackageCompatibilityReport {
  const findings: PackageCompatibilityFinding[] = [];

  compareWorkflow(from.workflow, to.workflow, findings);
  compareSchema(from.schema, to.schema, findings);

  const hasBreaking = findings.some((finding) => finding.severity === 'breaking');
  const hasPublicAddition = findings.some((finding) => finding.severity === 'info');
  const requiredVersionBump: VersionBump = hasBreaking
    ? 'major'
    : hasPublicAddition
      ? 'minor'
      : 'patch';

  return {
    fromVersion: from.version,
    toVersion: to.version,
    versionBump: detectVersionBump(from.version, to.version),
    requiredVersionBump,
    findings,
  };
}

export function assertPackageUpgradeAllowed(from: DomainPackage, to: DomainPackage): void {
  const compared = compareVersions(from.version, to.version);
  if (!compared.ok) {
    throw new ValidationError(compared.error.message, {
      packageName: to.name,
      fromVersion: from.version,
      toVersion: to.version,
    });
  }
  if (compared.value >= 0) {
    throw new ValidationError('Domain package version must increase', {
      packageName: to.name,
      fromVersion: from.version,
      toVersion: to.version,
    });
  }

  const report = checkPackageCompatibility(from, to);
  if (isVersionBumpAtLeast(report.versionBump, report.requiredVersionBump)) return;

  throw new ValidationError('Domain package version does not match compatibility requirements', {
    packageName: to.name,
    fromVersion: from.version,
    toVersion: to.version,
    requiredVersionBump: report.requiredVersionBump,
    versionBump: report.versionBump,
    findings: report.findings.filter((finding) => finding.severity === 'breaking'),
  });
}

export function detectVersionBump(fromVersion: string, toVersion: string): VersionBump {
  const from = parseVersion(fromVersion);
  const to = parseVersion(toVersion);
  if (!from.ok || !to.ok) return 'none';

  if (to.value.major !== from.value.major) return 'major';
  if (to.value.minor !== from.value.minor) return 'minor';
  if (to.value.patch !== from.value.patch) return 'patch';
  return 'none';
}

function compareWorkflow(
  from: NormalizedWorkflowDefinition,
  to: NormalizedWorkflowDefinition,
  findings: PackageCompatibilityFinding[]
): void {
  if (from.type !== to.type) {
    findings.push({
      severity: 'breaking',
      code: 'workflow_type_changed',
      path: 'workflow.type',
      message: `Workflow type changed from "${from.type}" to "${to.type}"`,
    });
  }

  if (from.initialState !== to.initialState) {
    findings.push({
      severity: 'breaking',
      code: 'workflow_initial_state_changed',
      path: 'workflow.initialState',
      message: `Initial state changed from "${from.initialState}" to "${to.initialState}"`,
    });
  }

  compareStringSet('workflow.states', from.states, to.states, findings, {
    removedCode: 'workflow_state_removed',
    addedCode: 'workflow_state_added',
    removedMessage: (value) => `Workflow state "${value}" was removed`,
    addedMessage: (value) => `Workflow state "${value}" was added`,
  });

  compareStringSet('workflow.closedStates', from.closedStates, to.closedStates, findings, {
    removedCode: 'workflow_closed_state_removed',
    addedCode: 'workflow_closed_state_added',
    removedMessage: (value) => `Closed state "${value}" was removed`,
    addedMessage: (value) => `Closed state "${value}" was added`,
    addedSeverity: 'breaking',
  });

  const fromTransitions = new Map(from.transitions.map((transition) => [transitionKey(transition), transition]));
  const toTransitions = new Map(to.transitions.map((transition) => [transitionKey(transition), transition]));

  for (const [key, transition] of fromTransitions) {
    if (!toTransitions.has(key)) {
      findings.push({
        severity: 'breaking',
        code: 'workflow_transition_removed',
        path: `workflow.transitions.${transition.action}`,
        message: `Transition "${transition.action}" from "${transition.from}" to "${transition.to}" was removed`,
      });
    }
  }

  for (const [key, transition] of toTransitions) {
    if (!fromTransitions.has(key)) {
      findings.push({
        severity: 'info',
        code: 'workflow_transition_added',
        path: `workflow.transitions.${transition.action}`,
        message: `Transition "${transition.action}" from "${transition.from}" to "${transition.to}" was added`,
      });
    }
  }
}

function compareSchema(
  from: FieldSchema,
  to: FieldSchema,
  findings: PackageCompatibilityFinding[]
): void {
  if (from.type !== to.type) {
    findings.push({
      severity: 'breaking',
      code: 'schema_type_changed',
      path: 'schema.type',
      message: `Schema type changed from "${from.type}" to "${to.type}"`,
    });
  }

  if (from.allowAdditionalFields === true && to.allowAdditionalFields !== true) {
    findings.push({
      severity: 'breaking',
      code: 'schema_additional_fields_restricted',
      path: 'schema.allowAdditionalFields',
      message: 'Additional fields were restricted',
    });
  } else if (from.allowAdditionalFields !== true && to.allowAdditionalFields === true) {
    findings.push({
      severity: 'info',
      code: 'schema_additional_fields_allowed',
      path: 'schema.allowAdditionalFields',
      message: 'Additional fields were allowed',
    });
  }

  for (const [fieldName, field] of Object.entries(from.fields)) {
    const next = to.fields[fieldName];
    if (next == null) {
      findings.push({
        severity: 'breaking',
        code: 'schema_field_removed',
        path: `schema.fields.${fieldName}`,
        message: `Field "${fieldName}" was removed`,
      });
      continue;
    }

    compareField(fieldName, field, next, findings);
  }

  for (const [fieldName, field] of Object.entries(to.fields)) {
    if (from.fields[fieldName] != null) continue;
    findings.push({
      severity: field.required === true ? 'breaking' : 'info',
      code: field.required === true ? 'schema_required_field_added' : 'schema_optional_field_added',
      path: `schema.fields.${fieldName}`,
      message: `Field "${fieldName}" was added`,
    });
  }
}

function compareField(
  fieldName: string,
  from: FieldDefinition,
  to: FieldDefinition,
  findings: PackageCompatibilityFinding[]
): void {
  const path = `schema.fields.${fieldName}`;
  if (from.type !== to.type) {
    findings.push({
      severity: 'breaking',
      code: 'schema_field_type_changed',
      path,
      message: `Field "${fieldName}" changed type from "${from.type}" to "${to.type}"`,
    });
    return;
  }

  if (from.required !== true && to.required === true) {
    findings.push({
      severity: 'breaking',
      code: 'schema_field_now_required',
      path: `${path}.required`,
      message: `Field "${fieldName}" became required`,
    });
  }

  if (from.type === 'string' && to.type === 'string') {
    compareMinimum(fieldName, 'minLength', from.minLength, to.minLength, findings);
  }

  if (from.type === 'array' && to.type === 'array') {
    compareMinimum(fieldName, 'minItems', from.minItems, to.minItems, findings);
  }

  if (from.type === 'enum' && to.type === 'enum') {
    compareStringSet(`schema.fields.${fieldName}.values`, from.values, to.values, findings, {
      removedCode: 'schema_enum_value_removed',
      addedCode: 'schema_enum_value_added',
      removedMessage: (value) => `Enum value "${value}" was removed from "${fieldName}"`,
      addedMessage: (value) => `Enum value "${value}" was added to "${fieldName}"`,
    });
  }
}

function compareMinimum(
  fieldName: string,
  property: 'minLength' | 'minItems',
  from: number | undefined,
  to: number | undefined,
  findings: PackageCompatibilityFinding[]
): void {
  const previous = from ?? 0;
  const next = to ?? 0;
  if (next > previous) {
    findings.push({
      severity: 'breaking',
      code: `schema_field_${property}_increased`,
      path: `schema.fields.${fieldName}.${property}`,
      message: `Field "${fieldName}" ${property} increased from ${previous} to ${next}`,
    });
  } else if (next < previous) {
    findings.push({
      severity: 'info',
      code: `schema_field_${property}_decreased`,
      path: `schema.fields.${fieldName}.${property}`,
      message: `Field "${fieldName}" ${property} decreased from ${previous} to ${next}`,
    });
  }
}

function compareStringSet(
  path: string,
  from: readonly string[],
  to: readonly string[],
  findings: PackageCompatibilityFinding[],
  options: {
    removedCode: string;
    addedCode: string;
    removedMessage: (value: string) => string;
    addedMessage: (value: string) => string;
    addedSeverity?: CompatibilitySeverity | undefined;
  }
): void {
  const previous = new Set(from);
  const next = new Set(to);

  for (const value of previous) {
    if (!next.has(value)) {
      findings.push({
        severity: 'breaking',
        code: options.removedCode,
        path,
        message: options.removedMessage(value),
      });
    }
  }

  for (const value of next) {
    if (!previous.has(value)) {
      findings.push({
        severity: options.addedSeverity ?? 'info',
        code: options.addedCode,
        path,
        message: options.addedMessage(value),
      });
    }
  }
}

function transitionKey(transition: { action: string; from: string; to: string }): string {
  return `${transition.action}:${transition.from}:${transition.to}`;
}

function isVersionBumpAtLeast(actual: VersionBump, required: VersionBump): boolean {
  return bumpRank(actual) >= bumpRank(required);
}

function bumpRank(bump: VersionBump): number {
  switch (bump) {
    case 'none':
      return 0;
    case 'patch':
      return 1;
    case 'minor':
      return 2;
    case 'major':
      return 3;
  }
}
