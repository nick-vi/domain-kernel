import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createValidatedMap,
  Err,
  isErr,
  Ok,
  validateUnknown,
  ValidatedMap,
  ValidatedMapErrorKind,
} from '@/primitives';

const EntrySchema = z.object({
  label: z.string(),
  weight: z.number(),
});

type Entry = z.infer<typeof EntrySchema>;

describe('validated map primitive', () => {
  it('validates keys and values with structural safeParse schemas', () => {
    const map = createValidatedMap<string, Entry>({
      key: z.string().min(2),
      value: EntrySchema,
    });

    const valid = map.set('ab', { label: 'alpha', weight: 2 });
    expect(valid.ok).toBe(true);
    expect(map.get('ab').value).toEqual({ label: 'alpha', weight: 2 });

    const invalidKey = map.set('a', { label: 'bad', weight: 0 });
    expect(isErr(invalidKey)).toBe(true);
    if (isErr(invalidKey)) {
      expect(invalidKey.error.kind).toBe(ValidatedMapErrorKind.InvalidKey);
    }

    const invalidValue = map.set('cd', { label: 'bad' });
    expect(isErr(invalidValue)).toBe(true);
    if (isErr(invalidValue)) {
      expect(invalidValue.error.kind).toBe(ValidatedMapErrorKind.InvalidValue);
    }
  });

  it('accepts injected validators without requiring a schema', () => {
    const map = createValidatedMap<string, number>({
      validateKey: (value) =>
        typeof value === 'string' && value.startsWith('acct:')
          ? Ok(value)
          : Err(new Error('key must be account-scoped')),
      validateValue: (value) =>
        typeof value === 'number' && value >= 0
          ? Ok(value)
          : Err(new Error('balance must be non-negative')),
    });

    expect(map.set('acct:cash', 100).unwrap()).toBe(100);

    const invalid = map.set('cash', 100);
    expect(isErr(invalid)).toBe(true);
    if (isErr(invalid)) {
      expect(invalid.error.kind).toBe(ValidatedMapErrorKind.InvalidKey);
      expect(invalid.error.message).toContain('account-scoped');
    }
  });

  it('supports transform, refinement, invariant, and orSet', () => {
    const map = createValidatedMap<string, Entry>({
      key: z.string(),
      value: EntrySchema,
      transform: (_key, value) => ({
        ...(value as Entry),
        label: (value as Entry).label.trim(),
      }),
      refine: (_key, value) => value.weight > 0 || 'weight must be positive',
      invariant: (entries) => {
        const total = [...entries.values()].reduce((sum, value) => sum + value.weight, 0);
        return total <= 10 || 'total weight cannot exceed 10';
      },
    });

    expect(map.get('a').orSet(() => ({ label: '  A  ', weight: 4 })).unwrap()).toEqual({
      label: 'A',
      weight: 4,
    });
    expect(map.get('a').unwrapOr({ label: 'fallback', weight: 1 })).toEqual({
      label: 'A',
      weight: 4,
    });
    expect(map.get('missing').unwrapOrElse(() => ({ label: 'fallback', weight: 1 }))).toEqual({
      label: 'fallback',
      weight: 1,
    });
    expect(map.get('a').orSet(() => ({ label: 'ignored', weight: 99 })).unwrap()).toEqual({
      label: 'A',
      weight: 4,
    });

    const refined = map.set('b', { label: 'B', weight: 0 });
    expect(isErr(refined)).toBe(true);
    if (isErr(refined)) {
      expect(refined.error.kind).toBe(ValidatedMapErrorKind.Refine);
    }

    const invariant = map.set('c', { label: 'C', weight: 7 });
    expect(isErr(invariant)).toBe(true);
    if (isErr(invariant)) {
      expect(invariant.error.kind).toBe(ValidatedMapErrorKind.Invariant);
    }
  });

  it('loads from JSON and produces pick, omit, and readonly snapshots', () => {
    const loaded = ValidatedMap.fromJSON<string, Entry>('{"a":{"label":"A","weight":1}}', {
      key: z.string(),
      value: EntrySchema,
    });

    expect(loaded.ok).toBe(true);
    const map = loaded.unwrap();
    expect(map.toJSON()).toEqual({ a: { label: 'A', weight: 1 } });
    expect(map.pick(['a']).toEntries()).toEqual([['a', { label: 'A', weight: 1 }]]);
    expect(map.omit(['a']).size).toBe(0);

    const readonly = map.readonly();
    const blocked = (readonly as ValidatedMap<string, Entry>).set('b', { label: 'B', weight: 2 });
    expect(isErr(blocked)).toBe(true);
    if (isErr(blocked)) {
      expect(blocked.error.kind).toBe(ValidatedMapErrorKind.Readonly);
    }
  });

  it('notifies watchers on set and delete', () => {
    const map = createValidatedMap<string, Entry>({
      key: z.string(),
      value: EntrySchema,
    });
    const seen: Array<Entry | undefined> = [];

    const unwatch = map.watch('a', (value) => {
      seen.push(value);
    });

    map.set('a', { label: 'A', weight: 1 });
    map.delete('a');
    unwatch();
    map.set('a', { label: 'A2', weight: 2 });

    expect(seen).toEqual([{ label: 'A', weight: 1 }, undefined]);
  });

  it('provides reusable validateUnknown for non-map primitives', () => {
    const result = validateUnknown('42', {
      validate: (value) => (value === '42' ? Ok(42) : Err(new Error('not the answer'))),
    });

    expect(result.unwrap()).toBe(42);
  });
});
