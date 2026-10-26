export type TrendPoint = { label: string; value: number };
export type TrendBucket = { bucket: string; count: number };

export function fillTrendSeries(axis: readonly { bucket: string; label: string }[], rows: readonly TrendBucket[]): TrendPoint[] {
  const counts = new Map(rows.map(({ bucket, count }) => [bucket, count]));
  return axis.map(({ bucket, label }) => ({ label, value: counts.get(bucket) ?? 0 }));
}
