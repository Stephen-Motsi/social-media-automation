import type { Metadata } from "next";
import Link from "next/link";
import { UserHeader } from "./header";
import { formatWhen } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { isStaff, pageViewer } from "@/lib/session";
import { displayHandle } from "@/lib/handles";
import { listedAdverts, postUrl } from "@/lib/adverts";
import { businessWhatsAppNumber, whatsappLink } from "@/lib/audience";
import { PlatformBadge, platforms } from "@/components/platforms";
import { PlatformToggle, SessionButtons, WhatsAppLink } from "./widgets";

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

function deviceName(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

export default async function MePage() {
  const viewer = await pageViewer("user");
  // Everything below is loaded for the signed-in user only (viewer.id from the checked session).
  const [user, adverts, business] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: viewer.id },
      include: {
        subscriptions: true,
        subscriber: true,
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
        <section>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Hi {user.name?.split(" ")[0] ?? "there"}</h1>
          <p className="mt-2 max-w-prose text-ink-soft">
            Choose the adverts you want and where. WhatsApp ones come to your number; for the others you&rsquo;ll see
            here when they&rsquo;re posted.
          </p>
        </section>

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

        <section className="glass rounded-3xl p-6" aria-labelledby="sec-h">
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
