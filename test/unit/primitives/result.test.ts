import { describe, expect, it } from 'vitest';
import { branch, Err, isErr, isOk, Ok, Result } from '@/primitives';

describe('Result utilities', () => {
  it('supports map, flatMap, match, and unwrapOr', () => {
    const result = Ok(2)
      .map((value) => value + 1)
      .flatMap((value) => Ok(value * 10));

    expect(isOk(result)).toBe(true);
    expect(result.match({ ok: (value) => value, err: () => 0 })).toBe(30);
    expect(Err('missing').unwrapOr(5)).toBe(5);
  });

  it('combines object results and returns the first error', () => {
    const valid = Result.allObject({
      type: Ok('order'),
      state: Ok('draft'),
    });
    const invalid = Result.allObject({
      type: Ok('order'),
      state: Err('missing_state'),
    });

    expect(valid.unwrap()).toEqual({ type: 'order', state: 'draft' });
    expect(isErr(invalid)).toBe(true);
    expect(invalid.match({ ok: () => null, err: (error) => error })).toBe('missing_state');
  });
});

describe('branch utility', () => {
  it('returns the first truthy branch', () => {
    const selected = branch<string>()
      .if(false, () => 'no')
      .if('console', (mode) => mode)
      .else('none');

    expect(selected).toBe('console');
  });
});
