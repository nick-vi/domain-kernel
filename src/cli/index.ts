#!/usr/bin/env node
import { Command } from 'commander';
import pkg from '../../package.json';
import {
  createAssignCommand,
  createCommentCommand,
  createCreateCommand,
  createDecisionCommand,
  createEventsCommand,
  createFieldCommand,
  createHealthCommand,
  createHistoryCommand,
  createIdempotencyCommand,
  createInitCommand,
  createIntegrationsCommand,
  createListCommand,
  createPackageCommand,
  createProjectionCommand,
  createProcessCommand,
  createQueryCommand,
  createReportCommand,
  createResourceCommand,
  createShowCommand,
  createTransitionCommand,
  createTypeCommand,
} from './commands';
import type { CliGlobalOptions } from './context';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('domain')
    .description('Generic domain kernel CLI')
    .version(pkg.version)
    .option('--data-dir <path>', 'filesystem storage root')
    .option('--actor <actorId>', 'actor id recorded in audit events')
    .option('--logs <mode>', 'log output: none, console, json', 'none')
    .option('--trace', 'emit simple span logs through the selected logger');

  const getGlobals = (): CliGlobalOptions => program.optsWithGlobals() as CliGlobalOptions;

  program.addCommand(createInitCommand(getGlobals));
  program.addCommand(createTypeCommand(getGlobals));
  program.addCommand(createPackageCommand(getGlobals));
  program.addCommand(createProjectionCommand(getGlobals));
  program.addCommand(createQueryCommand(getGlobals));
  program.addCommand(createReportCommand(getGlobals));
  program.addCommand(createEventsCommand(getGlobals));
  program.addCommand(createProcessCommand(getGlobals));
  program.addCommand(createHealthCommand(getGlobals));
  program.addCommand(createIdempotencyCommand(getGlobals));
  program.addCommand(createIntegrationsCommand(getGlobals));
  program.addCommand(createResourceCommand(getGlobals));
  program.addCommand(createCreateCommand(getGlobals));
  program.addCommand(createShowCommand(getGlobals));
  program.addCommand(createTransitionCommand(getGlobals));
  program.addCommand(createAssignCommand(getGlobals));
  program.addCommand(createDecisionCommand(getGlobals));
  program.addCommand(createCommentCommand(getGlobals));
  program.addCommand(createFieldCommand(getGlobals));
  program.addCommand(createHistoryCommand(getGlobals));
  program.addCommand(createListCommand(getGlobals));

  return program;
}

if (import.meta.main) {
  await createProgram().parseAsync();
}
