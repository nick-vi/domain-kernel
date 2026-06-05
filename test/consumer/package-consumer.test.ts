import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const tempDirs: string[] = [];

describe('package consumer surface', () => {
  afterEach(async () => {
    const directories = tempDirs.splice(0);
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('imports the built root and CLI exports from an external project', async () => {
    const project = await createConsumerProject();
    const scriptPath = join(project, 'consumer.mjs');

    await writeFile(
      scriptPath,
      `
        import * as kernel from 'domain-kernel';
        import { createProgram } from 'domain-kernel/cli';

        const result = kernel.primitives.Ok(1).map((value) => value + 1);
        if (!result.ok || result.value !== 2) {
          throw new Error('Result primitive export failed');
        }

        const program = createProgram();
        if (program.name() !== 'domain') {
          throw new Error('CLI export failed');
        }

        console.log(JSON.stringify({ ok: true, namespaces: Object.keys(kernel).sort() }));
      `
    );

    const { stdout } = await runCommand('node', [scriptPath], project);
    const output = JSON.parse(stdout.trim()) as { ok: boolean; namespaces: string[] };

    expect(output.ok).toBe(true);
    expect(output.namespaces).toContain('primitives');
    expect(output.namespaces).toContain('ports');
  });

  it('typechecks generated declarations from an external TypeScript project', async () => {
    const project = await createConsumerProject();
    const sourceDir = join(project, 'src');

    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(project, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            strict: true,
            noEmit: true,
            skipLibCheck: false,
          },
          include: ['src/**/*.ts'],
        },
        null,
        2
      )
    );
    await writeFile(
      join(sourceDir, 'index.ts'),
      `
        import * as kernel from 'domain-kernel';
        import { createProgram } from 'domain-kernel/cli';

        const result = kernel.primitives.Ok(1).flatMap((value) => kernel.primitives.Ok(value + 1));
        const context: kernel.ports.ObservationContext = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736' };
        const programName: string = createProgram().name();

        if (!result.ok) {
          throw new Error(programName + context.traceId);
        }
      `
    );

    await runCommand(
      join(rootDir, 'node_modules', '.bin', 'tsc'),
      ['-p', join(project, 'tsconfig.json'), '--pretty', 'false'],
      project
    );
  });

  it('emits declaration files without repo-only path aliases', async () => {
    const declarations = await readDeclarationTree(join(rootDir, 'dist', 'types'));

    expect(declarations).not.toContain('@/');
  });
});

async function createConsumerProject(): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), 'domain-kernel-consumer-'));
  tempDirs.push(project);

  const nodeModules = join(project, 'node_modules');
  await mkdir(nodeModules, { recursive: true });
  await symlink(rootDir, join(nodeModules, 'domain-kernel'), 'dir');
  await writeFile(join(project, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

  return project;
}

function runCommand(command: string, args: string[], cwd: string): Promise<{ stdout: string }> {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(command, args, { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error != null) {
        rejectCommand(
          new Error(
            [
              `Command failed: ${command} ${args.join(' ')}`,
              stdout.trim(),
              stderr.trim(),
            ]
              .filter((line) => line !== '')
              .join('\n')
          )
        );
        return;
      }

      resolveCommand({ stdout });
    });
  });
}

async function readDeclarationTree(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      contents.push(await readDeclarationTree(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      contents.push(await readFile(entryPath, 'utf8'));
    }
  }

  return contents.join('\n');
}
