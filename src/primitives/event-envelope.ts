export type EventEnvelope<TData = unknown, TMetadata extends Record<string, unknown> = Record<string, unknown>> = {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  time: string;
  subject?: string | undefined;
  datacontenttype?: string | undefined;
  dataschema?: string | undefined;
  data?: TData | undefined;
  actorId?: string | undefined;
  correlationId?: string | undefined;
  causationId?: string | undefined;
  metadata?: TMetadata | undefined;
};

export type EventInput<TData, TMetadata extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  source: string;
  type: string;
  time: string;
  subject?: string | undefined;
  datacontenttype?: string | undefined;
  dataschema?: string | undefined;
  data?: TData | undefined;
  actorId?: string | undefined;
  correlationId?: string | undefined;
  causationId?: string | undefined;
  metadata?: TMetadata | undefined;
};

export function eventEnvelope<TData = unknown, TMetadata extends Record<string, unknown> = Record<string, unknown>>(
  input: EventInput<TData, TMetadata>
): EventEnvelope<TData, TMetadata> {
  return {
    specversion: '1.0',
    id: input.id,
    source: input.source,
    type: input.type,
    time: input.time,
    ...(input.subject != null ? { subject: input.subject } : {}),
    ...(input.datacontenttype != null ? { datacontenttype: input.datacontenttype } : {}),
    ...(input.dataschema != null ? { dataschema: input.dataschema } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
    ...(input.actorId != null ? { actorId: input.actorId } : {}),
    ...(input.correlationId != null ? { correlationId: input.correlationId } : {}),
    ...(input.causationId != null ? { causationId: input.causationId } : {}),
    ...(input.metadata != null ? { metadata: input.metadata } : {}),
  };
}

export function eventCausedBy<TData, TMetadata extends Record<string, unknown>>(
  input: EventInput<TData, TMetadata>,
  cause: { id: string; correlationId?: string | undefined; actorId?: string | undefined }
): EventEnvelope<TData, TMetadata> {
  return eventEnvelope({
    ...input,
    actorId: input.actorId ?? cause.actorId,
    causationId: input.causationId ?? cause.id,
    correlationId: input.correlationId ?? cause.correlationId ?? cause.id,
  });
}
