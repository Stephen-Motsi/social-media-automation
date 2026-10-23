import type { GroupKind } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { metaConfigured, redirectUri } from "@/lib/meta/oauth";
import { xConfigured, xRedirectUri } from "@/lib/x";
import { tiktokConfigured, tiktokRedirectUri } from "@/lib/tiktok";
import { describeSchedule, formatInZone, toLocalDateTimeInput } from "@/lib/schedule";
import { scheduleSpec } from "@/lib/channels";
import { displayHandle, groupNames, groupOrder, groupPlatforms, handleMatches, profileUrl } from "@/lib/handles";
import { GroupCard, type ConnectView } from "./group-card";
import { NewGroup } from "./new-group";

export const dynamic = "force-dynamic";

type Params = {
  error?: string;
  connected?: string;
  platform?: string;
  missing?: string;
  shared?: string;
  expected?: string;
  got?: string;
};

function errorNotice(p: Params): string | null {
  switch (p.error) {
    case undefined:
      return null;
    case "admin_only":
      return "Only admins can connect or disconnect accounts.";
    case "meta_not_configured":
      return "Facebook and Instagram connections aren't set up yet. Add META_APP_ID and META_APP_SECRET to .env.";
    case "x_not_configured":
      return "X connections aren't set up yet. Add X_CLIENT_ID and X_CLIENT_SECRET to .env.";
    case "tiktok_not_configured":
      return "TikTok connections aren't set up yet. Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to .env.";
    case "cancelled":
      return "Connection was cancelled. Nothing was changed.";
    case "state_mismatch":
      return "That connection attempt expired or didn't come from this site. Try again.";
    case "no_code":
      return "The platform didn't return an authorisation code. Try again.";
    case "no_meta_channels":
      return "Add Facebook or Instagram to the Meta container before connecting.";
    case "no_pages":
      return "Facebook didn't share any Pages. Try again and select the Page you manage.";
    case "handle_not_found":
      return `Facebook didn't share the ${p.missing ?? "account"} named in this container${
        p.shared ? `. It shared: ${p.shared}` : ""
      }. Connect again and select that Page (Instagram accounts come with the Page they're linked to), or edit the handle.`;
    case "handle_mismatch":
      return `You signed in as ${p.got}, but this container posts to ${p.expected}. Nothing was linked. Sign out of ${
        p.platform === "TIKTOK" ? "TikTok" : "X"
      } in this browser, sign in as ${p.expected}, and connect again.`;
    case "tiktok_no_username":
      return "TikTok didn't return the account's username, so we couldn't confirm it's the right account. Enable the user.info.profile scope for the app in the TikTok developer portal, then connect again.";
    case "meta_error":
      return "Facebook returned an error while connecting. Try again; if it keeps happening, check the server log.";
    case "x_error":
      return "X returned an error while connecting. Try again; if it keeps happening, check the server log.";
    case "tiktok_error":
      return "TikTok returned an error while connecting. Try again; if it keeps happening, check the server log.";
    default:
      return null;
  }
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function connectFor(kind: GroupKind): ConnectView {
  switch (kind) {
    case "META":
      return {
        href: "/api/meta/connect",
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
  }
}

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [params, session, groups, accounts, adverts] = await Promise.all([
    searchParams,
    auth(),
    prisma.channelGroup.findMany({ include: { channels: true } }),
    prisma.socialAccount.findMany({ orderBy: { createdAt: "asc" } }),
    // Adverts are drafts saved from the Create page
    prisma.post.findMany({ where: { status: "DRAFT", channelId: null }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const admin = session?.user?.role === "ADMIN";
  const ordered = groupOrder.flatMap((k) => groups.filter((g) => g.kind === k));
  const missing = groupOrder.filter((k) => !groups.some((g) => g.kind === k));
  const advertViews = adverts.map((a) => ({
    id: a.id,
    label: `${a.content.trim().slice(0, 60) || "(image only)"}${a.content.length > 60 ? "…" : ""} · ${day.format(a.createdAt)}`,
    thumbnail: a.mediaUrls[0] ?? null,
  }));
  const error = errorNotice(params);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Channels</h1>
          <p className="mt-2 max-w-prose text-ink-soft">
            Each container links your real accounts in its settings. Inside it, choose what each platform posts, as a
            post or story, and when.
          </p>
        </div>
        {admin && <NewGroup missing={missing} />}
      </div>

      {error && (
        <p role="alert" className="glass mt-6 rounded-2xl px-5 py-3 text-danger">
          {error}
        </p>
      )}
      {params.connected && !params.error && (
        <p className="glass mt-6 rounded-2xl px-5 py-3 text-emerald-700 dark:text-emerald-300">
          Connected {params.connected} {params.connected === "1" ? "account" : "accounts"}.
        </p>
      )}
      {!admin && params.error !== "admin_only" && (
        <p className="glass mt-6 rounded-2xl px-5 py-3 text-ink-soft">Only admins can change channels.</p>
      )}

      {ordered.length === 0 ? (
        <div className="glass mt-8 rounded-[32px] px-6 py-14 text-center">
          <p className="text-lg font-medium">No containers yet</p>
          <p className="mx-auto mt-2 max-w-md text-ink-soft">
            {admin
              ? "Choose Add new, pick Meta, X or TikTok, and enter the handles of the accounts to post to."
              : "An admin needs to add a container first."}
          </p>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {ordered.map((g) => {
            const items = groupPlatforms[g.kind].flatMap((platform) => {
              const c = g.channels.find((ch) => ch.platform === platform);
              if (!c) return [];
              const spec = scheduleSpec(c);
              return [
                {
                  handleInput: displayHandle(platform, c.handle),
                  handleDisplay: displayHandle(platform, c.handle) || "No handle set",
                  profileUrl: profileUrl(platform, c.handle),
                  accounts: accounts
                    .filter((a) => a.platform === platform)
                    .map((a) => ({
                      id: a.id,
                      displayName: a.displayName,
                      connectedText: day.format(a.createdAt),
                      profileUrl: a.profileUrl,
                      matches: handleMatches(platform, c.handle, a),
                    })),
                  channel: {
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
                  },
                },
              ];
            });
            return (
              <GroupCard
                key={g.id}
                group={{ id: g.id, kind: g.kind }}
                items={items}
                adverts={advertViews}
                admin={admin}
                connect={connectFor(g.kind)}
                whatsappEnvReady={Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN)}
              />
            );
          })}
        </div>
      )}
      {missing.length > 0 && ordered.length > 0 && (
        <p className="mt-6 text-sm text-ink-soft">Not added yet: {missing.map((k) => groupNames[k]).join(", ")}.</p>
      )}
    </div>
  );
}
