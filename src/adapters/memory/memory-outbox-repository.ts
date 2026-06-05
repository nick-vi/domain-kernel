import type { OutboxListQuery, OutboxRepository } from '@/ports/outbox-repository';
import {
  markOutboxPublishing,
  outboxMessageIsDue,
  type OutboxMessage,
} from '@/primitives/outbox';
import { optionalPositiveIntegerOption } from '@/primitives/runtime-options';
import { compareStrings } from '@/primitives/string';

export class InMemoryOutboxRepository implements OutboxRepository {
  private readonly messages = new Map<string, OutboxMessage>();

  async save(message: OutboxMessage): Promise<void> {
    this.messages.set(message.id, structuredClone(message));
  }

  async getById(id: string): Promise<OutboxMessage | null> {
    const message = this.messages.get(id);
    return message == null ? null : structuredClone(message);
  }

  async list(query: OutboxListQuery = {}): Promise<OutboxMessage[]> {
    return [...this.messages.values()]
      .filter((message) => query.status == null || message.status === query.status)
      .map((message) => structuredClone(message))
      .sort(
        (left, right) =>
          compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id)
      );
  }

  async claimDue(input: { now: string; limit?: number | undefined }): Promise<OutboxMessage[]> {
    const limit = optionalPositiveIntegerOption('limit', input.limit);
    const candidates = [...this.messages.values()]
      .filter((message) => outboxMessageIsDue(message, input.now))
      .sort(
        (left, right) =>
          compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id)
      );
    const due = candidates
      .slice(0, limit ?? candidates.length)
      .map((message) => markOutboxPublishing(message, input.now));

    for (const message of due) {
      this.messages.set(message.id, structuredClone(message));
    }

    return due.map((message) => structuredClone(message));
  }
}
