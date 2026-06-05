export type AdapterConformanceCheck<TContext> = {
  name: string;
  run(context: TContext): Promise<void> | void;
};

export type AdapterConformanceProvider<TContext> = {
  name: string;
  create(): Promise<TContext> | TContext;
  dispose?(context: TContext): Promise<void> | void;
};

export type AdapterConformanceResult = {
  name: string;
  status: 'passed' | 'failed';
  error?: Error | undefined;
};

export type AdapterConformanceReport = {
  provider: string;
  results: AdapterConformanceResult[];
  passed: number;
  failed: number;
};

export async function runAdapterConformanceChecks<TContext>(
  provider: AdapterConformanceProvider<TContext>,
  checks: readonly AdapterConformanceCheck<TContext>[]
): Promise<AdapterConformanceReport> {
  const context = await provider.create();
  const results: AdapterConformanceResult[] = [];

  try {
    for (const check of checks) {
      try {
        await check.run(context);
        results.push({ name: check.name, status: 'passed' });
      } catch (error) {
        results.push({
          name: check.name,
          status: 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  } finally {
    await provider.dispose?.(context);
  }

  return {
    provider: provider.name,
    results,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
  };
}
