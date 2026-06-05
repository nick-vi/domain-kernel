import { Command } from 'commander';
import { queryAuditEventsUseCase } from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import {
  parseAuditEventType,
  parseNonNegativeIntegerOption,
  parsePositiveIntegerOption,
} from '@/cli/options';
import { printJson, runAction } from '@/cli/output';
import { printAuditEventSearchResult } from '@/cli/output-formatters';

type EventsTailOptions = {
  type?: string;
  workItem?: string;
  limit?: string;
  offset?: string;
  json?: boolean;
};

export function createEventsCommand(getGlobals: () => CliGlobalOptions): Command {
  const events = new Command('events').description('Inspect audit events');

  events.addCommand(
    new Command('tail')
      .description('Print recent audit events')
      .option('--type <eventType>', 'filter by audit event type')
      .option('--work-item <workItemId>', 'filter by work item id')
      .option('--limit <number>', 'maximum number of results')
      .option('--offset <number>', 'number of results to skip')
      .option('--json', 'print JSON output')
      .action((options: EventsTailOptions) =>
        runAction(async () => {
          const globals = getGlobals();
          const result = await queryAuditEventsUseCase(createCliDependencies(globals), {
            actor: resolveActor(globals.actor),
            query: {
              ...(options.type != null ? { type: parseAuditEventType(options.type) } : {}),
              ...(options.workItem != null ? { workItemId: options.workItem } : {}),
              ...(options.limit != null
                ? { limit: parsePositiveIntegerOption('limit', options.limit) }
                : {}),
              ...(options.offset != null
                ? { offset: parseNonNegativeIntegerOption('offset', options.offset) }
                : {}),
              sort: 'occurred_at_asc',
            },
          });
          printAuditEventSearchResult(result, options.json === true);
        })
      )
  );

  events.addCommand(
    new Command('stream')
      .description('Read a stored event stream with revisions')
      .argument('<streamId>', 'event stream id')
      .option('--from-revision <number>', 'first revision to read')
      .option('--limit <number>', 'maximum number of events')
      .option('--json', 'print JSON output')
      .action(
        (
          streamId: string,
          options: { fromRevision?: string; limit?: string; json?: boolean }
        ) =>
          runAction(async () => {
            const deps = createCliDependencies(getGlobals());
            const state = await deps.events.getStreamState(streamId);
            const streamEvents = await deps.events.readStream({
              streamId,
              ...(options.fromRevision != null
                ? {
                    fromRevision: parseNonNegativeIntegerOption(
                      'fromRevision',
                      options.fromRevision
                    ),
                  }
                : {}),
              ...(options.limit != null
                ? { limit: parsePositiveIntegerOption('limit', options.limit) }
                : {}),
            });
            const result = { state, events: streamEvents };
            if (options.json === true) {
              printJson(result);
              return;
            }

            console.log(
              `${state.streamId} exists=${String(state.exists)} revision=${state.revision}`
            );
            for (const event of streamEvents) {
              console.log(`${event.revision} ${event.id} ${event.type} ${event.occurredAt}`);
            }
          })
      )
  );

  return events;
}
