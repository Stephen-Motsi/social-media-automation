import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handleMatches } from "@/lib/handles";
import { queueCampaign } from "@/lib/queue";

// Subscribers, matching adverts to them, and proposing campaigns for admin approval.

export const CONSENT_TEXT =
  "I agree to receive adverts on WhatsApp about the topics I chose. I can unsubscribe at any time by replying STOP or using my manage link.";

export { CONSENT_METHODS } from "@/lib/consent";

// Suggested towns on the subscribe page (subscribers can type any).
export const COMMON_LOCATIONS = ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika", "Machakos", "Nyeri"];

export const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE ?? "254";
// Don't message the same person more often than this (WhatsApp limits marketing messages per person).
export const MIN_HOURS_BETWEEN_MESSAGES = Number(process.env.AUDIENCE_MIN_HOURS_BETWEEN_MESSAGES ?? 24);

// "0712 345 678" -> "254712345678"; "+254 712 345678" -> "254712345678". Returns null if it can't be a number.
export function normalizePhone(input: string, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  let d = (input ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length >= 9 && d.length <= 11) d = countryCode + d.slice(1);
  else if (d.length === 9 && /^[17]/.test(d) && countryCode === "254") d = countryCode + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export const newManageToken = () => randomBytes(24).toString("base64url");

// Short code people send as "JOIN ABC123" to prove they own the number. No look-alike characters.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newConfirmCode() {
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// The business's WhatsApp number people confirm with: the Meta container's WhatsApp handle.
export async function businessWhatsAppNumber(): Promise<string | null> {
  const channel = await prisma.channel.findUnique({ where: { platform: "WHATSAPP" } });
  return channel?.handle || process.env.WHATSAPP_BUSINESS_NUMBER?.replace(/\D/g, "") || null;
}

export const whatsappLink = (number: string, text: string) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

export const subscribePageUrl = () => `${(process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/subscribe`;

export function manageUrl(token: string) {
  return `${(process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/subscribe/manage/${token}`;
}

export const sameLocation = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// "  nairobi  west " -> "Nairobi West", so the same town is stored and counted one way.
export const normalizeLocation = (input: string | null | undefined) =>
  (input ?? "").trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase()) || null;

const MAX_SEND_ATTEMPTS = 3;

// Deliveries that count as "this person already has / will get this advert".
const REACHED: Prisma.DeliveryWhereInput = {
  OR: [
    { status: { in: ["SENT", "DELIVERED", "READ"] } },
    { status: "PENDING", campaign: { status: { in: ["PENDING_APPROVAL", "APPROVED", "SENDING"] } } },
  ],
};

// Active subscribers interested in any of the advert's topics (and in its locations, if any),
// who haven't already received or been queued for it.
export async function matchSubscribers(advertId: string) {
  const advert = await prisma.post.findUnique({ where: { id: advertId }, include: { interests: true } });
  if (!advert) return [];
  // An advert targeting specific platforms without WhatsApp isn't sent on WhatsApp.
  if (advert.targetPlatforms.length && !advert.targetPlatforms.includes("WHATSAPP")) return [];
  const notReached = { deliveries: { none: { ...REACHED, campaign: { advertId } } } };
  // 1. Signed-in users who subscribed to this advert on WhatsApp (listed adverts only)
  const bySubscription = advert.listedAt
    ? await prisma.subscriber.findMany({
        where: { status: "ACTIVE", ...notReached, user: { subscriptions: { some: { advertId, platform: "WHATSAPP" } } } },
        include: { interests: true },
      })
    : [];
  // 2. Topic subscribers (subscribe page / admin-added), filtered by the advert's towns
  const byTopic = advert.interests.length
    ? (
        await prisma.subscriber.findMany({
          where: { status: "ACTIVE", ...notReached, interests: { some: { id: { in: advert.interests.map((i) => i.id) } } } },
          include: { interests: true },
        })
      ).filter(
        (s) => !advert.targetLocations.length || (s.location && advert.targetLocations.some((l) => sameLocation(l, s.location!))),
      )
    : [];
  // Stop retrying someone this advert has already failed to reach a few times (e.g. not on WhatsApp).
  const failed = await prisma.delivery.groupBy({
    by: ["subscriberId"],
    where: { status: "FAILED", campaign: { advertId } },
    _count: true,
  });
  const givenUp = new Set(failed.filter((f) => f._count >= MAX_SEND_ATTEMPTS).map((f) => f.subscriberId));
  const seen = new Set<string>(givenUp);
  // Messaged recently: matched again once the gap has passed (the worker re-checks every ~10 minutes).
  const cutoff = new Date(Date.now() - MIN_HOURS_BETWEEN_MESSAGES * 60 * 60 * 1000);
  return [...bySubscription, ...byTopic].filter((s) =>
    seen.has(s.id) || (s.lastSentAt && s.lastSentAt > cutoff) ? false : (seen.add(s.id), true),
  );
}

// Why WhatsApp sends can't go out right now (null = ready): what an admin has to fix.
export async function whatsappNotReady(): Promise<string | null> {
  if (!(await getAudienceTemplate())) return "no WhatsApp message template is set (Audience page).";
  const channel = await prisma.channel.findUnique({ where: { platform: "WHATSAPP" } });
  const accounts = await prisma.socialAccount.findMany({ where: { platform: "WHATSAPP" } });
  if (!accounts.some((a) => handleMatches("WHATSAPP", channel?.handle, a))) {
    return "your WhatsApp number isn't connected (Settings in the Meta container on Channels).";
  }
  return null;
}

