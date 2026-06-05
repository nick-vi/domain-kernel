import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

const aliasPrefix = '@/';
const declarationsRootInput = process.argv[2];

if (declarationsRootInput == null || declarationsRootInput.trim() === '') {
  throw new Error('Usage: node scripts/rewrite-dts-paths.ts <declarations-root>');
}

const declarationsRoot = resolve(declarationsRootInput);
const declarationFiles = await listDeclarationFiles(declarationsRoot);
let changedFiles = 0;

for (const declarationFile of declarationFiles) {
  const source = await readFile(declarationFile, 'utf8');
  const rewritten = rewriteDeclarationImports(source, declarationFile, declarationsRoot);

  if (rewritten !== source) {
    await writeFile(declarationFile, rewritten);
    changedFiles += 1;
  }
}

console.log(`rewrote declaration aliases in ${changedFiles} file(s)`);

async function listDeclarationFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listDeclarationFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

function rewriteDeclarationImports(source: string, filePath: string, root: string): string {
  return source
    .replace(/(from\s+['"])(@\/[^'"]+)(['"])/g, (_match, prefix, specifier, suffix) => {
      return `${prefix}${relativeDeclarationSpecifier(filePath, root, specifier)}${suffix}`;
    })
    .replace(
      /(import\s*\(\s*['"])(@\/[^'"]+)(['"]\s*\))/g,
      (_match, prefix, specifier, suffix) => {
        return `${prefix}${relativeDeclarationSpecifier(filePath, root, specifier)}${suffix}`;
      }
    );
}

function relativeDeclarationSpecifier(
  filePath: string,
  root: string,
  aliasSpecifier: string
): string {
  const target = resolve(root, aliasSpecifier.slice(aliasPrefix.length));
  let specifier = relative(dirname(filePath), target).split(sep).join('/');

  if (!specifier.startsWith('.')) {
    specifier = `./${specifier}`;
  }

  return specifier;
}
