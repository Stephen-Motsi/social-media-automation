import type { Frequency } from "@prisma/client";

// Next-run calculation for channel schedules, in the channel's IANA timezone (default Africa/Nairobi).

export type ScheduleSpec = {
  frequency: Frequency;
  runAt?: Date | null;
  timeOfDay: string; // "HH:MM"
  weekdays: number[]; // 0 = Sunday
  dayOfMonth?: number | null;
  timezone: string;
};

export const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE ?? "Africa/Nairobi";
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Local = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

function localParts(date: Date, timeZone: string): Local {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  };
}

// Converts a wall-clock time in `timeZone` to a UTC Date (handles DST by re-checking the offset).
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (ms: number) => {
    const l = localParts(new Date(ms), timeZone);
    return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute) - ms;
  };
  let utc = asUtc - offsetAt(asUtc);
  utc = asUtc - offsetAt(utc);
  return new Date(utc);
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function parseTime(timeOfDay: string) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeOfDay);
  if (!m) throw new Error(`Invalid time "${timeOfDay}"`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

// First run strictly after `after`, or null if the schedule has no future runs.
export function nextRun(spec: ScheduleSpec, after: Date = new Date()): Date | null {
  if (spec.frequency === "ONCE") {
    return spec.runAt && spec.runAt.getTime() > after.getTime() ? spec.runAt : null;
  }
  const { hour, minute } = parseTime(spec.timeOfDay);
  const start = localParts(after, spec.timezone);
  // Walk forward day by day in local time; 400 days covers every monthly/weekly case.
  for (let i = 0; i <= 400; i++) {
    const d = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const weekday = d.getUTCDay();

    let matches = false;
    if (spec.frequency === "DAILY") matches = true;
    if (spec.frequency === "WEEKLY") matches = spec.weekdays.includes(weekday);
    if (spec.frequency === "MONTHLY" && spec.dayOfMonth) {
      matches = day === Math.min(spec.dayOfMonth, daysInMonth(year, month));
    }
    if (!matches) continue;

    const candidate = zonedTimeToUtc(year, month, day, hour, minute, spec.timezone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return null;
}

export function describeSchedule(spec: ScheduleSpec): string {
  const at = `at ${spec.timeOfDay}`;
  switch (spec.frequency) {
    case "ONCE":
      return spec.runAt ? `Once, ${formatInZone(spec.runAt, spec.timezone)}` : "Once (no time set)";
    case "DAILY":
      return `Every day ${at}`;
    case "WEEKLY": {
      const days = [...spec.weekdays].sort().map((d) => WEEKDAY_NAMES[d]);
      return days.length ? `Every ${days.join(", ")} ${at}` : "Weekly (no days chosen)";
    }
    case "MONTHLY":
      return spec.dayOfMonth ? `Monthly on day ${spec.dayOfMonth} ${at}` : "Monthly (no date chosen)";
  }
}

export function formatInZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// For <input type="datetime-local"> values, interpreted in the channel's timezone.
export function parseLocalDateTime(value: string, timeZone: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return zonedTimeToUtc(y, mo, d, h, mi, timeZone);
}

export function toLocalDateTimeInput(date: Date, timeZone: string) {
  const l = localParts(date, timeZone);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${l.year}-${p(l.month)}-${p(l.day)}T${p(l.hour)}:${p(l.minute)}`;
}
