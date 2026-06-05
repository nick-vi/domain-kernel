import type { ProjectionListQuery, ProjectionStore } from '@/ports/projection-store';
import type {
  ProjectionCheckpoint,
  ProjectionRecord,
  ProjectionSnapshot,
} from '@/primitives/projection';
import { scopeKey, scopeMatches } from '@/primitives/scope';
import { compareStrings } from '@/primitives/string';

export class InMemoryProjectionStore implements ProjectionStore {
  private readonly records = new Map<string, ProjectionRecord>();
  private readonly checkpoints = new Map<string, ProjectionCheckpoint>();
  private readonly snapshots = new Map<string, ProjectionSnapshot>();

  async save(record: ProjectionRecord): Promise<void> {
    this.records.set(recordKey(record), structuredClone(record));
  }

  async get(input: {
    projectionName: string;
    id: string;
    scope?: ProjectionRecord['scope'];
  }): Promise<ProjectionRecord | null> {
    const record = this.records.get(recordKey(input));
    return record == null ? null : structuredClone(record);
  }

  async list(query: ProjectionListQuery): Promise<ProjectionRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.projectionName === query.projectionName)
      .filter((record) => query.scope == null || scopeMatches(record.scope, query.scope))
      .map((record) => structuredClone(record))
      .sort((left, right) => compareStrings(left.id, right.id));
  }

  async saveCheckpoint(checkpoint: ProjectionCheckpoint): Promise<void> {
    this.checkpoints.set(checkpointKey(checkpoint), structuredClone(checkpoint));
  }

  async getCheckpoint(input: {
    projectionName: string;
    scope?: ProjectionCheckpoint['scope'];
  }): Promise<ProjectionCheckpoint | null> {
    const checkpoint = this.checkpoints.get(checkpointKey(input));
    return checkpoint == null ? null : structuredClone(checkpoint);
  }

  async saveSnapshot(snapshot: ProjectionSnapshot): Promise<void> {
    this.snapshots.set(snapshotKey(snapshot), structuredClone(snapshot));
  }

  async listSnapshots(query: ProjectionListQuery): Promise<ProjectionSnapshot[]> {
    return [...this.snapshots.values()]
      .filter((snapshot) => snapshot.projectionName === query.projectionName)
      .filter((snapshot) => query.scope == null || scopeMatches(snapshot.scope, query.scope))
      .map((snapshot) => structuredClone(snapshot))
      .sort(
        (left, right) =>
          compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id)
      );
  }

  async getLatestSnapshot(query: ProjectionListQuery): Promise<ProjectionSnapshot | null> {
    const snapshots = await this.listSnapshots(query);
    return snapshots.at(-1) ?? null;
  }

  async clear(query: ProjectionListQuery): Promise<void> {
    for (const [key, record] of this.records.entries()) {
      if (
        record.projectionName === query.projectionName &&
        scopeMatches(record.scope, query.scope)
      ) {
        this.records.delete(key);
      }
    }
    this.checkpoints.delete(checkpointKey(query));
    for (const [key, snapshot] of this.snapshots.entries()) {
      if (
        snapshot.projectionName === query.projectionName &&
        scopeMatches(snapshot.scope, query.scope)
      ) {
        this.snapshots.delete(key);
      }
    }
  }
}

function recordKey(input: {
  projectionName: string;
  id: string;
  scope?: ProjectionRecord['scope'];
}): string {
  return `${input.projectionName}:${scopeKey(input.scope)}:${input.id}`;
}

function checkpointKey(input: {
  projectionName: string;
  scope?: ProjectionCheckpoint['scope'];
}): string {
  return `${input.projectionName}:${scopeKey(input.scope)}`;
}

function snapshotKey(input: {
  projectionName: string;
  id: string;
  scope?: ProjectionSnapshot['scope'];
}): string {
  return `${input.projectionName}:${scopeKey(input.scope)}:${input.id}`;
}
