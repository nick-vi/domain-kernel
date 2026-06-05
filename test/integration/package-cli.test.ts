import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { DomainPackage } from '@/domain/package/domain-package';
import { createTempDir, removeTempDir } from '../support/application';

const execFileAsync = promisify(execFile);

describe('package CLI', () => {
  it('scaffolds a package skeleton and registers it from the manifest', async () => {
    const dataDir = await createTempDir();
    const packagesDir = await createTempDir();
    try {
      const scaffolded = await runCliJson<{ path: string; files: string[] }>(dataDir, [
        'package',
        'scaffold',
        'billing',
        '--type',
        'invoice',
        '--dir',
        packagesDir,
        '--package-version',
        '1.0.0',
        '--json',
      ]);

      expect(scaffolded.files).toContain('domain-package.json');
      await access(`${scaffolded.path}/domain-package.json`);
      await access(`${scaffolded.path}/workflow.json`);
      await access(`${scaffolded.path}/schema.json`);
      await access(`${scaffolded.path}/migrations.json`);

      await runCli(dataDir, ['package', 'register', scaffolded.path, '--json']);
      const inspected = await runCliJson<DomainPackage>(dataDir, [
        'package',
        'inspect',
        'billing',
        '--json',
      ]);

      expect(inspected).toMatchObject({
        name: 'billing',
        version: '1.0.0',
        workflowType: 'invoice',
        lifecycle: { status: 'active' },
      });

      await runCli(dataDir, [
        'package',
        'register',
        scaffolded.path,
        '--package-version',
        '1.1.0',
        '--json',
      ]);

      const graph = await runCliJson<{ installOrder: string[] }>(dataDir, [
        'package',
        'graph',
        '--json',
      ]);
      expect(graph.installOrder).toEqual(['billing']);

      const diff = await runCliJson<{ status: string }>(dataDir, [
        'package',
        'diff',
        'billing',
        '--from',
        '1.0.0',
        '--to',
        '1.1.0',
        '--json',
      ]);
      expect(diff.status).toBe('compatible');
    } finally {
      await removeTempDir(dataDir);
      await removeTempDir(packagesDir);
    }
  });

  it('registers the sample products package with migrations from disk', async () => {
    const dataDir = await createTempDir();
    try {
      await runCli(dataDir, [
        'package',
        'register',
        'examples/packages/sample-products',
        '--json',
      ]);

      const inspected = await runCliJson<DomainPackage>(dataDir, [
        'package',
        'inspect',
        'sample-products',
        '--json',
      ]);

      expect(inspected).toMatchObject({
        name: 'sample-products',
        version: '1.1.0',
        workflowType: 'product',
        migrations: [
          expect.objectContaining({
            id: 'sample-products-1-1-barcode',
            fromVersion: '1.0.0',
            toVersion: '1.1.0',
          }),
        ],
      });
    } finally {
      await removeTempDir(dataDir);
    }
  });

  it('validates package fixtures and exports kernel contracts', async () => {
    const dataDir = await createTempDir();
    try {
      const report = await runCliJson<{ fixtureCount: number; registered: boolean }>(dataDir, [
        'package',
        'test',
        'examples/packages/sample-products',
        '--json',
      ]);
      expect(report.fixtureCount).toBe(2);
      expect(report.registered).toBe(false);

      const contracts = await runCliJson<{ asyncapi: string; components: unknown }>(dataDir, [
        'package',
        'contracts',
        '--asyncapi',
      ]);
      expect(contracts.asyncapi).toBe('3.1.0');
      expect(contracts.components).toBeDefined();
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
