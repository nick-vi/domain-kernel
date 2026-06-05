import { resolve } from 'node:path';
import { Command } from 'commander';
import {
  createKernelProjections,
  rebuildProjection,
  verifyProjection,
  type ProjectionDefinition,
} from '@/application';
import { FsProjectionStore, RandomFileTempNames } from '@/adapters/fs';
import { createCliDependencies, type CliGlobalOptions } from '@/cli/context';
import { parsePositiveIntegerOption } from '@/cli/options';
import { printJson, runAction } from '@/cli/output';
import { sleep } from '@/primitives/timing';

export function createProjectionCommand(getGlobals: () => CliGlobalOptions): Command {
  const projection = new Command('projection').description('Manage kernel projections');

  projection
    .command('list')
    .description('List built-in kernel projections and stored checkpoints')
    .option('--json', 'print JSON output')
    .action((options: { json?: boolean }) =>
      runAction(async () => {
        const deps = createCliDependencies(getGlobals());
        const rows = await Promise.all(
          createKernelProjections().map(async (definition) => ({
            name: definition.name,
            eventTypes: definition.eventTypes ?? [],
            recordCount: (
              await deps.projections.list({
                projectionName: definition.name,
                scope: definition.scope,
              })
            ).length,
            checkpoint: await deps.projections.getCheckpoint({
              projectionName: definition.name,
              scope: definition.scope,
            }),
          }))
        );

        if (options.json === true) {
          printJson(rows);
          return;
        }

        for (const row of rows) {
          const cursor = row.checkpoint?.cursor != null ? ` cursor=${row.checkpoint.cursor}` : '';
          console.log(`${row.name} records=${row.recordCount}${cursor}`);
        }
      })
    );

  projection
    .command('rebuild')
    .description('Rebuild a built-in projection, or all built-in projections')
    .argument('<name>', 'projection name, or "all"')
    .option('--batch-size <number>', 'positive batch size')
    .option('--json', 'print JSON output')
    .action((name: string, options: { batchSize?: string; json?: boolean }) =>
      runAction(async () => {
        const deps = createCliDependencies(getGlobals());
        const results = [];
        for (const definition of resolveProjectionDefinitions(name)) {
          results.push(
            await rebuildProjection(deps, definition, {
              ...(options.batchSize != null
                ? { batchSize: parsePositiveIntegerOption('batchSize', options.batchSize) }
                : {}),
            })
          );
        }

        if (options.json === true) {
          printJson(results);
          return;
        }

        for (const result of results) {
          console.log(`${result.projectionName} processed=${result.processed} sequence=${result.sequence}`);
        }
      })
    );

  projection
    .command('verify')
    .description('Verify a built-in projection, or all built-in projections')
    .argument('<name>', 'projection name, or "all"')
    .requiredOption('--scratch-dir <path>', 'explicit scratch storage root')
    .option('--batch-size <number>', 'positive batch size')
    .option('--json', 'print JSON output')
    .action(
      (
        name: string,
        options: { scratchDir: string; batchSize?: string; json?: boolean }
      ) =>
        runAction(async () => {
          const deps = createCliDependencies(getGlobals());
          const scratchStore = new FsProjectionStore(
            resolve(options.scratchDir),
            deps.clock,
            sleep,
            new RandomFileTempNames()
          );
          const reports = [];
          for (const definition of resolveProjectionDefinitions(name)) {
            reports.push(
              await verifyProjection(deps, definition, {
                scratchStore,
                ...(options.batchSize != null
                  ? { batchSize: parsePositiveIntegerOption('batchSize', options.batchSize) }
                  : {}),
              })
            );
          }

          if (options.json === true) {
            printJson(reports);
            return;
          }

          for (const report of reports) {
            console.log(
              `${report.projectionName} status=${report.status} expected=${report.expectedCount} actual=${report.actualCount}`
            );
          }
        })
    );

  return projection;
}

function resolveProjectionDefinitions(name: string): ProjectionDefinition[] {
  const definitions = createKernelProjections();
  if (name === 'all') return definitions;

  const definition = definitions.find((candidate) => candidate.name === name);
  if (definition == null) {
    throw new Error(
      `Unknown projection "${name}". Available projections: ${definitions
        .map((item) => item.name)
        .join(', ')}`
    );
  }
  return [definition];
}
