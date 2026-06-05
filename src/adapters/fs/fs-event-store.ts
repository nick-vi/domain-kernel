import {
  auditEventStreamId,
  type AuditEvent,
} from '@/domain/event/audit-event';
import { EventStreamConflictError, ValidationError } from '@/domain/errors/domain-error';
import type { AuditEventQueryPort } from '@/ports/audit-event-query';
import type {
  AuditEventQuery,
  AuditEventSearchResult,
} from '@/domain/query/audit-event-query';
import type { Clock } from '@/ports/clock';
import {
  ExpectedStreamRevision,
  type AppendEventOptions,
  type AppendEventsInput,
  type EventStore,
  type EventStreamState,
  type ReadEventStreamInput,
  type StoredAuditEvent,
} from '@/ports/event-store';
import type { SleepFunction } from '@/primitives/timing';
import {
  nonNegativeIntegerOption,
  optionalPositiveIntegerOption,
} from '@/primitives/runtime-options';
import { compareStrings } from '@/primitives/string';
import { AuditEventSchema, StoredAuditEventSchema } from '@/validation/schemas';
import { paginate } from '@/adapters/query/query-utils';
import {
  appendJsonlBatchUnlocked,
  jsonlFilenameForId,
  listFilesRecursive,
  readJsonl,
  safeJoin,
  withFileLock,
} from './fs-utils';

export class FsEventStore implements EventStore, AuditEventQueryPort {
  private readonly root: string;

  constructor(dataDir: string, private readonly clock: Clock, private readonly sleep: SleepFunction) {
    this.root = safeJoin(dataDir, 'events');
  }

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

    const path = this.pathFor(streamId);
    return withFileLock(path, async () => {
      const current = await readStoredEvents(path, streamId);
      assertExpectedRevision(streamId, current.length - 1, input.expectedRevision);
      const stored = input.events.map((event, index) => ({
        ...event,
        streamId,
        revision: current.length + index,
      }));
      await appendJsonlBatchUnlocked(path, stored);
      return stored;
    }, { clock: this.clock, sleep: this.sleep });
  }

  async readStream(input: ReadEventStreamInput): Promise<StoredAuditEvent[]> {
    const events = await readStoredEvents(this.pathFor(input.streamId), input.streamId);
    const fromRevision = nonNegativeIntegerOption(
      'fromRevision',
      input.fromRevision ?? 0
    );
    const limit = optionalPositiveIntegerOption('limit', input.limit);
    return events
      .filter((event) => event.revision >= fromRevision)
      .sort((a, b) => a.revision - b.revision)
      .slice(0, limit ?? events.length);
  }

  async getStreamState(streamId: string): Promise<EventStreamState> {
    const events = await readStoredEvents(this.pathFor(streamId), streamId);
    return {
      streamId,
      revision: events.length - 1,
      exists: events.length > 0,
    };
  }

  async getByWorkItemId(workItemId: string): Promise<AuditEvent[]> {
    const events = await readStoredEvents(this.pathFor(workItemId), workItemId);
    return events
      .sort(
        (left, right) =>
          compareStrings(left.occurredAt, right.occurredAt) ||
          compareStrings(left.id, right.id)
      )
      .map((event) => toAuditEvent(event));
  }

  async search(query: AuditEventQuery): Promise<AuditEventSearchResult> {
    const events = (await this.loadEvents(query.workItemId))
      .filter((event) => query.type == null || event.type === query.type)
      .filter((event) => query.actorId == null || event.actorId === query.actorId)
      .filter((event) => query.occurredAfter == null || event.occurredAt >= query.occurredAfter)
      .filter((event) => query.occurredBefore == null || event.occurredAt <= query.occurredBefore)
      .sort((a, b) => compareAuditEvents(a, b, query.sort ?? 'occurred_at_asc'));

    const result = paginate(events, query);
    return {
      events: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  private pathFor(streamId: string): string {
    return safeJoin(this.root, jsonlFilenameForId(streamId));
  }

  private async loadEvents(workItemId?: string): Promise<AuditEvent[]> {
    if (workItemId != null) {
      return this.getByWorkItemId(workItemId);
    }

    const files = await listFilesRecursive(this.root);
    const events = await Promise.all(files.map((file) => readStoredEvents(file)));
    return events.flat().map((event) => toAuditEvent(event));
  }
}

async function readStoredEvents(
  path: string,
  streamId?: string | undefined
): Promise<StoredAuditEvent[]> {
  const values = await readJsonl<unknown>(path);
  return values.map((value, index) => {
    const stored = StoredAuditEventSchema.safeParse(value);
    if (stored.success) return stored.data;

    const raw = AuditEventSchema.safeParse(value);
    if (raw.success) {
      const eventStreamId = streamId ?? auditEventStreamId(raw.data);
      return {
        ...raw.data,
        streamId: eventStreamId,
        revision: index,
      };
    }

    throw stored.error;
  });
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
