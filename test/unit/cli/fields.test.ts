import { describe, expect, it } from 'vitest';
import { parseFieldOptions } from '@/cli/fields';

describe('CLI field parsing', () => {
  it('parses scalar and JSON field values as a Result', () => {
    const result = parseFieldOptions([
      'customer=acme',
      'priority=high',
      'fragile=false',
      'lines=[{"sku":"peas","qty":12}]',
    ]);

    expect(result.unwrap()).toEqual({
      customer: 'acme',
      priority: 'high',
      fragile: false,
      lines: [{ sku: 'peas', qty: 12 }],
    });
  });

  it('returns Err for malformed field input', () => {
    const result = parseFieldOptions(['customer']);

    expect(result.ok).toBe(false);
    expect(result.match({ ok: () => '', err: (error) => error.message })).toContain('key=value');
  });

  it('returns Err for malformed JSON field values', () => {
    const result = parseFieldOptions(['lines=[,]']);

    expect(result.ok).toBe(false);
    expect(result.match({ ok: () => '', err: (error) => error.message })).toContain('not valid JSON');
  });

  it('preserves leading-zero scalar values as strings', () => {
    expect(parseFieldOptions(['externalId=00123']).unwrap()).toEqual({
      externalId: '00123',
    });
  });
});
