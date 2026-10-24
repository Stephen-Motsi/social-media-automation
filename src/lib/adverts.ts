import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { displayHandle, handleMatches, profileUrl } from "@/lib/handles";
import { schedulePost } from "@/lib/queue";
import { proposeCampaign, whatsappNotReady } from "@/lib/audience";
import { formatWhen, QueueUnavailable, reasonFor } from "@/lib/errors";
import { platformRules, type PlatformVerdict } from "@/lib/policy/rules";

// Adverts the admin defines (title, about, topics, target platforms, image, caption) and lists
// for users, who subscribe to an advert per platform handle.

export type AdvertPlatform = { platform: Platform; handle: string; url: string | null };

// The platforms an advert targets that have a social container with a handle (what users can pick).
export async function advertPlatforms(targetPlatforms: Platform[]): Promise<AdvertPlatform[]> {
  if (targetPlatforms.length === 0) return [];
  const channels = await prisma.channel.findMany({ where: { platform: { in: targetPlatforms } } });
  return targetPlatforms.flatMap((platform) => {
    const c = channels.find((ch) => ch.platform === platform);
    return c?.handle ? [{ platform, handle: displayHandle(platform, c.handle), url: profileUrl(platform, c.handle) }] : [];
  });
}

export async function listedAdverts() {
  const adverts = await prisma.post.findMany({
    where: { listedAt: { not: null }, status: "DRAFT", channelId: null },
    orderBy: { listedAt: "desc" },
    include: { interests: true },
  });
  return Promise.all(adverts.map(async (a) => ({ ...a, platforms: await advertPlatforms(a.targetPlatforms) })));
}

// Link to a published post, where the platform's ID is one; otherwise the handle's profile.
export function postUrl(platform: Platform, externalPostId: string | null, handle: string | null) {
  if (externalPostId) {
    if (platform === "FACEBOOK") return `https://www.facebook.com/${externalPostId}`;
    if (platform === "X") return `https://x.com/i/web/status/${externalPostId}`;
  }
  return profileUrl(platform, handle);
}

// What happened (or will happen) on one platform, in words an admin can act on.
export type PlatformOutcome = { platform: Platform; ok: boolean; message: string };

const nameOf = (p: Platform) => platformRules[p].name;
const checksOf = (advert: { checks: unknown }) => (advert.checks as PlatformVerdict[] | null) ?? [];

// Posts the advert on its targeted social platforms at `at` (now if omitted). WhatsApp isn't posted:
// it goes to subscribers' own numbers. Every post still goes through the platform checks in the worker.
export async function postAdvertToPlatforms(advertId: string, at?: Date | null): Promise<PlatformOutcome[]> {
  const advert = await prisma.post.findUniqueOrThrow({ where: { id: advertId } });
  const when = at && at > new Date() ? at : null;
  const outcomes: PlatformOutcome[] = [];
  for (const platform of advert.targetPlatforms.filter((p) => p !== "WHATSAPP")) {
    const name = nameOf(platform);
    const blockers = checksOf(advert).find((v) => v.platform === platform && v.status === "block")?.issues.filter((i) => i.severity === "block");
    if (blockers?.length) {
      outcomes.push({ platform, ok: false, message: `Not posted on ${name}: ${blockers.map((b) => b.message).join(" ")}` });
      continue;
    }
    const channel = await prisma.channel.findUnique({ where: { platform } });
    const accounts = (await prisma.socialAccount.findMany({ where: { platform } })).filter((a) => handleMatches(platform, channel?.handle, a));
    if (!channel || accounts.length === 0) {
      const handle = channel?.handle ? displayHandle(platform, channel.handle) : `your ${name} account`;
      outcomes.push({ platform, ok: false, message: `Not posted on ${name}: ${handle} isn't connected. Connect it in Settings on Channels.` });
      continue;
    }
    if (!advert.mediaUrls[0] && platformRules[platform].image.required) {
      outcomes.push({ platform, ok: false, message: `Not posted on ${name}: ${name} needs a photo.` });
      continue;
    }
    const post = await prisma.post.create({
      data: {
        content: advert.content,
        mediaUrls: advert.mediaUrls,
        status: "SCHEDULED",
        scheduledAt: when ?? new Date(),
        authorId: advert.authorId,
        sourceAdvertId: advert.id,
        targets: { create: accounts.map((a) => ({ accountId: a.id, format: channel.format })) },
      },
    });
    const at = when ? `at ${formatWhen(when)}` : "now";
    try {
      await schedulePost(post.id, when);
      outcomes.push({ platform, ok: true, message: `${when ? "Scheduled" : "Posting"} on ${name} ${at}.` });
    } catch (err) {
      // Saved as scheduled: the worker's safety net queues it again once the queue is back.
      if (!(err instanceof QueueUnavailable)) throw err;
      outcomes.push({ platform, ok: false, message: `Saved for ${name} ${at}, but ${err.message}` });
    }
  }
  return outcomes;
}

