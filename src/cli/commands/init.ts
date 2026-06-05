import { Command } from 'commander';
import { initializeDataDir, resolveDataDir, type CliGlobalOptions } from '@/cli/context';
import { printJson, runAction } from '@/cli/output';

export function createInitCommand(getGlobals: () => CliGlobalOptions): Command {
  return new Command('init')
    .description('Initialize filesystem storage for the domain kernel')
    .action(() =>
      runAction(async () => {
        const dataDir = resolveDataDir(getGlobals().dataDir);
        await initializeDataDir(dataDir);
        printJson({ dataDir, initialized: true });
      })
    );
}
