import { Command } from 'commander';
import { createWorkItemUseCase } from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { collectOption, parseFieldOptions } from '@/cli/fields';
import { printJson, runAction } from '@/cli/output';

export function createCreateCommand(getGlobals: () => CliGlobalOptions): Command {
  return new Command('create')
    .description('Create a work item')
    .argument('<type>', 'work item type')
    .option('--field <key=value>', 'field value', collectOption, [])
    .action((type: string, options: { field: string[] }) =>
      runAction(async () => {
        const globals = getGlobals();
        const fields = parseFieldOptions(options.field).match({
          ok: (value) => value,
          err: (error) => {
            throw error;
          },
        });
        const workItem = await createWorkItemUseCase(createCliDependencies(globals), {
          type,
          fields,
          actor: resolveActor(globals.actor),
        });
        printJson(workItem);
      })
    );
}
