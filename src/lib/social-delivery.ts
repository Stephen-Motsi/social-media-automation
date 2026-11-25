import type { Platform, Role, SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { displayHandle, handleMatches } from "@/lib/handles";
import { accessTokenFor } from "@/lib/tokens";
import { xSendDm, xUserByUsername } from "@/lib/x";
import { commentOnMedia } from "@/lib/meta/instagram";
import { postUrl } from "@/lib/adverts";
import { notifyAdmins } from "@/lib/notify";
import { canPublishToAccount, isStaffRole } from "@/lib/ownership";

// Sends adverts to the handles subscribers put on their profile, once the advert's send time comes
// (straight away for people who subscribe later). Run by the worker on every scheduler tick.
// - X: a direct message from our account (X only delivers it if they accept messages from us)
// - Instagram: an @mention in a comment on our post of the advert (Instagram doesn't allow messaging first)
// Facebook and TikTok have no way to send to a person, so subscribers see the post on our page.
export const HANDLE_PLATFORMS: Platform[] = ["X", "INSTAGRAM"];

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 10 * 60_000;
const BRAND = process.env.BRAND_NAME ?? "Social Automation";
const siteUrl = () => (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

// Our connected account on a platform (the one matching the container's handle).
async function ourAccount(platform: Platform, author: { id: string; role: Role }): Promise<SocialAccount | null> {
  const ownerId = isStaffRole(author.role) ? null : author.id;
  const channel = await prisma.channel.findFirst({ where: { platform, ownerId } });
  if (!channel) return null;
  return (await prisma.socialAccount.findMany({ where: { platform, ownerId, disconnectedAt: null } }))
    .find((a) => !a.disconnectedAt && canPublishToAccount(author, a.ownerId) && handleMatches(platform, channel.handle, a)) ?? null;
}

// The advert's published post on a platform, if it has one.
const publishedTarget = (advertId: string, authorId: string, accountId: string) =>
  prisma.postTarget.findFirst({
    where: { status: "PUBLISHED", accountId, account: { disconnectedAt: null }, post: { sourceAdvertId: advertId, authorId } },
    include: { account: true },
    orderBy: { post: { createdAt: "desc" } },
  });

// Readable reasons for the usual refusals.
function explain(platform: Platform, handle: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (platform === "X" && /not allowed|cannot send|can't send|forbidden|403/i.test(msg)) {
    return `${displayHandle("X", handle)} doesn't accept messages from us yet (they can follow our account or open their messages). X said: ${msg}`;
  }
  return msg;
}

// `only`: one person's subscription to one advert (sent straight after they subscribe);
// without it, everything that's due (the worker's safety net).
export async function deliverToHandles(now = new Date(), only?: { advertId: string; userId: string }) {
  // 1. Who should get what: subscriptions on X/Instagram, for adverts that are listed and due, with a handle on file
  const subs = await prisma.advertSubscription.findMany({
    where: {
      ...(only ?? {}),
      platform: { in: HANDLE_PLATFORMS },
      advert: { listedAt: { not: null }, reviewStatus: "APPROVED", OR: [{ sendAt: null }, { sendAt: { lte: now } }] },
      user: { disabledAt: null, socials: { some: { platform: { in: HANDLE_PLATFORMS } } } },
    },
    include: { user: { select: { socials: true } } },
  });
  const rows = subs.flatMap((s) => {
    const social = s.user.socials.find((x) => x.platform === s.platform);
    return social ? [{ advertId: s.advertId, userId: s.userId, platform: s.platform, handle: social.handle }] : [];
  });
  if (rows.length) await prisma.socialDelivery.createMany({ data: rows, skipDuplicates: true });

  // 2. Send what's waiting (and retry recent failures a few times)
  const due = await prisma.socialDelivery.findMany({
    where: {
      ...(only ?? {}),
      platform: { in: HANDLE_PLATFORMS },
      OR: [{ status: "PENDING" }, { status: "FAILED", attempts: { lt: MAX_ATTEMPTS }, updatedAt: { lte: new Date(now.getTime() - RETRY_AFTER_MS) } }],
    },
    include: { advert: { include: { author: { select: { id: true, role: true } } } }, user: { select: { socials: true, subscriptions: true, disabledAt: true } } },
    take: 50,
    orderBy: { createdAt: "asc" },
  });
  const accounts = new Map<string, SocialAccount | null>();
  let sent = 0;
  for (const d of due) {
    const claimed = await prisma.socialDelivery.updateMany({
      where: { id: d.id, status: d.status, attempts: d.attempts, updatedAt: d.updatedAt },
      data: { status: "IN_FLIGHT", error: "Delivery in progress; reconcile before retrying if interrupted." },
    });
    if (!claimed.count) continue;
    if (d.advert.reviewStatus !== "APPROVED") {
      await prisma.socialDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", error: "Blocked: the advert has not been approved." } });
      continue;
    }
    // Still subscribed, and still the same handle? Otherwise don't send.
    const current = d.user.socials.find((s) => s.platform === d.platform)?.handle;
    const stillSubscribed = d.user.subscriptions.some((s) => s.advertId === d.advertId && s.platform === d.platform);
    if (!stillSubscribed || !current || current !== d.handle || d.user.disabledAt || !d.advert.listedAt) {
      await prisma.socialDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", error: "Unsubscribed or the handle changed." } });
      continue;
    }
    const author = d.advert.author;
    const accountKey = `${author.id}:${author.role}:${d.platform}`;
    if (!accounts.has(accountKey)) accounts.set(accountKey, await ourAccount(d.platform, author));
    const account = accounts.get(accountKey);
    if (!account) {
      // Not a failure of this delivery: it goes once the account is connected.
      await prisma.socialDelivery.update({ where: { id: d.id }, data: { status: d.status, error: `Waiting: our ${d.platform === "X" ? "X" : "Instagram"} account isn't connected.` } });
      continue;
    }
    let sending = false;
    try {
      const token = await accessTokenFor(account);
      let externalId: string;
      if (d.platform === "X") {
        const person = await xUserByUsername(token, d.handle);
        if (!person) {
          await prisma.socialDelivery.update({ where: { id: d.id }, data: { status: "FAILED", attempts: MAX_ATTEMPTS, error: `There's no X account ${displayHandle("X", d.handle)}.` } });
          continue;
        }
        const ours = await publishedTarget(d.advertId, author.id, account.id);
        const link = ours ? postUrl("X", ours.externalPostId, ours.account.handle) : `${siteUrl()}/#${d.advertId}`;
        const text = [d.advert.title, d.advert.content, link, `You subscribed to this on ${BRAND}. Unsubscribe any time at ${siteUrl()}/me`].filter(Boolean).join("\n\n");
        sending = true;
        externalId = (await xSendDm(token, person.id, text.slice(0, 9000))).dm_event_id;
      } else {
        const post = await publishedTarget(d.advertId, author.id, account.id);
        if (!post?.externalPostId) {
          await prisma.socialDelivery.update({ where: { id: d.id }, data: { status: d.status, error: "Waiting for the advert to be posted on Instagram." } });
          continue;
        }
        const message = `@${d.handle} ${d.advert.title ?? "Here's the advert"} 👆 You subscribed to this on ${BRAND}.`;
        sending = true;
        externalId = (await commentOnMedia({ mediaId: post.externalPostId, accessToken: token, message })).id;
      }
      await prisma.socialDelivery.update({ where: { id: d.id }, data: { status: "SENT", externalId, sentAt: new Date(), error: null, attempts: { increment: 1 } } });
      sent++;
    } catch (err) {
      const error = explain(d.platform, d.handle, err).slice(0, 500);
      await prisma.socialDelivery.update({ where: { id: d.id }, data: {
        status: sending ? "IN_FLIGHT" : "FAILED",
        attempts: { increment: 1 },
        error: sending ? `Delivery outcome unknown; reconcile before retrying. ${error}`.slice(0, 500) : error,
      } });
      // Tell the admins once, on the first failure
      if (d.attempts === 0) {
        await notifyAdmins({
          kind: "SEND_FAILED",
          title: `Couldn't send "${d.advert.title ?? "an advert"}" to ${displayHandle(d.platform, d.handle)}`,
          body: error,
          link: "/admin/adverts",
          userId: d.userId,
        });
      }
    }
  }
  return sent;
}
