import type { SyncCheckpointListQuery, SyncStateRepository } from '@/ports/sync-state-repository';
import type { Clock } from '@/ports/clock';
import type { SleepFunction } from '@/primitives/timing';
import { scopeKey, scopeMatches } from '@/primitives/scope';
import { compareStrings } from '@/primitives/string';
import { externalReferenceKey, type ExternalReference, type SyncCheckpoint } from '@/primitives/sync';
import { ExternalReferenceSchema, SyncCheckpointSchema } from '@/validation/schemas';
import {
  filenameForId,
  listFilesRecursive,
  pathExists,
  readJson,
  safeJoin,
  type FileTempNames,
  withFileLock,
  writeJsonAtomic,
} from './fs-utils';

export class FsSyncStateRepository implements SyncStateRepository {
  private readonly checkpointsRoot: string;
  private readonly refsRoot: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly sleep: SleepFunction,
    private readonly tempNames: FileTempNames
  ) {
    this.checkpointsRoot = safeJoin(dataDir, 'sync', 'checkpoints');
    this.refsRoot = safeJoin(dataDir, 'sync', 'external-refs');
  }

  async saveCheckpoint(checkpoint: SyncCheckpoint): Promise<void> {
    const path = this.checkpointPath(checkpoint.id);
    await withFileLock(path, async () => {
      await writeJsonAtomic(path, checkpoint, this.tempNames);
    }, { clock: this.clock, sleep: this.sleep });
  }

  async getCheckpoint(id: string): Promise<SyncCheckpoint | null> {
    const path = this.checkpointPath(id);
    if (!(await pathExists(path))) return null;
    return readJson<SyncCheckpoint>(path, SyncCheckpointSchema);
  }

  async listCheckpoints(query: SyncCheckpointListQuery = {}): Promise<SyncCheckpoint[]> {
    const files = await listFilesRecursive(this.checkpointsRoot);
    const checkpoints = await Promise.all(
      files.map((file) => readJson<SyncCheckpoint>(file, SyncCheckpointSchema))
    );
    return checkpoints
      .filter((checkpoint) => query.source == null || checkpoint.source === query.source)
      .filter((checkpoint) => query.stream == null || checkpoint.stream === query.stream)
      .filter((checkpoint) => query.status == null || checkpoint.status === query.status)
      .filter((checkpoint) => query.scope == null || scopeMatches(checkpoint.scope, query.scope))
      .sort(
        (left, right) =>
          compareStrings(left.updatedAt, right.updatedAt) || compareStrings(left.id, right.id)
      );
  }

  async saveExternalReference(reference: ExternalReference): Promise<void> {
    const path = this.externalReferencePath(reference);
    await withFileLock(path, async () => {
      await writeJsonAtomic(path, reference, this.tempNames);
    }, { clock: this.clock, sleep: this.sleep });
  }

  async getExternalReference(input: {
    system: string;
    entityType: string;
    externalId: string;
    scope?: ExternalReference['scope'];
  }): Promise<ExternalReference | null> {
    const path = this.externalReferencePath(input);
    if (!(await pathExists(path))) return null;
    return readJson<ExternalReference>(path, ExternalReferenceSchema);
  }

  private checkpointPath(id: string): string {
    return safeJoin(this.checkpointsRoot, filenameForId(id));
  }

  private externalReferencePath(input: {
    system: string;
    entityType: string;
    externalId: string;
    scope?: ExternalReference['scope'];
  }): string {
    return safeJoin(
      this.refsRoot,
      filenameForId(`${scopeKey(input.scope)}:${externalReferenceKey(input)}`)
    );
  }
}