// What WhatsApp subscribers will get, or why they won't yet.
async function whatsappOutcome(advertId: string): Promise<PlatformOutcome> {
  const advert = await prisma.post.findUniqueOrThrow({
    where: { id: advertId },
    include: { campaigns: { orderBy: { createdAt: "desc" }, include: { _count: { select: { deliveries: true } } } } },
  });
  const blockers = checksOf(advert).find((v) => v.platform === "WHATSAPP" && v.status === "block")?.issues.filter((i) => i.severity === "block");
  if (blockers?.length) return { platform: "WHATSAPP", ok: false, message: `Not sent on WhatsApp: ${blockers.map((b) => b.message).join(" ")}` };
  const when = advert.sendAt && advert.sendAt > new Date() ? `at ${formatWhen(advert.sendAt)}` : "straight away";
  if (!advert.autoSend) {
    return { platform: "WHATSAPP", ok: true, message: `WhatsApp subscribers get it after you approve the send on Approvals.` };
  }
  const notReady = await whatsappNotReady();
  if (notReady) return { platform: "WHATSAPP", ok: false, message: `Not sent on WhatsApp yet: ${notReady} Sends are held on Approvals until it's fixed.` };
  const next = advert.campaigns.find((c) => c.status === "APPROVED");
  const count = next?._count.deliveries ?? 0;
  return {
    platform: "WHATSAPP",
    ok: true,
    message: count
      ? `Sending to ${count} WhatsApp ${count === 1 ? "subscriber" : "subscribers"} ${when}; anyone who subscribes later gets it too.`
      : `Anyone who subscribes on WhatsApp gets it ${when === "straight away" ? "as soon as they subscribe" : when}.`,
  };
}

export type PublishReport = { ok: true; listed: true; outcomes: PlatformOutcome[] } | { ok: false; error: string };

