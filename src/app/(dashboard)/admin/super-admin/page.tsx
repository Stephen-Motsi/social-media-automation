import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pageViewer } from "@/lib/session";
import { activityLabel } from "@/lib/activity";
import { fillTrendSeries, type TrendBucket } from "@/lib/dashboard-series";
import { platformOrder, platforms } from "@/components/platforms";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 8;
const roleLabel = { USER: "User", ADMIN: "Admin", SUPER_ADMIN: "Super admin" } as const;
const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: process.env.APP_TIMEZONE ?? "Africa/Nairobi",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const monthLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" });

type SearchParams = { q?: string; role?: string; status?: string; page?: string };
type Point = { label: string; value: number };

export default async function SuperAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await pageViewer("super");
  const params = await searchParams;
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 13));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const query = params.q?.trim() ?? "";
  const role = params.role === "ADMIN" || params.role === "SUPER_ADMIN" || params.role === "USER" ? params.role : "";
  const status = params.status === "disabled" || params.status === "active" ? params.status : "";
  const pageNum = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const userWhere: Prisma.UserWhereInput = {
    ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }] } : {}),
    ...(role ? { role } : {}),
    ...(status === "disabled" ? { disabledAt: { not: null } } : status === "active" ? { disabledAt: null } : {}),
  };
  const [accountCount, activeChannels, scheduledPosts, pendingCampaigns, flaggedSubscribers, activeSessions, matchedUsers] = await Promise.all([
    prisma.user.count(),
    prisma.channel.count({ where: { enabled: true } }),
    prisma.post.count({ where: { status: "SCHEDULED", scheduledAt: { gte: now } } }),
    prisma.campaign.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.subscriber.count({ where: { status: "NEEDS_REVIEW" } }),
    prisma.userSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    prisma.user.count({ where: userWhere }),
  ]);

  const totalPages = Math.max(1, Math.ceil(matchedUsers / PAGE_SIZE));
  const page = Math.min(pageNum, totalPages);
  const [users, recentActivity, growthBuckets, publishingBuckets, platformGroups, channels] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        disabledAt: true,
        createdAt: true,
        sessions: { select: { lastSeenAt: true, revokedAt: true, expiresAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 },
      },
    }),
    prisma.activityLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.$queryRaw<TrendBucket[]>(Prisma.sql`
      SELECT TO_CHAR(DATE_TRUNC('month', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM') AS bucket, COUNT(*)::int AS count
      FROM "User"
      WHERE "createdAt" >= ${monthStart}
      GROUP BY 1
      ORDER BY 1
    `),
    prisma.$queryRaw<TrendBucket[]>(Prisma.sql`
      SELECT TO_CHAR(DATE_TRUNC('day', "publishedAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket, COUNT(*)::int AS count
      FROM "Post"
      WHERE "status" = 'PUBLISHED' AND "publishedAt" >= ${dayStart}
      GROUP BY 1
      ORDER BY 1
    `),
    prisma.socialAccount.groupBy({ by: ["platform"], _count: { _all: true } }),
    prisma.channel.findMany({
      orderBy: [{ enabled: "desc" }, { nextRunAt: "asc" }],
      select: { platform: true, enabled: true, nextRunAt: true, lastRunAt: true, lastError: true },
    }),
  ]);

  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)));
  const userGrowth: Point[] = fillTrendSeries(
    months.map((month) => ({ bucket: month.toISOString().slice(0, 7), label: monthLabel.format(month) })),
    growthBuckets,
  );
  const days = Array.from({ length: 14 }, (_, i) => new Date(dayStart.getTime() + i * 24 * 60 * 60 * 1000));
  const publishing: Point[] = fillTrendSeries(
    days.map((date) => ({ bucket: date.toISOString().slice(0, 10), label: dayLabel.format(date) })),
    publishingBuckets,
  );
  const platformUsage = platformOrder.map((platform) => ({
    name: platforms[platform].name,
    value: platformGroups.find((group) => group.platform === platform)?._count._all ?? 0,
    blend: platforms[platform].blend,
  }));

  const stats = [
    { label: "Total accounts", value: accountCount.toLocaleString(), note: `${activeSessions.toLocaleString()} active sessions`, icon: "users" },
    { label: "Active channels", value: activeChannels.toLocaleString(), note: "Enabled publishing schedules", icon: "broadcast" },
    { label: "Scheduled posts", value: scheduledPosts.toLocaleString(), note: "Upcoming publications", icon: "calendar" },
    { label: "Pending approvals", value: (pendingCampaigns + flaggedSubscribers).toLocaleString(), note: `${pendingCampaigns} campaigns · ${flaggedSubscribers} subscribers`, icon: "check" },
  ];

  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (role) next.set("role", role);
    if (status) next.set("status", status);
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return `/admin/super-admin${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink-soft">Platform overview</p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Good {greeting(now)}, admin</h2>
          <p className="mt-2 text-sm text-ink-soft">Monitor publishing, accounts and platform activity in one place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/create" className="rounded-full border border-line bg-white/55 px-4 py-2.5 text-sm font-medium dark:bg-white/10">Create advert</Link>
          <Link href="/admin/roles" className="blend-meta inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-fuchsia-500/20">
            Manage roles <span aria-hidden>→</span>
          </Link>
        </div>
      </section>

      <section aria-label="Platform metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat, index) => (
          <article key={stat.label} className="glass lift rise rounded-3xl p-5 sm:p-6" style={{ "--i": index + 1 } as React.CSSProperties}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-ink-soft">{stat.label}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{stat.value}</p>
              </div>
              <span className="flex size-10 items-center justify-center rounded-2xl bg-white/50 text-ink dark:bg-white/10">
                <Icon name={stat.icon} />
              </span>
            </div>
            <p className="mt-3 text-xs text-ink-soft">{stat.note}</p>
          </article>
        ))}
      </section>

      <section aria-label="Analytics" className="grid gap-4 xl:grid-cols-5">
        <div className="glass rounded-3xl p-5 sm:p-6 xl:col-span-2">
          <Chart title="User growth" description="New accounts · last 6 months · UTC" points={userGrowth} />
        </div>
        <div className="glass rounded-3xl p-5 sm:p-6 xl:col-span-2">
          <Chart title="Publishing activity" description="Published posts · last 14 days · UTC" points={publishing} />
        </div>
        <section className="glass rounded-3xl p-5 sm:p-6 xl:col-span-1" aria-label="Platform usage">
          <h3 className="font-semibold">Platform usage</h3>
          <p className="mt-1 text-xs text-ink-soft">Connected social accounts</p>
          <div className="mt-5 space-y-4">
            {platformUsage.map((platform) => {
              const max = Math.max(1, ...platformUsage.map((item) => item.value));
              return (
                <div key={platform.name}>
                  <div className="mb-1.5 flex justify-between gap-2 text-xs">
                    <span>{platform.name}</span><span className="tabular-nums text-ink-soft">{platform.value}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink/5 dark:bg-white/10">
                    <div className={`${platform.blend} h-full rounded-full`} style={{ width: `${(platform.value / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            {platformUsage.every((platform) => platform.value === 0) && <p className="text-sm text-ink-soft">No social accounts connected yet.</p>}
          </div>
        </section>
      </section>

      <section className="glass overflow-hidden rounded-3xl">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line p-5 sm:p-6">
          <div>
            <h3 className="text-lg font-semibold">Accounts</h3>
            <p className="mt-1 text-sm text-ink-soft">{matchedUsers.toLocaleString()} {matchedUsers === 1 ? "account" : "accounts"} match your filters</p>
          </div>
          <form action="/admin/super-admin" role="search" className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
            <label className="sr-only" htmlFor="account-search">Search accounts</label>
            <input id="account-search" name="q" defaultValue={query} placeholder="Search name or email" className="min-w-0 rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-white/5 sm:w-52" />
            <label className="sr-only" htmlFor="account-role">Filter by role</label>
            <select id="account-role" name="role" defaultValue={role} className="rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-[#211b38]">
              <option value="">All roles</option><option value="USER">User</option><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super admin</option>
            </select>
            <label className="sr-only" htmlFor="account-status">Filter by status</label>
            <select id="account-status" name="status" defaultValue={status} className="rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-[#211b38]">
              <option value="">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option>
            </select>
            <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-ink sm:col-span-3 sm:justify-self-end">Apply filters</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-white/20 text-xs text-ink-soft dark:bg-white/[0.03]">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium sm:px-6">Account</th>
                <th scope="col" className="px-3 py-3 font-medium">Role</th>
                <th scope="col" className="px-3 py-3 font-medium">Status</th>
                <th scope="col" className="px-3 py-3 font-medium">Last active</th>
                <th scope="col" className="px-3 py-3 font-medium">Joined</th>
                <th scope="col" className="px-5 py-3 text-right font-medium sm:px-6">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((user) => {
                const last = user.sessions[0];
                const online = !!last && !last.revokedAt && last.expiresAt > now;
                return (
                  <tr key={user.id} className="transition-colors hover:bg-white/30 dark:hover:bg-white/[0.04]">
                    <td className="px-5 py-3.5 sm:px-6">
                      <span className="block font-medium">{user.name ?? user.email}</span>
                      <span className="block text-xs text-ink-soft">{user.email}</span>
                    </td>
                    <td className="px-3 py-3.5"><span className="rounded-full border border-line px-2.5 py-1 text-xs">{roleLabel[user.role]}</span></td>
                    <td className="px-3 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={`size-2 rounded-full ${user.disabledAt ? "bg-danger" : "bg-wa"}`} />
                        {user.disabledAt ? "Disabled" : "Active"}
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-xs text-ink-soft">{last ? when.format(last.lastSeenAt) : "Never"}</td>
                    <td className="px-3 py-3.5 text-xs text-ink-soft">{dayLabel.format(user.createdAt)}</td>
                    <td className="px-5 py-3.5 text-right sm:px-6">
                      <Link href={`/admin/users?id=${user.id}`} className="rounded-full px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-white/60 hover:text-ink dark:hover:bg-white/10">Details <span aria-hidden>→</span></Link>
                      <span className="sr-only">{online ? "Has an active session" : "No active session"}</span>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-12 text-center"><p className="font-medium">No accounts found</p><p className="mt-1 text-sm text-ink-soft">Try changing your search or filters.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-6">
          <p className="text-xs text-ink-soft">Page {page} of {totalPages}</p>
          <nav aria-label="Account table pages" className="flex items-center gap-2">
            <Link tabIndex={page <= 1 ? -1 : undefined} aria-disabled={page <= 1} href={pageHref(Math.max(1, page - 1))} className={`rounded-full border border-line px-3 py-1.5 text-xs ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-white/50 dark:hover:bg-white/10"}`}>Previous</Link>
            <Link tabIndex={page >= totalPages ? -1 : undefined} aria-disabled={page >= totalPages} href={pageHref(Math.min(totalPages, page + 1))} className={`rounded-full border border-line px-3 py-1.5 text-xs ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-white/50 dark:hover:bg-white/10"}`}>Next</Link>
          </nav>
        </div>
      </section>

      <section className="glass overflow-hidden rounded-3xl" aria-label="Channel activity">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <h3 className="font-semibold">Channel activity</h3>
          <p className="mt-1 text-sm text-ink-soft">Schedule status and the latest run information.</p>
        </div>
        {channels.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-ink-soft">No channels have been configured yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {channels.map((channel) => (
              <li key={channel.platform} className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6">
                <span className={`size-2.5 shrink-0 rounded-full ${channel.lastError ? "bg-danger" : channel.enabled ? "bg-wa" : "bg-ink-soft/40"}`} />
                <span className="min-w-24 flex-1 text-sm font-medium">{platforms[channel.platform].name}</span>
                <span className={`rounded-full px-2.5 py-1 text-xs ${channel.lastError ? "bg-danger/10 text-danger" : channel.enabled ? "bg-wa/10 text-wa" : "bg-ink/5 text-ink-soft dark:bg-white/10"}`}>
                  {channel.lastError ? "Needs attention" : channel.enabled ? "Scheduled" : "Paused"}
                </span>
                <span className="w-full text-xs text-ink-soft sm:w-auto sm:text-right">
                  {channel.lastError ? channel.lastError : channel.lastRunAt ? `Last run ${when.format(channel.lastRunAt)}` : channel.nextRunAt ? `Next run ${when.format(channel.nextRunAt)}` : "No run recorded"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line px-5 py-3 sm:px-6">
          <Link href="/channels" className="text-sm font-medium text-ink-soft hover:text-ink">Manage channels →</Link>
        </div>
      </section>

      <section className="glass rounded-3xl p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="font-semibold">Recent system activity</h3><p className="mt-1 text-sm text-ink-soft">Latest events from across the platform.</p></div>
          <Link href="/admin/logs" className="shrink-0 text-sm font-medium text-ink-soft hover:text-ink">View audit log →</Link>
        </div>
        {recentActivity.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-line px-5 py-8 text-center">
            <p className="text-sm font-medium">No activity yet</p><p className="mt-1 text-xs text-ink-soft">Account and publishing events will appear here.</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {recentActivity.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <span className="min-w-0 flex-1 text-sm">
                  <Link href={`/admin/users?id=${event.user.id}`} className="font-medium hover:underline">{event.user.name ?? event.user.email}</Link>
                  <span className="ml-2 text-ink-soft">{activityLabel(event.action)}</span>
                </span>
                <time dateTime={event.createdAt.toISOString()} className="text-xs text-ink-soft">{when.format(event.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Chart({ title, description, points }: { title: string; description: string; points: Point[] }) {
  const max = Math.max(1, ...points.map((point) => point.value));
  const coordinates = points.map((point, index) => `${(index / Math.max(1, points.length - 1)) * 640},${188 - (point.value / max) * 158}`).join(" ");
  const hasData = points.some((point) => point.value > 0);

  return (
    <>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-ink-soft">{description}</p>
      {hasData ? (
        <div className="mt-4">
          <svg viewBox="0 0 640 210" role="img" aria-label={`${title}: ${points.map((point) => `${point.label} ${point.value}`).join(", ")}`} className="h-44 w-full overflow-visible">
            {[30, 80, 130, 180].map((y) => <line key={y} x1="0" x2="640" y1={y} y2={y} stroke="var(--line)" strokeDasharray="4 7" />)}
            <polyline points={coordinates} fill="none" stroke="var(--ig-3)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {points.map((point, index) => (
              <circle key={`${point.label}-${index}`} cx={(index / Math.max(1, points.length - 1)) * 640} cy={188 - (point.value / max) * 158} r="4" fill="var(--ig-3)">
                <title>{point.label}: {point.value}</title>
              </circle>
            ))}
          </svg>
          <div className="mt-1 flex justify-between text-[10px] text-ink-soft"><span>{points[0]?.label}</span><span>{points[Math.floor(points.length / 2)]?.label}</span><span>{points[points.length - 1]?.label}</span></div>
        </div>
      ) : (
        <div className="mt-4 flex h-44 items-center justify-center rounded-2xl border border-dashed border-line text-center">
          <p className="px-4 text-sm text-ink-soft">Not enough activity yet to show a trend.</p>
        </div>
      )}
    </>
  );
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    broadcast: <><path d="M2 12a10 10 0 0 1 20 0M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0M12 12v9" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
    check: <><path d="m5 12 4 4L19 6" /><circle cx="12" cy="12" r="10" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.users}</svg>;
}

function greeting(date: Date) {
  const hour = date.getHours();
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}
