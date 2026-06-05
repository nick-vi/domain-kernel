import type { ApplicationDependencies } from '@/application/dependencies';
import {
  rebuildProjection,
  type ProjectionDefinition,
  type RebuildProjectionOptions,
} from '@/application/projection-worker';
import type { ProjectionStore } from '@/ports/projection-store';
import { idempotencyFingerprint } from '@/primitives/idempotency';
import type { ProjectionRecord } from '@/primitives/projection';
import type { Scope } from '@/primitives/scope';
import { compareStrings } from '@/primitives/string';

export type ProjectionVerificationStatus = 'matched' | 'drifted';

export type ProjectionVerificationDifference = {
  kind: 'missing' | 'extra' | 'changed';
  id: string;
  expectedHash?: string | undefined;
  actualHash?: string | undefined;
  expected?: ProjectionRecord | undefined;
  actual?: ProjectionRecord | undefined;
};

export type ProjectionVerificationReport = {
  projectionName: string;
  scope?: Scope | undefined;
  status: ProjectionVerificationStatus;
  expectedCount: number;
  actualCount: number;
  differences: ProjectionVerificationDifference[];
};

export type VerifyProjectionOptions = RebuildProjectionOptions & {
  scratchStore: ProjectionStore;
};

export async function verifyProjection(
  deps: ApplicationDependencies,
  definition: ProjectionDefinition,
  options: VerifyProjectionOptions
): Promise<ProjectionVerificationReport> {
  await options.scratchStore.clear({
    projectionName: definition.name,
    scope: definition.scope,
  });

  await rebuildProjection(
    {
      ...deps,
      projections: options.scratchStore,
    },
    definition,
    {
      ...(options.batchSize != null ? { batchSize: options.batchSize } : {}),
      clear: true,
    }
  );

  return compareProjectionRecords({
    projectionName: definition.name,
    scope: definition.scope,
    expected: await options.scratchStore.list({
      projectionName: definition.name,
      scope: definition.scope,
    }),
    actual: await deps.projections.list({
      projectionName: definition.name,
      scope: definition.scope,
    }),
  });
}

export function compareProjectionRecords(input: {
  projectionName: string;
  scope?: Scope | undefined;
  expected: readonly ProjectionRecord[];
  actual: readonly ProjectionRecord[];
}): ProjectionVerificationReport {
  const expectedById = recordsById(input.expected);
  const actualById = recordsById(input.actual);
  const differences: ProjectionVerificationDifference[] = [];

  for (const [id, expected] of expectedById) {
    const actual = actualById.get(id);
    if (actual == null) {
      differences.push({
        kind: 'missing',
        id,
        expectedHash: projectionRecordHash(expected),
        expected,
      });
      continue;
    }

    const expectedHash = projectionRecordHash(expected);
    const actualHash = projectionRecordHash(actual);
    if (expectedHash !== actualHash) {
      differences.push({
        kind: 'changed',
        id,
        expectedHash,
        actualHash,
        expected,
        actual,
      });
    }
  }

  for (const [id, actual] of actualById) {
    if (expectedById.has(id)) continue;
    differences.push({
      kind: 'extra',
      id,
      actualHash: projectionRecordHash(actual),
      actual,
    });
  }

  return {
    projectionName: input.projectionName,
    ...(input.scope != null ? { scope: input.scope } : {}),
    status: differences.length === 0 ? 'matched' : 'drifted',
    expectedCount: input.expected.length,
    actualCount: input.actual.length,
    differences: differences.sort(
      (left, right) => compareStrings(left.kind, right.kind) || compareStrings(left.id, right.id)
    ),
  };
}

function recordsById(records: readonly ProjectionRecord[]): Map<string, ProjectionRecord> {
  return new Map(records.map((record) => [record.id, record]));
}

function projectionRecordHash(record: ProjectionRecord): string {
  return idempotencyFingerprint(record.value);
}
