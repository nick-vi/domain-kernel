import type { AuditEvent } from '@/domain/event/audit-event';

export const ExpectedStreamRevision = Object.freeze({
  Any: 'any',
  NoStream: 'no_stream',
  StreamExists: 'stream_exists',
} as const);

export type ExpectedStreamRevision =
  | (typeof ExpectedStreamRevision)[keyof typeof ExpectedStreamRevision]
  | number;

export type AppendEventOptions = {
  expectedRevision?: ExpectedStreamRevision | undefined;
};

export type AppendEventsInput = AppendEventOptions & {
  streamId?: string | undefined;
  events: AuditEvent[];
};

export type StoredAuditEvent = AuditEvent & {
  streamId: string;
  revision: number;
};

export type EventStreamState = {
  streamId: string;
  revision: number;
  exists: boolean;
};

export type ReadEventStreamInput = {
  streamId: string;
  fromRevision?: number | undefined;
  limit?: number | undefined;
};

export interface EventStore {
  append(event: AuditEvent, options?: AppendEventOptions): Promise<StoredAuditEvent>;
  appendMany(input: AppendEventsInput): Promise<StoredAuditEvent[]>;
  readStream(input: ReadEventStreamInput): Promise<StoredAuditEvent[]>;
  getStreamState(streamId: string): Promise<EventStreamState>;
  getByWorkItemId(workItemId: string): Promise<AuditEvent[]>;
}
