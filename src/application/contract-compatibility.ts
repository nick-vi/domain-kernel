import type {
  ContractDefinition,
  ContractKind,
} from '@/application/contract-catalog';
import { detectVersionBump, type VersionBump } from '@/application/package-compatibility';
import { compareStrings } from '@/primitives/string';

export type ContractCompatibilityMode = 'backward' | 'forward' | 'full';
export type ContractCompatibilityStatus = 'compatible' | 'breaking';

export type ContractCompatibilityFinding = {
  severity: 'breaking' | 'info';
  code: string;
  path: string;
  message: string;
};

export type ContractCompatibilityReport = {
  kind: ContractKind;
  type: string;
  fromVersion: string;
  toVersion: string;
  mode: ContractCompatibilityMode;
  status: ContractCompatibilityStatus;
  versionBump: VersionBump;
  requiredVersionBump: VersionBump;
  findings: ContractCompatibilityFinding[];
};

export function checkContractCompatibility(
  from: ContractDefinition,
  to: ContractDefinition,
  options: { mode?: ContractCompatibilityMode | undefined } = {}
): ContractCompatibilityReport {
  const mode = options.mode ?? 'backward';
  const findings: ContractCompatibilityFinding[] = [];

  if (from.kind !== to.kind) {
    findings.push({
      severity: 'breaking',
      code: 'contract_kind_changed',
      path: 'kind',
      message: `Contract kind changed from "${from.kind}" to "${to.kind}"`,
    });
  }

  if (from.type !== to.type) {
    findings.push({
      severity: 'breaking',
      code: 'contract_type_changed',
      path: 'type',
      message: `Contract type changed from "${from.type}" to "${to.type}"`,
    });
  }

  if (mode === 'backward' || mode === 'full') {
    compareReaderWriterSchemas(to.jsonSchema, from.jsonSchema, findings, 'backward');
  }
  if (mode === 'forward' || mode === 'full') {
    compareReaderWriterSchemas(from.jsonSchema, to.jsonSchema, findings, 'forward');
  }

  const hasBreaking = findings.some((finding) => finding.severity === 'breaking');
  const hasInfo = findings.some((finding) => finding.severity === 'info');

  return {
    kind: to.kind,
    type: to.type,
    fromVersion: from.version,
    toVersion: to.version,
    mode,
    status: hasBreaking ? 'breaking' : 'compatible',
    versionBump: detectVersionBump(from.version, to.version),
    requiredVersionBump: hasBreaking ? 'major' : hasInfo ? 'minor' : 'patch',
    findings: findings.sort((left, right) => compareStrings(left.path, right.path)),
  };
}

function compareReaderWriterSchemas(
  reader: Record<string, unknown> | undefined,
  writer: Record<string, unknown> | undefined,
  findings: ContractCompatibilityFinding[],
  direction: 'backward' | 'forward'
): void {
  if (reader == null || writer == null) {
    if (reader !== writer) {
      findings.push({
        severity: 'info',
        code: `${direction}_schema_presence_changed`,
        path: 'jsonSchema',
        message: `Contract schema presence changed for ${direction} compatibility`,
      });
    }
    return;
  }

  compareSchemaNode(reader, writer, findings, direction, 'jsonSchema');
}

function compareSchemaNode(
  reader: Record<string, unknown>,
  writer: Record<string, unknown>,
  findings: ContractCompatibilityFinding[],
  direction: 'backward' | 'forward',
  path: string
): void {
  const readerType = stringValue(reader.type);
  const writerType = stringValue(writer.type);
  if (readerType != null && writerType != null && readerType !== writerType) {
    findings.push({
      severity: 'breaking',
      code: `${direction}_schema_type_changed`,
      path,
      message: `${direction} reader type "${readerType}" does not accept writer type "${writerType}"`,
    });
    return;
  }

  if ('const' in reader && 'const' in writer && reader.const !== writer.const) {
    findings.push({
      severity: 'breaking',
      code: `${direction}_schema_const_changed`,
      path,
      message: `${direction} reader constant does not accept writer constant`,
    });
  }

  if (readerType === 'object' || writerType === 'object') {
    compareObjectSchema(reader, writer, findings, direction, path);
  }
}

function compareObjectSchema(
  reader: Record<string, unknown>,
  writer: Record<string, unknown>,
  findings: ContractCompatibilityFinding[],
  direction: 'backward' | 'forward',
  path: string
): void {
  const readerProperties = objectValue(reader.properties);
  const writerProperties = objectValue(writer.properties);
  const readerRequired = stringSet(reader.required);
  const writerRequired = stringSet(writer.required);
  const readerClosed = reader.additionalProperties === false;
  const writerOpen = writer.additionalProperties !== false;

  for (const name of Object.keys(readerProperties)) {
    if (writerProperties[name] != null) continue;
    if (readerRequired.has(name)) {
      findings.push({
        severity: 'breaking',
        code: `${direction}_required_property_added`,
        path: `${path}.properties.${name}`,
        message: `${direction} reader requires property "${name}" that writer may omit`,
      });
    } else {
      findings.push({
        severity: 'info',
        code: `${direction}_optional_property_added`,
        path: `${path}.properties.${name}`,
        message: `${direction} reader accepts new optional property "${name}"`,
      });
    }
  }

  for (const name of Object.keys(writerProperties)) {
    const readerProperty = recordValue(readerProperties[name]);
    const writerProperty = recordValue(writerProperties[name]);
    if (readerProperty == null) {
      if (readerClosed) {
        findings.push({
          severity: 'breaking',
          code: `${direction}_property_removed_from_closed_reader`,
          path: `${path}.properties.${name}`,
          message: `${direction} reader rejects writer property "${name}"`,
        });
      }
      continue;
    }

    if (writerProperty != null) {
      compareSchemaNode(readerProperty, writerProperty, findings, direction, `${path}.properties.${name}`);
    }
  }

  if (writerOpen && readerClosed) {
    findings.push({
      severity: 'breaking',
      code: `${direction}_additional_properties_restricted`,
      path: `${path}.additionalProperties`,
      message: `${direction} reader is closed while writer may emit additional properties`,
    });
  }

  for (const name of writerRequired) {
    if (!readerRequired.has(name)) {
      findings.push({
        severity: 'info',
        code: `${direction}_required_property_relaxed`,
        path: `${path}.required`,
        message: `${direction} reader no longer requires property "${name}"`,
      });
    }
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return recordValue(value) ?? {};
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((item): item is string => typeof item === 'string'));
}
