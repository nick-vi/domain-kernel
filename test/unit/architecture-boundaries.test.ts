import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

type LayerName =
  | 'primitives'
  | 'domain'
  | 'ports'
  | 'application'
  | 'adapters'
  | 'cli'
  | 'validation';

type BoundaryRule = {
  root: string;
  forbidden: LayerName[];
};

const rules: BoundaryRule[] = [
  {
    root: 'src/primitives',
    forbidden: ['domain', 'application', 'ports', 'adapters', 'cli', 'validation'],
  },
  {
    root: 'src/domain',
    forbidden: ['application', 'ports', 'adapters', 'cli', 'validation'],
  },
  {
    root: 'src/ports',
    forbidden: ['application', 'adapters', 'cli'],
  },
  {
    root: 'src/application',
    forbidden: ['adapters', 'cli'],
  },
  {
    root: 'src/adapters',
    forbidden: ['cli'],
  },
  {
    root: 'src/validation',
    forbidden: ['application', 'adapters', 'cli'],
  },
];

describe('architecture boundaries', () => {
  it.each(rules)('$root does not import forbidden upper layers', async (rule) => {
    const violations: string[] = [];
    for (const file of await listTypescriptFiles(rule.root)) {
      const modules = importedModules(await readFile(file, 'utf8'));
      for (const module of modules) {
        const layer = importedLayer(file, module);
        const forbidden = layer == null ? undefined : rule.forbidden.find((item) => item === layer);
        if (forbidden != null) {
          violations.push(`${file}: imports ${module}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

async function listTypescriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return listTypescriptFiles(path);
      return entry.isFile() && path.endsWith('.ts') ? [path] : [];
    })
  );
  return files.flat().sort();
}

function importedLayer(fromFile: string, module: string): LayerName | undefined {
  if (module.startsWith('@/')) {
    return layerName(module.slice(2).split('/')[0]);
  }

  if (!module.startsWith('.')) return undefined;

  return layerForPath(normalize(join(dirname(fromFile), module)));
}

function layerForPath(path: string): LayerName | undefined {
  const [root, layer] = relative('.', path).split('/');
  if (root !== 'src') return undefined;
  return layerName(layer);
}

function layerName(value: string | undefined): LayerName | undefined {
  switch (value) {
    case 'primitives':
    case 'domain':
    case 'ports':
    case 'application':
    case 'adapters':
    case 'cli':
    case 'validation':
      return value;
    default:
      return undefined;
  }
}

function importedModules(source: string): string[] {
  const modules: string[] = [];
  const regex = /(?:from\s+|import\()\s*['"]([^'"]+)['"]/g;
  for (;;) {
    const match = regex.exec(source);
    if (match == null) break;
    modules.push(match[1]!);
  }
  return modules;
}
