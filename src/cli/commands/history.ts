import { Command } from 'commander';
import { getHistoryUseCase } from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { runAction } from '@/cli/output';
import { printHistory } from '@/cli/output-formatters';

export function createHistoryCommand(getGlobals: () => CliGlobalOptions): Command {
  return new Command('history')
    .description('Show audit history for a work item')
    .argument('<workItemId>', 'work item id')
    .option('--json', 'print JSON output')
    .action((workItemId: string, options: { json?: boolean }) =>
      runAction(async () => {
        const globals = getGlobals();
        const events = await getHistoryUseCase(createCliDependencies(globals), {
          workItemId,
          actor: resolveActor(globals.actor),
        });
        printHistory(events, options.json === true);
      })
    );
}
