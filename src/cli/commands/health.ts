import { Command } from 'commander';
import { createCliDependencies, type CliGlobalOptions } from '@/cli/context';
import { parseHealthStatus } from '@/cli/options';
import { printJson, runAction } from '@/cli/output';

export function createHealthCommand(getGlobals: () => CliGlobalOptions): Command {
  const health = new Command('health').description('Inspect health reports');

  health
    .command('list')
    .description('List latest health reports')
    .option('--status <status>', 'filter by health status')
    .option('--json', 'print JSON output')
    .action((options: { status?: string; json?: boolean }) =>
      runAction(async () => {
        const reports = await createCliDependencies(getGlobals()).health.list({
          ...(options.status != null ? { status: parseHealthStatus(options.status) } : {}),
        });
        if (options.json === true) {
          printJson(reports);
          return;
        }

        if (reports.length === 0) {
          console.log('No health reports.');
          return;
        }

        for (const report of reports) {
          const message = report.message != null ? ` ${report.message}` : '';
          console.log(`${report.name} status=${report.status} checked=${report.checkedAt}${message}`);
        }
      })
    );

  return health;
}
