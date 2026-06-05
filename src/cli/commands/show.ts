import { Command } from 'commander';
import { getWorkItemUseCase } from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { runAction } from '@/cli/output';
import { printWorkItem } from '@/cli/output-formatters';

export function createShowCommand(getGlobals: () => CliGlobalOptions): Command {
  return new Command('show')
    .description('Show a work item')
    .argument('<workItemId>', 'work item id')
    .option('--json', 'print JSON output')
    .action((workItemId: string, options: { json?: boolean }) =>
      runAction(async () => {
        const workItem = await getWorkItemUseCase(createCliDependencies(getGlobals()), {
          workItemId,
          actor: resolveActor(getGlobals().actor),
        });
        printWorkItem(workItem, options.json === true);
      })
    );
}