// Publishes an advert: lists it for users, posts it on its social platforms at `sendAt` (now if
// empty) and sends it to WhatsApp subscribers then. Each platform reports what happened and why.
export async function publishAdvert(advertId: string, opts: { sendAt?: Date | null; autoSend?: boolean } = {}): Promise<PublishReport> {
  try {
    const advert = await prisma.post.findFirst({ where: { id: advertId, status: "DRAFT", channelId: null } });
    if (!advert) return { ok: false, error: "this advert no longer exists." };
    if (!advert.title) return { ok: false, error: "give the advert a title." };
    if (advert.targetPlatforms.length === 0) return { ok: false, error: "choose at least one target platform." };
    if (!advert.content.trim() && !advert.mediaUrls[0]) return { ok: false, error: "add a caption or a photo." };
    if (opts.sendAt && opts.sendAt.getTime() < Date.now() - 5 * 60_000) return { ok: false, error: "the send time is in the past. Pick a later time or choose Now." };
    const blocked = checksOf(advert).filter((c) => c.status === "block" && advert.targetPlatforms.includes(c.platform));
    if (blocked.length === advert.targetPlatforms.length) {
      const why = blocked.map((b) => `${nameOf(b.platform)}: ${b.issues.filter((i) => i.severity === "block").map((i) => i.message).join(" ")}`);
      return { ok: false, error: `it can't be posted on any of its platforms. ${why.join(" ")}` };
    }

    const sendAt = opts.sendAt && opts.sendAt > new Date() ? opts.sendAt : null;
    await prisma.post.update({ where: { id: advertId }, data: { listedAt: new Date(), sendAt, autoSend: opts.autoSend ?? true } });
    const outcomes = await postAdvertToPlatforms(advertId, sendAt);
    if (advert.targetPlatforms.includes("WHATSAPP") || (await prisma.post.count({ where: { id: advertId, interests: { some: {} } } }))) {
      await proposeCampaign(advertId, "Advert published").catch((err) => console.error("proposeCampaign:", err));
      outcomes.push(await whatsappOutcome(advertId));
    }
    return { ok: true, listed: true, outcomes };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}

// Stops what hasn't gone out yet: scheduled posts and unsent WhatsApp sends.
export async function cancelPendingSends(advertId: string, why: string) {
  const posts = await prisma.post.findMany({ where: { sourceAdvertId: advertId, status: "SCHEDULED" }, select: { id: true } });
  await prisma.$transaction([
    prisma.postTarget.updateMany({ where: { postId: { in: posts.map((p) => p.id) }, status: "PENDING" }, data: { status: "FAILED", error: why } }),
    prisma.post.updateMany({ where: { id: { in: posts.map((p) => p.id) } }, data: { status: "FAILED" } }),
    prisma.campaign.updateMany({ where: { advertId, status: { in: ["APPROVED", "PENDING_APPROVAL"] } }, data: { status: "FAILED", error: why } }),
  ]);
  return posts.length;
}

// Where a published advert stands on each platform (shown on Adverts and the home page).
export async function advertStatus(advertId: string): Promise<PlatformOutcome[]> {
  const advert = await prisma.post.findUniqueOrThrow({
    where: { id: advertId },
    include: {
      advertPosts: { orderBy: { createdAt: "desc" }, include: { targets: { include: { account: true } } } },
      campaigns: { orderBy: { createdAt: "desc" }, include: { deliveries: { select: { status: true } } } },
    },
  });
  const out: PlatformOutcome[] = [];
  for (const platform of advert.targetPlatforms) {
    const name = nameOf(platform);
    if (platform === "WHATSAPP") {
      const c = advert.campaigns[0];
      const n = (s: string[]) => c?.deliveries.filter((d) => s.includes(d.status)).length ?? 0;
      if (!c) out.push({ platform, ok: true, message: advert.sendAt && advert.sendAt > new Date() ? `Goes to WhatsApp subscribers at ${formatWhen(advert.sendAt)}.` : "No WhatsApp subscribers yet." });
      else if (c.status === "PENDING_APPROVAL") out.push({ platform, ok: false, message: c.reason?.startsWith("Waiting:") ? `WhatsApp is waiting: ${c.reason.slice("Waiting: ".length)}` : `WhatsApp: ${c.deliveries.length} waiting for your approval.` });
      else if (c.status === "APPROVED") out.push({ platform, ok: true, message: `WhatsApp: sending to ${c.deliveries.length} ${c.sendAt && c.sendAt > new Date() ? `at ${formatWhen(c.sendAt)}` : "now"}.` });
      else if (c.status === "SENDING") out.push({ platform, ok: true, message: "WhatsApp: sending now." });
      else if (c.status === "SENT") {
        const failed = n(["FAILED"]);
        out.push({ platform, ok: failed === 0, message: `WhatsApp: sent to ${n(["SENT", "DELIVERED", "READ"])}${failed ? `, ${failed} failed` : ""}${n(["SKIPPED"]) ? `, ${n(["SKIPPED"])} held back (already messaged in the last 24 hours; sent automatically after that)` : ""}.` });
      } else out.push({ platform, ok: false, message: `WhatsApp ${c.status === "REJECTED" ? "send rejected" : `failed: ${c.error ?? "unknown error"}`}` });
      continue;
    }
    const post = advert.advertPosts.find((p) => p.targets.some((t) => t.account.platform === platform));
    const target = post?.targets.find((t) => t.account.platform === platform);
    if (!post || !target) out.push({ platform, ok: false, message: `${name}: not posted yet.` });
    else if (target.status === "PUBLISHED") out.push({ platform, ok: true, message: `Posted on ${name}${post.publishedAt ? ` ${formatWhen(post.publishedAt)}` : ""}.` });
    else if (target.status === "FAILED") out.push({ platform, ok: false, message: `${name} failed: ${target.error ?? "unknown error"}` });
    else out.push({ platform, ok: true, message: post.scheduledAt && post.scheduledAt > new Date() ? `Goes out on ${name} at ${formatWhen(post.scheduledAt)}.` : `Posting on ${name} now.` });
  }
  return out;
}
