import type { OutboxMessage, OutboxStatus } from '@/primitives/outbox';

export type OutboxListQuery = {
  status?: OutboxStatus | undefined;
};

export interface OutboxRepository {
  save(message: OutboxMessage): Promise<void>;
  getById(id: string): Promise<OutboxMessage | null>;
  list(query?: OutboxListQuery): Promise<OutboxMessage[]>;
  claimDue(input: { now: string; limit?: number | undefined }): Promise<OutboxMessage[]>;
}
