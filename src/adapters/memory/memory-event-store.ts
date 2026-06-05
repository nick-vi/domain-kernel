import {
  auditEventStreamId,
  auditEventWorkItemId,
  type AuditEvent,
} from '@/domain/event/audit-event';
import { EventStreamConflictError, ValidationError } from '@/domain/errors/domain-error';
import type { AuditEventQueryPort } from '@/ports/audit-event-query';
import type {
  AuditEventQuery,
  AuditEventSearchResult,
} from '@/domain/query/audit-event-query';
import {
  ExpectedStreamRevision,
  type AppendEventOptions,
  type AppendEventsInput,
  type EventStore,
  type EventStreamState,
  type ReadEventStreamInput,
  type StoredAuditEvent,
} from '@/ports/event-store';
import { paginate } from '@/adapters/query/query-utils';
import {
  nonNegativeIntegerOption,
  optionalPositiveIntegerOption,
} from '@/primitives/runtime-options';
import { compareStrings } from '@/primitives/string';

export class InMemoryEventStore implements EventStore, AuditEventQueryPort {
  private readonly eventsByStreamId = new Map<string, StoredAuditEvent[]>();

  async append(
    event: AuditEvent,
    options: AppendEventOptions = {}
  ): Promise<StoredAuditEvent> {
    const appended = await this.appendMany({
      streamId: auditEventStreamId(event),
      events: [event],
      ...options,
    });
    return appended[0]!;
  }

  async appendMany(input: AppendEventsInput): Promise<StoredAuditEvent[]> {
    if (input.events.length === 0) return [];

    const streamId = input.streamId ?? auditEventStreamId(input.events[0]!);
    for (const event of input.events) {
      const eventStreamId = auditEventStreamId(event);
      if (eventStreamId !== streamId) {
        throw new ValidationError('All appended events must belong to the same stream', {
          streamId,
          eventStreamId,
          eventId: event.id,
        });
      }
    }

    const current = this.eventsByStreamId.get(streamId) ?? [];
    assertExpectedRevision(streamId, current.length - 1, input.expectedRevision);
    const stored = input.events.map((event, index) => ({
      ...structuredClone(event),
      streamId,
      revision: current.length + index,
    }));
    this.eventsByStreamId.set(streamId, [...current, ...stored.map((event) => structuredClone(event))]);
    return stored.map((event) => structuredClone(event));
  }

  async readStream(input: ReadEventStreamInput): Promise<StoredAuditEvent[]> {
    const fromRevision = nonNegativeIntegerOption(
      'fromRevision',
      input.fromRevision ?? 0
    );
    const limit = optionalPositiveIntegerOption('limit', input.limit);
    const events = (this.eventsByStreamId.get(input.streamId) ?? [])
      .filter((event) => event.revision >= fromRevision)
      .sort((a, b) => a.revision - b.revision);
    return events.slice(0, limit ?? events.length).map((event) => structuredClone(event));
  }

  async getStreamState(streamId: string): Promise<EventStreamState> {
    const events = this.eventsByStreamId.get(streamId) ?? [];
    return {
      streamId,
      revision: events.length - 1,
      exists: events.length > 0,
    };
  }

  async getByWorkItemId(workItemId: string): Promise<AuditEvent[]> {
    return (this.eventsByStreamId.get(workItemId) ?? [])
      .map((event) => structuredClone(event))
      .sort(
        (left, right) =>
          compareStrings(left.occurredAt, right.occurredAt) ||
          compareStrings(left.id, right.id)
      )
      .map((event) => toAuditEvent(event));
  }

  async search(query: AuditEventQuery): Promise<AuditEventSearchResult> {
    const events = [...this.eventsByStreamId.values()]
      .flat()
      .map((event) => structuredClone(event))
      .filter((event) => query.workItemId == null || auditEventWorkItemId(event) === query.workItemId)
      .filter((event) => query.type == null || event.type === query.type)
      .filter((event) => query.actorId == null || event.actorId === query.actorId)
      .filter((event) => query.occurredAfter == null || event.occurredAt >= query.occurredAfter)
      .filter((event) => query.occurredBefore == null || event.occurredAt <= query.occurredBefore)
      .sort((a, b) => compareAuditEvents(a, b, query.sort ?? 'occurred_at_asc'))
      .map((event) => toAuditEvent(event));

    const result = paginate(events, query);
    return {
      events: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }
}

function toAuditEvent(stored: StoredAuditEvent): AuditEvent {
  const { streamId: _streamId, revision: _revision, ...event } = stored;
  return event;
}

function compareAuditEvents(
  left: AuditEvent,
  right: AuditEvent,
  sort: NonNullable<AuditEventQuery['sort']>
): number {
  switch (sort) {
    case 'occurred_at_desc':
      return (
        compareStrings(right.occurredAt, left.occurredAt) ||
        compareStrings(right.id, left.id)
      );
    case 'occurred_at_asc':
      return (
        compareStrings(left.occurredAt, right.occurredAt) ||
        compareStrings(left.id, right.id)
      );
  }
}

function assertExpectedRevision(
  streamId: string,
  currentRevision: number,
  expectedRevision: ExpectedStreamRevision = ExpectedStreamRevision.Any
): void {
  const exists = currentRevision >= 0;
  if (expectedRevision === ExpectedStreamRevision.Any) return;
  if (expectedRevision === ExpectedStreamRevision.NoStream && !exists) return;
  if (expectedRevision === ExpectedStreamRevision.StreamExists && exists) return;
  if (typeof expectedRevision === 'number' && currentRevision === expectedRevision) return;

  throw new EventStreamConflictError('Event stream revision conflict', {
    streamId,
    expectedRevision,
    currentRevision,
  });
}
