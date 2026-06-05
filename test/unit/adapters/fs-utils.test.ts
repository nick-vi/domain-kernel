import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withFileLock } from '@/adapters/fs/fs-utils';
import type { Clock } from '@/ports/clock';
import type { SleepFunction } from '@/primitives/timing';

const fixedClock: Clock = {
  now: () => '2026-06-04T12:00:00.000Z',
};

describe('filesystem adapter utilities', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'domain-kernel-fs-utils-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes lock metadata from the injected clock while a lock is held', async () => {
    const path = join(root, 'record.json');
    const lockPath = `${path}.lock`;
    const seen = await withFileLock(
      path,
      async () => JSON.parse(await readFile(lockPath, 'utf8')) as unknown,
      {
        clock: fixedClock,
        sleep: async () => undefined,
        staleMs: 1_000,
      }
    );

    expect(seen).toEqual({
      acquiredAt: '2026-06-04T12:00:00.000Z',
      staleAt: '2026-06-04T12:00:01.000Z',
    });
    await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes stale file locks by metadata instead of filesystem mtime', async () => {
    const path = join(root, 'record.json');
    const lockPath = `${path}.lock`;
    let sleeps = 0;
    await writeFile(
      lockPath,
      `${JSON.stringify({
        acquiredAt: '2026-06-04T11:59:00.000Z',
        staleAt: '2026-06-04T12:00:00.000Z',
      })}\n`,
      'utf8'
    );

    const result = await withFileLock(
      path,
      async () => JSON.parse(await readFile(lockPath, 'utf8')) as unknown,
      {
        clock: { now: () => '2026-06-04T12:00:01.000Z' },
        retryDelayMs: 7,
        sleep: async () => {
          sleeps++;
        },
        staleMs: 1_000,
        timeoutMs: 1_000,
      }
    );

    expect(result).toEqual({
      acquiredAt: '2026-06-04T12:00:01.000Z',
      staleAt: '2026-06-04T12:00:02.000Z',
    });
    expect(sleeps).toBe(0);
    await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses the injected sleep function while waiting for a file lock', async () => {
    const path = join(root, 'record.json');
    const lockPath = `${path}.lock`;
    const delays: number[] = [];
    const sleep: SleepFunction = async (ms) => {
      delays.push(ms);
      await rm(lockPath, { force: true });
    };

    await writeFile(
      lockPath,
      `${JSON.stringify({
        acquiredAt: '2026-06-04T12:00:00.000Z',
        staleAt: '2026-06-04T12:00:10.000Z',
      })}\n`,
      'utf8'
    );

    const result = await withFileLock(path, async () => 'acquired', {
      clock: fixedClock,
      retryDelayMs: 7,
      sleep,
      staleMs: 60_000,
      timeoutMs: 1000,
    });

    expect(result).toBe('acquired');
    expect(delays).toEqual([7]);
    await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
