import { Command } from 'commander';
import {
  queryAuditEventsUseCase,
  queryWorkItemsUseCase,
} from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { collectOption, parseFieldOptions } from '@/cli/fields';
import {
  parseAuditEventSort,
  parseAuditEventType,
  parseNonNegativeIntegerOption,
  parsePositiveIntegerOption,
  parseWorkItemSort,
} from '@/cli/options';
import { runAction } from '@/cli/output';
import {
  printAuditEventSearchResult,
  printWorkItemSearchResult,
} from '@/cli/output-formatters';

type WorkQueryOptions = {
  type?: string;
  status?: string;
  actorId?: string;
  assignedTo?: string;
  field: string[];
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  limit?: string;
  offset?: string;
  sort?: string;
  json?: boolean;
};

type EventQueryOptions = {
  workItem?: string;
  type?: string;
  actorId?: string;
  occurredAfter?: string;
  occurredBefore?: string;
  limit?: string;
  offset?: string;
  sort?: string;
  json?: boolean;
};

export function createQueryCommand(getGlobals: () => CliGlobalOptions): Command {
  const query = new Command('query').description('Query work items and audit events');

  query.addCommand(
    new Command('work')
      .description('Query work items')
      .option('--type <type>', 'filter by work item type')
      .option('--status <status>', 'filter by state/status')
      .option('--actor-id <actorId>', 'filter by actor id seen in audit history')
      .option('--assigned-to <actorId>', 'filter by assignee actor id')
      .option('--field <key=value>', 'field equality filter', collectOption, [])
      .option('--created-after <timestamp>', 'filter by created timestamp lower bound')
      .option('--created-before <timestamp>', 'filter by created timestamp upper bound')
      .option('--updated-after <timestamp>', 'filter by updated timestamp lower bound')
      .option('--updated-before <timestamp>', 'filter by updated timestamp upper bound')
      .option('--limit <number>', 'maximum number of results')
      .option('--offset <number>', 'number of results to skip')
      .option('--sort <sort>', 'created_at_desc, created_at_asc, updated_at_desc, updated_at_asc')
      .option('--json', 'print JSON output')
      .action((options: WorkQueryOptions) =>
        runAction(async () => {
          const globals = getGlobals();
          const fieldEquals = parseFieldOptions(options.field).match({
            ok: (value) => value,
            err: (error) => {
              throw error;
            },
          });
          const result = await queryWorkItemsUseCase(createCliDependencies(globals), {
            actor: resolveActor(globals.actor),
            query: {
              ...(options.type != null ? { type: options.type } : {}),
              ...(options.status != null ? { status: options.status } : {}),
              ...(options.actorId != null ? { actorId: options.actorId } : {}),
              ...(options.assignedTo != null ? { assignedTo: options.assignedTo } : {}),
              ...(Object.keys(fieldEquals).length > 0 ? { fieldEquals } : {}),
              ...(options.createdAfter != null ? { createdAfter: options.createdAfter } : {}),
              ...(options.createdBefore != null ? { createdBefore: options.createdBefore } : {}),
              ...(options.updatedAfter != null ? { updatedAfter: options.updatedAfter } : {}),
              ...(options.updatedBefore != null ? { updatedBefore: options.updatedBefore } : {}),
              ...(options.limit != null
                ? { limit: parsePositiveIntegerOption('limit', options.limit) }
                : {}),
              ...(options.offset != null
                ? { offset: parseNonNegativeIntegerOption('offset', options.offset) }
                : {}),
              ...(options.sort != null ? { sort: parseWorkItemSort(options.sort) } : {}),
            },
          });
          printWorkItemSearchResult(result, options.json === true);
        })
      )
  );

  query.addCommand(
    new Command('events')
      .description('Query audit events')
      .option('--work-item <workItemId>', 'filter by work item id')
      .option('--type <eventType>', 'filter by audit event type')
      .option('--actor-id <actorId>', 'filter by actor id')
      .option('--occurred-after <timestamp>', 'filter by occurred timestamp lower bound')
      .option('--occurred-before <timestamp>', 'filter by occurred timestamp upper bound')
      .option('--limit <number>', 'maximum number of results')
      .option('--offset <number>', 'number of results to skip')
      .option('--sort <sort>', 'occurred_at_desc or occurred_at_asc')
      .option('--json', 'print JSON output')
      .action((options: EventQueryOptions) =>
        runAction(async () => {
          const globals = getGlobals();
          const result = await queryAuditEventsUseCase(createCliDependencies(globals), {
            actor: resolveActor(globals.actor),
            query: {
              ...(options.workItem != null ? { workItemId: options.workItem } : {}),
              ...(options.type != null ? { type: parseAuditEventType(options.type) } : {}),
              ...(options.actorId != null ? { actorId: options.actorId } : {}),
              ...(options.occurredAfter != null ? { occurredAfter: options.occurredAfter } : {}),
              ...(options.occurredBefore != null
                ? { occurredBefore: options.occurredBefore }
                : {}),
              ...(options.limit != null
                ? { limit: parsePositiveIntegerOption('limit', options.limit) }
                : {}),
              ...(options.offset != null
                ? { offset: parseNonNegativeIntegerOption('offset', options.offset) }
                : {}),
              ...(options.sort != null ? { sort: parseAuditEventSort(options.sort) } : {}),
            },
          });
          printAuditEventSearchResult(result, options.json === true);
        })
      )
  );

  return query;
}
