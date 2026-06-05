import { z } from 'zod';
import {
  addCommentUseCase,
  addDecisionUseCase,
  assignWorkItemUseCase,
  createResourceUseCase,
  createWorkItemUseCase,
  registerDomainPackage,
  registerWorkflow,
  releaseResourceReservationUseCase,
  reserveResourceUseCase,
  transitionWorkItemUseCase,
  updateWorkItemFieldsUseCase,
} from '@/application/use-cases';
import { CommandBus, type CommandBusOptions } from '@/application/command-bus';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { Actor } from '@/domain/auth/auth';
import type { CommandEnvelope } from '@/primitives/command';
import {
  FieldSchemaSchema,
  JsonObjectSchema,
  NonEmptyStringSchema,
  PackageCapabilitySchema,
  PackageDependencySchema,
  PackageLifecycleSchema,
  PackageMigrationsSchema,
  SemverSchema,
  WorkflowDefinitionSchema,
} from '@/validation/schemas';

export const KernelCommandType = Object.freeze({
  WorkCreate: 'work.create',
  WorkUpdateFields: 'work.update_fields',
  WorkTransition: 'work.transition',
  WorkAssign: 'work.assign',
  WorkAddComment: 'work.add_comment',
  WorkAddDecision: 'work.add_decision',
  ResourceCreate: 'resource.create',
  ResourceReserve: 'resource.reserve',
  ResourceReleaseReservation: 'resource.release_reservation',
  WorkflowRegister: 'workflow.register',
  PackageRegister: 'package.register',
} as const);

export type KernelCommandType = (typeof KernelCommandType)[keyof typeof KernelCommandType];

export type CommandActorResolver = (command: CommandEnvelope) => Actor;

export type DefaultCommandRegistryOptions = {
  resolveActor: CommandActorResolver;
  commandBus?: CommandBusOptions | undefined;
};

const ExpectedVersionSchema = z.number().int().positive().optional();

export const WorkCreatePayloadSchema = z
  .object({
    type: NonEmptyStringSchema,
    fields: JsonObjectSchema.optional(),
  })
  .strict();

export const WorkUpdateFieldsPayloadSchema = z
  .object({
    workItemId: NonEmptyStringSchema,
    fields: JsonObjectSchema,
    expectedVersion: ExpectedVersionSchema,
  })
  .strict();

export const WorkTransitionPayloadSchema = z
  .object({
    workItemId: NonEmptyStringSchema,
    action: NonEmptyStringSchema,
    expectedVersion: ExpectedVersionSchema,
  })
  .strict();

export const WorkAssignPayloadSchema = z
  .object({
    workItemId: NonEmptyStringSchema,
    assigneeId: NonEmptyStringSchema,
    expectedVersion: ExpectedVersionSchema,
  })
  .strict();

export const WorkAddCommentPayloadSchema = z
  .object({
    workItemId: NonEmptyStringSchema,
    text: NonEmptyStringSchema,
    expectedVersion: ExpectedVersionSchema,
  })
  .strict();

export const WorkAddDecisionPayloadSchema = z
  .object({
    workItemId: NonEmptyStringSchema,
    decisionType: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    expectedVersion: ExpectedVersionSchema,
  })
  .strict();

export const ResourceCreatePayloadSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    fields: JsonObjectSchema.optional(),
  })
  .strict();

export const ResourceReservePayloadSchema = z
  .object({
    workItemId: NonEmptyStringSchema,
    resourceId: NonEmptyStringSchema,
    quantity: z.number().positive().optional(),
    fields: JsonObjectSchema.optional(),
  })
  .strict();

export const ResourceReleaseReservationPayloadSchema = z
  .object({
    workItemId: NonEmptyStringSchema,
    resourceId: NonEmptyStringSchema,
    quantity: z.number().positive().optional(),
  })
  .strict();

export const WorkflowRegisterPayloadSchema = z
  .object({
    workflow: WorkflowDefinitionSchema,
  })
  .strict();

export const PackageRegisterPayloadSchema = z
  .object({
    name: NonEmptyStringSchema,
    version: SemverSchema.optional(),
    workflow: WorkflowDefinitionSchema,
    schema: FieldSchemaSchema,
    migrations: PackageMigrationsSchema.optional(),
    fixtures: z.array(NonEmptyStringSchema).optional(),
    kernelVersion: SemverSchema.optional(),
    dependencies: z.array(PackageDependencySchema).optional(),
    capabilities: z.array(PackageCapabilitySchema).optional(),
    lifecycle: PackageLifecycleSchema.optional(),
    sourcePath: z.string().optional(),
  })
  .strict();

export const KernelCommandPayloadSchemas = Object.freeze({
  [KernelCommandType.WorkCreate]: WorkCreatePayloadSchema,
  [KernelCommandType.WorkUpdateFields]: WorkUpdateFieldsPayloadSchema,
  [KernelCommandType.WorkTransition]: WorkTransitionPayloadSchema,
  [KernelCommandType.WorkAssign]: WorkAssignPayloadSchema,
  [KernelCommandType.WorkAddComment]: WorkAddCommentPayloadSchema,
  [KernelCommandType.WorkAddDecision]: WorkAddDecisionPayloadSchema,
  [KernelCommandType.ResourceCreate]: ResourceCreatePayloadSchema,
  [KernelCommandType.ResourceReserve]: ResourceReservePayloadSchema,
  [KernelCommandType.ResourceReleaseReservation]: ResourceReleaseReservationPayloadSchema,
  [KernelCommandType.WorkflowRegister]: WorkflowRegisterPayloadSchema,
  [KernelCommandType.PackageRegister]: PackageRegisterPayloadSchema,
} as const);

