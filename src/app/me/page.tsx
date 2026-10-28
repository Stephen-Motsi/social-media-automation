import type { Metadata } from "next";
import Link from "next/link";
import { UserHeader } from "./header";
import { formatWhen } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { isStaff, pageViewer } from "@/lib/session";
import { displayHandle, PROFILE_PLATFORMS } from "@/lib/handles";
import { deviceName } from "@/lib/activity";
import { listedAdverts, postUrl } from "@/lib/adverts";
import { businessWhatsAppNumber, whatsappLink } from "@/lib/audience";
import { PlatformBadge } from "@/components/platforms";
import { PlatformToggle, SessionButtons, SubscribeAll, WhatsAppLink } from "./widgets";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My adverts" };

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: process.env.APP_TIMEZONE ?? "Africa/Nairobi",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const providerNames: Record<string, string> = { google: "Google", facebook: "Facebook", mock: "Test login" };

function greetingFor(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const dashboardDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: process.env.APP_TIMEZONE ?? "Africa/Nairobi",
  weekday: "long",
  day: "numeric",
  month: "long",
});

export default async function MePage() {
  const viewer = await pageViewer("user");
  // Everything below is loaded for the signed-in user only (viewer.id from the checked session).
  const [user, adverts, business] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: viewer.id },
      include: {
        subscriptions: true,
        subscriber: true,
        socials: true,
        accounts: { select: { provider: true } },
        sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } },
        activity: { orderBy: { createdAt: "desc" }, take: 12 },
      },
    }),
    listedAdverts(),
    businessWhatsAppNumber(),
  ]);
  const subscribed = (advertId: string, p: string) => user.subscriptions.some((s) => s.advertId === advertId && s.platform === p);
  const waActive = user.subscriber?.status === "ACTIVE";
  const subscribedAdvertCount = new Set(user.subscriptions.map((subscription) => subscription.advertId)).size;
  const profileComplete = Boolean(user.name?.trim());
  const setupSteps = [
    { label: "Complete your profile", complete: profileComplete, href: "/me/profile" },
    { label: "Choose an advert", complete: subscribedAdvertCount > 0, href: "/#adverts" },
    { label: "Link WhatsApp", complete: waActive, href: "#whatsapp" },
  ];
  const setupComplete = setupSteps.every((step) => step.complete);
  const now = new Date();
  const upcomingAdverts = adverts.filter((advert) => advert.sendAt && advert.sendAt > now).sort((a, b) => a.sendAt!.getTime() - b.sendAt!.getTime()).slice(0, 4);
  const connectedHandles = PROFILE_PLATFORMS.filter((platform) => user.socials.some((social) => social.platform === platform && social.handle.trim())).length + (waActive ? 1 : 0);
  const whatsappStatus = user.subscriber?.status === "ACTIVE"
    ? "Linked"
    : user.subscriber?.status === "NEEDS_REVIEW"
      ? "Review needed"
      : user.whatsappCode && user.whatsappPending
        ? "Waiting for confirmation"
        : "Not linked";

  // What happened with each subscription: WhatsApp messages to this user, or the posts on that platform
  const advertIds = [...new Set(user.subscriptions.map((s) => s.advertId))];
  const [deliveries, posts, handleDeliveries] = await Promise.all([
    user.subscriber
      ? prisma.delivery.findMany({
          where: { subscriberId: user.subscriber.id, campaign: { advertId: { in: advertIds } } },
          include: { campaign: { select: { advertId: true } } },
          orderBy: { createdAt: "desc" },
        })
      : [],
    prisma.postTarget.findMany({
      where: { status: "PUBLISHED", post: { sourceAdvertId: { in: advertIds } } },
      include: { account: true, post: { select: { sourceAdvertId: true, publishedAt: true, updatedAt: true } } },
    }),
    prisma.socialDelivery.findMany({ where: { userId: user.id, advertId: { in: advertIds } } }),
  ]);
  const feed = user.subscriptions.flatMap((s) => {
    const advert = adverts.find((a) => a.id === s.advertId);
    if (!advert) return [];
    if (s.platform === "WHATSAPP") {
      return deliveries
        .filter((d) => d.campaign.advertId === s.advertId && ["SENT", "DELIVERED", "READ"].includes(d.status))
        .map((d) => ({ key: d.id, advert, platform: s.platform, at: d.sentAt ?? d.createdAt, text: `Sent to your WhatsApp (${d.status.toLowerCase()})`, url: null as string | null }));
    }
    const toHandle = handleDeliveries
      .filter((d) => d.advertId === s.advertId && d.platform === s.platform && (d.status === "SENT" || d.status === "FAILED"))
      .map((d) => ({
        key: d.id,
        advert,
        platform: s.platform,
        at: d.sentAt ?? d.updatedAt,
        text:
          d.status === "SENT"
            ? s.platform === "X"
              ? `Sent to ${displayHandle("X", d.handle)} by direct message`
              : `We mentioned ${displayHandle("INSTAGRAM", d.handle)} on our post`
            : `Couldn't reach ${displayHandle(s.platform, d.handle)}: ${d.error ?? "unknown error"}`,
        url: null as string | null,
      }));
    return [...toHandle, ...posts
      .filter((t) => t.post.sourceAdvertId === s.advertId && t.account.platform === s.platform)
      .map((t) => ({
        key: t.id,
        advert,
        platform: s.platform,
        at: t.post.publishedAt ?? t.post.updatedAt,
        text: `Posted on ${t.account.displayName}`,
        url: postUrl(s.platform, t.externalPostId, t.account.handle),
      }))];
  });
  feed.sort((a, b) => b.at.getTime() - a.at.getTime());

  const pendingLink =
    user.whatsappCode && user.whatsappPending
      ? { code: user.whatsappCode, number: user.whatsappPending, link: business ? whatsappLink(business, `JOIN ${user.whatsappCode}`) : null }
      : null;

  return (
    <div className="min-h-screen pb-16">
      <UserHeader email={user.email} current="/me" staff={isStaff(viewer.role)} />

      <main className="rise mx-auto max-w-5xl space-y-8 px-4 pt-10">
        <section className="glass relative overflow-hidden rounded-[32px] p-6 sm:p-8">
          <div aria-hidden className="absolute -right-16 -top-24 size-72 rounded-full bg-[var(--ig-2)]/10 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium text-ink-soft">{dashboardDate.format(now)} · Your dashboard</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{greetingFor(now)}, {user.name?.split(" ")[0] ?? "there"}</h1>
              <p className="mt-2 max-w-2xl text-ink-soft">
                Discover adverts, choose where you receive them, and review delivery activity from one place.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/#adverts" className="blend-meta inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium text-white shadow-md shadow-fuchsia-500/25">
                Browse adverts
              </Link>
              <Link href="/me/profile" className="inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-white/55 px-5 py-2.5 text-sm font-medium hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/20">
                Manage profile
              </Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="quick-actions-h">
          <h2 id="quick-actions-h" className="mb-3 text-lg font-semibold">Quick actions</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link href="/#adverts" className="glass lift rounded-2xl p-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--ig-2)]/12 text-lg font-semibold text-[var(--ig-3)]" aria-hidden>+</span>
              <p className="mt-3 font-semibold">Browse adverts</p>
              <p className="mt-1 text-xs text-ink-soft">Choose what you want to follow</p>
            </Link>
            <Link href="/me/profile" className="glass lift rounded-2xl p-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--fb-1)]/12 text-lg font-semibold text-[var(--fb-1)]" aria-hidden>@</span>
              <p className="mt-3 font-semibold">Manage socials</p>
              <p className="mt-1 text-xs text-ink-soft">Add or update delivery handles</p>
            </Link>
            <Link href="#whatsapp" className="glass lift rounded-2xl p-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-wa/12 text-lg font-semibold text-emerald-700 dark:text-emerald-300" aria-hidden>WA</span>
              <p className="mt-3 font-semibold">WhatsApp</p>
              <p className="mt-1 text-xs text-ink-soft">{whatsappStatus}</p>
            </Link>
            <Link href="#security" className="glass lift rounded-2xl p-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-ink/8 text-lg font-semibold" aria-hidden>✓</span>
              <p className="mt-3 font-semibold">Sign-in & security</p>
              <p className="mt-1 text-xs text-ink-soft">Review active sessions</p>
            </Link>
          </div>
        </section>

        <section aria-label="Dashboard overview" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Adverts subscribed", value: subscribedAdvertCount, note: subscribedAdvertCount === 1 ? "1 advert" : `${subscribedAdvertCount} adverts` },
            { label: "Platform choices", value: user.subscriptions.length, note: "Your selected channels" },
            { label: "Profile handles", value: connectedHandles, note: "Saved or confirmed" },
            { label: "Delivery updates", value: feed.length, note: feed.length === 0 ? "No delivered items yet" : "Recent subscription activity" },
          ].map((metric, index) => (
            <article key={metric.label} className="glass lift rounded-2xl p-5" style={{ "--i": index + 1 } as React.CSSProperties}>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-soft">{metric.label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{metric.value}</p>
              <p className="mt-1 text-xs text-ink-soft">{metric.note}</p>
            </article>
          ))}
        </section>

        {!setupComplete && (
          <section className="glass rounded-3xl p-6" aria-labelledby="setup-h">
            <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-soft">Getting started</p>
              <h2 id="setup-h" className="mt-1 text-lg font-semibold">Set up your advert experience</h2>
            </div>
            <p className="text-sm font-medium tabular-nums text-ink-soft">
              {setupSteps.filter((step) => step.complete).length}/{setupSteps.length} complete
            </p>
          </div>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            {setupSteps.map((step, index) => (
              <li key={step.label}>
                <Link href={step.href} className="flex h-full items-center gap-3 rounded-2xl border border-line bg-white/35 px-4 py-3 transition-colors hover:bg-white/70 dark:bg-white/5 dark:hover:bg-white/10">
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.complete ? "bg-wa text-white" : "bg-ink text-white dark:bg-white dark:text-ink"}`} aria-label={step.complete ? "Complete" : `Step ${index + 1}`}>
                    {step.complete ? "✓" : index + 1}
                  </span>
                  <span className="min-w-0 text-sm font-medium">{step.label}</span>
                </Link>
              </li>
            ))}
          </ol>
          </section>
        )}

        <section id="whatsapp" className="glass scroll-mt-24 rounded-3xl p-6" aria-labelledby="wa-h">
          <h2 id="wa-h" className="text-lg font-semibold">My WhatsApp</h2>
          <div className="mt-3">
            <WhatsAppLink
              status={user.subscriber ? user.subscriber.status : pendingLink ? "waiting" : "none"}
              number={user.subscriber?.phone ?? null}
              pending={pendingLink}
            />
          </div>
        </section>

        <section className="glass rounded-3xl p-6" aria-labelledby="delivery-h">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-soft">My delivery</p>
              <h2 id="delivery-h" className="mt-1 text-lg font-semibold">Saved platform handles</h2>
            </div>
            <Link href="/me/profile" className="inline-flex min-h-9 items-center rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-white/60 dark:hover:bg-white/10">Manage</Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {PROFILE_PLATFORMS.map((platform) => {
              const social = user.socials.find((item) => item.platform === platform);
              return (
                <div key={platform} className="rounded-2xl border border-line bg-white/30 px-4 py-3 dark:bg-white/[0.03]">
                  <PlatformBadge platform={platform} />
                  <p className="mt-2 truncate text-sm font-semibold">{social ? displayHandle(platform, social.handle) : "Not added"}</p>
                  <p className={`mt-1 text-xs ${social ? "text-emerald-700 dark:text-emerald-300" : "text-ink-soft"}`}>{social ? "Handle saved" : "Optional setup"}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="glass rounded-3xl p-6" aria-labelledby="schedule-h">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-soft">Upcoming</p>
              <h2 id="schedule-h" className="mt-1 text-lg font-semibold">Scheduled adverts</h2>
            </div>
            <Link href="/#adverts" className="text-sm font-medium text-ink-soft hover:text-ink">View all adverts</Link>
          </div>
          {upcomingAdverts.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-line px-5 py-8 text-center">
              <p className="font-medium">No future sends are listed</p>
              <p className="mt-1 text-sm text-ink-soft">New scheduled adverts will appear here when they are published with a send date.</p>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {upcomingAdverts.map((advert) => (
                <li key={advert.id}>
                  <Link href={`/#${advert.id}`} className="flex min-h-16 items-center gap-3 rounded-2xl py-3 transition-colors hover:bg-white/35 dark:hover:bg-white/[0.03]">
                    <div className="flex min-w-0 flex-1">
                      <p className="truncate font-medium">{advert.title ?? "Advert"}</p>
                      <p className="mt-1 text-xs text-ink-soft">{advert.sendAt ? formatWhen(advert.sendAt) : "Schedule unavailable"}</p>
                    </div>
                    <ul className="hidden flex-wrap justify-end gap-1 sm:flex" aria-label="Platforms">
                      {advert.platforms.map((platform) => <li key={platform.platform}><PlatformBadge platform={platform.platform} /></li>)}
                    </ul>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="ads-h">
          <h2 id="ads-h" className="text-lg font-semibold">Adverts</h2>
          {adverts.length === 0 ? (
            <p className="mt-3 text-ink-soft">No adverts yet. Check back soon.</p>
          ) : (
            <ul className="mt-4 grid gap-5 md:grid-cols-2">
              {adverts.map((a) => (
                <li key={a.id} id={a.id}>
                  <article className="glass lift flex gap-4 rounded-[28px] p-4">
                    {a.mediaUrls[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.mediaUrls[0]} alt="" className="size-24 shrink-0 rounded-2xl object-cover sm:size-28" />
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{a.title ?? "Advert"}</h3>
                      {a.about && <p className="mt-0.5 text-sm text-ink-soft">{a.about}</p>}
                      {a.sendAt && a.sendAt > new Date() && <p className="mt-1 text-xs font-medium text-[var(--ig-3)]">Goes out {formatWhen(a.sendAt)}</p>}
                      <div className="mt-3">
                        <SubscribeAll advertId={a.id} subscribed={a.platforms.filter((p) => subscribed(a.id, p.platform)).length} offered={a.platforms.filter((p) => p.platform !== "WHATSAPP" || waActive).length} />
                      </div>
                      <ul className="mt-3 space-y-2">
                        {a.platforms.map((p) => (
                          <PlatformToggle
                            key={p.platform}
                            advertId={a.id}
                            platform={p.platform}
                            handle={p.handle}
                            url={p.url}
                            subscribed={subscribed(a.id, p.platform)}
                            disabledReason={p.platform === "WHATSAPP" && !waActive ? "link your number first" : undefined}
                          />
                        ))}
                      </ul>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass rounded-3xl p-6" aria-labelledby="feed-h">
          <h2 id="feed-h" className="text-lg font-semibold">What you&rsquo;ve received</h2>
          {feed.length === 0 ? (
            <p className="mt-3 text-ink-soft">Nothing yet. Subscribed adverts appear here once they&rsquo;re sent or posted.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {feed.map((f) => (
                <li key={f.key} className="flex items-center gap-3 py-3 text-sm">
                  <PlatformBadge platform={f.platform} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{f.advert.title ?? "Advert"}</p>
                    <p className="text-xs text-ink-soft">
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {f.text}
                        </a>
                      ) : (
                        f.text
                      )}{" "}
                      · {when.format(f.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="security" className="glass scroll-mt-24 rounded-3xl p-6" aria-labelledby="sec-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="sec-h" className="text-lg font-semibold">Sign-in and security</h2>
            <SessionButtons />
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            Signed in with {[...new Set(user.accounts.map((a) => providerNames[a.provider] ?? a.provider))].join(", ") || "email and password"}.
          </p>
          <ul className="mt-4 divide-y divide-line text-sm">
            {user.sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{deviceName(s.userAgent)}</p>
                  <p className="text-xs text-ink-soft">
                    {s.ip ?? "Unknown network"} · signed in {when.format(s.createdAt)} · last active {when.format(s.lastSeenAt)}
                  </p>
                </div>
                <SessionButtons id={s.id} current={s.id === viewer.sessionId} />
              </li>
            ))}
          </ul>
          <h3 className="mt-6 text-sm font-semibold">Recent activity</h3>
          <ul className="mt-2 space-y-1 text-xs text-ink-soft">
            {user.activity.map((a) => (
              <li key={a.id}>
                {when.format(a.createdAt)} · {a.action.toLowerCase().replace(/_/g, " ")}
                {a.detail && typeof a.detail === "object" ? ` · ${Object.values(a.detail as Record<string, unknown>).join(", ")}` : ""}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
