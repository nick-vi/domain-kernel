import { z } from 'zod';
import type { AuditEvent } from '@/domain/event/audit-event';
import type { CommandIdempotencyRecord } from '@/ports/command-idempotency-store';
import type { StoredAuditEvent } from '@/ports/event-store';
import type { IntegrationAttempt } from '@/domain/integration/integration-attempt';
import type {
  AppliedPackageMigration,
  DomainPackage,
  FieldSchema,
} from '@/domain/package/domain-package';
import type { Resource, ResourceReservation } from '@/domain/resource/resource';
import type { JsonObject, JsonValue } from '@/domain/shared';
import type { WorkItem } from '@/domain/work-item/work-item';
import type { OutboxMessage } from '@/primitives/outbox';
import type { HealthCheckResult } from '@/primitives/health';
import { isIsoTimestamp } from '@/primitives/time';
import type { MetricExemplar, MetricMeasurement } from '@/primitives/metrics';
import type {
  ProcessInstance,
  ProcessJsonObject,
  ProcessJsonValue,
} from '@/primitives/process-manager';
import type {
  ProjectionCheckpoint,
  ProjectionRecord,
  ProjectionSnapshot,
} from '@/primitives/projection';
import type { Scope } from '@/primitives/scope';
import type { ExternalReference, SyncCheckpoint } from '@/primitives/sync';
import type {
  TelemetryAttributes,
  TelemetryAttributeValue,
  TelemetryResource,
} from '@/primitives/telemetry-resource';
import type {
  NormalizedWorkflowDefinition,
  WorkflowDefinition,
} from '@/domain/workflow/workflow-definition';

export const NonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'Required non-empty string',
});

export const IsoTimestampSchema = z.string().refine(isIsoTimestamp, {
  message: 'Expected canonical UTC ISO timestamp',
});

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), JsonValueSchema);
export const SemverSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);

export const ScopeSchema: z.ZodType<Scope> = z
  .object({
    tenantId: NonEmptyStringSchema.optional(),
    workspaceId: NonEmptyStringSchema.optional(),
    environment: NonEmptyStringSchema.optional(),
    partition: NonEmptyStringSchema.optional(),
  })
  .strict();

export const TransitionDefinitionSchema = z
  .object({
    action: NonEmptyStringSchema,
    from: NonEmptyStringSchema,
    to: NonEmptyStringSchema,
    requires: z.array(NonEmptyStringSchema).optional(),
  })
  .strict();

export const WorkflowDefinitionSchema: z.ZodType<WorkflowDefinition> = z
  .object({
    type: NonEmptyStringSchema,
    initialState: NonEmptyStringSchema.optional(),
    states: z.array(NonEmptyStringSchema).min(1),
    transitions: z.array(TransitionDefinitionSchema),
    closedStates: z.array(NonEmptyStringSchema).optional(),
  })
  .strict();

export const NormalizedWorkflowDefinitionSchema: z.ZodType<NormalizedWorkflowDefinition> = z
  .object({
    type: NonEmptyStringSchema,
    initialState: NonEmptyStringSchema,
    states: z.array(NonEmptyStringSchema).min(1),
    transitions: z.array(TransitionDefinitionSchema),
    closedStates: z.array(NonEmptyStringSchema),
  })
  .strict();

export const ResourceRefSchema = z
  .object({
    type: NonEmptyStringSchema,
    id: NonEmptyStringSchema,
    label: z.string().optional(),
  })
  .strict();

export const DecisionSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    actorId: NonEmptyStringSchema,
    occurredAt: IsoTimestampSchema,
  })
  .strict();

export const CommentSchema = z
  .object({
    id: NonEmptyStringSchema,
    text: NonEmptyStringSchema,
    actorId: NonEmptyStringSchema,
    occurredAt: IsoTimestampSchema,
  })
  .strict();

