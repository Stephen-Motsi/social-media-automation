import type { Platform } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { metaConfigured, redirectUri } from "@/lib/meta/oauth";
import { xConfigured, xRedirectUri } from "@/lib/x";
import { tiktokConfigured, tiktokRedirectUri } from "@/lib/tiktok";
import { platformOrder } from "@/lib/policy/rules";
import { describeSchedule, formatInZone, toLocalDateTimeInput } from "@/lib/schedule";
import { scheduleSpec } from "@/lib/channels";
import { platforms } from "@/components/platforms";
import { ChannelCard, type ConnectView } from "./channel-card";
import { NewChannel } from "./new-channel";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  admin_only: "Only admins can connect or disconnect accounts.",
  meta_not_configured: "Facebook and Instagram connections aren't set up yet. Add META_APP_ID and META_APP_SECRET to .env.",
  x_not_configured: "X connections aren't set up yet. Add X_CLIENT_ID and X_CLIENT_SECRET to .env.",
  tiktok_not_configured: "TikTok connections aren't set up yet. Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to .env.",
  cancelled: "Connection was cancelled. Nothing was changed.",
  state_mismatch: "That connection attempt expired or didn't come from this site. Try again.",
  no_code: "The platform didn't return an authorisation code. Try again.",
  no_pages: "No Facebook Pages were shared. Try again and select at least one Page you manage.",
  no_instagram:
    "None of the shared Pages has an Instagram professional account linked. Link one to a Page in Instagram's settings, then try again.",
  meta_error: "Facebook returned an error while connecting. Try again; if it keeps happening, check the server log.",
  x_error: "X returned an error while connecting. Try again; if it keeps happening, check the server log.",
  tiktok_error: "TikTok returned an error while connecting. Try again; if it keeps happening, check the server log.",
};

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function connectFor(platform: Platform): ConnectView {
  switch (platform) {
    case "FACEBOOK":
    case "INSTAGRAM":
      return {
        href: `/api/meta/connect?platform=${platform}`,
        ready: metaConfigured(),
        setupHint: `Not set up yet: add META_APP_ID and META_APP_SECRET to .env, and ${redirectUri()} as a redirect URI in the Meta app.`,
      };
    case "X":
      return {
        href: "/api/x/connect",
        ready: xConfigured(),
        setupHint: `Not set up yet: add X_CLIENT_ID and X_CLIENT_SECRET to .env, and ${xRedirectUri()} as a callback URL in the X developer portal.`,
      };
    case "TIKTOK":
      return {
        href: "/api/tiktok/connect",
        ready: tiktokConfigured(),
        setupHint: `Not set up yet: add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to .env, and ${tiktokRedirectUri()} as a redirect URI in the TikTok developer portal.`,
      };
    case "WHATSAPP":
      return {
        ready: true,
        setupHint: "",
        envReady: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN),
      };
  }
}

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string; platform?: string }>;
}) {
  const [{ error, connected, platform: connectedPlatform }, session, channels, accounts, adverts] = await Promise.all([
    searchParams,
    auth(),
    prisma.channel.findMany(),
    prisma.socialAccount.findMany({ orderBy: { createdAt: "asc" } }),
    // Adverts are drafts saved from the Create page
    prisma.post.findMany({ where: { status: "DRAFT", channelId: null }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const admin = session?.user?.role === "ADMIN";
  const ordered = platformOrder.flatMap((p) => channels.filter((c) => c.platform === p));
  const missing = platformOrder.filter((p) => !channels.some((c) => c.platform === p));
  const advertViews = adverts.map((a) => ({
    id: a.id,
    label: `${a.content.trim().slice(0, 60) || "(image only)"}${a.content.length > 60 ? "…" : ""} · ${day.format(a.createdAt)}`,
    thumbnail: a.mediaUrls[0] ?? null,
  }));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Channels</h1>
          <p className="mt-2 max-w-prose text-ink-soft">
            One container per platform: connect accounts in its settings, then choose what to post and when.
          </p>
        </div>
        {admin && <NewChannel missing={missing} />}
      </div>

      {error && notices[error] && (
        <p role="alert" className="glass mt-6 rounded-2xl px-5 py-3 text-danger">
          {notices[error]}
        </p>
      )}
      {connected && (
        <p className="glass mt-6 rounded-2xl px-5 py-3 text-emerald-700 dark:text-emerald-300">
          Connected {connected} {connectedPlatform && connectedPlatform in platforms ? platforms[connectedPlatform as Platform].name : ""}{" "}
          {connected === "1" ? "account" : "accounts"}.
        </p>
      )}
      {!admin && error !== "admin_only" && (
        <p className="glass mt-6 rounded-2xl px-5 py-3 text-ink-soft">Only admins can change channels.</p>
      )}

      {ordered.length === 0 ? (
        <div className="glass mt-8 rounded-[32px] px-6 py-14 text-center">
          <p className="text-lg font-medium">No channels yet</p>
          <p className="mx-auto mt-2 max-w-md text-ink-soft">
            {admin
              ? "Choose Create new and pick a platform to add its container."
              : "An admin needs to add a platform first."}
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {ordered.map((c) => {
            const spec = scheduleSpec(c);
            return (
              <ChannelCard
                key={c.id}
                admin={admin}
                adverts={advertViews}
                connect={connectFor(c.platform)}
                accounts={accounts
                  .filter((a) => a.platform === c.platform)
                  .map((a) => ({ id: a.id, displayName: a.displayName, connectedText: `Connected ${day.format(a.createdAt)}` }))}
                channel={{
                  id: c.id,
                  platform: c.platform,
                  format: c.format,
                  advertId: c.advertId,
                  frequency: c.frequency,
                  runAtLocal: c.runAt ? toLocalDateTimeInput(c.runAt, c.timezone) : "",
                  timeOfDay: c.timeOfDay,
                  weekdays: c.weekdays,
                  dayOfMonth: c.dayOfMonth,
                  enabled: c.enabled,
                  scheduleText: describeSchedule(spec),
                  nextRunText: c.nextRunAt ? formatInZone(c.nextRunAt, c.timezone) : null,
                  lastRunText: c.lastRunAt ? formatInZone(c.lastRunAt, c.timezone) : null,
                  lastError: c.lastError,
                  timezoneLabel: c.timezone === "Africa/Nairobi" ? "Nairobi time (EAT)" : c.timezone,
                  whatsappRecipients: c.whatsappRecipients,
                  whatsappTemplate: c.whatsappTemplate,
                  whatsappTemplateLang: c.whatsappTemplateLang,
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
