import { describe, expect, it } from 'vitest';
import {
  ContractKind,
  KernelCommandType,
  createKernelContractCatalog,
} from '@/application';

describe('ContractCatalog', () => {
  it('validates default kernel command payloads', () => {
    const catalog = createKernelContractCatalog();

    const valid = catalog.validate({
      kind: ContractKind.Command,
      type: KernelCommandType.WorkCreate,
      value: { type: 'order', fields: { customer: 'Acme' } },
    });
    const invalid = catalog.validate({
      kind: ContractKind.Command,
      type: KernelCommandType.WorkCreate,
      value: { fields: { customer: 'Acme' } },
    });

    expect(valid.ok).toBe(true);
    expect(invalid.ok).toBe(false);
  });

  it('validates audit events by exact event type', () => {
    const catalog = createKernelContractCatalog();

    const valid = catalog.validate({
      kind: ContractKind.Event,
      type: 'WorkItemCreated',
      value: {
        id: 'audit_001',
        type: 'WorkItemCreated',
        actorId: 'admin',
        occurredAt: '2026-06-04T12:00:00.000Z',
        workItemId: 'work_001',
        workItemType: 'order',
        state: 'draft',
        fields: {},
        version: 1,
      },
    });
    const wrongType = catalog.validate({
      kind: ContractKind.Event,
      type: 'WorkItemTransitioned',
      value: {
        id: 'audit_001',
        type: 'WorkItemCreated',
        actorId: 'admin',
        occurredAt: '2026-06-04T12:00:00.000Z',
        workItemId: 'work_001',
        workItemType: 'order',
        state: 'draft',
        fields: {},
        version: 1,
      },
    });

    expect(valid.ok).toBe(true);
    expect(wrongType.ok).toBe(false);
  });

  it('returns Err for unknown contracts', () => {
    const result = createKernelContractCatalog().validate({
      kind: ContractKind.Command,
      type: 'unknown.command',
      value: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('is not registered');
  });

  it('exports an AsyncAPI 3.1 contract document', () => {
    const document = createKernelContractCatalog().toAsyncApi({
      title: 'Domain Kernel',
      version: '0.1.0',
    });

    expect(document.asyncapi).toBe('3.1.0');
    expect(document.info).toEqual({ title: 'Domain Kernel', version: '0.1.0' });
    expect(Object.keys(document.channels)).toContain('command_work_create');
    expect(Object.keys(document.components.messages)).toContain('command_work_create_1_0_0');
    expect(document.components.messages.command_work_create_1_0_0?.headers).toMatchObject({
      properties: {
        traceparent: { type: 'string' },
        correlationId: { type: 'string' },
      },
    });
    expect(document.components.messages.command_work_create_1_0_0?.payload).toMatchObject({
      required: ['type'],
      properties: {
        type: { type: 'string', minLength: 1 },
      },
    });
    expect(document.components.messages.command_work_create_1_0_0?.correlationId).toEqual({
      location: '$message.header#/correlationId',
    });
  });
});
