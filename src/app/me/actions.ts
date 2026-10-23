"use server";

import { revalidatePath } from "next/cache";
import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logActivity, requireViewer } from "@/lib/session";
import { advertPlatforms } from "@/lib/adverts";
import { businessWhatsAppNumber, newConfirmCode, normalizePhone, proposeCampaign, whatsappLink } from "@/lib/audience";

// Every action here acts only on the signed-in user's own records (viewer.id from the
// database-checked session), never on IDs of other users sent from the browser.

export type MeState = { ok?: boolean; error?: string; message?: string; join?: { code: string; link: string | null } } | undefined;

const refresh = () => revalidatePath("/me");

export async function setAdvertSubscription(advertId: string, platform: Platform, on: boolean): Promise<MeState> {
  const viewer = await requireViewer();
  const advert = await prisma.post.findFirst({ where: { id: advertId, listedAt: { not: null } } });
  if (!advert) return { error: "This advert isn't available any more." };
  if (!(await advertPlatforms(advert.targetPlatforms)).some((p) => p.platform === platform)) {
    return { error: "This advert isn't offered on that platform." };
  }
  if (on && platform === "WHATSAPP") {
    const sub = await prisma.subscriber.findUnique({ where: { userId: viewer.id } });
    if (sub?.status !== "ACTIVE") return { error: "Link and confirm your WhatsApp number first." };
  }

  if (on) {
    await prisma.advertSubscription.upsert({
      where: { userId_advertId_platform: { userId: viewer.id, advertId, platform } },
      update: {},
      create: { userId: viewer.id, advertId, platform },
    });
    // Automatic: a WhatsApp subscription queues the send for admin approval straight away.
    if (platform === "WHATSAPP") await proposeCampaign(advertId, "New subscription").catch(() => null);
  } else {
    await prisma.advertSubscription.deleteMany({ where: { userId: viewer.id, advertId, platform } });
  }
  await logActivity(viewer.id, on ? "SUBSCRIBE" : "UNSUBSCRIBE", { advert: advert.title ?? advert.id, platform });
  refresh();
  return { ok: true };
}

export async function linkWhatsApp(_prev: MeState, fd: FormData): Promise<MeState> {
  const viewer = await requireViewer();
  if (fd.get("consent") !== "on") return { error: "Tick the box to agree to receive adverts on WhatsApp." };
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  if (!phone) return { error: "That doesn't look like a WhatsApp number. Try e.g. 0712 345 678." };
  const taken = await prisma.subscriber.findUnique({ where: { phone } });
  if (taken?.userId && taken.userId !== viewer.id) return { error: "This number is linked to another account." };

  // Nothing is linked until "JOIN <code>" arrives from this exact number.
  const code = newConfirmCode();
  await prisma.user.update({ where: { id: viewer.id }, data: { whatsappPending: phone, whatsappCode: code } });
  await logActivity(viewer.id, "WHATSAPP_ADDED", { phone: `+${phone}`, status: "waiting for JOIN" });
  const business = await businessWhatsAppNumber();
  refresh();
  return { ok: true, join: { code, link: business ? whatsappLink(business, `JOIN ${code}`) : null } };
}

export async function unlinkWhatsApp(): Promise<MeState> {
  const viewer = await requireViewer();
  await prisma.$transaction([
    prisma.subscriber.updateMany({ where: { userId: viewer.id }, data: { userId: null, status: "UNSUBSCRIBED", unsubscribedAt: new Date() } }),
    prisma.advertSubscription.deleteMany({ where: { userId: viewer.id, platform: "WHATSAPP" } }),
    prisma.user.update({ where: { id: viewer.id }, data: { whatsappPending: null, whatsappCode: null } }),
  ]);
  await logActivity(viewer.id, "WHATSAPP_REMOVED");
  refresh();
  return { ok: true, message: "Your WhatsApp number was removed and won't get adverts." };
}

export async function revokeSession(sessionId: string): Promise<MeState> {
  const viewer = await requireViewer();
  // Scoped to the viewer: another user's session ID does nothing.
  const res = await prisma.userSession.updateMany({
    where: { id: sessionId, userId: viewer.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count) await logActivity(viewer.id, "SESSION_REVOKED", { session: sessionId.slice(-6) });
  refresh();
  return { ok: true };
}

export async function revokeOtherSessions(): Promise<MeState> {
  const viewer = await requireViewer();
  const res = await prisma.userSession.updateMany({
    where: { userId: viewer.id, revokedAt: null, id: { not: viewer.sessionId } },
    data: { revokedAt: new Date() },
  });
  await logActivity(viewer.id, "SESSIONS_REVOKED", { count: res.count });
  refresh();
  return { ok: true, message: res.count ? `Signed out ${res.count} other ${res.count === 1 ? "device" : "devices"}.` : "No other devices were signed in." };
}
