import type { Scope } from '@/primitives/scope';
import type {
  ProjectionCheckpoint,
  ProjectionRecord,
  ProjectionSnapshot,
} from '@/primitives/projection';

export type ProjectionListQuery = {
  projectionName: string;
  scope?: Scope | undefined;
};

export interface ProjectionStore {
  save(record: ProjectionRecord): Promise<void>;
  get(input: {
    projectionName: string;
    id: string;
    scope?: Scope | undefined;
  }): Promise<ProjectionRecord | null>;
  list(query: ProjectionListQuery): Promise<ProjectionRecord[]>;
  saveCheckpoint(checkpoint: ProjectionCheckpoint): Promise<void>;
  getCheckpoint(input: {
    projectionName: string;
    scope?: Scope | undefined;
  }): Promise<ProjectionCheckpoint | null>;
  saveSnapshot(snapshot: ProjectionSnapshot): Promise<void>;
  listSnapshots(query: ProjectionListQuery): Promise<ProjectionSnapshot[]>;
  getLatestSnapshot(query: ProjectionListQuery): Promise<ProjectionSnapshot | null>;
  clear(query: ProjectionListQuery): Promise<void>;
}
