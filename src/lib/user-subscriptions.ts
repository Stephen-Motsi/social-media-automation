import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { advertPlatforms, postUrl } from "@/lib/adverts";
import { MIN_HOURS_BETWEEN_MESSAGES, proposeCampaign } from "@/lib/audience";
import { formatWhen, QueueUnavailable } from "@/lib/errors";
import { displayHandle } from "@/lib/handles";
import { notifyAdmins } from "@/lib/notify";
import { platformRules } from "@/lib/policy/rules";
import { queueDelivery } from "@/lib/queue";
import { logActivity } from "@/lib/session";
import { HANDLE_PLATFORMS } from "@/lib/social-delivery";

// Subscribing a signed-in user to an advert, and sending it straight away (or at the advert's
// send time) to what's on their profile:
//   WhatsApp: their confirmed number          X: a direct message to their @handle
//   Instagram: an @mention on our post        Facebook, TikTok: shown on our page and in their feed
// Admins are notified of every subscription.

export type PlatformNote = { platform: Platform; message: string; link?: string | null; linkLabel?: string };
export type SubscribeResult = { ok: true; subscribed: PlatformNote[]; skipped: PlatformNote[] } | { ok: false; error: string };

const name = (p: Platform) => platformRules[p].name;

export async function subscribeUser(userId: string, advertId: string, only?: Platform[], how: "button" | "auto" = "button"): Promise<SubscribeResult> {
  const [advert, user] = await Promise.all([
    prisma.post.findFirst({ where: { id: advertId, listedAt: { not: null }, status: "DRAFT", channelId: null } }),
    prisma.user.findUnique({ where: { id: userId }, include: { socials: true, subscriber: true } }),
  ]);
  if (!advert || !user) return { ok: false, error: "This advert isn't available any more." };
  const offered = (await advertPlatforms(advert.targetPlatforms)).map((p) => p.platform);
  const wanted = only ? offered.filter((p) => only.includes(p)) : offered;
  if (wanted.length === 0) return { ok: false, error: only ? "This advert isn't offered on that platform." : "This advert isn't offered on any platform yet." };

  const later = advert.sendAt && advert.sendAt > new Date() ? advert.sendAt : null;
  const subscribed: PlatformNote[] = [];
  const skipped: PlatformNote[] = [];
  for (const platform of wanted) {
    // WhatsApp needs a confirmed number: messages can only go to people who opted in from it.
    if (platform === "WHATSAPP" && user.subscriber?.status !== "ACTIVE") {
      skipped.push({ platform, message: "Link and confirm your WhatsApp number to get it there.", link: "/me/profile", linkLabel: "Link it" });
      continue;
    }
    await prisma.advertSubscription.upsert({
      where: { userId_advertId_platform: { userId, advertId, platform } },
      update: {},
      create: { userId, advertId, platform },
    });
    subscribed.push(await noteFor(platform, advert, user, later));
  }

  // Send now (or at the send time): WhatsApp joins the send; X / Instagram go to their handles.
  if (subscribed.some((s) => s.platform === "WHATSAPP")) await proposeCampaign(advertId, "New subscription").catch((err) => console.error("proposeCampaign:", err));
  if (subscribed.some((s) => HANDLE_PLATFORMS.includes(s.platform))) {
    // If the queue is down, the worker's scheduler sends it on its next pass instead.
    await queueDelivery(advertId, userId, later).catch((err) => {
      if (!(err instanceof QueueUnavailable)) throw err;
    });
  }

  if (subscribed.length) {
    await logActivity(userId, "SUBSCRIBE", { advert: advert.title ?? advert.id, platforms: subscribed.map((s) => s.platform).join(", "), how }).catch(() => null);
    if (how === "button") {
      await notifyAdmins({
        kind: "SUBSCRIBED",
        title: `${user.name ?? user.email} subscribed to "${advert.title ?? "an advert"}"`,
        body: `On ${subscribed.map((s) => name(s.platform)).join(", ")}. ${later ? `It goes out ${formatWhen(later)}.` : "Sending now."}`,
        link: `/admin/users?id=${user.id}`,
        userId: user.id,
      });
    }
  }
  return { ok: true, subscribed, skipped };
}

