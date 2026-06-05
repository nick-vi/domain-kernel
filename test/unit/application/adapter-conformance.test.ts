import { describe, expect, it } from 'vitest';
import { runAdapterConformanceChecks } from '@/application';

describe('runAdapterConformanceChecks', () => {
  it('returns a reusable pass/fail report for adapter checks', async () => {
    const report = await runAdapterConformanceChecks(
      {
        name: 'memory-test',
        create: () => ({ value: 1 }),
      },
      [
        {
          name: 'passes',
          run: (context) => {
            expect(context.value).toBe(1);
          },
        },
        {
          name: 'fails',
          run: () => {
            throw new Error('contract failed');
          },
        },
      ]
    );

    expect(report).toMatchObject({
      provider: 'memory-test',
      passed: 1,
      failed: 1,
      results: [
        { name: 'passes', status: 'passed' },
        { name: 'fails', status: 'failed', error: { message: 'contract failed' } },
      ],
    });
  });
});
