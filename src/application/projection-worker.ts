import type { ApplicationDependencies } from '@/application/dependencies';
import type { AuditEvent, AuditEventType } from '@/domain/event/audit-event';
import type {
  ProjectionJsonObject,
  ProjectionRecord,
} from '@/primitives/projection';
import {
  advanceProjectionCheckpoint,
  createProjectionRecord,
  updateProjectionRecord,
} from '@/primitives/projection';
import { optionalPositiveIntegerOption } from '@/primitives/runtime-options';
import type { Scope } from '@/primitives/scope';

export type ProjectionContext = {
  deps: ApplicationDependencies;
  definition: ProjectionDefinition;
  event: AuditEvent;
  getRecord(id: string): Promise<ProjectionRecord | null>;
  saveRecord(id: string, value: ProjectionJsonObject): Promise<ProjectionRecord>;
  upsertRecord(
    id: string,
    update: (current: ProjectionJsonObject | undefined) => ProjectionJsonObject
  ): Promise<ProjectionRecord>;
};

export type ProjectionDefinition = {
  name: string;
  scope?: Scope | undefined;
  eventTypes?: AuditEventType[] | undefined;
  project: (context: ProjectionContext) => Promise<void> | void;
};

export type RebuildProjectionOptions = {
  batchSize?: number | undefined;
  clear?: boolean | undefined;
};

export type ProjectionRunResult = {
  projectionName: string;
  processed: number;
  cursor?: string | undefined;
  sequence: number;
};

export async function rebuildProjection(
  deps: ApplicationDependencies,
  definition: ProjectionDefinition,
  options: RebuildProjectionOptions = {}
): Promise<ProjectionRunResult> {
  const batchSize = optionalPositiveIntegerOption('batchSize', options.batchSize) ?? 100;

  if (options.clear !== false) {
    await deps.projections.clear({
      projectionName: definition.name,
      scope: definition.scope,
    });
  }

  let offset = 0;
  let processed = 0;
  let cursor: string | undefined;

  for (;;) {
    const page = await deps.eventQueries.search({
      limit: batchSize,
      offset,
      sort: 'occurred_at_asc',
    });
    if (page.events.length === 0) break;

    for (const event of page.events) {
      if (!shouldProjectEvent(definition, event)) continue;

      await definition.project(createProjectionContext(deps, definition, event));
      processed += 1;
      cursor = event.id;
      await deps.projections.saveCheckpoint(
        advanceProjectionCheckpoint(undefined, {
          projectionName: definition.name,
          scope: definition.scope,
          cursor,
          sequence: processed,
          now: deps.clock.now(),
        })
      );
    }

    offset += page.events.length;
    if (offset >= page.total) break;
  }

  deps.logger.info('Projection rebuilt', {
    projectionName: definition.name,
    processed,
    cursor,
  });

  return {
    projectionName: definition.name,
    processed,
    ...(cursor != null ? { cursor } : {}),
    sequence: processed,
  };
}

function createProjectionContext(
  deps: ApplicationDependencies,
  definition: ProjectionDefinition,
  event: AuditEvent
): ProjectionContext {
  const getRecord = (id: string) =>
    deps.projections.get({
      projectionName: definition.name,
      scope: definition.scope,
      id,
    });

  const saveRecord = async (
    id: string,
    value: ProjectionJsonObject
  ): Promise<ProjectionRecord> => {
    const existing = await getRecord(id);
    const record =
      existing == null
        ? createProjectionRecord({
            projectionName: definition.name,
            scope: definition.scope,
            id,
            value,
            now: deps.clock.now(),
          })
        : updateProjectionRecord(existing, { value, now: deps.clock.now() });
    await deps.projections.save(record);
    return record;
  };

  return {
    deps,
    definition,
    event,
    getRecord,
    saveRecord,
    upsertRecord: async (id, update) => {
      const existing = await getRecord(id);
      return saveRecord(id, update(existing?.value));
    },
  };
}

function shouldProjectEvent(definition: ProjectionDefinition, event: AuditEvent): boolean {
  return definition.eventTypes == null || definition.eventTypes.includes(event.type);
}
