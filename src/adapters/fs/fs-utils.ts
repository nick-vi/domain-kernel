import {
  access,
  appendFile,
  constants,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Clock } from '@/ports/clock';
import { positiveIntegerOption } from '@/primitives/runtime-options';
import { SafeJson } from '@/primitives/safe-json';
import type { SafeParseSchema } from '@/primitives/schema';
import { compareStrings } from '@/primitives/string';
import type { SleepFunction } from '@/primitives/timing';
import {
  addMillisecondsToIsoTimestamp,
  isIsoTimestampAtOrBefore,
  isoTimestampEpochMs,
  parseIsoTimestamp,
} from '@/primitives/time';
import { validateWithSchema } from '@/validation/validate';

export const DEFAULT_FILE_LOCK_RETRY_DELAY_MS = 25;
export const DEFAULT_FILE_LOCK_STALE_MS = 5 * 60_000;
export const DEFAULT_FILE_LOCK_TIMEOUT_MS = 5_000;

export type FileLockOptions = {
  clock: Clock;
  sleep: SleepFunction;
  retryDelayMs?: number | undefined;
  staleMs?: number | undefined;
  timeoutMs?: number | undefined;
};

export type FileTempNames = {
  nextTempName(): string;
};

type FileLockMetadata = {
  acquiredAt: string;
  staleAt: string;
};

type FileLockTime = {
  timestamp: string;
  epochMs: number;
};

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(path: string, schema?: SafeParseSchema<T>): Promise<T> {
  const raw = await readFile(path, 'utf8');
  const parsed = SafeJson.parse<unknown>(raw);
  if (!parsed.ok) {
    throw parsed.error;
  }

  if (schema == null) {
    return parsed.value as T;
  }

  const validated = validateWithSchema(schema, parsed.value, path);
  if (!validated.ok) {
    throw validated.error;
  }
  return validated.value;
}

export async function writeJsonAtomic(
  path: string,
  value: unknown,
  tempNames: FileTempNames
): Promise<void> {
  const serialized = SafeJson.stringify(value, 2);
  if (!serialized.ok) {
    throw serialized.error;
  }
  await writeTempThenRename(path, `${serialized.value}\n`, tempNames);
}

export async function appendJsonl(
  path: string,
  value: unknown,
  options: FileLockOptions
): Promise<void> {
  await appendJsonlBatch(path, [value], options);
}

export async function appendJsonlBatch(
  path: string,
  values: readonly unknown[],
  options: FileLockOptions
): Promise<void> {
  const lines: string[] = [];
  for (const value of values) {
    const serialized = SafeJson.stringify(value);
    if (!serialized.ok) {
      throw serialized.error;
    }
    lines.push(serialized.value);
  }

  if (lines.length === 0) return;

  await withFileLock(path, async () => {
    await appendJsonlBatchUnlocked(path, values);
  }, options);
}

export async function appendJsonlBatchUnlocked(
  path: string,
  values: readonly unknown[]
): Promise<void> {
  const lines: string[] = [];
  for (const value of values) {
    const serialized = SafeJson.stringify(value);
    if (!serialized.ok) {
      throw serialized.error;
    }
    lines.push(serialized.value);
  }

  if (lines.length === 0) return;

  await ensureDir(dirname(path));
  await appendFile(path, `${lines.join('\n')}\n`, 'utf8');
}

export async function appendJsonlUnlocked(path: string, value: unknown): Promise<void> {
  const serialized = SafeJson.stringify(value);
  if (!serialized.ok) {
    throw serialized.error;
  }
  await ensureDir(dirname(path));
  await appendFile(path, `${serialized.value}\n`, 'utf8');
}

export async function readJsonl<T>(path: string, schema?: SafeParseSchema<T>): Promise<T[]> {
  if (!(await pathExists(path))) {
    return [];
  }

  const raw = await readFile(path, 'utf8');
  const values: T[] = [];
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const [index, line] of lines.entries()) {
    const parsed = SafeJson.parse<unknown>(line);
    if (!parsed.ok) {
      throw parsed.error;
    }

    if (schema == null) {
      values.push(parsed.value as T);
      continue;
    }

    const validated = validateWithSchema(schema, parsed.value, `${path}:${index + 1}`);
    if (!validated.ok) {
      throw validated.error;
    }
    values.push(validated.value);
  }

  return values;
}

export function safeJoin(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...segments);
  const rel = relative(resolvedRoot, target);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return target;
  }
  throw new Error(`Path escapes root: ${join(root, ...segments)}`);
}

