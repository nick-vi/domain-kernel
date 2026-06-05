import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  createFileCache,
  fileCacheKeyToPath,
  FileCacheErrorKind,
  type FileCacheClock,
  type FileCacheNamespace,
  type FileCacheTempNames,
  isErr,
  Ok,
  sanitizeFileCacheSegment,
  sleep,
  sortedJsonCacheKey,
} from '@/primitives';

const PersonSchema = z.object({
  name: z.string(),
  score: z.number(),
});

type Person = z.infer<typeof PersonSchema>;

class MutableClock implements FileCacheClock {
  constructor(private current: number) {}

  now(): number {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}

class SequenceTempNames implements FileCacheTempNames {
  private index = 0;

  nextTempName(): string {
    this.index += 1;
    return `tmp_${this.index}`;
  }
}

describe('file cache primitives', () => {
  let root: string;
  let clock: MutableClock;
  let tempNames: SequenceTempNames;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'domain-kernel-file-cache-'));
    clock = new MutableClock(Date.parse('2026-06-04T12:00:00.000Z'));
    tempNames = new SequenceTempNames();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function peopleCache(overrides: Partial<FileCacheNamespace<string, Person>> = {}) {
    const people: FileCacheNamespace<string, Person> = {
      keyOf: (key) => key,
      schema: PersonSchema,
      ttlMs: null,
      version: 1,
      ...overrides,
    };

    return createFileCache({
      root,
      clock,
      tempNames,
      namespaces: { people },
    });
  }

  it('sanitizes cache paths and builds deterministic object keys', () => {
    expect(fileCacheKeyToPath('../etc/passwd', 'json')).toBe(join('_', 'etc', 'passwd.json'));
    expect(sanitizeFileCacheSegment('a:b*c?d')).toBe('a_b_c_d');
    expect(sortedJsonCacheKey({ z: 1, a: { c: 3, b: 2 } })).toBe(
      '{"a":{"b":2,"c":3},"z":1}'
    );
  });

  it('roundtrips typed entries through a namespaced cache', async () => {
    const people = peopleCache().ns('people');

    const written = await people.set('alice', { name: 'Alice', score: 95 });
    expect(written.ok).toBe(true);

    const lookup = await people.get('alice');
    expect(lookup.ok).toBe(true);
    expect(lookup.unwrap()).toMatchObject({
      hit: true,
      negative: false,
      value: { name: 'Alice', score: 95 },
    });
    expect(lookup.unwrap().unwrapOr({ name: 'Fallback', score: 0 })).toEqual({
      name: 'Alice',
      score: 95,
    });

    expect((await people.delete('alice')).unwrap()).toBe(true);
    expect((await people.delete('alice')).unwrap()).toBe(false);
  });

  it('deduplicates concurrent miss factories with singleflight', async () => {
    const people = peopleCache().ns('people');
    let calls = 0;

    const factory = async () => {
      calls++;
      await sleep(20);
      return Ok({ name: 'Shared', score: 100 });
    };

    const results = await Promise.all([
      people.get('shared').then((result) => result.unwrap().orSet(factory)),
      people.get('shared').then((result) => result.unwrap().orSet(factory)),
      people.get('shared').then((result) => result.unwrap().orSet(factory)),
    ]);

    expect(calls).toBe(1);
    for (const result of results) {
      expect(result.ok).toBe(true);
      expect(result.unwrap()).toEqual({ name: 'Shared', score: 100 });
    }
  });

  it('treats expired entries as misses', async () => {
    const people = peopleCache({ ttlMs: 60_000 }).ns('people');

    await people.set('bob', { name: 'Bob', score: 80 });
    expect((await people.get('bob')).unwrap().hit).toBe(true);

    clock.advance(60_001);

    const expired = await people.get('bob');
    expect(expired.ok).toBe(true);
    expect(expired.unwrap().hit).toBe(false);
    expect(expired.unwrap().value).toBeNull();
    expect(expired.unwrap().unwrapOrElse(() => ({ name: 'Fallback', score: 0 }))).toEqual({
      name: 'Fallback',
      score: 0,
    });
  });

  it('supports negative cache entries without calling the factory', async () => {
    const people = peopleCache({ negative: { ttlMs: 1000 } }).ns('people');

    const negative = await people.setNegative('missing');
    expect(negative.ok).toBe(true);

    const lookup = (await people.get('missing')).unwrap();
    expect(lookup.hit).toBe(true);
    expect(lookup.negative).toBe(true);
    expect(lookup.value).toBeNull();

    let calls = 0;
    const value = await lookup.orSet(async () => {
      calls++;
      return Ok({ name: 'Should not run', score: 0 });
    });

    expect(calls).toBe(0);
    expect(value.unwrap()).toBeNull();

    clock.advance(1001);
    const expired = (await people.get('missing')).unwrap();
    expect(expired.hit).toBe(false);
    expect(expired.value).toBeNull();
  });

  it('returns typed validation errors for invalid writes', async () => {
    const people = peopleCache().ns('people');

    const result = await people.set('bad', { name: 'Bad' } as unknown as Person);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe(FileCacheErrorKind.Validation);
      expect(result.error.issues?.length).toBeGreaterThan(0);
    }
  });

  it('treats corrupt cached files as misses and removes them', async () => {
    const people = peopleCache().ns('people');
    const path = join(people.path, fileCacheKeyToPath('bad', 'json'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ name: 42, score: 'wrong' }), 'utf8');

    const lookup = await people.get('bad');
    expect(lookup.ok).toBe(true);
    expect(lookup.unwrap().hit).toBe(false);
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('evicts least recently used entries when maxEntries is exceeded', async () => {
    const people = peopleCache({ maxEntries: 2 }).ns('people');

    await people.set('a', { name: 'A', score: 1 });
    await people.set('b', { name: 'B', score: 2 });
    await people.set('c', { name: 'C', score: 3 });

    expect((await people.get('a')).unwrap().hit).toBe(false);
    expect((await people.get('b')).unwrap().hit).toBe(true);
    expect((await people.get('c')).unwrap().hit).toBe(true);
  });

  it('reports stats and purges older namespace versions', async () => {
    const v1 = peopleCache({ version: 1 });
    await v1.ns('people').set('old', { name: 'Old', score: 1 });

    const v2 = peopleCache({ version: 2 });
    await v2.ns('people').set('current', { name: 'Current', score: 2 });

    const stats = await v2.stats();
    expect(stats.ok).toBe(true);
    const peopleStats = stats.unwrap().namespaces.people;
    expect(peopleStats).toBeDefined();
    expect(peopleStats?.entries).toBe(1);
    expect(peopleStats?.bytes).toBeGreaterThan(0);

    const purge = await v2.purge();
    expect(purge.ok).toBe(true);
    expect(purge.unwrap().deleted).toBe(1);

    const oldPath = join(root, 'people', 'v1', fileCacheKeyToPath('old', 'json'));
    await expect(readFile(oldPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
