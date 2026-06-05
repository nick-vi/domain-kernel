import { Command } from 'commander';
import { addCommentUseCase } from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { parseExpectedVersion } from '@/cli/options';
import { printJson, runAction } from '@/cli/output';

export function createCommentCommand(getGlobals: () => CliGlobalOptions): Command {
  const comment = new Command('comment').description('Manage work item comments');

  comment
    .command('add')
    .description('Add a comment to a work item')
    .argument('<workItemId>', 'work item id')
    .requiredOption('--text <text>', 'comment text')
    .option('--expected-version <version>', 'expected current work item version')
    .action((workItemId: string, options: { text: string; expectedVersion?: string }) =>
      runAction(async () => {
        const globals = getGlobals();
        const workItem = await addCommentUseCase(createCliDependencies(globals), {
          workItemId,
          text: options.text,
          expectedVersion: parseExpectedVersion(options.expectedVersion),
          actor: resolveActor(globals.actor),
        });
        printJson(workItem);
      })
    );

  return comment;
}
