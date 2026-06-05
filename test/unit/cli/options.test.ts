import { describe, expect, it } from 'vitest';
import { parseIsoTimestampOption } from '@/cli/options';

describe('CLI option parsing', () => {
  it('accepts only canonical UTC ISO timestamps', () => {
    expect(parseIsoTimestampOption('--now', '2026-06-04T12:00:00.000Z')).toBe(
      '2026-06-04T12:00:00.000Z'
    );
    expect(() => parseIsoTimestampOption('--now', '2026-06-04T12:00:00Z')).toThrow(
      /ISO timestamp/
    );
    expect(() => parseIsoTimestampOption('--now', '2026-06-04T14:00:00.000+02:00')).toThrow(
      /ISO timestamp/
    );
  });
});
