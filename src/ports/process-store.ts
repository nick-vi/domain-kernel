import type { ProcessInstance, ProcessStatus } from '@/primitives/process-manager';

export type ProcessListQuery = {
  type?: string | undefined;
  status?: ProcessStatus | undefined;
  waitingFor?: string | undefined;
};

export type ProcessTimeoutQuery = {
  now: string;
  type?: string | undefined;
};

export interface ProcessStore {
  save(process: ProcessInstance): Promise<void>;
  getById(id: string): Promise<ProcessInstance | null>;
  list(query?: ProcessListQuery): Promise<ProcessInstance[]>;
  listDueTimeouts(query: ProcessTimeoutQuery): Promise<ProcessInstance[]>;
}
