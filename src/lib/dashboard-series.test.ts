import { fillTrendSeries } from "@/lib/dashboard-series";

const series = fillTrendSeries(
  [
    { bucket: "2026-10-01", label: "1 Oct" },
    { bucket: "2026-10-02", label: "2 Oct" },
    { bucket: "2026-10-03", label: "3 Oct" },
  ],
  [
    { bucket: "2026-10-01", count: 3 },
    { bucket: "2026-10-03", count: 1 },
    { bucket: "outside-range", count: 20 },
  ],
);

const expected = [
  { label: "1 Oct", value: 3 },
  { label: "2 Oct", value: 0 },
  { label: "3 Oct", value: 1 },
];

if (JSON.stringify(series) !== JSON.stringify(expected)) {
  console.error("FAIL  dashboard trend series fills missing buckets and ignores out-of-range rows");
  process.exit(1);
}

console.log("PASS  dashboard trend series fills missing buckets and ignores out-of-range rows");
