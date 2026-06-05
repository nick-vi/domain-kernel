import { Command } from 'commander';
import { createCliDependencies, type CliGlobalOptions } from '@/cli/context';
import {
  parseIdempotencyStatus,
  parseIsoTimestampOption,
  parsePositiveIntegerOption,
} from '@/cli/options';
import { printJson, runAction } from '@/cli/output';

export function createIdempotencyCommand(getGlobals: () => CliGlobalOptions): Command {
  const idempotency = new Command('idempotency').description('Inspect command idempotency records');

  idempotency
    .command('list')
    .description('List command idempotency records')
    .option('--command-type <type>', 'filter by command type')
    .option('--status <status>', 'filter by idempotency status')
    .option('--json', 'print JSON output')
    .action(
      (options: { commandType?: string; status?: string; json?: boolean }) =>
        runAction(async () => {
          const records = await createCliDependencies(getGlobals()).commandIdempotency.list({
            ...(options.commandType != null ? { commandType: options.commandType } : {}),
            ...(options.status != null ? { status: parseIdempotencyStatus(options.status) } : {}),
          });
          if (options.json === true) {
            printJson(records);
            return;
          }

          if (records.length === 0) {
            console.log('No command idempotency records.');
            return;
          }

          for (const record of records) {
            const inProgressExpires =
              record.inProgressExpiresAt != null
                ? ` inProgressExpires=${record.inProgressExpiresAt}`
                : '';
            const replayExpires =
              record.replayExpiresAt != null ? ` replayExpires=${record.replayExpiresAt}` : '';
            console.log(
              `${record.key} type=${record.commandType} status=${record.status}${inProgressExpires}${replayExpires}`
            );
          }
        })
    );

  idempotency
    .command('prune')
    .description('Delete expired command idempotency records')
    .requiredOption('--now <timestamp>', 'current ISO timestamp')
    .option('--limit <number>', 'maximum records to prune')
    .option('--json', 'print JSON output')
    .action((options: { now: string; limit?: string; json?: boolean }) =>
      runAction(async () => {
        const result = await createCliDependencies(getGlobals()).commandIdempotency.pruneExpired({
          now: parseIsoTimestampOption('now', options.now),
          ...(options.limit != null
            ? { limit: parsePositiveIntegerOption('limit', options.limit) }
            : {}),
        });
        if (options.json === true) {
          printJson(result);
          return;
        }

        console.log(`pruned: ${result.pruned}`);
        for (const key of result.keys) {
          console.log(`  ${key}`);
        }
      })
    );

  return idempotency;
}
