import type { AuditEventType } from '@/domain/event/audit-event';
import { KernelCommandPayloadSchemas } from '@/application/default-command-registry';
import { compareVersions, parseVersion } from '@/primitives/migration';
import { Err, Ok, type Result } from '@/primitives/result';
import {
  type SafeParseSchema,
  type ValidationError,
  validateUnknown,
} from '@/primitives/schema';
import { compareStrings } from '@/primitives/string';
import { AuditEventSchema } from '@/validation/schemas';

export const ContractKind = Object.freeze({
  Command: 'command',
  Event: 'event',
} as const);

export type ContractKind = (typeof ContractKind)[keyof typeof ContractKind];

export type ContractDefinition<T = unknown> = {
  kind: ContractKind;
  type: string;
  version: string;
  description?: string | undefined;
  schema?: SafeParseSchema<T> | undefined;
  jsonSchema?: Record<string, unknown> | undefined;
  deprecated?: boolean | undefined;
};

export type ContractDocument = {
  contracts: ContractDocumentEntry[];
};

export type ContractDocumentEntry = {
  kind: ContractKind;
  type: string;
  version: string;
  description?: string | undefined;
  deprecated?: boolean | undefined;
};

export type AsyncApiContractDocument = {
  asyncapi: '3.1.0';
  info: {
    title: string;
    version: string;
  };
  defaultContentType: 'application/json';
  channels: Record<string, { address: string; messages: Record<string, { $ref: string }> }>;
  operations: Record<
    string,
    { action: 'send' | 'receive'; channel: { $ref: string }; messages: Array<{ $ref: string }> }
  >;
  components: {
    messages: Record<
      string,
      {
        name: string;
        title: string;
        headers: Record<string, unknown>;
        payload: Record<string, unknown>;
        correlationId: { location: string };
      }
    >;
  };
};

export class ContractCatalog {
  private readonly contracts = new Map<string, ContractDefinition>();

  register<T>(contract: ContractDefinition<T>): this {
    const version = parseVersion(contract.version);
    if (!version.ok) {
      throw new ContractCatalogError(version.error.message);
    }

    const key = contractKey(contract.kind, contract.type, contract.version);
    if (this.contracts.has(key)) {
      throw new ContractCatalogError(`Contract "${key}" is already registered`);
    }

    this.contracts.set(key, contract as ContractDefinition);
    return this;
  }

  get(input: {
    kind: ContractKind;
    type: string;
    version?: string | undefined;
  }): ContractDefinition | undefined {
    if (input.version != null) {
      return this.contracts.get(contractKey(input.kind, input.type, input.version));
    }

    return this.list({ kind: input.kind, type: input.type }).at(-1);
  }

  list(query: { kind?: ContractKind | undefined; type?: string | undefined } = {}): ContractDefinition[] {
    return [...this.contracts.values()]
      .filter((contract) => query.kind == null || contract.kind === query.kind)
      .filter((contract) => query.type == null || contract.type === query.type)
      .sort(
        (left, right) =>
          compareStrings(left.kind, right.kind) ||
          compareStrings(left.type, right.type) ||
          compareContractVersions(left.version, right.version)
      );
  }

  validate<T = unknown>(input: {
    kind: ContractKind;
    type: string;
    version?: string | undefined;
    value: unknown;
  }): Result<T, ValidationError | ContractCatalogError> {
    const contract = this.get(input);
    if (contract == null) {
      return Err(
        new ContractCatalogError(
          `Contract "${contractKey(input.kind, input.type, input.version ?? 'latest')}" is not registered`
        )
      );
    }

    if (contract.schema == null) {
      return Ok(input.value as T);
    }

    return validateUnknown<T>(input.value, {
      schema: contract.schema as SafeParseSchema<T>,
      source: `${contract.kind}:${contract.type}@${contract.version}`,
    });
  }