export async function listFilesRecursive(root: string): Promise<string[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await readdir(root);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry);
      const info = await stat(path);
      if (info.isFile() && (entry.endsWith('.lock') || entry.endsWith('.tmp'))) {
        return [];
      }
      return info.isDirectory() ? listFilesRecursive(path) : [path];
    })
  );

  return files.flat().sort(compareStrings);
}

export async function writeTempThenRename(
  path: string,
  content: string,
  tempNames: FileTempNames
): Promise<void> {
  await ensureDir(dirname(path));
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${fileTempNameSegment(tempNames.nextTempName())}.tmp`
  );
  try {
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function withFileLock<T>(
  path: string,
  fn: () => Promise<T>,
  options: FileLockOptions
): Promise<T> {
  const lockPath = `${path}.lock`;
  const timeoutMs = positiveIntegerOption(
    'timeoutMs',
    options.timeoutMs ?? DEFAULT_FILE_LOCK_TIMEOUT_MS
  );
  const staleMs = positiveIntegerOption('staleMs', options.staleMs ?? DEFAULT_FILE_LOCK_STALE_MS);
  const retryDelayMs = positiveIntegerOption(
    'retryDelayMs',
    options.retryDelayMs ?? DEFAULT_FILE_LOCK_RETRY_DELAY_MS
  );
  const startedAt = fileLockTime(options.clock);
  let acquisitionTime = startedAt;

  await ensureDir(dirname(lockPath));

  for (;;) {
    try {
      await writeFile(lockPath, formatFileLockMetadata(acquisitionTime, staleMs), {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error) {
      if (!isFileExistsError(error)) throw error;

      const now = fileLockTime(options.clock);
      const timedOut = now.epochMs - startedAt.epochMs >= timeoutMs;
      const removed = await removeExpiredLock(lockPath, {
        removeInvalid: timedOut,
        staleAtOrBefore: startedAt.timestamp,
      });
      if (removed) {
        acquisitionTime = now;
        continue;
      }
      if (timedOut) {
        throw new Error(`Timed out acquiring file lock: ${lockPath}`);
      }
      await options.sleep(retryDelayMs);
      acquisitionTime = fileLockTime(options.clock);
      continue;
    }

    try {
      return await fn();
    } finally {
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
}

export async function hashFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

export async function loadConfigFile<T>(path: string, schema?: SafeParseSchema<T>): Promise<T> {
  return readJson<T>(path, schema);
}

export async function resolveProjectRoot(start: string): Promise<string> {
  let current = resolve(start);
  for (;;) {
    if (await pathExists(join(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(start);
    }
    current = parent;
  }
}

export async function removePath(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

export function filenameForId(id: string): string {
  return `${encodeURIComponent(id)}.json`;
}

export function jsonlFilenameForId(id: string): string {
  return `${encodeURIComponent(id)}.jsonl`;
}

async function removeExpiredLock(
  lockPath: string,
  options: { removeInvalid: boolean; staleAtOrBefore: string }
): Promise<boolean> {
  try {
    const raw = await readFile(lockPath, 'utf8');
    const metadata = parseFileLockMetadata(raw);
    const expired =
      metadata == null
        ? options.removeInvalid
        : isIsoTimestampAtOrBefore(metadata.staleAt, options.staleAtOrBefore).unwrap();
    if (!expired) return false;
    await rm(lockPath, { force: true });
    return true;
  } catch {
    // The lock disappeared between attempts.
    return false;
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function formatFileLockMetadata(acquired: FileLockTime, staleMs: number): string {
  const staleAt = addMillisecondsToIsoTimestamp(acquired.timestamp, staleMs).unwrap();
  return `${JSON.stringify({
    acquiredAt: acquired.timestamp,
    staleAt,
  } satisfies FileLockMetadata)}\n`;
}

function parseFileLockMetadata(raw: string): FileLockMetadata | null {
  const parsed = SafeJson.parse<unknown>(raw);
  if (!parsed.ok || !isRecord(parsed.value)) return null;

  const acquiredAt = parsed.value.acquiredAt;
  const staleAt = parsed.value.staleAt;
  if (typeof acquiredAt !== 'string' || typeof staleAt !== 'string') return null;
  if (!parseIsoTimestamp(acquiredAt, 'lock.acquiredAt').ok) return null;
  if (!parseIsoTimestamp(staleAt, 'lock.staleAt').ok) return null;
  return { acquiredAt, staleAt };
}

function fileLockTime(clock: Clock): FileLockTime {
  const timestamp = clock.now();
  const epochMs = isoTimestampEpochMs(timestamp, 'clock.now');
  if (!epochMs.ok) throw epochMs.error;
  return { timestamp, epochMs: epochMs.value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fileTempNameSegment(value: string): string {
  if (value.length === 0) throw new Error('File temp name must be non-empty');
  return encodeURIComponent(value);
}
