"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  businessWhatsAppNumber,
  CONSENT_TEXT,
  newConfirmCode,
  newManageToken,
  normalizeLocation,
  normalizePhone,
  proposeForSubscriber,
  whatsappLink,
} from "@/lib/audience";
import { evaluateSubscription } from "@/lib/policy/subscriptions";

export type SubscribeState =
  | {
      ok?: boolean;
      error?: string;
      message?: string;
      // Self sign-ups confirm by sending this on WhatsApp
      confirm?: { code: string; link: string | null };
      // Number already on the list: we never reveal or change someone else's subscription here
      existing?: { manageLink: string | null };
      rejected?: string;
    }
  | undefined;

const MAX_SIGNUPS_PER_IP_PER_HOUR = 10;

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  phone: z.string().trim().min(1, "Enter your WhatsApp number."),
  location: z.string().trim().max(60).optional(),
  interests: z.array(z.string()).min(1, "Choose at least one topic."),
  consent: z.literal("on", { message: "Tick the box to agree to receive adverts on WhatsApp." }),
});

async function clientIp() {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

async function validInterestIds(ids: string[]) {
  const found = await prisma.interest.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return found.map((f) => f.id);
}

export async function subscribe(_prev: SubscribeState, formData: FormData): Promise<SubscribeState> {
  // Bots fill every field; people never see this one.
  if (formData.get("company")) return { ok: true, message: "Thanks!" };

  const parsed = schema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    location: formData.get("location") || undefined,
    interests: formData.getAll("interests").map(String),
    consent: formData.get("consent"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return { error: "That doesn't look like a WhatsApp number. Try e.g. 0712 345 678 or +254 712 345 678." };

  const ip = await clientIp();
  if (ip) {
    const recent = await prisma.subscriber.count({
      where: { consentIp: ip, updatedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= MAX_SIGNUPS_PER_IP_PER_HOUR) return { error: "Too many sign-ups from this network. Try again later." };
  }

  const interestIds = await validInterestIds(parsed.data.interests);
  if (interestIds.length === 0) return { error: "Choose at least one topic." };
  const business = await businessWhatsAppNumber();

  const existing = await prisma.subscriber.findUnique({ where: { phone } });
  // Someone entering a number that's already subscribed (maybe not theirs): change nothing, reveal nothing.
  // The owner can get their manage link by messaging MANAGE from that phone.
  if (existing && ["ACTIVE", "PENDING", "NEEDS_REVIEW"].includes(existing.status)) {
    return { ok: true, existing: { manageLink: business ? whatsappLink(business, "MANAGE") : null } };
  }

  const fields = {
    name: parsed.data.name,
    location: normalizeLocation(parsed.data.location),
    consentText: CONSENT_TEXT,
    consentAt: new Date(),
    consentIp: ip,
    source: "subscribe_page",
    confirmCode: newConfirmCode(),
    confirmedAt: null,
    status: "PENDING" as const,
  };
  const sub = existing
    ? // Previously unsubscribed or rejected: a fresh opt-in, confirmed again from the phone itself
      await prisma.subscriber.update({
        where: { id: existing.id },
        data: { ...fields, interests: { set: interestIds.map((id) => ({ id })) } },
      })
    : await prisma.subscriber.create({
        data: { ...fields, phone, manageToken: newManageToken(), interests: { connect: interestIds.map((id) => ({ id })) } },
      });

  // Automatic approval: the checks run now; ownership is confirmed when they send JOIN.
  const status = await evaluateSubscription(sub.id);
  revalidatePath("/audience");
  revalidatePath("/approvals");
  if (status === "REJECTED") {
    const checks = (await prisma.subscriber.findUnique({ where: { id: sub.id } }))?.checks as { result: string; detail: string }[];
    return { rejected: checks.find((c) => c.result === "fail")?.detail ?? "This number can't be subscribed." };
  }
  return { ok: true, confirm: { code: sub.confirmCode!, link: business ? whatsappLink(business, `JOIN ${sub.confirmCode}`) : null } };
}

export async function updatePreferences(token: string, _prev: SubscribeState, formData: FormData): Promise<SubscribeState> {
  const sub = await prisma.subscriber.findUnique({ where: { manageToken: token } });
  if (!sub) return { error: "This link isn't valid any more." };
  const ids = await validInterestIds(formData.getAll("interests").map(String));
  if (ids.length === 0) return { error: "Choose at least one topic, or unsubscribe instead." };
  const location = normalizeLocation(String(formData.get("location") ?? "").slice(0, 60));
  await prisma.subscriber.update({
    where: { id: sub.id },
    data: { interests: { set: ids.map((id) => ({ id })) }, location },
  });
  await proposeForSubscriber(sub.id).catch(() => null);
  revalidatePath(`/subscribe/manage/${token}`);
  revalidatePath("/audience");
  return { ok: true, message: "Saved your preferences." };
}

// The manage link is only ever sent to the subscriber's own WhatsApp, so it proves ownership.
export async function setSubscribed(token: string, subscribed: boolean): Promise<SubscribeState> {
  const sub = await prisma.subscriber.findUnique({ where: { manageToken: token } });
  if (!sub) return { error: "This link isn't valid any more." };
  if (subscribed) {
    await prisma.subscriber.update({
      where: { id: sub.id },
      data: { consentText: CONSENT_TEXT, consentAt: new Date(), consentIp: await clientIp(), confirmedAt: sub.confirmedAt ?? new Date() },
    });
    const status = await evaluateSubscription(sub.id);
    if (status === "ACTIVE") await proposeForSubscriber(sub.id).catch(() => null);
  } else {
    await prisma.subscriber.update({ where: { id: sub.id }, data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() } });
  }
  revalidatePath(`/subscribe/manage/${token}`);
  revalidatePath("/audience");
  return { ok: true, message: subscribed ? "You're subscribed again." : "You've been unsubscribed. You won't get any more adverts." };
}
