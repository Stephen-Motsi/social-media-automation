import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pageViewer } from "@/lib/session";
import { activityDetail, activityLabel, activityLabels, deviceName } from "@/lib/activity";
import { RevokeSession } from "../buttons";
import { activityWhere, type LogFilters } from "./query";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: process.env.APP_TIMEZONE ?? "Africa/Nairobi",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const providerNames: Record<string, string> = { google: "Google", facebook: "Facebook", credentials: "Email & password", mock: "Test login" };
const roleLabel = { USER: "User", ADMIN: "Admin", SUPER_ADMIN: "Super admin" } as const;
const field = "rounded-full border border-line bg-white/55 px-3.5 py-2 text-sm dark:bg-white/5";

type Params = LogFilters & { tab?: string; page?: string; status?: string };

// Everything people do, and every signed-in session, from the database (ActivityLog, UserSession).
export default async function LogsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await pageViewer("staff");
  const p = await searchParams;
  const tab = p.tab === "sessions" ? "sessions" : "activity";
  const page = Math.max(1, Number(p.page) || 1);
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3600_000);

  const [activeSessions, signIns24h, signUps24h, users] = await Promise.all([
    prisma.userSession.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    prisma.activityLog.count({ where: { action: "SIGN_IN", createdAt: { gte: since24h } } }),
    prisma.activityLog.count({ where: { action: "SIGN_UP", createdAt: { gte: since24h } } }),
    prisma.user.count(),
  ]);
  const stats = [
    { label: "Signed in now", value: activeSessions },
    { label: "Sign-ins, last 24 h", value: signIns24h },
    { label: "New accounts, last 24 h", value: signUps24h },
    { label: "Accounts", value: users },
  ];

  const qs = (over: Partial<Params>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...p, ...over })) if (v) next.set(k, String(v));
    return `/admin/logs?${next}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Logs</h1>
        <p className="mt-2 max-w-prose text-ink-soft">
          Every sign-in, sign-out and action, and every signed-in device, stored in the database. Session records are
          checked on every request, so signing a device out here takes effect at its next click.
        </p>
      </div>

      <section aria-label="Totals" className="glass grid grid-cols-2 divide-line overflow-hidden rounded-3xl md:grid-cols-4 md:divide-x">
        {stats.map((s) => (
          <div key={s.label} className="px-6 py-5">
            <div className="text-sm text-ink-soft">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{s.value.toLocaleString()}</div>
          </div>
        ))}
      </section>

      <div role="tablist" aria-label="Log type" className="flex gap-1">
        {(["activity", "sessions"] as const).map((t) => (
          <Link
            key={t}
            role="tab"
            aria-selected={tab === t}
            href={t === "activity" ? "/admin/logs" : "/admin/logs?tab=sessions"}
            className={`rounded-full px-4 py-2 text-sm font-medium ${tab === t ? "bg-ink text-white dark:bg-white dark:text-ink" : "text-ink-soft hover:bg-white/40 hover:text-ink dark:hover:bg-white/10"}`}
          >
            {t === "activity" ? "Activity" : "Sessions"}
          </Link>
        ))}
      </div>

      {tab === "activity" ? <Activity p={p} page={page} qs={qs} /> : <Sessions p={p} page={page} qs={qs} />}
    </div>
  );
}

async function Activity({ p, page, qs }: { p: Params; page: number; qs: (o: Partial<Params>) => string }) {
  const where = activityWhere(p);
  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
    }),
    prisma.activityLog.count({ where }),
  ]);
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } }) : [];
  const exportUrl = `/admin/logs/export?${new URLSearchParams(Object.entries({ q: p.q, action: p.action, from: p.from, to: p.to }).filter((e): e is [string, string] => !!e[1]))}`;

  return (
    <section className="glass rise space-y-4 rounded-3xl p-5 sm:p-6">
      <form className="flex flex-wrap items-end gap-2" action="/admin/logs">
        <label className="min-w-48 flex-1">
          <span className="text-xs font-medium">Person or IP</span>
          <input name="q" defaultValue={p.q} placeholder="Name, email or IP" className={`mt-1 w-full ${field}`} />
        </label>
        <label>
          <span className="text-xs font-medium">Event</span>
          <select name="action" defaultValue={p.action ?? ""} className={`mt-1 block ${field}`}>
            <option value="">All events</option>
            {Object.entries(activityLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-xs font-medium">From</span>
          <input type="date" name="from" defaultValue={p.from} className={`mt-1 block ${field}`} />
        </label>
        <label>
          <span className="text-xs font-medium">To</span>
          <input type="date" name="to" defaultValue={p.to} className={`mt-1 block ${field}`} />
        </label>
        <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-ink">
          Filter
        </button>
        {(p.q || p.action || p.from || p.to) && (
          <Link href="/admin/logs" className="px-2 py-2 text-sm text-ink-soft hover:text-ink">
            Clear
          </Link>
        )}
        <a href={exportUrl} className="ml-auto rounded-full border border-line bg-white/55 px-4 py-2 text-sm font-medium hover:bg-white/80 dark:bg-white/10">
          Download CSV
        </a>
      </form>

      <p className="text-sm text-ink-soft">
        {total.toLocaleString()} {total === 1 ? "event" : "events"}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-ink-soft">Nothing matches.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="px-2 py-2 font-medium">When</th>
                <th className="px-2 py-2 font-medium">Who</th>
                <th className="px-2 py-2 font-medium">Event</th>
                <th className="px-2 py-2 font-medium">Details</th>
                <th className="px-2 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const actor = r.actorId && r.actorId !== r.user.id ? actors.find((a) => a.id === r.actorId) : null;
                return (
                  <tr key={r.id} className="align-top transition-colors hover:bg-white/35 dark:hover:bg-white/5">
                    <td className="px-2 py-2.5 whitespace-nowrap text-ink-soft tabular-nums">{when.format(r.createdAt)}</td>
                    <td className="px-2 py-2.5">
                      <Link href={`/admin/users?id=${r.user.id}`} className="font-medium hover:underline">
                        {r.user.name ?? r.user.email}
                      </Link>
                      <span className="block text-xs text-ink-soft">
                        {r.user.email} · {roleLabel[r.user.role]}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      {activityLabel(r.action)}
                      {actor && <span className="block text-xs text-ink-soft">by {actor.email}</span>}
                    </td>
                    <td className="max-w-80 px-2 py-2.5 text-xs break-words text-ink-soft">{activityDetail(r.detail)}</td>
                    <td className="px-2 py-2.5 text-xs whitespace-nowrap text-ink-soft tabular-nums">{r.ip ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={total} qs={qs} />
    </section>
  );
}

async function Sessions({ p, page, qs }: { p: Params; page: number; qs: (o: Partial<Params>) => string }) {
  const now = new Date();
  const status = p.status === "all" ? "all" : "active";
  const where: Prisma.UserSessionWhereInput = {
    // Signed in now, plus anything signed out in the last 10 minutes (so a sign-out shows its result)
    ...(status === "active"
      ? { expiresAt: { gt: now }, OR: [{ revokedAt: null }, { revokedAt: { gte: new Date(now.getTime() - 10 * 60_000) } }] }
      : {}),
    ...(p.q ? { AND: [{ OR: [{ user: { email: { contains: p.q, mode: "insensitive" } } }, { user: { name: { contains: p.q, mode: "insensitive" } } }, { ip: { contains: p.q } }] }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.userSession.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
    }),
    prisma.userSession.count({ where }),
  ]);

  return (
    <section className="glass rise space-y-4 rounded-3xl p-5 sm:p-6">
      <form className="flex flex-wrap items-end gap-2" action="/admin/logs">
        <input type="hidden" name="tab" value="sessions" />
        <label className="min-w-48 flex-1">
          <span className="text-xs font-medium">Person or IP</span>
          <input name="q" defaultValue={p.q} placeholder="Name, email or IP" className={`mt-1 w-full ${field}`} />
        </label>
        <label>
          <span className="text-xs font-medium">Show</span>
          <select name="status" defaultValue={status} className={`mt-1 block ${field}`}>
            <option value="active">Signed in now</option>
            <option value="all">All sessions</option>
          </select>
        </label>
        <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-ink">
          Filter
        </button>
      </form>
      <p className="text-sm text-ink-soft">
        {total.toLocaleString()} {total === 1 ? "session" : "sessions"}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-ink-soft">No sessions.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="px-2 py-2 font-medium">Who</th>
                <th className="px-2 py-2 font-medium">Signed in with</th>
                <th className="px-2 py-2 font-medium">Device</th>
                <th className="px-2 py-2 font-medium">Started</th>
                <th className="px-2 py-2 font-medium">Last seen</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => {
                const state = s.revokedAt ? "Signed out" : s.expiresAt <= now ? "Expired" : "Active";
                return (
                  <tr key={s.id} className="align-top transition-colors hover:bg-white/35 dark:hover:bg-white/5">
                    <td className="px-2 py-2.5">
                      <Link href={`/admin/users?id=${s.user.id}`} className="font-medium hover:underline">
                        {s.user.name ?? s.user.email}
                      </Link>
                      <span className="block text-xs text-ink-soft">
                        {s.user.email} · {roleLabel[s.user.role]}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">{providerNames[s.provider] ?? s.provider}</td>
                    <td className="px-2 py-2.5">
                      {deviceName(s.userAgent)}
                      <span className="block text-xs text-ink-soft tabular-nums">{s.ip ?? "IP unknown"}</span>
                    </td>
                    <td className="px-2 py-2.5 whitespace-nowrap text-ink-soft tabular-nums">{when.format(s.createdAt)}</td>
                    <td className="px-2 py-2.5 whitespace-nowrap text-ink-soft tabular-nums">{when.format(s.lastSeenAt)}</td>
                    <td className="px-2 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${state === "Active" ? "bg-wa/15 text-emerald-700 dark:text-emerald-300" : "bg-ink/10 text-ink-soft"}`}>{state}</span>
                      {s.revokedAt && <span className="mt-1 block text-xs text-ink-soft">{when.format(s.revokedAt)}</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right">{state === "Active" && <RevokeSession id={s.id} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={total} qs={qs} />
    </section>
  );
}

function Pager({ page, total, qs }: { page: number; total: number; qs: (o: Partial<Params>) => string }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages === 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between text-sm">
      {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="rounded-full px-3 py-1.5 hover:bg-white/40 dark:hover:bg-white/10">← Newer</Link> : <span />}
      <span className="text-ink-soft">
        Page {page} of {pages}
      </span>
      {page < pages ? <Link href={qs({ page: String(page + 1) })} className="rounded-full px-3 py-1.5 hover:bg-white/40 dark:hover:bg-white/10">Older →</Link> : <span />}
    </nav>
  );
}
