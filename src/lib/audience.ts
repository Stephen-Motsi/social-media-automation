import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Subscribers, matching adverts to them, and proposing campaigns for admin approval.

export const CONSENT_TEXT =
  "I agree to receive adverts on WhatsApp about the topics I chose. I can unsubscribe at any time by replying STOP or using my manage link.";

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

export function manageUrl(token: string) {
  return `${(process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/subscribe/manage/${token}`;
}

export const sameLocation = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// "  nairobi  west " -> "Nairobi West", so the same town is stored and counted one way.
export const normalizeLocation = (input: string | null | undefined) =>
  (input ?? "").trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase()) || null;

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
  if (!advert || advert.interests.length === 0) return [];
  const subscribers = await prisma.subscriber.findMany({
    where: {
      status: "ACTIVE",
      interests: { some: { id: { in: advert.interests.map((i) => i.id) } } },
      deliveries: { none: { ...REACHED, campaign: { advertId } } },
    },
    include: { interests: true },
  });
  // Location matching is case-insensitive; adverts without locations go everywhere.
  return advert.targetLocations.length
    ? subscribers.filter((s) => s.location && advert.targetLocations.some((l) => sameLocation(l, s.location!)))
    : subscribers;
}

// Proposes (or tops up) a campaign for an advert. Adverts whose campaign was rejected aren't proposed again.
export async function proposeCampaign(advertId: string, reason: string) {
  const advert = await prisma.post.findUnique({ where: { id: advertId }, include: { campaigns: true } });
  if (!advert || advert.status !== "DRAFT" || advert.channelId) return null;
  if (advert.campaigns.some((c) => c.status === "REJECTED")) return null;

  const matched = await matchSubscribers(advertId);
  if (matched.length === 0) return null;

  const pending = advert.campaigns.find((c) => c.status === "PENDING_APPROVAL");
  if (pending) {
    await prisma.delivery.createMany({
      data: matched.map((s) => ({ campaignId: pending.id, subscriberId: s.id })),
      skipDuplicates: true,
    });
    await prisma.campaign.update({ where: { id: pending.id }, data: { reason } });
    return pending.id;
  }
  const campaign = await prisma.campaign.create({
    data: { advertId, reason, deliveries: { create: matched.map((s) => ({ subscriberId: s.id })) } },
  });
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
    where: { status: "DRAFT", channelId: null, interests: { some: {} } },
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
