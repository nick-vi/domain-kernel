import { basename, relative, resolve } from 'node:path';
import { Command } from 'commander';
import { z } from 'zod';
import { buildPackageEvolutionReport } from '@/application/package-evolution';
import { buildPackageGraph } from '@/application/package-graph';
import { createKernelContractCatalog } from '@/application/contract-catalog';
import {
  testDomainPackage,
  type DomainPackageFixture,
  type DomainPackageTestReport,
} from '@/application/package-test-harness';
import {
  inspectDomainPackage,
  listDomainPackages,
  registerDomainPackage,
} from '@/application/use-cases';
import { runPackageMigrations } from '@/application/package-migration-runner';
import {
  ensureDir,
  listFilesRecursive,
  loadConfigFile,
  pathExists,
  readJson,
  RandomFileTempNames,
  writeJsonAtomic,
} from '@/adapters/fs';
import { createCliDependencies, resolveActor, type CliGlobalOptions } from '@/cli/context';
import { printJson, runAction } from '@/cli/output';
import { printDomainPackage, printDomainPackageList } from '@/cli/output-formatters';
import type {
  FieldSchema,
  PackageCapability,
  PackageDependency,
  PackageLifecycle,
  PackageMigration,
} from '@/domain/package/domain-package';
import type { WorkflowDefinition } from '@/domain/workflow/workflow-definition';
import { compareStrings } from '@/primitives/string';
import {
  DomainPackageManifestSchema,
  FieldSchemaSchema,
  JsonObjectSchema,
  NonEmptyStringSchema,
  PackageMigrationsSchema,
  WorkflowDefinitionSchema,
} from '@/validation/schemas';

