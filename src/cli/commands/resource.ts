import { Command } from 'commander';
import {
  createResourceUseCase,
  getResourceUseCase,
  listResourcesUseCase,
  releaseResourceReservationUseCase,
  reserveResourceUseCase,
} from '@/application/use-cases';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { collectOption, parseFieldOptions } from '@/cli/fields';
import { parsePositiveIntegerOption } from '@/cli/options';
import { runAction } from '@/cli/output';
import {
  printResource,
  printResourceList,
  printResourceReservation,
} from '@/cli/output-formatters';

export function createResourceCommand(getGlobals: () => CliGlobalOptions): Command {
  const resource = new Command('resource').description('Manage resources and reservations');

  resource
    .command('create')
    .description('Create a resource')
    .argument('<resourceId>', 'resource id')
    .requiredOption('--type <type>', 'resource type')
    .option('--field <key=value>', 'resource field value', collectOption, [])
    .option('--json', 'print JSON output')
    .action((resourceId: string, options: { type: string; field: string[]; json?: boolean }) =>
      runAction(async () => {
        const globals = getGlobals();
        const fields = parseFieldOptions(options.field).match({
          ok: (value) => value,
          err: (error) => {
            throw error;
          },
        });
        const created = await createResourceUseCase(createCliDependencies(globals), {
          id: resourceId,
          type: options.type,
          fields,
          actor: resolveActor(globals.actor),
        });
        printResource(created, options.json === true);
      })
    );

  resource
    .command('show')
    .description('Show a resource')
    .argument('<resourceId>', 'resource id')
    .option('--json', 'print JSON output')
    .action((resourceId: string, options: { json?: boolean }) =>
      runAction(async () => {
        const globals = getGlobals();
        const found = await getResourceUseCase(createCliDependencies(globals), {
          resourceId,
          actor: resolveActor(globals.actor),
        });
        printResource(found, options.json === true);
      })
    );

  resource
    .command('list')
    .description('List resources')
    .option('--type <type>', 'filter by resource type')
    .option('--json', 'print JSON output')
    .action((options: { type?: string; json?: boolean }) =>
      runAction(async () => {
        const globals = getGlobals();
        const resources = await listResourcesUseCase(
          createCliDependencies(globals),
          resolveActor(globals.actor),
          {
            ...(options.type != null ? { type: options.type } : {}),
          }
        );
        printResourceList(resources, options.json === true);
      })
    );

  resource
    .command('reserve')
    .description('Reserve a resource for a work item')
    .argument('<workItemId>', 'work item id')
    .argument('<resourceId>', 'resource id')
    .option('--quantity <number>', 'quantity or capacity to reserve')
    .option('--field <key=value>', 'reservation field value', collectOption, [])
    .option('--json', 'print JSON output')
    .action(
      (
        workItemId: string,
        resourceId: string,
        options: { quantity?: string; field: string[]; json?: boolean }
      ) =>
        runAction(async () => {
          const globals = getGlobals();
          const fields = parseFieldOptions(options.field).match({
            ok: (value) => value,
            err: (error) => {
              throw error;
            },
          });
          const reservation = await reserveResourceUseCase(createCliDependencies(globals), {
            workItemId,
            resourceId,
            ...(options.quantity != null
              ? { quantity: parsePositiveIntegerOption('quantity', options.quantity) }
              : {}),
            ...(Object.keys(fields).length > 0 ? { fields } : {}),
            actor: resolveActor(globals.actor),
          });
          printResourceReservation(reservation, options.json === true);
        })
    );

  resource
    .command('release')
    .description('Release a resource reservation for a work item')
    .argument('<workItemId>', 'work item id')
    .argument('<resourceId>', 'resource id')
    .option('--quantity <number>', 'quantity or capacity to release')
    .option('--json', 'print JSON output')
    .action(
      (workItemId: string, resourceId: string, options: { quantity?: string; json?: boolean }) =>
        runAction(async () => {
          const globals = getGlobals();
          const reservation = await releaseResourceReservationUseCase(
            createCliDependencies(globals),
            {
              workItemId,
              resourceId,
              ...(options.quantity != null
                ? { quantity: parsePositiveIntegerOption('quantity', options.quantity) }
                : {}),
              actor: resolveActor(globals.actor),
            }
          );
          printResourceReservation(reservation, options.json === true);
        })
    );

  return resource;
}
