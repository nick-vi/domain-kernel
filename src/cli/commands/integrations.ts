import { Command } from 'commander';
import {
  getIntegrationAttemptUseCase,
  listIntegrationAttemptsUseCase,
} from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { parseIntegrationAttemptStatus } from '@/cli/options';
import { runAction } from '@/cli/output';
import {
  printIntegrationAttempt,
  printIntegrationAttemptList,
} from '@/cli/output-formatters';

type IntegrationListOptions = {
  provider?: string;
  operation?: string;
  status?: string;
  event?: string;
  workItem?: string;
  resource?: string;
  json?: boolean;
};

export function createIntegrationsCommand(getGlobals: () => CliGlobalOptions): Command {
  const integrations = new Command('integrations').description('Inspect integration attempts');

  integrations
    .command('list')
    .description('List integration attempts')
    .option('--provider <provider>', 'filter by provider')
    .option('--operation <operation>', 'filter by operation')
    .option('--status <status>', 'pending, succeeded, failed, or skipped')
    .option('--event <eventId>', 'filter by audit event id')
    .option('--work-item <workItemId>', 'filter by work item id')
    .option('--resource <resourceId>', 'filter by resource id')
    .option('--json', 'print JSON output')
    .action((options: IntegrationListOptions) =>
      runAction(async () => {
        const globals = getGlobals();
        const attempts = await listIntegrationAttemptsUseCase(createCliDependencies(globals), {
          actor: resolveActor(globals.actor),
          query: {
            ...(options.provider != null ? { provider: options.provider } : {}),
            ...(options.operation != null ? { operation: options.operation } : {}),
            ...(options.status != null
              ? { status: parseIntegrationAttemptStatus(options.status) }
              : {}),
            ...(options.event != null ? { eventId: options.event } : {}),
            ...(options.workItem != null ? { workItemId: options.workItem } : {}),
            ...(options.resource != null ? { resourceId: options.resource } : {}),
          },
        });
        printIntegrationAttemptList(attempts, options.json === true);
      })
    );

  integrations
    .command('show')
    .description('Show an integration attempt')
    .argument('<attemptId>', 'integration attempt id')
    .option('--json', 'print JSON output')
    .action((attemptId: string, options: { json?: boolean }) =>
      runAction(async () => {
        const globals = getGlobals();
        const attempt = await getIntegrationAttemptUseCase(createCliDependencies(globals), {
          id: attemptId,
          actor: resolveActor(globals.actor),
        });
        printIntegrationAttempt(attempt, options.json === true);
      })
    );

  return integrations;
}
