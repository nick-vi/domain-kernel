import type { Scope } from './scope';

export const SyncCheckpointStatus = Object.freeze({
  ACTIVE: 'active',
  STALE: 'stale',
  FAILED: 'failed',
} as const);

export type SyncCheckpointStatus =
  (typeof SyncCheckpointStatus)[keyof typeof SyncCheckpointStatus];

export type SyncCheckpoint = {
  id: string;
  source: string;
  stream: string;
  scope?: Scope | undefined;
  cursor?: string | undefined;
  highWatermark?: string | undefined;
  status: SyncCheckpointStatus;
  updatedAt: string;
  lastError?: string | undefined;
};

export type ExternalReference = {
  system: string;
  entityType: string;
  externalId: string;
  localId: string;
  scope?: Scope | undefined;
  checksum?: string | undefined;
  seenAt: string;
};

export function createSyncCheckpoint(input: {
  id: string;
  source: string;
  stream: string;
  scope?: Scope | undefined;
  cursor?: string | undefined;
  highWatermark?: string | undefined;
  now: string;
}): SyncCheckpoint {
  return {
    id: input.id,
    source: input.source,
    stream: input.stream,
    ...(input.scope != null ? { scope: input.scope } : {}),
    ...(input.cursor != null ? { cursor: input.cursor } : {}),
    ...(input.highWatermark != null ? { highWatermark: input.highWatermark } : {}),
    status: SyncCheckpointStatus.ACTIVE,
    updatedAt: input.now,
  };
}

export function advanceSyncCheckpoint(
  checkpoint: SyncCheckpoint,
  input: {
    cursor?: string | undefined;
    highWatermark?: string | undefined;
    now: string;
  }
): SyncCheckpoint {
  const { lastError: _lastError, ...rest } = checkpoint;
  return {
    ...rest,
    ...(input.cursor != null ? { cursor: input.cursor } : {}),
    ...(input.highWatermark != null ? { highWatermark: input.highWatermark } : {}),
    status: SyncCheckpointStatus.ACTIVE,
    updatedAt: input.now,
  };
}

export function failSyncCheckpoint(
  checkpoint: SyncCheckpoint,
  input: { error: string; now: string }
): SyncCheckpoint {
  return {
    ...checkpoint,
    status: SyncCheckpointStatus.FAILED,
    lastError: input.error,
    updatedAt: input.now,
  };
}

export function markSyncCheckpointStale(
  checkpoint: SyncCheckpoint,
  input: { now: string; error?: string | undefined }
): SyncCheckpoint {
  return {
    ...checkpoint,
    status: SyncCheckpointStatus.STALE,
    ...(input.error != null ? { lastError: input.error } : {}),
    updatedAt: input.now,
  };
}

export function externalReferenceKey(input: {
  system: string;
  entityType: string;
  externalId: string;
}): string {
  return `${input.system}:${input.entityType}:${input.externalId}`;
}
