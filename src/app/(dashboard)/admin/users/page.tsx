import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pageViewer } from "@/lib/session";
import { platforms } from "@/components/platforms";
import { SignOutEverywhere } from "../buttons";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: process.env.APP_TIMEZONE ?? "Africa/Nairobi",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const roleLabel = { USER: "User", ADMIN: "Admin", SUPER_ADMIN: "Super admin" } as const;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; id?: string }> }) {
  await pageViewer("staff");
  const { q = "", id } = await searchParams;
  const where: Prisma.UserWhereInput = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
    : {};
  const now = new Date();
  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      accounts: { select: { provider: true } },
      sessions: { select: { lastSeenAt: true, revokedAt: true, expiresAt: true }, orderBy: { lastSeenAt: "desc" } },
      _count: { select: { subscriptions: true } },
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
              <Link href="/admin/users" className="text-sm text-ink-soft hover:text-ink">
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
        <form role="search" className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="Name or email" aria-label="Search users" className="rounded-xl border border-line bg-white/55 px-3 py-2 text-sm dark:bg-white/5" />
          <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-ink">
            Search
          </button>
        </form>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-ink-soft">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Role</th>
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
                    <Link href={`/admin/users?id=${u.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="font-medium hover:underline">
                      {u.name ?? u.email}
                    </Link>
                    <span className="block text-xs text-ink-soft">{u.email}</span>
                  </td>
                  <td className="py-2.5 pr-3">{roleLabel[u.role]}</td>
                  <td className="py-2.5 pr-3">{u.accounts.map((a) => a.provider).join(", ") || "Password"}</td>
                  <td className="py-2.5 pr-3">{u.sessions[0] ? when.format(u.sessions[0].lastSeenAt) : "Never"}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{u.sessions.filter((s) => !s.revokedAt && s.expiresAt > now).length}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{u._count.subscriptions}</td>
                  <td className="py-2.5">{u.subscriber ? u.subscriber.status.toLowerCase().replace("_", " ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
