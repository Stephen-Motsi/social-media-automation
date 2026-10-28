import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pageViewer } from "@/lib/session";
import { platforms } from "@/components/platforms";
import { SignOutEverywhere } from "../buttons";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: process.env.APP_TIMEZONE ?? "Africa/Nairobi",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const roleLabel = { USER: "User", ADMIN: "Admin", SUPER_ADMIN: "Super admin" } as const;

type UserParams = { q?: string; id?: string; role?: string; status?: string; page?: string };

export default async function UsersPage({ searchParams }: { searchParams: Promise<UserParams> }) {
  await pageViewer("super");
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const id = params.id;
  const role = params.role === "USER" || params.role === "ADMIN" || params.role === "SUPER_ADMIN" ? params.role : "";
  const status = params.status === "disabled" || params.status === "active" ? params.status : "";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const where: Prisma.UserWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    ...(role ? { role } : {}),
    ...(status === "disabled" ? { disabledAt: { not: null } } : status === "active" ? { disabledAt: null } : {}),
  };
  const now = new Date();
  const total = await prisma.user.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      accounts: { select: { provider: true } },
      sessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 },
      _count: {
        select: {
          subscriptions: true,
          sessions: { where: { revokedAt: null, expiresAt: { gt: now } } },
        },
      },
      subscriber: { select: { status: true } },
    },
  });
  const selected = id
    ? await prisma.user.findUnique({
        where: { id },
        include: {
          subscriptions: { include: { advert: { select: { title: true } } }, orderBy: { createdAt: "desc" } },
          sessions: { orderBy: { lastSeenAt: "desc" }, take: 20 },
          activity: { orderBy: { createdAt: "desc" }, take: 50 },
          subscriber: true,
          accounts: { select: { provider: true } },
        },
      })
    : null;
  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (role) next.set("role", role);
    if (status) next.set("status", status);
    if (target > 1) next.set("page", String(target));
    const query = next.toString();
    return `/admin/users${query ? `?${query}` : ""}`;
  };
  const detailHref = (userId: string) => {
    const next = new URLSearchParams();
    next.set("id", userId);
    if (q) next.set("q", q);
    if (role) next.set("role", role);
    if (status) next.set("status", status);
    if (page > 1) next.set("page", String(page));
    return `/admin/users?${next}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Users</h1>
        <p className="mt-2 max-w-prose text-ink-soft">Everyone with an account: how they sign in, their sessions, subscriptions and activity.</p>
      </div>

      {selected && (
        <section className="glass space-y-5 rounded-[28px] p-6" aria-label={`Details for ${selected.email}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{selected.name ?? selected.email}</h2>
              <p className="text-sm text-ink-soft">
                {selected.email} · {roleLabel[selected.role]} · joined {when.format(selected.createdAt)} ·{" "}
                {selected.accounts.map((a) => a.provider).join(", ") || "password"}
                {selected.subscriber ? ` · WhatsApp +${selected.subscriber.phone} (${selected.subscriber.status.toLowerCase()})` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SignOutEverywhere userId={selected.id} />
              <Link href={pageHref(page)} className="text-sm text-ink-soft hover:text-ink">
                Close
              </Link>
            </div>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <div>
              <h3 className="text-sm font-semibold">Subscriptions</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {selected.subscriptions.map((s) => (
                  <li key={s.id}>
                    {s.advert.title ?? "Advert"} <span className="text-ink-soft">· {platforms[s.platform].name}</span>
                  </li>
                ))}
                {selected.subscriptions.length === 0 && <li className="text-ink-soft">None</li>}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Sessions</h3>
              <ul className="mt-2 space-y-1.5 text-xs">
                {selected.sessions.map((s) => {
                  const live = !s.revokedAt && s.expiresAt > now;
                  return (
                    <li key={s.id} className={live ? "" : "text-ink-soft line-through"}>
                      {s.provider} · {s.ip ?? "?"} · last active {when.format(s.lastSeenAt)}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Activity</h3>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs text-ink-soft">
                {selected.activity.map((a) => (
                  <li key={a.id}>
                    {when.format(a.createdAt)} · <span className="text-ink">{a.action.toLowerCase().replace(/_/g, " ")}</span>
                    {a.detail ? ` · ${Object.values(a.detail as Record<string, unknown>).join(", ")}` : ""}
                    {a.ip ? ` · ${a.ip}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      <section className="glass rounded-3xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-ink-soft">{total.toLocaleString()} {total === 1 ? "account" : "accounts"}</p>
          <form role="search" action="/admin/users" className="grid w-full gap-2 sm:w-auto sm:grid-cols-4">
            <label className="sr-only" htmlFor="users-search">Search users</label>
            <input id="users-search" name="q" defaultValue={q} placeholder="Name or email" className="min-w-0 rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-white/5 sm:w-48" />
            <label className="sr-only" htmlFor="users-role">Filter by role</label>
            <select id="users-role" name="role" defaultValue={role} className="rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-[#211b38]">
              <option value="">All roles</option><option value="USER">User</option><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super admin</option>
            </select>
            <label className="sr-only" htmlFor="users-status">Filter by status</label>
            <select id="users-status" name="status" defaultValue={status} className="rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-[#211b38]">
              <option value="">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option>
            </select>
            <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-ink">Apply</button>
          </form>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-ink-soft">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Signs in with</th>
                <th className="py-2 pr-3 font-medium">Last active</th>
                <th className="py-2 pr-3 font-medium">Active sessions</th>
                <th className="py-2 pr-3 font-medium">Subscriptions</th>
                <th className="py-2 font-medium">WhatsApp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2.5 pr-3">
                    <Link href={detailHref(u.id)} className="font-medium hover:underline">
                      {u.name ?? u.email}
                    </Link>
                    <span className="block text-xs text-ink-soft">{u.email}</span>
                  </td>
                  <td className="py-2.5 pr-3">{roleLabel[u.role]}</td>
                  <td className="py-2.5 pr-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className={`size-2 rounded-full ${u.disabledAt ? "bg-danger" : "bg-wa"}`} />
                      {u.disabledAt ? "Disabled" : "Active"}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">{u.accounts.map((a) => a.provider).join(", ") || "Password"}</td>
                  <td className="py-2.5 pr-3">{u.sessions[0] ? when.format(u.sessions[0].lastSeenAt) : "Never"}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{u._count.sessions}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{u._count.subscriptions}</td>
                  <td className="py-2.5">{u.subscriber ? u.subscriber.status.toLowerCase().replace("_", " ") : "—"}</td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-soft">No accounts match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-soft">Page {page} of {totalPages}</p>
          <nav aria-label="User pages" className="flex items-center gap-2">
            <Link tabIndex={page <= 1 ? -1 : undefined} aria-disabled={page <= 1} href={pageHref(Math.max(1, page - 1))} className={`rounded-full border border-line px-3 py-1.5 text-xs ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-white/50 dark:hover:bg-white/10"}`}>Previous</Link>
            <Link tabIndex={page >= totalPages ? -1 : undefined} aria-disabled={page >= totalPages} href={pageHref(Math.min(totalPages, page + 1))} className={`rounded-full border border-line px-3 py-1.5 text-xs ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-white/50 dark:hover:bg-white/10"}`}>Next</Link>
          </nav>
        </div>
      </section>
    </div>
  );
}