export const WorkItemSchema: z.ZodType<WorkItem> = z
  .object({
    id: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    status: NonEmptyStringSchema,
    fields: JsonObjectSchema,
    resources: z.array(ResourceRefSchema),
    decisions: z.array(DecisionSchema),
    comments: z.array(CommentSchema),
    assigneeId: NonEmptyStringSchema.optional(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    closedAt: IsoTimestampSchema.optional(),
    version: z.number().int().positive(),
  })
  .strict();

const AuditEventBaseSchema = {
  id: NonEmptyStringSchema,
  actorId: NonEmptyStringSchema,
  occurredAt: IsoTimestampSchema,
};

const WorkItemAuditEventBaseSchema = {
  ...AuditEventBaseSchema,
  workItemId: NonEmptyStringSchema,
};

const VersionedMutationEventSchema = {
  previousVersion: z.number().int().positive(),
  nextVersion: z.number().int().positive(),
};

export const AuditEventSchema: z.ZodType<AuditEvent> = z.discriminatedUnion('type', [
  z
    .object({
      ...WorkItemAuditEventBaseSchema,
      type: z.literal('WorkItemCreated'),
      workItemType: NonEmptyStringSchema,
      state: NonEmptyStringSchema,
      fields: JsonObjectSchema,
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...WorkItemAuditEventBaseSchema,
      ...VersionedMutationEventSchema,
      type: z.literal('WorkItemFieldsUpdated'),
      fields: JsonObjectSchema,
      previousFields: JsonObjectSchema,
    })
    .strict(),
  z
    .object({
      ...WorkItemAuditEventBaseSchema,
      ...VersionedMutationEventSchema,
      type: z.literal('WorkItemTransitioned'),
      action: NonEmptyStringSchema,
      from: NonEmptyStringSchema,
      to: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      ...WorkItemAuditEventBaseSchema,
      ...VersionedMutationEventSchema,
      type: z.literal('WorkItemAssigned'),
      assigneeId: NonEmptyStringSchema,
      previousAssigneeId: NonEmptyStringSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...WorkItemAuditEventBaseSchema,
      ...VersionedMutationEventSchema,
      type: z.literal('DecisionAdded'),
      decisionId: NonEmptyStringSchema,
      decisionType: NonEmptyStringSchema,
      reason: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      ...WorkItemAuditEventBaseSchema,
      ...VersionedMutationEventSchema,
      type: z.literal('CommentAdded'),
      commentId: NonEmptyStringSchema,
      text: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      ...AuditEventBaseSchema,
      type: z.literal('ResourceCreated'),
      resourceId: NonEmptyStringSchema,
      resourceType: NonEmptyStringSchema,
      fields: JsonObjectSchema,
    })
    .strict(),
  z
    .object({
      ...WorkItemAuditEventBaseSchema,
      type: z.literal('ResourceReserved'),
      resourceId: NonEmptyStringSchema,
      resourceType: NonEmptyStringSchema,
      reservationId: NonEmptyStringSchema,
      quantity: z.number().positive().optional(),
    })
    .strict(),
  z
    .object({
      ...WorkItemAuditEventBaseSchema,
      type: z.literal('ResourceReservationReleased'),
      resourceId: NonEmptyStringSchema,
      resourceType: NonEmptyStringSchema,
      reservationId: NonEmptyStringSchema,
      quantity: z.number().positive().optional(),
    })
    .strict(),
]);

export const StoredAuditEventSchema: z.ZodType<StoredAuditEvent> = AuditEventSchema.and(
  z
    .object({
      streamId: NonEmptyStringSchema,
      revision: z.number().int().nonnegative(),
    })
    .strict()
);

export const ResourceSchema: z.ZodType<Resource> = z
  .object({
    id: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    fields: JsonObjectSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    version: z.number().int().positive(),
  })
  .strict();

export const ResourceReservationSchema: z.ZodType<ResourceReservation> = z
  .object({
    id: NonEmptyStringSchema,
    resourceId: NonEmptyStringSchema,
    resourceType: NonEmptyStringSchema,
    workItemId: NonEmptyStringSchema,
    quantity: z.number().positive().optional(),
    fields: JsonObjectSchema,
    status: z.enum(['active', 'released']),
    createdAt: IsoTimestampSchema,
    releasedAt: IsoTimestampSchema.optional(),
  })
  .strict();

export const IntegrationAttemptSchema: z.ZodType<IntegrationAttempt> = z
  .object({
    id: NonEmptyStringSchema,
    provider: NonEmptyStringSchema,
    operation: NonEmptyStringSchema,
    idempotencyKey: NonEmptyStringSchema,
    status: z.enum(['pending', 'succeeded', 'failed', 'skipped']),
    eventId: NonEmptyStringSchema.optional(),
    workItemId: NonEmptyStringSchema.optional(),
    resourceId: NonEmptyStringSchema.optional(),
    externalId: NonEmptyStringSchema.optional(),
    requestHash: NonEmptyStringSchema.optional(),
    errorCode: NonEmptyStringSchema.optional(),
    errorMessage: NonEmptyStringSchema.optional(),
    attemptCount: z.number().int().nonnegative(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();

export const EventEnvelopeSchema = z
  .object({
    specversion: z.literal('1.0'),
    id: NonEmptyStringSchema,
    source: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    time: IsoTimestampSchema,
    subject: z.string().optional(),
    datacontenttype: z.string().optional(),
    dataschema: z.string().optional(),
    data: JsonValueSchema.optional(),
    actorId: NonEmptyStringSchema.optional(),
    correlationId: NonEmptyStringSchema.optional(),
    causationId: NonEmptyStringSchema.optional(),
    metadata: z.record(z.string(), JsonValueSchema).optional(),
  })
  .strict();

export const OutboxMessageSchema: z.ZodType<OutboxMessage> = z
  .object({
    id: NonEmptyStringSchema,
    event: EventEnvelopeSchema,
    status: z.enum(['pending', 'publishing', 'published', 'failed', 'dead']),
    attempts: z.number().int().nonnegative(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    availableAt: IsoTimestampSchema,
    publishedAt: IsoTimestampSchema.optional(),
    lastError: z.string().optional(),
  })
  .strict();

export const SyncCheckpointSchema: z.ZodType<SyncCheckpoint> = z
  .object({
    id: NonEmptyStringSchema,
    source: NonEmptyStringSchema,
    stream: NonEmptyStringSchema,
    scope: ScopeSchema.optional(),
    cursor: z.string().optional(),
    highWatermark: z.string().optional(),
    status: z.enum(['active', 'stale', 'failed']),
    updatedAt: IsoTimestampSchema,
    lastError: z.string().optional(),
  })
  .strict();

export const ExternalReferenceSchema: z.ZodType<ExternalReference> = z
  .object({
    system: NonEmptyStringSchema,
    entityType: NonEmptyStringSchema,
    externalId: NonEmptyStringSchema,
    localId: NonEmptyStringSchema,
    scope: ScopeSchema.optional(),
    checksum: z.string().optional(),
    seenAt: IsoTimestampSchema,
  })
  .strict();

export const ProjectionRecordSchema: z.ZodType<ProjectionRecord> = z
  .object({
    projectionName: NonEmptyStringSchema,
    id: NonEmptyStringSchema,
    scope: ScopeSchema.optional(),
    value: JsonObjectSchema,
    version: z.number().int().positive(),
    updatedAt: IsoTimestampSchema,
  })
  .strict();

export const ProjectionCheckpointSchema: z.ZodType<ProjectionCheckpoint> = z
  .object({
    projectionName: NonEmptyStringSchema,
    scope: ScopeSchema.optional(),
    cursor: z.string().optional(),
    sequence: z.number().int().nonnegative().optional(),
    updatedAt: IsoTimestampSchema,
  })
  .strict();

export const ProjectionSnapshotSchema: z.ZodType<ProjectionSnapshot> = z
  .object({
    id: NonEmptyStringSchema,
    projectionName: NonEmptyStringSchema,
    scope: ScopeSchema.optional(),
    checkpoint: ProjectionCheckpointSchema.optional(),
    records: z.array(ProjectionRecordSchema),
    recordCount: z.number().int().nonnegative(),
    createdAt: IsoTimestampSchema,
  })
  .strict()
  .refine((snapshot) => snapshot.recordCount === snapshot.records.length, {
    message: 'Projection snapshot recordCount must match records length',
    path: ['recordCount'],
  });

export const ProcessJsonValueSchema: z.ZodType<ProcessJsonValue> =
  JsonValueSchema as z.ZodType<ProcessJsonValue>;

export const ProcessJsonObjectSchema: z.ZodType<ProcessJsonObject> =
  JsonObjectSchema as z.ZodType<ProcessJsonObject>;

export const ProcessStepSchema = z
  .object({
    name: NonEmptyStringSchema,
    status: z.enum(['pending', 'running', 'waiting', 'completed', 'failed', 'compensated', 'skipped']),
    attempts: z.number().int().nonnegative(),
    startedAt: IsoTimestampSchema.optional(),
    completedAt: IsoTimestampSchema.optional(),
    failedAt: IsoTimestampSchema.optional(),
    error: z.string().optional(),
    compensation: z.string().optional(),
  })
  .strict();

export const ProcessTimeoutSchema = z
  .object({
    id: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    status: z.enum(['scheduled', 'fired', 'cancelled']),
    dueAt: IsoTimestampSchema,
    createdAt: IsoTimestampSchema,
    firedAt: IsoTimestampSchema.optional(),
    cancelledAt: IsoTimestampSchema.optional(),
  })
  .strict();

export const ProcessInstanceSchema: z.ZodType<ProcessInstance> = z
  .object({
    id: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    status: z.enum([
      'running',
      'waiting',
      'completed',
      'failed',
      'compensating',
      'compensated',
      'cancelled',
    ]),
    state: ProcessJsonObjectSchema,
    steps: z.array(ProcessStepSchema),
    timeouts: z.array(ProcessTimeoutSchema),
    startedAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    waitingFor: z.string().optional(),
    completedAt: IsoTimestampSchema.optional(),
    failedAt: IsoTimestampSchema.optional(),
    cancelledAt: IsoTimestampSchema.optional(),
    compensatedAt: IsoTimestampSchema.optional(),
    error: z.string().optional(),
  })
  .strict();

export const TelemetryAttributeValueSchema: z.ZodType<TelemetryAttributeValue> = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);

export const TelemetryAttributesSchema: z.ZodType<TelemetryAttributes> = z.record(
  z.string(),
  TelemetryAttributeValueSchema
);

export const TelemetryResourceSchema: z.ZodType<TelemetryResource> = z
  .object({
    attributes: TelemetryAttributesSchema,
    schemaUrl: z.string().optional(),
  })
  .strict();

export const MetricExemplarSchema: z.ZodType<MetricExemplar> = z
  .object({
    value: z.number().finite(),
    observedAt: IsoTimestampSchema,
    traceId: z.string(),
    spanId: z.string(),
    traceFlags: z.string().optional(),
    sampled: z.boolean(),
    attributes: TelemetryAttributesSchema.optional(),
  })
  .strict();

export const MetricMeasurementSchema: z.ZodType<MetricMeasurement> = z
  .object({
    name: NonEmptyStringSchema,
    kind: z.enum(['counter', 'gauge', 'duration']),
    value: z.number().finite(),
    observedAt: IsoTimestampSchema,
    unit: z.string().optional(),
    attributes: TelemetryAttributesSchema.optional(),
    resource: TelemetryResourceSchema.optional(),
    exemplar: MetricExemplarSchema.optional(),
    droppedAttributes: z.number().int().nonnegative().optional(),
  })
  .strict();

export const HealthCheckResultSchema: z.ZodType<HealthCheckResult> = z
  .object({
    name: NonEmptyStringSchema,
    status: z.enum(['pass', 'warn', 'fail']),
    checkedAt: IsoTimestampSchema,
    message: z.string().optional(),
    details: JsonObjectSchema.optional(),
  })
  .strict();

export const CommandIdempotencyRecordSchema: z.ZodType<CommandIdempotencyRecord> = z
  .object({
    key: NonEmptyStringSchema,
    fingerprint: NonEmptyStringSchema,
    status: z.enum(['started', 'succeeded', 'failed']),
    commandId: NonEmptyStringSchema,
    commandType: NonEmptyStringSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    inProgressExpiresAt: IsoTimestampSchema.optional(),
    replayExpiresAt: IsoTimestampSchema.optional(),
    response: JsonValueSchema.optional(),
    error: z.string().optional(),
  })
  .strict();

const FieldDefinitionBaseSchema = {
  required: z.boolean().optional(),
  description: z.string().optional(),
};

export const FieldDefinitionSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...FieldDefinitionBaseSchema,
      type: z.literal('string'),
      minLength: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ ...FieldDefinitionBaseSchema, type: z.literal('number') }).strict(),
  z.object({ ...FieldDefinitionBaseSchema, type: z.literal('boolean') }).strict(),
  z.object({ ...FieldDefinitionBaseSchema, type: z.literal('object') }).strict(),
  z
    .object({
      ...FieldDefinitionBaseSchema,
      type: z.literal('array'),
      minItems: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      ...FieldDefinitionBaseSchema,
      type: z.literal('enum'),
      values: z.array(NonEmptyStringSchema).min(1),
    })
    .strict(),
]);