export function createDefaultCommandBus(
  deps: ApplicationDependencies,
  options: DefaultCommandRegistryOptions
): CommandBus {
  return registerDefaultCommandHandlers(new CommandBus(deps, options.commandBus), options);
}

export function registerDefaultCommandHandlers(
  bus: CommandBus,
  options: DefaultCommandRegistryOptions
): CommandBus {
  const actor = (command: CommandEnvelope) => options.resolveActor(command);

  return bus
    .register({
      type: KernelCommandType.WorkCreate,
      payload: { schema: WorkCreatePayloadSchema },
      handle: ({ deps, command }) =>
        createWorkItemUseCase(deps, {
          type: command.payload.type,
          ...(command.payload.fields != null ? { fields: command.payload.fields } : {}),
          actor: actor(command),
        }),
    })
    .register({
      type: KernelCommandType.WorkUpdateFields,
      payload: { schema: WorkUpdateFieldsPayloadSchema },
      handle: ({ deps, command }) =>
        updateWorkItemFieldsUseCase(deps, { ...command.payload, actor: actor(command) }),
    })
    .register({
      type: KernelCommandType.WorkTransition,
      payload: { schema: WorkTransitionPayloadSchema },
      handle: ({ deps, command }) =>
        transitionWorkItemUseCase(deps, { ...command.payload, actor: actor(command) }),
    })
    .register({
      type: KernelCommandType.WorkAssign,
      payload: { schema: WorkAssignPayloadSchema },
      handle: ({ deps, command }) =>
        assignWorkItemUseCase(deps, { ...command.payload, actor: actor(command) }),
    })
    .register({
      type: KernelCommandType.WorkAddComment,
      payload: { schema: WorkAddCommentPayloadSchema },
      handle: ({ deps, command }) =>
        addCommentUseCase(deps, { ...command.payload, actor: actor(command) }),
    })
    .register({
      type: KernelCommandType.WorkAddDecision,
      payload: { schema: WorkAddDecisionPayloadSchema },
      handle: ({ deps, command }) =>
        addDecisionUseCase(deps, { ...command.payload, actor: actor(command) }),
    })
    .register({
      type: KernelCommandType.ResourceCreate,
      payload: { schema: ResourceCreatePayloadSchema },
      handle: ({ deps, command }) =>
        createResourceUseCase(deps, {
          id: command.payload.id,
          type: command.payload.type,
          ...(command.payload.fields != null ? { fields: command.payload.fields } : {}),
          actor: actor(command),
        }),
    })
    .register({
      type: KernelCommandType.ResourceReserve,
      payload: { schema: ResourceReservePayloadSchema },
      handle: ({ deps, command }) =>
        reserveResourceUseCase(deps, {
          workItemId: command.payload.workItemId,
          resourceId: command.payload.resourceId,
          ...(command.payload.quantity != null ? { quantity: command.payload.quantity } : {}),
          ...(command.payload.fields != null ? { fields: command.payload.fields } : {}),
          actor: actor(command),
        }),
    })
    .register({
      type: KernelCommandType.ResourceReleaseReservation,
      payload: { schema: ResourceReleaseReservationPayloadSchema },
      handle: ({ deps, command }) =>
        releaseResourceReservationUseCase(deps, {
          workItemId: command.payload.workItemId,
          resourceId: command.payload.resourceId,
          ...(command.payload.quantity != null ? { quantity: command.payload.quantity } : {}),
          actor: actor(command),
        }),
    })
    .register({
      type: KernelCommandType.WorkflowRegister,
      payload: { schema: WorkflowRegisterPayloadSchema },
      handle: ({ deps, command }) =>
        registerWorkflow(deps, { ...command.payload, actor: actor(command) }),
    })
    .register({
      type: KernelCommandType.PackageRegister,
      payload: { schema: PackageRegisterPayloadSchema },
      handle: ({ deps, command }) =>
        registerDomainPackage(deps, {
          name: command.payload.name,
          ...(command.payload.version != null ? { version: command.payload.version } : {}),
          workflow: command.payload.workflow,
          schema: command.payload.schema,
          ...(command.payload.migrations != null ? { migrations: command.payload.migrations } : {}),
          ...(command.payload.fixtures != null ? { fixtures: command.payload.fixtures } : {}),
          ...(command.payload.kernelVersion != null ? { kernelVersion: command.payload.kernelVersion } : {}),
          ...(command.payload.dependencies != null ? { dependencies: command.payload.dependencies } : {}),
          ...(command.payload.capabilities != null ? { capabilities: command.payload.capabilities } : {}),
          ...(command.payload.lifecycle != null ? { lifecycle: command.payload.lifecycle } : {}),
          ...(command.payload.sourcePath != null ? { sourcePath: command.payload.sourcePath } : {}),
          actor: actor(command),
        }),
    });
}