export function createPackageCommand(getGlobals: () => CliGlobalOptions): Command {
  const packageCommand = new Command('package').description('Manage domain packages');

  packageCommand
    .command('test')
    .description('Validate a domain package directory')
    .argument('<path>', 'package directory')
    .option('--name <name>', 'package name; defaults to directory name')
    .option('--package-version <version>', 'package semantic version')
    .option('--register', 'register the package after validation')
    .option('--json', 'print JSON output')
    .action(
      (
        path: string,
        options: {
          name?: string;
          packageVersion?: string;
          register?: boolean;
          json?: boolean;
        }
      ) =>
        runAction(async () => {
          const packagePath = resolve(path);
          const workflow = await loadConfigFile<WorkflowDefinition>(
            resolve(packagePath, 'workflow.json'),
            WorkflowDefinitionSchema
          );
          const schema = await loadConfigFile<FieldSchema>(
            resolve(packagePath, 'schema.json'),
            FieldSchemaSchema
          );
          const fixtures = await loadFixtureData(packagePath, schema.type);
          const migrations = await loadPackageMigrations(packagePath);
          const manifest = await loadPackageManifest(packagePath);
          const globals = getGlobals();
          const report = await testDomainPackage(createCliDependencies(globals), {
            name: options.name ?? manifest.name ?? basename(packagePath),
            version: options.packageVersion ?? manifest.version,
            workflow,
            schema,
            migrations,
            fixtures,
            ...(manifest.kernelVersion != null ? { kernelVersion: manifest.kernelVersion } : {}),
            ...(manifest.dependencies != null ? { dependencies: manifest.dependencies } : {}),
            ...(manifest.capabilities != null ? { capabilities: manifest.capabilities } : {}),
            ...(manifest.lifecycle != null ? { lifecycle: manifest.lifecycle } : {}),
            sourcePath: packagePath,
            actor: resolveActor(globals.actor),
            register: options.register === true,
          });
          if (!report.ok) throw report.error;
          printDomainPackageTestReport(report.value, options.json === true);
        })
    );

  packageCommand
    .command('register')
    .description('Register a domain package directory')
    .argument('<path>', 'package directory')
    .option('--name <name>', 'package name; defaults to directory name')
    .option('--package-version <version>', 'package semantic version')
    .option('--json', 'print JSON output')
    .action((path: string, options: { name?: string; packageVersion?: string; json?: boolean }) =>
      runAction(async () => {
        const packagePath = resolve(path);
        const workflow = await loadConfigFile<WorkflowDefinition>(
          resolve(packagePath, 'workflow.json'),
          WorkflowDefinitionSchema
        );
        const schema = await loadConfigFile<FieldSchema>(
          resolve(packagePath, 'schema.json'),
          FieldSchemaSchema
        );
        const fixtures = await loadFixtureNames(packagePath);
        const migrations = await loadPackageMigrations(packagePath);
        const manifest = await loadPackageManifest(packagePath);
        const globals = getGlobals();
        const domainPackage = await registerDomainPackage(createCliDependencies(globals), {
          name: options.name ?? manifest.name ?? basename(packagePath),
          version: options.packageVersion ?? manifest.version,
          workflow,
          schema,
          migrations,
          fixtures,
          ...(manifest.kernelVersion != null ? { kernelVersion: manifest.kernelVersion } : {}),
          ...(manifest.dependencies != null ? { dependencies: manifest.dependencies } : {}),
          ...(manifest.capabilities != null ? { capabilities: manifest.capabilities } : {}),
          ...(manifest.lifecycle != null ? { lifecycle: manifest.lifecycle } : {}),
          sourcePath: packagePath,
          actor: resolveActor(globals.actor),
        });
        printDomainPackage(domainPackage, options.json === true);
      })
    );

  packageCommand
    .command('scaffold')
    .description('Create a generic domain package skeleton')
    .argument('<name>', 'package name')
    .option('--type <type>', 'workflow/schema type; defaults to package name')
    .option('--dir <path>', 'parent directory', '.')
    .option('--package-version <version>', 'initial semantic version', '0.1.0')
    .option('--json', 'print JSON output')
    .action(
      (
        name: string,
        options: { type?: string; dir: string; packageVersion: string; json?: boolean }
      ) =>
        runAction(async () => {
          const packagePath = resolve(options.dir, name);
          if (await pathExists(packagePath)) {
            throw new Error(`Package directory already exists: ${packagePath}`);
          }

          const type = options.type ?? name;
          const tempNames = new RandomFileTempNames();
          const workflow: WorkflowDefinition = {
            type,
            states: ['draft', 'active', 'closed'],
            transitions: [
              { action: 'start', from: 'draft', to: 'active' },
              { action: 'close', from: 'active', to: 'closed' },
            ],
            closedStates: ['closed'],
          };
          const schema: FieldSchema = {
            type,
            fields: {},
          };

          await ensureDir(resolve(packagePath, 'fixtures'));
          await writeJsonAtomic(
            resolve(packagePath, 'domain-package.json'),
            {
              name,
              version: options.packageVersion,
              lifecycle: { status: 'active' },
            },
            tempNames
          );
          await writeJsonAtomic(resolve(packagePath, 'workflow.json'), workflow, tempNames);
          await writeJsonAtomic(resolve(packagePath, 'schema.json'), schema, tempNames);
          await writeJsonAtomic(resolve(packagePath, 'migrations.json'), [], tempNames);

          const result = {
            name,
            version: options.packageVersion,
            type,
            path: packagePath,
            files: [
              'domain-package.json',
              'workflow.json',
              'schema.json',
              'migrations.json',
              'fixtures/',
            ],
          };

          if (options.json === true) {
            printJson(result);
            return;
          }

          printJson(result);
        })
    );

  packageCommand
    .command('migrate')
    .description('Plan or record package migrations')
    .argument('<name>', 'package name')
    .requiredOption('--from <version>', 'source version')
    .requiredOption('--to <version>', 'target version')
    .option('--dry-run', 'only return the planned migration steps')
    .option('--json', 'print JSON output')
    .action(
      (
        name: string,
        options: { from: string; to: string; dryRun?: boolean; json?: boolean }
      ) =>
        runAction(async () => {
          const globals = getGlobals();
          const result = await runPackageMigrations(createCliDependencies(globals), {
            packageName: name,
            fromVersion: options.from,
            toVersion: options.to,
            dryRun: options.dryRun === true,
          });
          printJson(result);
        })
    );

  packageCommand
    .command('graph')
    .description('Inspect registered package dependencies')
    .option('--json', 'print JSON output')
    .action((options: { json?: boolean }) =>
      runAction(async () => {
        const graph = buildPackageGraph(await createCliDependencies(getGlobals()).packages.list());
        printPackageGraph(graph, options.json === true);
      })
    );

  packageCommand
    .command('contracts')
    .description('Print kernel command and event contracts')
    .option('--asyncapi', 'print an AsyncAPI document')
    .option('--title <title>', 'AsyncAPI document title', 'Domain Kernel Contracts')
    .option('--contract-version <version>', 'AsyncAPI document version', '1.0.0')
    .action((options: { asyncapi?: boolean; title: string; contractVersion: string }) =>
      runAction(async () => {
        const catalog = createKernelContractCatalog();
        printJson(
          options.asyncapi === true
            ? catalog.toAsyncApi({
                title: options.title,
                version: options.contractVersion,
              })
            : catalog.toDocument()
        );
      })
    );

  packageCommand
    .command('diff')
    .description('Report workflow/schema evolution between package versions')
    .argument('<name>', 'package name')
    .requiredOption('--from <version>', 'source version')
    .requiredOption('--to <version>', 'target version')
    .option('--json', 'print JSON output')
    .action(
      (name: string, options: { from: string; to: string; json?: boolean }) =>
        runAction(async () => {
          const deps = createCliDependencies(getGlobals());
          const from = await deps.packages.getByNameAndVersion(name, options.from);
          const to = await deps.packages.getByNameAndVersion(name, options.to);
          if (from == null) throw new Error(`Package "${name}@${options.from}" is not registered`);
          if (to == null) throw new Error(`Package "${name}@${options.to}" is not registered`);

          const report = buildPackageEvolutionReport(from, to);
          printPackageEvolutionReport(report, options.json === true);
        })
    );

  packageCommand
    .command('list')
    .description('List registered domain packages')
    .option('--json', 'print JSON output')
    .action((options: { json?: boolean }) =>
      runAction(async () => {
        const globals = getGlobals();
        const domainPackages = await listDomainPackages(
          createCliDependencies(globals),
          resolveActor(globals.actor)
        );
        printDomainPackageList(domainPackages, options.json === true);
      })
    );

  packageCommand
    .command('inspect')
    .description('Inspect a registered domain package')
    .argument('<name>', 'package name')
    .option('--json', 'print JSON output')
    .action((name: string, options: { json?: boolean }) =>
      runAction(async () => {
        const globals = getGlobals();
        const domainPackage = await inspectDomainPackage(createCliDependencies(globals), {
          name,
          actor: resolveActor(globals.actor),
        });
        printDomainPackage(domainPackage, options.json === true);
      })
    );

  return packageCommand;
}

