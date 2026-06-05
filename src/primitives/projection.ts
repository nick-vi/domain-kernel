import type { JsonObject, JsonPrimitive, JsonValue } from './json-value';
import type { Scope } from './scope';

export type ProjectionJsonPrimitive = JsonPrimitive;
export type ProjectionJsonValue = JsonValue;
export type ProjectionJsonObject = JsonObject;

export type ProjectionRecord = {
  projectionName: string;
  id: string;
  scope?: Scope | undefined;
  value: ProjectionJsonObject;
  version: number;
  updatedAt: string;
};

export type ProjectionCheckpoint = {
  projectionName: string;
  scope?: Scope | undefined;
  cursor?: string | undefined;
  sequence?: number | undefined;
  updatedAt: string;
};

export type ProjectionSnapshot = {
  id: string;
  projectionName: string;
  scope?: Scope | undefined;
  checkpoint?: ProjectionCheckpoint | undefined;
  records: ProjectionRecord[];
  recordCount: number;
  createdAt: string;
};

export function createProjectionRecord(input: {
  projectionName: string;
  id: string;
  scope?: Scope | undefined;
  value: ProjectionJsonObject;
  now: string;
}): ProjectionRecord {
  return {
    projectionName: input.projectionName,
    id: input.id,
    ...(input.scope != null ? { scope: input.scope } : {}),
    value: input.value,
    version: 1,
    updatedAt: input.now,
  };
}

export function updateProjectionRecord(
  record: ProjectionRecord,
  input: { value: ProjectionJsonObject; now: string }
): ProjectionRecord {
  return {
    ...record,
    value: input.value,
    version: record.version + 1,
    updatedAt: input.now,
  };
}

export function advanceProjectionCheckpoint(
  checkpoint: ProjectionCheckpoint | undefined,
  input: {
    projectionName: string;
    scope?: Scope | undefined;
    cursor?: string | undefined;
    sequence?: number | undefined;
    now: string;
  }
): ProjectionCheckpoint {
  return {
    projectionName: input.projectionName,
    ...(input.scope != null ? { scope: input.scope } : checkpoint?.scope != null ? { scope: checkpoint.scope } : {}),
    ...(input.cursor != null ? { cursor: input.cursor } : checkpoint?.cursor != null ? { cursor: checkpoint.cursor } : {}),
    ...(input.sequence != null
      ? { sequence: input.sequence }
      : checkpoint?.sequence != null
        ? { sequence: checkpoint.sequence }
        : {}),
    updatedAt: input.now,
  };
}

export function createProjectionSnapshot(input: {
  id: string;
  projectionName: string;
  scope?: Scope | undefined;
  records: readonly ProjectionRecord[];
  checkpoint?: ProjectionCheckpoint | undefined;
  now: string;
}): ProjectionSnapshot {
  const records = input.records.map((record) => structuredClone(record));

  return {
    id: input.id,
    projectionName: input.projectionName,
    ...(input.scope != null ? { scope: input.scope } : {}),
    ...(input.checkpoint != null ? { checkpoint: structuredClone(input.checkpoint) } : {}),
    records,
    recordCount: records.length,
    createdAt: input.now,
  };
}
