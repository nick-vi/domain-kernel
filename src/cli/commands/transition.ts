import { Command } from 'commander';
import { transitionWorkItemUseCase } from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { parseExpectedVersion } from '@/cli/options';
import { printJson, runAction } from '@/cli/output';

export function createTransitionCommand(getGlobals: () => CliGlobalOptions): Command {
  return new Command('transition')
    .description('Move a work item through its workflow')
    .argument('<workItemId>', 'work item id')
    .argument('<action>', 'workflow transition action')
    .option('--expected-version <version>', 'expected current work item version')
    .action((workItemId: string, action: string, options: { expectedVersion?: string }) =>
      runAction(async () => {
        const globals = getGlobals();
        const workItem = await transitionWorkItemUseCase(createCliDependencies(globals), {
          workItemId,
          action,
          expectedVersion: parseExpectedVersion(options.expectedVersion),
          actor: resolveActor(globals.actor),
        });
        printJson(workItem);
      })
    );
}
