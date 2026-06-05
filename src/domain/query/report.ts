export type CountReportGroupBy = 'status' | 'type';

export type CountReport = {
  groupBy: CountReportGroupBy;
  counts: Array<{
    value: string;
    count: number;
  }>;
};