  toDocument(): ContractDocument {
    return {
      contracts: this.list().map((contract) => ({
        kind: contract.kind,
        type: contract.type,
        version: contract.version,
        ...(contract.description != null ? { description: contract.description } : {}),
        ...(contract.deprecated != null ? { deprecated: contract.deprecated } : {}),
      })),
    };
  }

  toAsyncApi(input: { title: string; version: string }): AsyncApiContractDocument {
    const channels: AsyncApiContractDocument['channels'] = {};
    const operations: AsyncApiContractDocument['operations'] = {};
    const messages: AsyncApiContractDocument['components']['messages'] = {};

    for (const contract of this.list()) {
      const name = contractMessageName(contract);
      const channelName = contractChannelName(contract);
      const action = contract.kind === ContractKind.Command ? 'receive' : 'send';
      channels[channelName] = {
        address: contract.type,
        messages: {
          [name]: { $ref: `#/components/messages/${name}` },
        },
      };
      operations[`${action}_${name}`] = {
        action,
        channel: { $ref: `#/channels/${channelName}` },
        messages: [{ $ref: `#/channels/${channelName}/messages/${name}` }],
      };
      messages[name] = {
        name: contract.type,
        title: contract.description ?? contract.type,
        headers: contractHeadersSchema(),
        payload: contract.jsonSchema ?? {
          type: 'object',
          additionalProperties: true,
          'x-domain-kernel-contract-version': contract.version,
        },
        correlationId: {
          location: '$message.header#/correlationId',
        },
      };
    }

    return {
      asyncapi: '3.1.0',
      info: {
        title: input.title,
        version: input.version,
      },
      defaultContentType: 'application/json',
      channels,
      operations,
      components: { messages },
    };
  }
}

export class ContractCatalogError extends Error {
  override readonly name = 'ContractCatalogError';
}

export function createKernelContractCatalog(): ContractCatalog {
  const catalog = new ContractCatalog();

  for (const [type, schema] of Object.entries(KernelCommandPayloadSchemas)) {
    catalog.register({
      kind: ContractKind.Command,
      type,
      version: '1.0.0',
      description: `Kernel command ${type}`,
      schema: schema as SafeParseSchema<unknown>,
      jsonSchema: KernelCommandJsonSchemas[type] ?? genericJsonObjectSchema(type),
    });
  }

  for (const type of KernelAuditEventTypes) {
    catalog.register({
      kind: ContractKind.Event,
      type,
      version: '1.0.0',
      description: `Kernel audit event ${type}`,
      schema: auditEventSchemaFor(type),
      jsonSchema: auditEventJsonSchema(type),
    });
  }

  return catalog;
}

export const KernelAuditEventTypes = Object.freeze([
  'WorkItemCreated',
  'WorkItemFieldsUpdated',
  'WorkItemTransitioned',
  'WorkItemAssigned',
  'DecisionAdded',
  'CommentAdded',
  'ResourceCreated',
  'ResourceReserved',
  'ResourceReservationReleased',
] satisfies AuditEventType[]);

function auditEventSchemaFor(type: AuditEventType): SafeParseSchema<unknown> {
  return {
    safeParse(input) {
      const parsed = AuditEventSchema.safeParse(input);
      if (!parsed.success) return parsed;
      if (parsed.data.type === type) return { success: true, data: parsed.data };
      return {
        success: false,
        error: {
          issues: [
            {
              path: ['type'],
              message: `Expected audit event type "${type}"`,
            },
          ],
        },
      };
    },
  };
}

function contractKey(kind: ContractKind, type: string, version: string): string {
  return `${kind}:${type}@${version}`;
}

function compareContractVersions(left: string, right: string): number {
  return compareVersions(left, right).unwrapOr(compareStrings(left, right));
}

function contractMessageName(contract: ContractDefinition): string {
  return safeName(`${contract.kind}_${contract.type}_${contract.version}`);
}

