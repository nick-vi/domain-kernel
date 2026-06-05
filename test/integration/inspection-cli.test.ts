import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FsCommandIdempotencyStore } from '@/adapters/fs/fs-command-idempotency-store';
import { FsHealthReporter } from '@/adapters/fs/fs-health-reporter';
import { FsProcessStore } from '@/adapters/fs/fs-process-store';
import { createProcess, healthCheckResult, HealthStatus } from '@/primitives';
import {
  createTempDir,
  immediateSleep,
  removeTempDir,
  SequenceClock,
  SequenceFileTempNames,
} from '../support/application';

const execFileAsync = promisify(execFile);

describe('inspection CLI', () => {
  it('reads event streams with stored revisions', async () => {
    const dataDir = await createTempDir();
    try {
      await runCli(dataDir, ['package', 'register', 'examples/packages/sample-orders', '--json']);
      const created = await runCliJson<{ id: string }>(dataDir, [
        'create',
        'order',
        '--field',
        'customer=Acme',
        '--field',
        'lines=[{"sku":"A","quantity":1}]',
      ]);

      const stream = await runCliJson<{
        state: { exists: boolean; revision: number };
        events: Array<{ revision: number; type: string }>;
      }>(dataDir, ['events', 'stream', created.id, '--json']);

      expect(stream.state).toEqual({ streamId: created.id, exists: true, revision: 0 });
      expect(stream.events).toEqual([
        expect.objectContaining({ revision: 0, type: 'WorkItemCreated' }),
      ]);
    } finally {
      await removeTempDir(dataDir);
    }
  });

  it('rebuilds, lists, and verifies built-in projections from the CLI', async () => {
    const dataDir = await createTempDir();
    const scratchDir = await createTempDir();
    try {
      await runCli(dataDir, ['package', 'register', 'examples/packages/sample-orders', '--json']);
      await runCliJson<{ id: string }>(dataDir, [
        'create',
        'order',
        '--field',
        'customer=Acme',
        '--field',
        'lines=[{"sku":"A","quantity":1}]',
      ]);

      const rebuilt = await runCliJson<Array<{ projectionName: string; processed: number }>>(
        dataDir,
        ['projection', 'rebuild', 'all', '--json']
      );
      const listed = await runCliJson<Array<{ name: string; recordCount: number }>>(dataDir, [
        'projection',
        'list',
        '--json',
      ]);
      const verified = await runCliJson<Array<{ projectionName: string; status: string }>>(
        dataDir,
        ['projection', 'verify', 'all', '--scratch-dir', scratchDir, '--json']
      );

      expect(rebuilt.map((row) => row.projectionName)).toContain('kernel.work_item_summary');
      expect(rebuilt.some((row) => row.processed > 0)).toBe(true);
      expect(listed).toContainEqual(
        expect.objectContaining({ name: 'kernel.work_item_summary', recordCount: 1 })
      );
      expect(verified.every((row) => row.status === 'matched')).toBe(true);
    } finally {
      await removeTempDir(dataDir);
      await removeTempDir(scratchDir);
    }
  });

  it('lists and prunes command idempotency records from the CLI', async () => {
    const dataDir = await createTempDir();
    try {
      const clock = new SequenceClock();
      const tempNames = new SequenceFileTempNames();
      const store = new FsCommandIdempotencyStore(dataDir, clock, immediateSleep, tempNames);
      const started = await store.begin({
        key: 'idem_cli',
        fingerprint: 'sha256:cli',
        commandId: 'cmd_cli',
        commandType: 'cli.command',
        now: '2026-06-04T12:00:00.000Z',
        inProgressExpiresAt: '2026-06-04T12:01:00.000Z',
      });
      expect(started.ok).toBe(true);

      const listed = await runCliJson<Array<{ key: string; commandType: string }>>(dataDir, [
        'idempotency',
        'list',
        '--json',
      ]);
      const pruned = await runCliJson<{ pruned: number; keys: string[] }>(dataDir, [
        'idempotency',
        'prune',
        '--now',
        '2026-06-04T12:02:00.000Z',
        '--json',
      ]);

      expect(listed).toEqual([
        expect.objectContaining({ key: 'idem_cli', commandType: 'cli.command' }),
      ]);
      expect(pruned).toEqual({ pruned: 1, keys: ['idem_cli'] });
    } finally {
      await removeTempDir(dataDir);
    }
  });

  it('lists process instances and health reports from filesystem ports', async () => {
    const dataDir = await createTempDir();
    try {
      const clock = new SequenceClock();
      const tempNames = new SequenceFileTempNames();
      await new FsProcessStore(dataDir, clock, immediateSleep, tempNames).save(
        createProcess({
          id: 'process_cli_001',
          type: 'cli.process',
          state: { workItemId: 'work_001' },
          now: '2026-06-04T12:00:00.000Z',
        })
      );
      await new FsHealthReporter(dataDir, clock, immediateSleep, tempNames).report(
        healthCheckResult({
          name: 'cli.store',
          status: HealthStatus.Pass,
          checkedAt: '2026-06-04T12:01:00.000Z',
        })
      );

      const processes = await runCliJson<Array<{ id: string; type: string }>>(dataDir, [
        'process',
        'list',
        '--type',
        'cli.process',
        '--json',
      ]);
      const health = await runCliJson<Array<{ name: string; status: string }>>(dataDir, [
        'health',
        'list',
        '--status',
        'pass',
        '--json',
      ]);

      expect(processes).toEqual([
        expect.objectContaining({ id: 'process_cli_001', type: 'cli.process' }),
      ]);
      expect(health).toEqual([
        expect.objectContaining({ name: 'cli.store', status: HealthStatus.Pass }),
      ]);
    } finally {
      await removeTempDir(dataDir);
    }
  });
});

async function runCli(dataDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('node', [
    'dist/cli/index.js',
    '--data-dir',
    dataDir,
    ...args,
  ]);
  return stdout.trim();
}

async function runCliJson<T>(dataDir: string, args: string[]): Promise<T> {
  return JSON.parse(await runCli(dataDir, args)) as T;
}
