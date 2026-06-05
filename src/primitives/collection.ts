import { isErr, Ok, type Result } from './result';
import { positiveIntegerOption } from './runtime-options';

export type ChunkInfo = {
  readonly chunkIndex: number;
  readonly startIndex: number;
  readonly endIndex: number;
};

export function chunk<T>(items: readonly T[], size: number): T[][] {
  positiveIntegerOption('size', size);

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function chunkForEach<T, E>(
  items: readonly T[],
  size: number,
  fn: (chunk: T[], info: ChunkInfo) => Promise<Result<void, E>> | Result<void, E>
): Promise<Result<void, E>> {
  positiveIntegerOption('size', size);

  let chunkIndex = 0;
  for (let index = 0; index < items.length; index += size) {
    const endIndex = Math.min(index + size, items.length);
    const result = await fn(items.slice(index, endIndex), { chunkIndex, startIndex: index, endIndex });
    if (isErr(result)) return result;
    chunkIndex++;
  }

  return Ok(undefined);
}

export async function chunkMap<T, R, E>(
  items: readonly T[],
  size: number,
  fn: (chunk: T[], info: ChunkInfo) => Promise<Result<R, E>> | Result<R, E>
): Promise<Result<R[], E>> {
  const results: R[] = [];
  const result = await chunkForEach(items, size, async (itemsChunk, info) => {
    const mapped = await fn(itemsChunk, info);
    if (isErr(mapped)) return mapped.asErr<void>();
    results.push(mapped.value);
    return Ok(undefined);
  });

  if (isErr(result)) return result.asErr<R[]>();
  return Ok(results);
}

export async function chunkFlatMap<T, R, E>(
  items: readonly T[],
  size: number,
  fn: (chunk: T[], info: ChunkInfo) => Promise<Result<readonly R[], E>> | Result<readonly R[], E>
): Promise<Result<R[], E>> {
  const results: R[] = [];
  const result = await chunkForEach(items, size, async (itemsChunk, info) => {
    const mapped = await fn(itemsChunk, info);
    if (isErr(mapped)) return mapped.asErr<void>();
    results.push(...mapped.value);
    return Ok(undefined);
  });

  if (isErr(result)) return result.asErr<R[]>();
  return Ok(results);
}

export function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group == null) {
      groups.set(key, [item]);
    } else {
      group.push(item);
    }
  }
  return groups;
}

export function keyBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T> {
  const keyed = new Map<K, T>();
  for (const item of items) {
    keyed.set(keyOf(item), item);
  }
  return keyed;
}

export function uniqueBy<T, K>(items: readonly T[], keyOf: (item: T) => K): T[] {
  const seen = new Set<K>();
  const unique: T[] = [];

  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

export function uniqueStrings(values: readonly string[]): string[] {
  return uniqueBy(values, (value) => value);
}
