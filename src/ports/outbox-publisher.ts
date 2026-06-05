import type { OutboxMessage } from '@/primitives/outbox';

export interface OutboxPublisher {
  publish(message: OutboxMessage): Promise<void>;
}
