export type CommandEnvelope<TPayload = unknown, TMetadata extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  type: string;
  payload: TPayload;
  occurredAt: string;
  actorId?: string | undefined;
  idempotencyKey?: string | undefined;
  correlationId?: string | undefined;
  causationId?: string | undefined;
  metadata?: TMetadata | undefined;
};

export type CommandInput<TPayload, TMetadata extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  type: string;
  payload: TPayload;
  occurredAt: string;
  actorId?: string | undefined;
  idempotencyKey?: string | undefined;
  correlationId?: string | undefined;
  causationId?: string | undefined;
  metadata?: TMetadata | undefined;
};

export function command<TPayload, TMetadata extends Record<string, unknown> = Record<string, unknown>>(
  input: CommandInput<TPayload, TMetadata>
): CommandEnvelope<TPayload, TMetadata> {
  return {
    id: input.id,
    type: input.type,
    payload: input.payload,
    occurredAt: input.occurredAt,
    ...(input.actorId != null ? { actorId: input.actorId } : {}),
    ...(input.idempotencyKey != null ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.correlationId != null ? { correlationId: input.correlationId } : {}),
    ...(input.causationId != null ? { causationId: input.causationId } : {}),
    ...(input.metadata != null ? { metadata: input.metadata } : {}),
  };
}

export function commandCausedBy<TPayload, TMetadata extends Record<string, unknown>>(
  input: CommandInput<TPayload, TMetadata>,
  parent: { id: string; correlationId?: string | undefined }
): CommandEnvelope<TPayload, TMetadata> {
  return command({
    ...input,
    causationId: input.causationId ?? parent.id,
    correlationId: input.correlationId ?? parent.correlationId ?? parent.id,
  });
}
