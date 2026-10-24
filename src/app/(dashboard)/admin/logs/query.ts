import type { Prisma } from "@prisma/client";

export type LogFilters = { q?: string; action?: string; from?: string; to?: string };

// The same filters for the page and the CSV export.
export function activityWhere({ q, action, from, to }: LogFilters): Prisma.ActivityLogWhereInput {
  const createdAt: Prisma.DateTimeFilter = {};
  if (from && !Number.isNaN(Date.parse(from))) createdAt.gte = new Date(from);
  if (to && !Number.isNaN(Date.parse(to))) createdAt.lt = new Date(new Date(to).getTime() + 24 * 3600_000);
  return {
    ...(action ? { action } : {}),
    ...(createdAt.gte || createdAt.lt ? { createdAt } : {}),
    ...(q ? { OR: [{ user: { email: { contains: q, mode: "insensitive" } } }, { user: { name: { contains: q, mode: "insensitive" } } }, { ip: { contains: q } }] } : {}),
  };
}
