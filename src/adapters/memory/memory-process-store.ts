import type {
  ProcessListQuery,
  ProcessStore,
  ProcessTimeoutQuery,
} from '@/ports/process-store';
import type { ProcessInstance } from '@/primitives/process-manager';
import { compareStrings } from '@/primitives/string';

export class InMemoryProcessStore implements ProcessStore {
  private readonly processes = new Map<string, ProcessInstance>();

  async save(process: ProcessInstance): Promise<void> {
    this.processes.set(process.id, structuredClone(process));
  }

  async getById(id: string): Promise<ProcessInstance | null> {
    const process = this.processes.get(id);
    return process == null ? null : structuredClone(process);
  }

  async list(query: ProcessListQuery = {}): Promise<ProcessInstance[]> {
    return sortProcesses([...this.processes.values()])
      .filter((process) => query.type == null || process.type === query.type)
      .filter((process) => query.status == null || process.status === query.status)
      .filter((process) => query.waitingFor == null || process.waitingFor === query.waitingFor)
      .map((process) => structuredClone(process));
  }

  async listDueTimeouts(query: ProcessTimeoutQuery): Promise<ProcessInstance[]> {
    return sortProcesses([...this.processes.values()])
      .filter((process) => query.type == null || process.type === query.type)
      .filter((process) =>
        process.timeouts.some(
          (timeout) => timeout.status === 'scheduled' && timeout.dueAt <= query.now
        )
      )
      .map((process) => structuredClone(process));
  }
}

function sortProcesses(processes: ProcessInstance[]): ProcessInstance[] {
  return processes.sort(
    (left, right) =>
      compareStrings(left.startedAt, right.startedAt) || compareStrings(left.id, right.id)
  );
}
