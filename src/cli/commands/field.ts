import { Command } from 'commander';
import { updateWorkItemFieldsUseCase } from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { parseFieldOptions } from '@/cli/fields';
import { parseExpectedVersion } from '@/cli/options';
import { printJson, runAction } from '@/cli/output';

export function createFieldCommand(getGlobals: () => CliGlobalOptions): Command {
  const command = new Command('field').description('Manage work item fields');

  command.addCommand(
    new Command('set')
      .description('Set one or more work item fields')
      .argument('<workItemId>', 'work item id')
      .argument('<fields...>', 'field values as key=value')
      .option('--expected-version <version>', 'expected current work item version')
      .action((workItemId: string, fields: string[], options: { expectedVersion?: string }) =>
        runAction(async () => {
          const globals = getGlobals();
          const parsedFields = parseFieldOptions(fields).match({
            ok: (value) => value,
            err: (error) => {
              throw error;
            },
          });
          const workItem = await updateWorkItemFieldsUseCase(createCliDependencies(globals), {
            workItemId,
            fields: parsedFields,
            expectedVersion: parseExpectedVersion(options.expectedVersion),
            actor: resolveActor(globals.actor),
          });
          printJson(workItem);
        })
      )
  );

  return command;
}