const PackageFixtureFileSchema = z
  .object({
    type: NonEmptyStringSchema.optional(),
    fields: JsonObjectSchema,
  })
  .strict();

async function loadPackageMigrations(packagePath: string): Promise<PackageMigration[]> {
  const migrationsPath = resolve(packagePath, 'migrations.json');
  if (!(await pathExists(migrationsPath))) {
    return [];
  }

  return loadConfigFile<PackageMigration[]>(migrationsPath, PackageMigrationsSchema);
}

async function loadPackageManifest(
  packagePath: string
): Promise<{
  name?: string | undefined;
  version?: string | undefined;
  kernelVersion?: string | undefined;
  dependencies?: PackageDependency[] | undefined;
  capabilities?: PackageCapability[] | undefined;
  lifecycle?: PackageLifecycle | undefined;
}> {
  const manifestPath = resolve(packagePath, 'domain-package.json');
  if (!(await pathExists(manifestPath))) {
    return {};
  }

  return loadConfigFile(manifestPath, DomainPackageManifestSchema);
}

async function loadFixtureNames(packagePath: string): Promise<string[]> {
  const fixturesRoot = resolve(packagePath, 'fixtures');
  if (!(await pathExists(fixturesRoot))) {
    return [];
  }

  const files = await listFilesRecursive(fixturesRoot);
  return files.map((file) => relative(fixturesRoot, file)).sort(compareStrings);
}

async function loadFixtureData(
  packagePath: string,
  schemaType: string
): Promise<DomainPackageFixture[]> {
  const fixturesRoot = resolve(packagePath, 'fixtures');
  if (!(await pathExists(fixturesRoot))) {
    return [];
  }

  const files = await listFilesRecursive(fixturesRoot);
  const fixtures = await Promise.all(
    files.map(async (file) => {
      const fixture = await readJson(file, PackageFixtureFileSchema);
      if (fixture.type != null && fixture.type !== schemaType) {
        throw new Error(
          `Fixture "${relative(fixturesRoot, file)}" type "${fixture.type}" does not match package type "${schemaType}"`
        );
      }
      return {
        name: relative(fixturesRoot, file),
        fields: fixture.fields,
      };
    })
  );

  return fixtures.sort((left, right) => compareStrings(left.name, right.name));
}

function printDomainPackageTestReport(report: DomainPackageTestReport, json: boolean): void {
  if (json) {
    printJson(report);
    return;
  }

  console.log(
    `${report.packageName}@${report.version} workflow=${report.workflowType} checks=${report.checks.length}`
  );
  console.log(`fixtures: ${report.fixtureCount}`);
  console.log(`registered: ${String(report.registered)}`);
  for (const check of report.checks) {
    console.log(`  ${check.name}: ${check.status}`);
  }
}

function printPackageGraph(graph: ReturnType<typeof buildPackageGraph>, json: boolean): void {
  if (json) {
    printJson(graph);
    return;
  }

  if (graph.nodes.length === 0) {
    console.log('No domain packages registered.');
    return;
  }

  console.log(`packages: ${graph.nodes.length}`);
  console.log(`install order: ${graph.installOrder.join(', ') || '(empty)'}`);
  if (graph.missing.length > 0) {
    console.log('missing dependencies:');
    for (const edge of graph.missing) {
      console.log(`  ${edge.from} -> ${edge.to}`);
    }
  }
  if (graph.cycles.length > 0) {
    console.log('cycles:');
    for (const cycle of graph.cycles) {
      console.log(`  ${cycle.join(' -> ')}`);
    }
  }
}

function printPackageEvolutionReport(
  report: ReturnType<typeof buildPackageEvolutionReport>,
  json: boolean
): void {
  if (json) {
    printJson(report);
    return;
  }

  console.log(`${report.packageName}: ${report.fromVersion} -> ${report.toVersion}`);
  console.log(`status: ${report.status}`);
  console.log(`version bump: ${report.versionBump} required=${report.requiredVersionBump}`);
  if (report.findings.length === 0) {
    console.log('findings: none');
    return;
  }

  console.log('findings:');
  for (const finding of report.findings) {
    console.log(`  ${finding.severity} ${finding.code} ${finding.path}: ${finding.message}`);
  }
}