export const FieldSchemaSchema: z.ZodType<FieldSchema> = z
  .object({
    type: NonEmptyStringSchema,
    fields: z.record(NonEmptyStringSchema, FieldDefinitionSchema),
    allowAdditionalFields: z.boolean().optional(),
  })
  .strict();

export const PackageMigrationSchema = z
  .object({
    id: NonEmptyStringSchema,
    kind: z.enum(['workflow', 'schema', 'data']),
    fromVersion: SemverSchema,
    toVersion: SemverSchema,
    description: z.string().optional(),
  })
  .strict();

export const PackageMigrationsSchema = z.array(PackageMigrationSchema);

export const PackageDependencySchema = z
  .object({
    name: NonEmptyStringSchema,
    version: SemverSchema.optional(),
  })
  .strict();

export const PackageCapabilitySchema = z
  .object({
    name: NonEmptyStringSchema,
    kind: z.enum([
      'workflow',
      'schema',
      'command',
      'event',
      'projection',
      'process',
      'integration',
      'custom',
    ]),
    version: SemverSchema.optional(),
  })
  .strict();

export const PackageLifecycleSchema = z
  .object({
    status: z.enum(['active', 'deprecated', 'replaced']),
    note: z.string().optional(),
    deprecatedAt: IsoTimestampSchema.optional(),
    replacedBy: z
      .object({
        name: NonEmptyStringSchema,
        version: SemverSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export const DomainPackageManifestSchema = z
  .object({
    name: NonEmptyStringSchema.optional(),
    version: SemverSchema.optional(),
    kernelVersion: SemverSchema.optional(),
    dependencies: z.array(PackageDependencySchema).optional(),
    capabilities: z.array(PackageCapabilitySchema).optional(),
    lifecycle: PackageLifecycleSchema.optional(),
  })
  .strict();

export const DomainPackageSchema: z.ZodType<DomainPackage> = z
  .object({
    name: NonEmptyStringSchema,
    version: SemverSchema,
    workflowType: NonEmptyStringSchema,
    workflow: NormalizedWorkflowDefinitionSchema,
    schema: FieldSchemaSchema,
    migrations: PackageMigrationsSchema,
    fixtures: z.array(NonEmptyStringSchema),
    kernelVersion: SemverSchema.optional(),
    dependencies: z.array(PackageDependencySchema).optional(),
    capabilities: z.array(PackageCapabilitySchema).optional(),
    lifecycle: PackageLifecycleSchema.optional(),
    sourcePath: z.string().optional(),
    registeredAt: IsoTimestampSchema,
  })
  .strict();

export const AppliedPackageMigrationSchema: z.ZodType<AppliedPackageMigration> = z
  .object({
    packageName: NonEmptyStringSchema,
    migrationId: NonEmptyStringSchema,
    kind: z.enum(['workflow', 'schema', 'data']),
    fromVersion: SemverSchema,
    toVersion: SemverSchema,
    status: z.enum(['applied', 'failed']),
    appliedAt: IsoTimestampSchema,
    errorMessage: z.string().optional(),
  })
  .strict();
