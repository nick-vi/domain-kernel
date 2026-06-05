import { Command } from 'commander';
import { createCliDependencies, type CliGlobalOptions } from '@/cli/context';
import {
  parseIsoTimestampOption,
  parseProcessStatus,
} from '@/cli/options';
import { printJson, runAction } from '@/cli/output';

export function createProcessCommand(getGlobals: () => CliGlobalOptions): Command {
  const process = new Command('process').description('Inspect process instances');

  process
    .command('list')
    .description('List process instances')
    .option('--type <type>', 'filter by process type')
    .option('--status <status>', 'filter by process status')
    .option('--waiting-for <signal>', 'filter by waiting signal')
    .option('--json', 'print JSON output')
    .action(
      (options: {
        type?: string;
        status?: string;
        waitingFor?: string;
        json?: boolean;
      }) =>
        runAction(async () => {
          const processes = await createCliDependencies(getGlobals()).processes.list({
            ...(options.type != null ? { type: options.type } : {}),
            ...(options.status != null ? { status: parseProcessStatus(options.status) } : {}),
            ...(options.waitingFor != null ? { waitingFor: options.waitingFor } : {}),
          });
          if (options.json === true) {
            printJson(processes);
            return;
          }

          if (processes.length === 0) {
            console.log('No process instances.');
            return;
          }

          for (const item of processes) {
            const waiting =
              item.waitingFor != null ? ` waitingFor=${item.waitingFor}` : '';
            console.log(`${item.id} type=${item.type} status=${item.status}${waiting}`);
          }
        })
    );

  process
    .command('due-timeouts')
    .description('List process instances with due scheduled timeouts')
    .requiredOption('--now <timestamp>', 'current ISO timestamp')
    .option('--type <type>', 'filter by process type')
    .option('--json', 'print JSON output')
    .action((options: { now: string; type?: string; json?: boolean }) =>
      runAction(async () => {
        const processes = await createCliDependencies(getGlobals()).processes.listDueTimeouts({
          now: parseIsoTimestampOption('now', options.now),
          ...(options.type != null ? { type: options.type } : {}),
        });
        if (options.json === true) {
          printJson(processes);
          return;
        }

        if (processes.length === 0) {
          console.log('No due process timeouts.');
          return;
        }

        for (const item of processes) {
          console.log(`${item.id} type=${item.type} status=${item.status}`);
        }
      })
    );

  return process;
}
