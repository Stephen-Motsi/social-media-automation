import type { Platform, SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { displayHandle, handleMatches } from "@/lib/handles";
import { accessTokenFor } from "@/lib/tokens";
import { xSendDm, xUserByUsername } from "@/lib/x";
import { commentOnMedia } from "@/lib/meta/instagram";
import { postUrl } from "@/lib/adverts";
import { notifyAdmins } from "@/lib/notify";

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
async function ourAccount(platform: Platform): Promise<SocialAccount | null> {
  const channel = await prisma.channel.findUnique({ where: { platform } });
  return (await prisma.socialAccount.findMany({ where: { platform } })).find((a) => handleMatches(platform, channel?.handle, a)) ?? null;
}

// The advert's published post on a platform, if it has one.
const publishedTarget = (advertId: string, platform: Platform) =>
  prisma.postTarget.findFirst({
    where: { status: "PUBLISHED", account: { platform }, post: { sourceAdvertId: advertId } },
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
      advert: { listedAt: { not: null }, OR: [{ sendAt: null }, { sendAt: { lte: now } }] },
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
      OR: [{ status: "PENDING" }, { status: "FAILED", attempts: { lt: MAX_ATTEMPTS }, updatedAt: { lte: new Date(now.getTime() - RETRY_AFTER_MS) } }],
    },
    include: { advert: true, user: { select: { socials: true, subscriptions: true, disabledAt: true } } },
    take: 50,
    orderBy: { createdAt: "asc" },
  });
  const accounts = new Map<Platform, SocialAccount | null>();
  let sent = 0;
  for (const d of due) {
    // Still subscribed, and still the same handle? Otherwise don't send.
    const current = d.user.socials.find((s) => s.platform === d.platform)?.handle;
    const stillSubscribed = d.user.subscriptions.some((s) => s.advertId === d.advertId && s.platform === d.platform);
    if (!stillSubscribed || !current || current !== d.handle || d.user.disabledAt || !d.advert.listedAt) {
      await prisma.socialDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", error: "Unsubscribed or the handle changed." } });
      continue;
    }
    if (!accounts.has(d.platform)) accounts.set(d.platform, await ourAccount(d.platform));
    const account = accounts.get(d.platform);
    if (!account) {
      // Not a failure of this delivery: it goes once the account is connected.
      await prisma.socialDelivery.update({ where: { id: d.id }, data: { error: `Waiting: our ${d.platform === "X" ? "X" : "Instagram"} account isn't connected.` } });
      continue;
    }
    try {
      const token = await accessTokenFor(account);
      let externalId: string;
      if (d.platform === "X") {
        const person = await xUserByUsername(token, d.handle);
        if (!person) {
          await prisma.socialDelivery.update({ where: { id: d.id }, data: { status: "FAILED", attempts: MAX_ATTEMPTS, error: `There's no X account ${displayHandle("X", d.handle)}.` } });
          continue;
        }
        const ours = await publishedTarget(d.advertId, "X");
        const link = ours ? postUrl("X", ours.externalPostId, ours.account.handle) : `${siteUrl()}/#${d.advertId}`;
        const text = [d.advert.title, d.advert.content, link, `You subscribed to this on ${BRAND}. Unsubscribe any time at ${siteUrl()}/me`].filter(Boolean).join("\n\n");
        externalId = (await xSendDm(token, person.id, text.slice(0, 9000))).dm_event_id;
      } else {
        const post = await publishedTarget(d.advertId, "INSTAGRAM");
        if (!post?.externalPostId) {
          await prisma.socialDelivery.update({ where: { id: d.id }, data: { error: "Waiting for the advert to be posted on Instagram." } });
          continue;
        }
        const message = `@${d.handle} ${d.advert.title ?? "Here's the advert"} 👆 You subscribed to this on ${BRAND}.`;
        externalId = (await commentOnMedia({ mediaId: post.externalPostId, accessToken: token, message })).id;
      }
      await prisma.socialDelivery.update({ where: { id: d.id }, data: { status: "SENT", externalId, sentAt: new Date(), error: null, attempts: { increment: 1 } } });
      sent++;
    } catch (err) {
      const error = explain(d.platform, d.handle, err).slice(0, 500);
      await prisma.socialDelivery.update({ where: { id: d.id }, data: { status: "FAILED", attempts: { increment: 1 }, error } });
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
