import type { HealthQuery, HealthReporter } from '@/ports/health';
import type { HealthCheckResult } from '@/primitives/health';
import { compareStrings } from '@/primitives/string';

export class InMemoryHealthReporter implements HealthReporter {
  private readonly results = new Map<string, HealthCheckResult>();

  async report(result: HealthCheckResult): Promise<void> {
    this.results.set(result.name, structuredClone(result));
  }

  async get(name: string): Promise<HealthCheckResult | null> {
    const result = this.results.get(name);
    return result == null ? null : structuredClone(result);
  }

  async list(query: HealthQuery = {}): Promise<HealthCheckResult[]> {
    return [...this.results.values()]
      .filter((result) => query.status == null || result.status === query.status)
      .map((result) => structuredClone(result))
      .sort(
        (left, right) =>
          compareStrings(left.checkedAt, right.checkedAt) || compareStrings(left.name, right.name)
      );
  }
}
