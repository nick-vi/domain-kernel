import { Command } from 'commander';
import { assignWorkItemUseCase } from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { parseExpectedVersion } from '@/cli/options';
import { printJson, runAction } from '@/cli/output';

export function createAssignCommand(getGlobals: () => CliGlobalOptions): Command {
  return new Command('assign')
    .description('Assign a work item to an actor')
    .argument('<workItemId>', 'work item id')
    .requiredOption('--assignee <actorId>', 'assignee actor id')
    .option('--expected-version <version>', 'expected current work item version')
    .action((workItemId: string, options: { assignee: string; expectedVersion?: string }) =>
      runAction(async () => {
        const globals = getGlobals();
        const workItem = await assignWorkItemUseCase(createCliDependencies(globals), {
          workItemId,
          assigneeId: options.assignee,
          expectedVersion: parseExpectedVersion(options.expectedVersion),
          actor: resolveActor(globals.actor),
        });
        printJson(workItem);
      })
    );
}