function contractChannelName(contract: ContractDefinition): string {
  return safeName(`${contract.kind}_${contract.type}`);
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

const KernelCommandJsonSchemas: Record<string, Record<string, unknown>> = {
  'work.create': objectSchema(['type'], {
    type: stringSchema(),
    fields: jsonObjectSchema(),
  }),
  'work.update_fields': objectSchema(['workItemId', 'fields'], {
    workItemId: stringSchema(),
    fields: jsonObjectSchema(),
    expectedVersion: integerSchema(1),
  }),
  'work.transition': objectSchema(['workItemId', 'action'], {
    workItemId: stringSchema(),
    action: stringSchema(),
    expectedVersion: integerSchema(1),
  }),
  'work.assign': objectSchema(['workItemId', 'assigneeId'], {
    workItemId: stringSchema(),
    assigneeId: stringSchema(),
    expectedVersion: integerSchema(1),
  }),
  'work.add_comment': objectSchema(['workItemId', 'text'], {
    workItemId: stringSchema(),
    text: stringSchema(),
    expectedVersion: integerSchema(1),
  }),
  'work.add_decision': objectSchema(['workItemId', 'decisionType', 'reason'], {
    workItemId: stringSchema(),
    decisionType: stringSchema(),
    reason: stringSchema(),
    expectedVersion: integerSchema(1),
  }),
  'resource.create': objectSchema(['id', 'type'], {
    id: stringSchema(),
    type: stringSchema(),
    fields: jsonObjectSchema(),
  }),
  'resource.reserve': objectSchema(['workItemId', 'resourceId'], {
    workItemId: stringSchema(),
    resourceId: stringSchema(),
    quantity: { type: 'number', exclusiveMinimum: 0 },
    fields: jsonObjectSchema(),
  }),
  'resource.release_reservation': objectSchema(['workItemId', 'resourceId'], {
    workItemId: stringSchema(),
    resourceId: stringSchema(),
    quantity: { type: 'number', exclusiveMinimum: 0 },
  }),
  'workflow.register': objectSchema(['workflow'], {
    workflow: genericJsonObjectSchema('workflow'),
  }),
  'package.register': objectSchema(['name', 'workflow', 'schema'], {
    name: stringSchema(),
    version: stringSchema(),
    workflow: genericJsonObjectSchema('workflow'),
    schema: genericJsonObjectSchema('field schema'),
    migrations: { type: 'array', items: genericJsonObjectSchema('migration') },
    fixtures: { type: 'array', items: stringSchema() },
    kernelVersion: stringSchema(),
    dependencies: { type: 'array', items: genericJsonObjectSchema('package dependency') },
    capabilities: { type: 'array', items: genericJsonObjectSchema('package capability') },
    lifecycle: genericJsonObjectSchema('package lifecycle'),
    sourcePath: stringSchema(),
  }),
};

function auditEventJsonSchema(type: string): Record<string, unknown> {
  return objectSchema(['id', 'type', 'actorId', 'occurredAt'], {
    id: stringSchema(),
    type: { const: type },
    actorId: stringSchema(),
    occurredAt: stringSchema('date-time'),
  });
}

function contractHeadersSchema(): Record<string, unknown> {
  return objectSchema([], {
    traceparent: stringSchema(),
    tracestate: stringSchema(),
    baggage: stringSchema(),
    correlationId: stringSchema(),
    causationId: stringSchema(),
  });
}

function objectSchema(required: string[], properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    required,
    properties,
    additionalProperties: false,
  };
}

function stringSchema(format?: string | undefined): Record<string, unknown> {
  return {
    type: 'string',
    minLength: 1,
    ...(format != null ? { format } : {}),
  };
}

function integerSchema(minimum: number): Record<string, unknown> {
  return {
    type: 'integer',
    minimum,
  };
}

function jsonObjectSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: true,
  };
}

function genericJsonObjectSchema(title: string): Record<string, unknown> {
  return {
    title,
    type: 'object',
    additionalProperties: true,
  };
}
