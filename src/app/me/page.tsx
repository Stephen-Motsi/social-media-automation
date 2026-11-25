import type { Metadata } from "next";
import Link from "next/link";
import { PlatformBadge, platforms } from "@/components/platforms";
import { deviceName } from "@/lib/activity";
import { formatWhen } from "@/lib/errors";
import { isStaff, pageViewer } from "@/lib/session";
import { userDashboard } from "@/lib/user-dashboard";
import { UserHeader } from "./header";
import LegacyDashboard from "./legacy-dashboard";
import { SessionButtons } from "./widgets";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };

export default async function MePage() {
  const viewer = await pageViewer("user");
  if (isStaff(viewer.role)) return <LegacyDashboard />;
  const { user, counts, recentDrafts, recentPosts, accounts, whatsapp } = await userDashboard(viewer.id);
  const metrics = [
    { label: "Draft adverts", value: counts.drafts },
    { label: "Scheduled posts", value: counts.scheduled },
    { label: "Published posts", value: counts.published },
    { label: "Failed posts", value: counts.failed },
  ];

  return (
    <div className="min-h-screen pb-16">
      <UserHeader email={viewer.email} current="/me" staff={false} />
      <main className="rise mx-auto max-w-5xl space-y-8 px-4 pt-10">
        <section className="glass flex flex-wrap items-end justify-between gap-5 rounded-[32px] p-6 sm:p-8">
          <div>
            <p className="text-sm font-medium text-ink-soft">Your advertising workspace</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Welcome, {user.name?.split(" ")[0] || "there"}</h1>
            <p className="mt-2 max-w-prose text-ink-soft">Create adverts, manage your social accounts and follow your publishing activity.</p>
          </div>
          <Link href="/me/create" className="blend-meta rounded-full px-5 py-3 text-sm font-medium text-white">Create an advert</Link>
        </section>

        <section aria-label="Your advertising overview" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <article key={metric.label} className="glass rounded-2xl p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{metric.label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{metric.value}</p>
            </article>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="glass rounded-3xl p-6" aria-labelledby="drafts-h">
            <div className="flex items-center justify-between gap-3">
              <h2 id="drafts-h" className="text-lg font-semibold">Recent drafts</h2>
              <Link href="/me/adverts" className="text-sm underline">View all</Link>
            </div>
            {recentDrafts.length === 0 ? <p className="mt-3 text-sm text-ink-soft">No drafts yet.</p> : (
              <ul className="mt-3 divide-y divide-line">
                {recentDrafts.map((draft) => (
                  <li key={draft.id} className="py-3">
                    <Link href={`/me/create?id=${encodeURIComponent(draft.id)}`} className="font-medium underline-offset-2 hover:underline">
                      {draft.title || draft.content.slice(0, 60) || "Untitled draft"}
                    </Link>
                    <p className="text-xs text-ink-soft">Updated {formatWhen(draft.updatedAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass rounded-3xl p-6" aria-labelledby="accounts-h">
            <div className="flex items-center justify-between gap-3">
              <h2 id="accounts-h" className="text-lg font-semibold">Social accounts</h2>
              <Link href="/me/accounts" className="text-sm underline">Manage</Link>
            </div>
            {accounts.length === 0 && <p className="mt-3 text-sm text-ink-soft">No social accounts connected yet.</p>}
            <ul className="mt-3 space-y-3">
              {accounts.map((account) => (
                <li key={account.id} className="flex items-center gap-2 text-sm">
                  <PlatformBadge platform={account.platform} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{account.displayName}{account.handle ? ` · ${account.handle}` : ""}</p>
                    <p className="text-xs text-ink-soft">
                      {account.disconnectedAt ? "Disconnected" : account.tokenExpiresAt && account.tokenExpiresAt <= new Date() ? "Token expired; check or reconnect" : "Authorization not recently verified"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-ink-soft">WhatsApp request: {whatsapp ? whatsapp.status.replaceAll("_", " ").toLowerCase() : "not requested"}.</p>
          </section>
        </div>

        <section className="glass rounded-3xl p-6" aria-labelledby="activity-h">
          <h2 id="activity-h" className="text-lg font-semibold">Recent publishing activity</h2>
          {recentPosts.length === 0 ? <p className="mt-3 text-sm text-ink-soft">No publishing activity yet.</p> : (
            <ul className="mt-3 divide-y divide-line">
              {recentPosts.map((post) => (
                <li key={post.id} className="space-y-1 py-3 text-sm">
                  <p className="font-medium">{post.content.slice(0, 100) || "Post"} · {post.status.toLowerCase()}</p>
                  <p className="text-xs text-ink-soft">{formatWhen(post.publishedAt ?? post.scheduledAt ?? post.updatedAt)}</p>
                  {post.targets.map((target) => (
                    <p key={target.id} className="text-xs text-ink-soft">
                      {platforms[target.account.platform].name} · {target.account.displayName}: {target.status === "IN_FLIGHT" ? "in progress or requires reconciliation" : target.status.toLowerCase()}
                      {target.error ? ` — ${target.error}` : ""}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <Link href="/me/history" className="mt-4 inline-block text-sm underline">View earlier subscription delivery history</Link>
        </section>

        <section id="security" className="glass scroll-mt-24 rounded-3xl p-6" aria-labelledby="security-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="security-h" className="text-lg font-semibold">Sign-in and security</h2>
            <SessionButtons />
          </div>
          <p className="mt-1 text-sm text-ink-soft">Signed in with {[...new Set(user.accounts.map((account) => account.provider))].join(", ") || "email and password"}.</p>
          <ul className="mt-4 divide-y divide-line text-sm">
            {user.sessions.map((session) => (
              <li key={session.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{deviceName(session.userAgent)}</p>
                  <p className="text-xs text-ink-soft">{session.ip ?? "Unknown network"} · last active {formatWhen(session.lastSeenAt)}</p>
                </div>
                <SessionButtons id={session.id} current={session.id === viewer.sessionId} />
              </li>
            ))}
          </ul>
          <h3 className="mt-6 text-sm font-semibold">Recent account activity</h3>
          <ul className="mt-2 space-y-1 text-xs text-ink-soft">
            {user.activity.map((activity) => <li key={activity.id}>{formatWhen(activity.createdAt)} · {activity.action.toLowerCase().replaceAll("_", " ")}</li>)}
          </ul>
        </section>
      </main>
    </div>
  );
}
