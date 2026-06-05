import { Command } from 'commander';
import { reportCountsUseCase } from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { parseCountReportGroupBy } from '@/cli/options';
import { runAction } from '@/cli/output';
import { printCountReport } from '@/cli/output-formatters';

export function createReportCommand(getGlobals: () => CliGlobalOptions): Command {
  const report = new Command('report').description('Run simple reports');

  report.addCommand(
    new Command('counts')
      .description('Count work items by a simple dimension')
      .requiredOption('--group-by <field>', 'status or type')
      .option('--json', 'print JSON output')
      .action((options: { groupBy: string; json?: boolean }) =>
        runAction(async () => {
          const globals = getGlobals();
          const result = await reportCountsUseCase(createCliDependencies(globals), {
            actor: resolveActor(globals.actor),
            groupBy: parseCountReportGroupBy(options.groupBy),
          });
          printCountReport(result, options.json === true);
        })
      )
  );

  return report;
}
