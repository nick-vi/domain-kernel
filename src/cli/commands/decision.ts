import { Command } from 'commander';
import { addDecisionUseCase } from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { parseExpectedVersion } from '@/cli/options';
import { printJson, runAction } from '@/cli/output';

export function createDecisionCommand(getGlobals: () => CliGlobalOptions): Command {
  const decision = new Command('decision').description('Manage work item decisions');

  decision
    .command('add')
    .description('Add a decision with required rationale')
    .argument('<workItemId>', 'work item id')
    .requiredOption('--type <type>', 'decision type')
    .requiredOption('--reason <reason>', 'decision rationale')
    .option('--expected-version <version>', 'expected current work item version')
    .action(
      (workItemId: string, options: { type: string; reason: string; expectedVersion?: string }) =>
        runAction(async () => {
          const globals = getGlobals();
          const workItem = await addDecisionUseCase(createCliDependencies(globals), {
            workItemId,
            decisionType: options.type,
            reason: options.reason,
            expectedVersion: parseExpectedVersion(options.expectedVersion),
            actor: resolveActor(globals.actor),
          });
          printJson(workItem);
        })
    );

  return decision;
}