// When an approved send goes out: the advert's send time, or now if that has passed.
const sendTimeFor = (advert: { sendAt: Date | null }) => (advert.sendAt && advert.sendAt > new Date() ? advert.sendAt : null);

const blockedOnWhatsApp = (checks: unknown) =>
  ((checks as { platform: string; status: string }[] | null) ?? []).some((c) => c.platform === "WHATSAPP" && c.status === "block");

// Proposes (or tops up) a campaign for an advert. Adverts whose campaign was rejected aren't proposed again.
// Adverts published with auto-send are approved straight away (publishing was the approval) and go out
// at the advert's send time; people who subscribe after that get it immediately.
export async function proposeCampaign(advertId: string, reason: string) {
  const advert = await prisma.post.findUnique({ where: { id: advertId }, include: { campaigns: true } });
  // Only published (listed) adverts are sent; drafts never are.
  if (!advert || advert.status !== "DRAFT" || advert.channelId || !advert.listedAt) return null;
  if (advert.campaigns.some((c) => c.status === "REJECTED")) return null;

  const matched = await matchSubscribers(advertId);
  const notReady = advert.autoSend ? ((blockedOnWhatsApp(advert.checks) && "it fails WhatsApp's checks.") || (await whatsappNotReady())) : null;
  const auto = advert.autoSend && !notReady;
  const sendAt = sendTimeFor(advert);
  const addTo = (campaignId: string) =>
    prisma.delivery.createMany({ data: matched.map((s) => ({ campaignId, subscriberId: s.id })), skipDuplicates: true });

  // An automatic send that hasn't gone out yet takes the new subscribers along.
  const upcoming = auto && advert.campaigns.find((c) => c.status === "APPROVED" && c.sendAt && c.sendAt > new Date());
  if (upcoming) {
    if (matched.length) await addTo(upcoming.id);
    return matched.length ? upcoming.id : null;
  }

  const pending = advert.campaigns.find((c) => c.status === "PENDING_APPROVAL");
  if (pending) {
    if (matched.length) await addTo(pending.id);
    if (auto) {
      await prisma.campaign.update({ where: { id: pending.id }, data: { status: "APPROVED", approvedAt: new Date(), sendAt, reason: "Sent automatically" } });
      await queueCampaign(pending.id, sendAt);
    } else {
      await prisma.campaign.update({ where: { id: pending.id }, data: { reason: notReady ? `Waiting: ${notReady}` : reason } });
    }
    return pending.id;
  }
  if (matched.length === 0) return null;
  const campaign = await prisma.campaign.create({
    data: {
      advertId,
      reason: auto ? "Sent automatically" : notReady ? `Waiting: ${notReady}` : reason,
      ...(auto ? { status: "APPROVED" as const, approvedAt: new Date(), sendAt } : {}),
      deliveries: { create: matched.map((s) => ({ subscriberId: s.id })) },
    },
  });
  if (auto) await queueCampaign(campaign.id, sendAt);
  return campaign.id;
}

// After someone subscribes or changes their topics: propose every targeted advert that now matches them.
export async function proposeForSubscriber(subscriberId: string) {
  const sub = await prisma.subscriber.findUnique({ where: { id: subscriberId }, include: { interests: true } });
  if (!sub || sub.status !== "ACTIVE" || sub.interests.length === 0) return 0;
  const adverts = await prisma.post.findMany({
    where: {
      status: "DRAFT",
      channelId: null,
      listedAt: { not: null },
      interests: { some: { id: { in: sub.interests.map((i) => i.id) } } },
    },
    select: { id: true },
  });
  let proposed = 0;
  for (const a of adverts) if (await proposeCampaign(a.id, "New subscribers match")) proposed++;
  return proposed;
}

// Safety net run by the worker: catches anything missed (e.g. a subscriber whose send was skipped).
export async function proposeAll() {
  const adverts = await prisma.post.findMany({
    where: {
      status: "DRAFT",
      channelId: null,
      listedAt: { not: null },
      OR: [{ interests: { some: {} } }, { subscriptions: { some: { platform: "WHATSAPP" } } }],
    },
    select: { id: true },
  });
  let proposed = 0;
  for (const a of adverts) if (await proposeCampaign(a.id, "Subscribers match")) proposed++;
  return proposed;
}

// ---- Settings: the WhatsApp template used for audience adverts ----------------------

export type AudienceTemplate = { name: string; lang: string };

export async function getAudienceTemplate(): Promise<AudienceTemplate | null> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ["audience.template", "audience.templateLang"] } } });
  const name = rows.find((r) => r.key === "audience.template")?.value ?? process.env.AUDIENCE_WHATSAPP_TEMPLATE;
  const lang = rows.find((r) => r.key === "audience.templateLang")?.value ?? process.env.AUDIENCE_WHATSAPP_TEMPLATE_LANG ?? "en_US";
  return name ? { name, lang } : null;
}

// WhatsApp template parameters can't contain new lines, tabs or more than 4 spaces in a row.
export const templateText = (text: string, max = 1000) => text.replace(/\s+/g, " ").trim().slice(0, max) || " ";
