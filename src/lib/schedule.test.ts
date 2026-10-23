// Schedule rule checks. Run with `npm test`. Pure: no network or database needed.
import { nextRun, zonedTimeToUtc, type ScheduleSpec } from "@/lib/schedule";

let fails = 0;
function expect(name: string, got: Date | null, want: string | null) {
  const g = got ? got.toISOString() : null;
  const ok = g === want;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : `got ${g} want ${want}`}`);
}

const nbo = (s: Partial<ScheduleSpec>): ScheduleSpec => ({
  frequency: "DAILY",
  timeOfDay: "09:00",
  weekdays: [],
  timezone: "Africa/Nairobi",
  ...s,
});
// Nairobi is UTC+3 all year: 09:00 EAT = 06:00 UTC
const t = (iso: string) => new Date(iso);

expect("daily, before today's time -> today", nextRun(nbo({}), t("2026-10-21T05:00:00Z")), "2026-10-21T06:00:00.000Z");
expect("daily, after today's time -> tomorrow", nextRun(nbo({}), t("2026-10-21T07:00:00Z")), "2026-10-22T06:00:00.000Z");
expect("daily, exactly at time -> tomorrow", nextRun(nbo({}), t("2026-10-21T06:00:00Z")), "2026-10-22T06:00:00.000Z");
expect("daily 23:30 EAT crosses UTC date", nextRun(nbo({ timeOfDay: "23:30" }), t("2026-10-21T10:00:00Z")), "2026-10-21T20:30:00.000Z");
// 2026-10-21 is a Wednesday
expect("weekly Mon+Fri from Wed -> Fri", nextRun(nbo({ frequency: "WEEKLY", weekdays: [1, 5] }), t("2026-10-21T10:00:00Z")), "2026-10-23T06:00:00.000Z");
expect("weekly Wed, later same day -> next Wed", nextRun(nbo({ frequency: "WEEKLY", weekdays: [3] }), t("2026-10-21T10:00:00Z")), "2026-10-28T06:00:00.000Z");
expect("weekly with no days -> none", nextRun(nbo({ frequency: "WEEKLY", weekdays: [] }), t("2026-10-21T10:00:00Z")), null);
expect("monthly 15th from 21 Oct -> 15 Nov", nextRun(nbo({ frequency: "MONTHLY", dayOfMonth: 15 }), t("2026-10-21T10:00:00Z")), "2026-11-15T06:00:00.000Z");
expect("monthly 31st in November -> 30 Nov", nextRun(nbo({ frequency: "MONTHLY", dayOfMonth: 31 }), t("2026-11-01T10:00:00Z")), "2026-11-30T06:00:00.000Z");
expect("monthly 31st in Feb 2027 -> 28 Feb", nextRun(nbo({ frequency: "MONTHLY", dayOfMonth: 31 }), t("2027-02-01T10:00:00Z")), "2027-02-28T06:00:00.000Z");
expect("once in future", nextRun(nbo({ frequency: "ONCE", runAt: t("2026-12-01T06:00:00Z") }), t("2026-10-21T10:00:00Z")), "2026-12-01T06:00:00.000Z");
expect("once in past -> none", nextRun(nbo({ frequency: "ONCE", runAt: t("2026-10-01T06:00:00Z") }), t("2026-10-21T10:00:00Z")), null);
// DST zone: London 09:00 is 08:00 UTC in summer, 09:00 UTC in winter (clocks change 25 Oct 2026)
expect("DST: London daily before change", nextRun(nbo({ timezone: "Europe/London" }), t("2026-10-24T09:00:00Z")), "2026-10-25T09:00:00.000Z");
expect("DST: London summer", nextRun(nbo({ timezone: "Europe/London" }), t("2026-10-23T09:00:00Z")), "2026-10-24T08:00:00.000Z");
expect("zonedTimeToUtc Nairobi", zonedTimeToUtc(2026, 1, 1, 0, 0, "Africa/Nairobi"), "2025-12-31T21:00:00.000Z");

process.exit(fails ? 1 : 0);
