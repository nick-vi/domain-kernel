import type { ProjectionListQuery, ProjectionStore } from '@/ports/projection-store';
import type { Clock } from '@/ports/clock';
import type { SleepFunction } from '@/primitives/timing';
import type {
  ProjectionCheckpoint,
  ProjectionRecord,
  ProjectionSnapshot,
} from '@/primitives/projection';
import { scopeKey, scopeMatches } from '@/primitives/scope';
import { compareStrings } from '@/primitives/string';
import {
  ProjectionCheckpointSchema,
  ProjectionRecordSchema,
  ProjectionSnapshotSchema,
} from '@/validation/schemas';
import {
  filenameForId,
  listFilesRecursive,
  pathExists,
  readJson,
  removePath,
  safeJoin,
  type FileTempNames,
  withFileLock,
  writeJsonAtomic,
} from './fs-utils';

export class FsProjectionStore implements ProjectionStore {
  private readonly recordsRoot: string;
  private readonly checkpointsRoot: string;
  private readonly snapshotsRoot: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly sleep: SleepFunction,
    private readonly tempNames: FileTempNames
  ) {
    this.recordsRoot = safeJoin(dataDir, 'projections', 'records');
    this.checkpointsRoot = safeJoin(dataDir, 'projections', 'checkpoints');
    this.snapshotsRoot = safeJoin(dataDir, 'projections', 'snapshots');
  }

  async save(record: ProjectionRecord): Promise<void> {
    const path = this.recordPath(record);
    await withFileLock(path, async () => {
      await writeJsonAtomic(path, record, this.tempNames);
    }, { clock: this.clock, sleep: this.sleep });
  }

  async get(input: {
    projectionName: string;
    id: string;
    scope?: ProjectionRecord['scope'];
  }): Promise<ProjectionRecord | null> {
    const path = this.recordPath(input);
    if (!(await pathExists(path))) return null;
    return readJson<ProjectionRecord>(path, ProjectionRecordSchema);
  }

  async list(query: ProjectionListQuery): Promise<ProjectionRecord[]> {
    const files = await listFilesRecursive(this.recordsRoot);
    const records = await Promise.all(
      files.map((file) => readJson<ProjectionRecord>(file, ProjectionRecordSchema))
    );
    return records
      .filter((record) => record.projectionName === query.projectionName)
      .filter((record) => query.scope == null || scopeMatches(record.scope, query.scope))
      .sort((left, right) => compareStrings(left.id, right.id));
  }

  async saveCheckpoint(checkpoint: ProjectionCheckpoint): Promise<void> {
    const path = this.checkpointPath(checkpoint);
    await withFileLock(path, async () => {
      await writeJsonAtomic(path, checkpoint, this.tempNames);
    }, { clock: this.clock, sleep: this.sleep });
  }

  async getCheckpoint(input: {
    projectionName: string;
    scope?: ProjectionCheckpoint['scope'];
  }): Promise<ProjectionCheckpoint | null> {
    const path = this.checkpointPath(input);
    if (!(await pathExists(path))) return null;
    return readJson<ProjectionCheckpoint>(path, ProjectionCheckpointSchema);
  }

  async saveSnapshot(snapshot: ProjectionSnapshot): Promise<void> {
    const path = this.snapshotPath(snapshot);
    await withFileLock(path, async () => {
      await writeJsonAtomic(path, snapshot, this.tempNames);
    }, { clock: this.clock, sleep: this.sleep });
  }

  async listSnapshots(query: ProjectionListQuery): Promise<ProjectionSnapshot[]> {
    const files = await listFilesRecursive(this.snapshotsRoot);
    const snapshots = await Promise.all(
      files.map((file) => readJson<ProjectionSnapshot>(file, ProjectionSnapshotSchema))
    );
    return snapshots
      .filter((snapshot) => snapshot.projectionName === query.projectionName)
      .filter((snapshot) => query.scope == null || scopeMatches(snapshot.scope, query.scope))
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
    const records = await this.list(query);
    await Promise.all(records.map((record) => removePath(this.recordPath(record))));
    await removePath(this.checkpointPath(query));
    const snapshots = await this.listSnapshots(query);
    await Promise.all(snapshots.map((snapshot) => removePath(this.snapshotPath(snapshot))));
  }

  private recordPath(input: {
    projectionName: string;
    id: string;
    scope?: ProjectionRecord['scope'];
  }): string {
    return safeJoin(
      this.recordsRoot,
      filenameForId(`${input.projectionName}:${scopeKey(input.scope)}:${input.id}`)
    );
  }

  private checkpointPath(input: {
    projectionName: string;
    scope?: ProjectionCheckpoint['scope'];
  }): string {
    return safeJoin(
      this.checkpointsRoot,
      filenameForId(`${input.projectionName}:${scopeKey(input.scope)}`)
    );
  }

  private snapshotPath(input: {
    projectionName: string;
    id: string;
    scope?: ProjectionSnapshot['scope'];
  }): string {
    return safeJoin(
      this.snapshotsRoot,
      filenameForId(`${input.projectionName}:${scopeKey(input.scope)}:${input.id}`)
    );
  }
}
