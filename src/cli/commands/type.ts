import { Command } from 'commander';
import { resolve } from 'node:path';
import { listWorkflowsUseCase, registerWorkflow } from '@/application/use-cases';
import { loadConfigFile } from '@/adapters/fs';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { printJson, runAction } from '@/cli/output';
import type { WorkflowDefinition } from '@/domain/workflow/workflow-definition';
import { WorkflowDefinitionSchema } from '@/validation/schemas';

export function createTypeCommand(getGlobals: () => CliGlobalOptions): Command {
  const type = new Command('type').description('Manage registered work item types');

  type
    .command('add')
    .description('Register a workflow-backed work item type')
    .argument('<type>', 'work item type')
    .requiredOption('--workflow <path>', 'path to workflow JSON')
    .action((typeName: string, options: { workflow: string }) =>
      runAction(async () => {
        const globals = getGlobals();
        const deps = createCliDependencies(globals);
        const workflow = await loadConfigFile<WorkflowDefinition>(
          resolve(options.workflow),
          WorkflowDefinitionSchema
        );
        if (workflow.type !== typeName) {
          throw new Error(
            `Workflow type "${workflow.type}" does not match requested type "${typeName}"`
          );
        }

        const registered = await registerWorkflow(deps, {
          workflow,
          actor: resolveActor(globals.actor),
        });
        printJson(registered);
      })
    );

  type.command('list').description('List registered workflow types').action(() =>
    runAction(async () => {
      const globals = getGlobals();
      printJson(
        await listWorkflowsUseCase(createCliDependencies(globals), resolveActor(globals.actor))
      );
    })
  );

  return type;
}
