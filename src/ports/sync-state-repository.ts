import type { Scope } from '@/primitives/scope';
import type { ExternalReference, SyncCheckpoint, SyncCheckpointStatus } from '@/primitives/sync';

export type SyncCheckpointListQuery = {
  source?: string | undefined;
  stream?: string | undefined;
  scope?: Scope | undefined;
  status?: SyncCheckpointStatus | undefined;
};

export interface SyncStateRepository {
  saveCheckpoint(checkpoint: SyncCheckpoint): Promise<void>;
  getCheckpoint(id: string): Promise<SyncCheckpoint | null>;
  listCheckpoints(query?: SyncCheckpointListQuery): Promise<SyncCheckpoint[]>;
  saveExternalReference(reference: ExternalReference): Promise<void>;
  getExternalReference(input: {
    system: string;
    entityType: string;
    externalId: string;
    scope?: Scope | undefined;
  }): Promise<ExternalReference | null>;
}
