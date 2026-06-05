import { Json } from './json';
import type { JsonObject, JsonPrimitive, JsonValue } from './json-value';
import { compareStrings } from './string';

export type ImportExportJsonPrimitive = JsonPrimitive;
export type ImportExportJsonValue = JsonValue;
export type ImportExportJsonObject = JsonObject;

export type ImportRecord<TValue extends ImportExportJsonObject = ImportExportJsonObject> = {
  externalId: string;
  value: TValue;
  checksum?: string | undefined;
};

export type ExistingRecord<TValue extends ImportExportJsonObject = ImportExportJsonObject> = {
  localId: string;
  externalId?: string | undefined;
  value: TValue;
  checksum?: string | undefined;
};

export const ImportPlanAction = Object.freeze({
  Create: 'create',
  Update: 'update',
  Skip: 'skip',
  Conflict: 'conflict',
} as const);

export type ImportPlanAction = (typeof ImportPlanAction)[keyof typeof ImportPlanAction];

export type ImportPlanChange<TValue extends ImportExportJsonObject = ImportExportJsonObject> = {
  action: ImportPlanAction;
  externalId: string;
  localId?: string | undefined;
  incoming: TValue;
  current?: TValue | undefined;
  reason: string;
  checksum: string;
};

export type ImportPlan<TValue extends ImportExportJsonObject = ImportExportJsonObject> = {
  changes: ImportPlanChange<TValue>[];
  creates: number;
  updates: number;
  skips: number;
  conflicts: number;
};

export function planImport<TValue extends ImportExportJsonObject>(input: {
  incoming: readonly ImportRecord<TValue>[];
  existing: readonly ExistingRecord<TValue>[];
  allowUpdates?: boolean | undefined;
}): ImportPlan<TValue> {
  const existingByExternalId = new Map(
    input.existing
      .filter((record) => record.externalId != null)
      .map((record) => [record.externalId!, record])
  );
  const seenIncoming = new Set<string>();
  const changes: ImportPlanChange<TValue>[] = [];

  for (const incoming of input.incoming) {
    const checksum = incoming.checksum ?? checksumValue(incoming.value);
    if (seenIncoming.has(incoming.externalId)) {
      changes.push({
        action: ImportPlanAction.Conflict,
        externalId: incoming.externalId,
        incoming: incoming.value,
        reason: 'duplicate_incoming_external_id',
        checksum,
      });
      continue;
    }
    seenIncoming.add(incoming.externalId);

    const current = existingByExternalId.get(incoming.externalId);
    if (current == null) {
      changes.push({
        action: ImportPlanAction.Create,
        externalId: incoming.externalId,
        incoming: incoming.value,
        reason: 'missing_local_record',
        checksum,
      });
      continue;
    }

    const currentChecksum = current.checksum ?? checksumValue(current.value);
    if (currentChecksum === checksum) {
      changes.push({
        action: ImportPlanAction.Skip,
        externalId: incoming.externalId,
        localId: current.localId,
        incoming: incoming.value,
        current: current.value,
        reason: 'checksum_match',
        checksum,
      });
      continue;
    }

    changes.push({
      action: input.allowUpdates === false ? ImportPlanAction.Conflict : ImportPlanAction.Update,
      externalId: incoming.externalId,
      localId: current.localId,
      incoming: incoming.value,
      current: current.value,
      reason: input.allowUpdates === false ? 'updates_disabled' : 'checksum_changed',
      checksum,
    });
  }

  return summarizePlan(changes);
}

export function exportRecords<TValue extends ImportExportJsonObject>(
  records: readonly ExistingRecord<TValue>[]
): ImportRecord<TValue>[] {
  return records
    .filter((record) => record.externalId != null)
    .map((record) => ({
      externalId: record.externalId!,
      value: record.value,
      checksum: record.checksum ?? checksumValue(record.value),
    }))
    .sort((left, right) => compareStrings(left.externalId, right.externalId));
}

function summarizePlan<TValue extends ImportExportJsonObject>(
  changes: ImportPlanChange<TValue>[]
): ImportPlan<TValue> {
  return {
    changes,
    creates: changes.filter((change) => change.action === ImportPlanAction.Create).length,
    updates: changes.filter((change) => change.action === ImportPlanAction.Update).length,
    skips: changes.filter((change) => change.action === ImportPlanAction.Skip).length,
    conflicts: changes.filter((change) => change.action === ImportPlanAction.Conflict).length,
  };
}

function checksumValue(value: ImportExportJsonObject): string {
  return Json.stableContentHash(value).unwrap();
}
