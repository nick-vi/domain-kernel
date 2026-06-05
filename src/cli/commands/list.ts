import { Command } from 'commander';
import { listWorkItemsUseCase } from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { runAction } from '@/cli/output';
import { printWorkItemList } from '@/cli/output-formatters';

export function createListCommand(getGlobals: () => CliGlobalOptions): Command {
  return new Command('list')
    .description('List work items')
    .option('--type <type>', 'filter by work item type')
    .option('--status <status>', 'filter by state/status')
    .option('--assignee <actorId>', 'filter by assignee')
    .option('--json', 'print JSON output')
    .action((options: { type?: string; status?: string; assignee?: string; json?: boolean }) =>
      runAction(async () => {
        const globals = getGlobals();
        const workItems = await listWorkItemsUseCase(
          createCliDependencies(globals),
          resolveActor(globals.actor),
          {
            ...(options.type != null ? { type: options.type } : {}),
            ...(options.status != null ? { status: options.status } : {}),
            ...(options.assignee != null ? { assigneeId: options.assignee } : {}),
          }
        );
        printWorkItemList(workItems, options.json === true);
      })
    );
}
