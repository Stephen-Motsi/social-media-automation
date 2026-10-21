import Link from "next/link";
import type { Platform } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { platforms, platformOrder, PlatformBadge } from "@/components/platforms";

export const dynamic = "force-dynamic";

const when = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function greeting(now: Date) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function plural(n: number, [one, many]: [string, string]) {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function OverviewPage() {
  const session = await auth();
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [accountGroups, statusGroups, sentByPlatform, upcoming, recent, dueThisWeek] = await Promise.all([
    prisma.socialAccount.groupBy({ by: ["platform"], _count: true }),
    prisma.post.groupBy({ by: ["status"], _count: true }),
    Promise.all(
      platformOrder.map((platform) =>
        prisma.postTarget.count({ where: { status: "PUBLISHED", account: { platform } } }),
      ),
    ),
    prisma.post.findMany({
      where: { status: "SCHEDULED", scheduledAt: { gte: now } },
      orderBy: { scheduledAt: "asc" },
      take: 4,
      include: { targets: { include: { account: true } } },
    }),
    prisma.postTarget.findMany({
      where: { status: { not: "PENDING" } },
      orderBy: { post: { updatedAt: "desc" } },
      take: 5,
      include: { account: true, post: true },
    }),
    prisma.post.count({ where: { status: "SCHEDULED", scheduledAt: { gte: now, lte: weekAhead } } }),
  ]);

  const accountsFor = (p: Platform) => accountGroups.find((g) => g.platform === p)?._count ?? 0;
  const postsWith = (s: string) => statusGroups.find((g) => g.status === s)?._count ?? 0;
  const name = session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "there";

  const stats = [
    { label: "Drafts", value: postsWith("DRAFT") },
    { label: "Scheduled", value: postsWith("SCHEDULED") },
    { label: "Published", value: postsWith("PUBLISHED") },
    { label: "Failed", value: postsWith("FAILED"), alert: true },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          {greeting(now)}, {name}
        </h1>
        <p className="mt-3 max-w-prose text-lg text-ink-soft">
          {dueThisWeek > 0
            ? `${plural(dueThisWeek, ["post goes", "posts go"])} out in the next 7 days.`
            : "Nothing is scheduled for the next 7 days."}
        </p>
      </section>

      {/* Channels: the one place we let colour run loud */}
      <section aria-label="Channels" className="grid gap-4 md:grid-cols-3">
        {platformOrder.map((platform, i) => {
          const p = platforms[platform];
          const count = accountsFor(platform);
          return (
            <article key={platform} className="glass group relative overflow-hidden rounded-[28px] p-6">
              {/* channel colour glowing up from the corner */}
              <div
                aria-hidden
                className={`${p.blend} absolute -top-16 -right-16 size-48 rounded-full opacity-40 blur-2xl transition-transform duration-700 group-hover:scale-125`}
              />
              <div className="relative">
                <PlatformBadge platform={platform} size="lg" />
                <h2 className="mt-5 text-xl font-semibold">{p.name}</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {count > 0 ? `${plural(count, p.accountNoun)} connected` : `No ${p.accountNoun[0]} connected yet`}
                </p>
                <div className="mt-6 flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-semibold tabular-nums">{sentByPlatform[i]}</div>
                    <div className="text-sm text-ink-soft">
                      {platform === "WHATSAPP" ? "messages sent" : "posts published"}
                    </div>
                  </div>
                  <Link
                    href="/accounts"
                    className="rounded-full bg-white/55 px-4 py-2 text-sm font-medium backdrop-blur transition-colors hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/20"
                  >
                    {count > 0 ? "Manage" : "Connect"}
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section
        aria-label="Post totals"
        className="glass grid grid-cols-2 divide-line rounded-3xl md:grid-cols-4 md:divide-x"
      >
        {stats.map((s) => (
          <div key={s.label} className="px-6 py-5">
            <div className="text-sm text-ink-soft">{s.label}</div>
            <div
              className={`mt-1 text-2xl font-semibold tabular-nums ${s.alert && s.value > 0 ? "text-danger" : ""}`}
            >
              {s.value}
            </div>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="glass rounded-3xl p-6 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Up next</h2>
            <Link href="/posts" className="text-sm text-ink-soft hover:text-ink">
              All posts
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
              <p className="text-ink-soft">
                Nothing scheduled. Write a post, pick a time, and it publishes on its own.
              </p>
              <Link
                href="/posts"
                className="blend-meta mt-4 inline-block rounded-full px-5 py-2 text-sm font-medium text-white shadow-md shadow-fuchsia-500/25"
              >
                Write a post
              </Link>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {upcoming.map((post) => (
                <li key={post.id} className="flex gap-4 py-4">
                  <div className="w-28 shrink-0 text-sm text-ink-soft">
                    {post.scheduledAt && when.format(post.scheduledAt)}
                  </div>
                  <p className="line-clamp-2 flex-1">{post.content}</p>
                  <div className="flex -space-x-2">
                    {[...new Set(post.targets.map((t) => t.account.platform))].map((pl) => (
                      <PlatformBadge key={pl} platform={pl} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass rounded-3xl p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold">Recent results</h2>
          {recent.length === 0 ? (
            <p className="mt-6 text-ink-soft">
              Once your first post goes out, you’ll see here whether it landed on each channel.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {recent.map((t) => (
                <li key={t.id} className="flex items-center gap-3">
                  <PlatformBadge platform={t.account.platform} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{t.post.content}</p>
                    <p className="truncate text-xs text-ink-soft">
                      {t.status === "PUBLISHED" ? `Sent to ${t.account.displayName}` : (t.error ?? "Failed")}
                    </p>
                  </div>
                  <span
                    className={`size-2.5 shrink-0 rounded-full ${t.status === "PUBLISHED" ? "bg-wa" : "bg-danger"}`}
                    aria-label={t.status === "PUBLISHED" ? "Published" : "Failed"}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
