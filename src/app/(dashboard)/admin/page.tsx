import { isStaff, pageViewer } from "@/lib/session";
import Link from "next/link";
import type { Platform } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { platforms, platformOrder, PlatformBadge } from "@/components/platforms";
import { formatSupport } from "@/lib/policy/rules";
import { describeSchedule, formatInZone } from "@/lib/schedule";
import { scheduleSpec } from "@/lib/channels";

export const dynamic = "force-dynamic";

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
  await pageViewer("staff");
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [accountGroups, statusGroups, sentByPlatform, channels, recent] = await Promise.all([
    prisma.socialAccount.groupBy({ by: ["platform"], _count: true }),
    prisma.post.groupBy({ by: ["status"], _count: true }),
    Promise.all(
      platformOrder.map((platform) =>
        prisma.postTarget.count({ where: { status: "PUBLISHED", account: { platform } } }),
      ),
    ),
    prisma.channel.findMany({ include: { advert: true } }),
    prisma.postTarget.findMany({
      where: { status: { not: "PENDING" } },
      orderBy: { post: { updatedAt: "desc" } },
      take: 5,
      include: { account: true, post: true },
    }),
  ]);
  const shown = platformOrder.filter((p) => channels.some((c) => c.platform === p));
  const upcoming = channels
    .filter((c) => c.enabled && c.nextRunAt)
    .sort((a, b) => a.nextRunAt!.getTime() - b.nextRunAt!.getTime());
  const dueThisWeek = upcoming.filter((c) => c.nextRunAt! <= weekAhead).length;

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
            ? `${plural(dueThisWeek, ["channel posts", "channels post"])} in the next 7 days.`
            : "Nothing is scheduled for the next 7 days."}
        </p>
      </section>

      {/* Channels: the one place we let colour run loud */}
      {shown.length === 0 && (
        <section className="glass rounded-[28px] px-6 py-10 text-center">
          <p className="text-lg font-medium">No channels yet</p>
          <p className="mt-1 text-ink-soft">Add a platform on the Channels page to connect accounts and schedule adverts.</p>
          <Link
            href="/channels"
            className="blend-meta mt-4 inline-block rounded-full px-5 py-2 text-sm font-medium text-white shadow-md shadow-fuchsia-500/25"
          >
            Go to Channels
          </Link>
        </section>
      )}
      <section aria-label="Channels" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((platform) => {
          const i = platformOrder.indexOf(platform);
          const p = platforms[platform];
          const count = accountsFor(platform);
          const channel = channels.find((c) => c.platform === platform)!;
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
                <p className="mt-1 text-sm text-ink-soft">
                  {channel.enabled && channel.nextRunAt
                    ? `Next: ${formatInZone(channel.nextRunAt, channel.timezone)}`
                    : "Schedule off"}
                </p>
                <div className="mt-6 flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-semibold tabular-nums">{sentByPlatform[i]}</div>
                    <div className="text-sm text-ink-soft">
                      {platform === "WHATSAPP" ? "messages sent" : "posts published"}
                    </div>
                  </div>
                  <Link
                    href="/channels"
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
            <Link href="/channels" className="text-sm text-ink-soft hover:text-ink">
              Channels
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
              <p className="text-ink-soft">
                Nothing scheduled. Pick an advert and a time in a channel, and it posts on its own.
              </p>
              <Link
                href="/channels"
                className="blend-meta mt-4 inline-block rounded-full px-5 py-2 text-sm font-medium text-white shadow-md shadow-fuchsia-500/25"
              >
                Set up a schedule
              </Link>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {upcoming.map((c) => (
                <li key={c.id} className="flex items-center gap-4 py-4">
                  <PlatformBadge platform={c.platform} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{c.advert?.content || "(image only)"}</p>
                    <p className="text-xs text-ink-soft">
                      {formatSupport[c.platform][c.format].label} · {describeSchedule(scheduleSpec(c))}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-sm text-ink-soft">{formatInZone(c.nextRunAt!, c.timezone)}</div>
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