// What the user will get on one platform, in a sentence.
async function noteFor(
  platform: Platform,
  advert: { id: string; sendAt: Date | null },
  user: { id: string; socials: { platform: Platform; handle: string }[]; subscriber: { lastSentAt: Date | null } | null },
  later: Date | null,
): Promise<PlatformNote> {
  const when = later ? formatWhen(later) : null;
  if (platform === "WHATSAPP") {
    // One advert per person per day on WhatsApp
    const last = user.subscriber?.lastSentAt;
    const free = last ? new Date(last.getTime() + MIN_HOURS_BETWEEN_MESSAGES * 3600_000) : null;
    if (free && free > new Date() && (!later || later < free)) return { platform, message: `Coming to your WhatsApp after ${formatWhen(free)} (one advert a day).` };
    return { platform, message: when ? `Coming to your WhatsApp ${when}.` : "On its way to your WhatsApp." };
  }
  if (platform === "X" || platform === "INSTAGRAM") {
    const mine = user.socials.find((s) => s.platform === platform);
    if (!mine) return { platform, message: `Add your ${name(platform)} handle to your profile to get it there.`, link: "/me/profile", linkLabel: "Add it" };
    const you = displayHandle(platform, mine.handle);
    const how = platform === "X" ? `a direct message to ${you}` : `a mention of ${you} on our post`;
    return { platform, message: when ? `Sent as ${how} ${when}.` : `On its way as ${how}.` };
  }
  // Facebook / TikTok can't deliver to a person: it's on our page and in their feed.
  const posted = await prisma.postTarget.findFirst({
    where: { status: "PUBLISHED", account: { platform }, post: { sourceAdvertId: advert.id } },
    include: { account: true },
  });
  if (posted) return { platform, message: `Posted on ${displayHandle(platform, posted.account.handle) || name(platform)}; it's in your feed.`, link: postUrl(platform, posted.externalPostId, posted.account.handle), linkLabel: "Open it" };
  return { platform, message: when ? `Posted on our ${name(platform)} ${when}; it'll be in your feed.` : `It'll be in your feed once it's posted on ${name(platform)}.` };
}

export async function unsubscribeUser(userId: string, advertId: string, only?: Platform[]) {
  const res = await prisma.advertSubscription.deleteMany({ where: { userId, advertId, ...(only ? { platform: { in: only } } : {}) } });
  if (res.count) await logActivity(userId, "UNSUBSCRIBE", { advert: advertId, platforms: only?.join(", ") ?? "all" }).catch(() => null);
  return res.count;
}

// "Subscribe me to every new advert": run when an advert is published. One admin notification in total.
export async function autoSubscribeUsers(advertId: string) {
  const users = await prisma.user.findMany({ where: { autoSubscribe: true, disabledAt: null, role: "USER" }, select: { id: true } });
  let count = 0;
  for (const u of users) {
    const res = await subscribeUser(u.id, advertId, undefined, "auto").catch(() => null);
    if (res?.ok && res.subscribed.length) count++;
  }
  if (count) {
    const advert = await prisma.post.findUnique({ where: { id: advertId }, select: { title: true } });
    await notifyAdmins({ kind: "SUBSCRIBED", title: `${count} ${count === 1 ? "person" : "people"} subscribed automatically to "${advert?.title ?? "an advert"}"`, body: "They chose to get every new advert.", link: "/admin/adverts" });
  }
  return count;
}

// After someone adds a handle to their profile: send the adverts they already subscribed to there.
export async function deliverAfterProfileChange(userId: string) {
  const subs = await prisma.advertSubscription.findMany({
    where: { userId, platform: { in: HANDLE_PLATFORMS }, advert: { listedAt: { not: null } } },
    include: { advert: { select: { sendAt: true } } },
  });
  for (const advertId of [...new Set(subs.map((s) => s.advertId))]) {
    const at = subs.find((s) => s.advertId === advertId)?.advert.sendAt;
    await queueDelivery(advertId, userId, at && at > new Date() ? at : null).catch(() => null);
  }
}
