import type { SyncCheckpointListQuery, SyncStateRepository } from '@/ports/sync-state-repository';
import { scopeKey, scopeMatches } from '@/primitives/scope';
import { compareStrings } from '@/primitives/string';
import { externalReferenceKey, type ExternalReference, type SyncCheckpoint } from '@/primitives/sync';

export class InMemorySyncStateRepository implements SyncStateRepository {
  private readonly checkpoints = new Map<string, SyncCheckpoint>();
  private readonly externalReferences = new Map<string, ExternalReference>();

  async saveCheckpoint(checkpoint: SyncCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.id, structuredClone(checkpoint));
  }

  async getCheckpoint(id: string): Promise<SyncCheckpoint | null> {
    const checkpoint = this.checkpoints.get(id);
    return checkpoint == null ? null : structuredClone(checkpoint);
  }

  async listCheckpoints(query: SyncCheckpointListQuery = {}): Promise<SyncCheckpoint[]> {
    return [...this.checkpoints.values()]
      .filter((checkpoint) => query.source == null || checkpoint.source === query.source)
      .filter((checkpoint) => query.stream == null || checkpoint.stream === query.stream)
      .filter((checkpoint) => query.status == null || checkpoint.status === query.status)
      .filter((checkpoint) => query.scope == null || scopeMatches(checkpoint.scope, query.scope))
      .map((checkpoint) => structuredClone(checkpoint))
      .sort(
        (left, right) =>
          compareStrings(left.updatedAt, right.updatedAt) || compareStrings(left.id, right.id)
      );
  }

  async saveExternalReference(reference: ExternalReference): Promise<void> {
    this.externalReferences.set(referenceStorageKey(reference), structuredClone(reference));
  }

  async getExternalReference(input: {
    system: string;
    entityType: string;
    externalId: string;
    scope?: ExternalReference['scope'];
  }): Promise<ExternalReference | null> {
    const reference = this.externalReferences.get(referenceStorageKey(input));
    return reference == null ? null : structuredClone(reference);
  }
}

function referenceStorageKey(input: {
  system: string;
  entityType: string;
  externalId: string;
  scope?: ExternalReference['scope'];
}): string {
  return `${scopeKey(input.scope)}:${externalReferenceKey(input)}`;
}
