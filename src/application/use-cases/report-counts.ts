import type { Actor } from '@/domain/auth/auth';
import type { CountReport, CountReportGroupBy } from '@/domain/query/report';
import type { WorkItemQuery } from '@/domain/query/work-item-query';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';
import { compareStrings } from '@/primitives/string';

export type ReportCountsInput = {
  actor: Actor;
  groupBy: CountReportGroupBy;
  query?: WorkItemQuery | undefined;
};

export async function reportCountsUseCase(
  deps: ApplicationDependencies,
  input: ReportCountsInput
): Promise<CountReport> {
  return deps.tracer.span('reportCounts', { groupBy: input.groupBy }, async () => {
    authorize(deps, input.actor, 'report:read');
    const result = await deps.workItemQueries.search({
      ...(input.query ?? {}),
      limit: undefined,
      offset: undefined,
    });
    const counts = new Map<string, number>();

    for (const item of result.items) {
      const value = input.groupBy === 'status' ? item.status : item.type;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return {
      groupBy: input.groupBy,
      counts: [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => compareStrings(left.value, right.value)),
    };
  });
}
