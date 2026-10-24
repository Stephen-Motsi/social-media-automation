"use server";

import { revalidatePath } from "next/cache";
import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logActivity, requireViewer } from "@/lib/session";
import { advertPlatforms, postUrl } from "@/lib/adverts";
import { formatWhen, reasonFor } from "@/lib/errors";
import { displayHandle, normalizeHandle, PROFILE_PLATFORMS, validateHandle } from "@/lib/handles";
import { platformRules } from "@/lib/policy/rules";
import { businessWhatsAppNumber, MIN_HOURS_BETWEEN_MESSAGES, newConfirmCode, normalizePhone, proposeCampaign, whatsappLink } from "@/lib/audience";

// Every action here acts only on the signed-in user's own records (viewer.id from the
// database-checked session), never on IDs of other users sent from the browser.

export type MeState = { ok?: boolean; error?: string; message?: string; link?: string | null; linkLabel?: string; join?: { code: string; link: string | null } } | undefined;

const refresh = () => {
  revalidatePath("/me");
  revalidatePath("/me/profile");
  revalidatePath("/");
};

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

  try {
    if (on) {
      await prisma.advertSubscription.upsert({
        where: { userId_advertId_platform: { userId: viewer.id, advertId, platform } },
        update: {},
        create: { userId: viewer.id, advertId, platform },
      });
      // Automatic: a WhatsApp subscription joins the send (at the advert's time, or now if that has passed).
      if (platform === "WHATSAPP") await proposeCampaign(advertId, "New subscription").catch((err) => console.error("proposeCampaign:", err));
    } else {
      await prisma.advertSubscription.deleteMany({ where: { userId: viewer.id, advertId, platform } });
    }
    await logActivity(viewer.id, on ? "SUBSCRIBE" : "UNSUBSCRIBE", { advert: advert.title ?? advert.id, platform });
  } catch (err) {
    return { error: `Not saved: ${reasonFor(err)}` };
  }
  refresh();
  if (!on) return { ok: true, message: "Unsubscribed." };
  let later = advert.sendAt && advert.sendAt > new Date() ? formatWhen(advert.sendAt) : null;
  if (platform === "WHATSAPP") {
    // One advert per person per day: if they just got one, this one follows after the gap.
    const last = (await prisma.subscriber.findUnique({ where: { userId: viewer.id } }))?.lastSentAt;
    const free = last ? new Date(last.getTime() + MIN_HOURS_BETWEEN_MESSAGES * 3600_000) : null;
    if (free && free > new Date() && (!advert.sendAt || advert.sendAt < free)) later = `after ${formatWhen(free)} (one advert a day on WhatsApp)`;
  }
  const where = platform === "WHATSAPP" ? "on your WhatsApp" : `on ${platformRules[platform].name}`;
  // X and Instagram go to the handle on their profile
  if (platform === "X" || platform === "INSTAGRAM") {
    const mine = await prisma.userSocial.findUnique({ where: { userId_platform: { userId: viewer.id, platform } } });
    const name = platformRules[platform].name;
    if (!mine) {
      return { ok: true, message: `Subscribed. Add your ${name} handle to your profile and it's sent to you there.`, link: "/me/profile", linkLabel: "Add it" };
    }
    const you = displayHandle(platform, mine.handle);
    const how = platform === "X" ? `by direct message to ${you}` : `by mentioning ${you} on our Instagram post`;
    return { ok: true, message: later ? `Subscribed. It's sent ${how} ${later}.` : `Subscribed. It's on its way ${how}.` };
  }
  if (later) return { ok: true, message: `Subscribed. It arrives ${where} ${later}.` };
  if (platform === "WHATSAPP") return { ok: true, message: "Subscribed. It's on its way to your WhatsApp." };
  const posted = await prisma.postTarget.findFirst({
    where: { status: "PUBLISHED", account: { platform }, post: { sourceAdvertId: advertId } },
    include: { account: true },
  });
  const handle = (await advertPlatforms([platform]))[0]?.handle;
  return posted
    ? { ok: true, message: `Subscribed. It's posted on ${handle ?? platformRules[platform].name}.`, link: postUrl(platform, posted.externalPostId, posted.account.handle) }
    : { ok: true, message: `Subscribed. You'll see it on ${handle ?? platformRules[platform].name} once it's posted.` };
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

// ---- Profile ---------------------------------------------------------------------------

export type ProfileState = { ok?: boolean; error?: string; message?: string; field?: string } | undefined;

export async function updateProfile(_prev: ProfileState, fd: FormData): Promise<ProfileState> {
  const viewer = await requireViewer();
  const name = String(fd.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 80) return { error: "Not saved: enter your name (2 to 80 characters).", field: "name" };

  const handles: { platform: Platform; handle: string | null }[] = [];
  for (const platform of PROFILE_PLATFORMS) {
    const raw = String(fd.get(platform) ?? "").trim();
    if (!raw) {
      handles.push({ platform, handle: null });
      continue;
    }
    const problem = validateHandle(platform, raw);
    if (problem) return { error: `Not saved: ${problem}`, field: platform };
    handles.push({ platform, handle: normalizeHandle(platform, raw) });
  }
  // Adverts are sent to these handles, so they must be the person's own.
  const deliverable = handles.some((h) => h.handle && (h.platform === "X" || h.platform === "INSTAGRAM"));
  if (deliverable && fd.get("consent") !== "on") {
    return { error: "Not saved: tick the box to confirm these are your accounts and you want adverts sent there.", field: "consent" };
  }

  try {
    for (const { platform, handle } of handles) {
      if (!handle) continue;
      const taken = await prisma.userSocial.findFirst({ where: { platform, handle, userId: { not: viewer.id } } });
      if (taken) return { error: `Not saved: that ${platformRules[platform].name} account is already on another profile.`, field: platform };
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: viewer.id }, data: { name } }),
      ...handles.map(({ platform, handle }) =>
        handle
          ? prisma.userSocial.upsert({
              where: { userId_platform: { userId: viewer.id, platform } },
              update: { handle },
              create: { userId: viewer.id, platform, handle },
            })
          : prisma.userSocial.deleteMany({ where: { userId: viewer.id, platform } }),
      ),
    ]);
    await logActivity(viewer.id, "PROFILE_UPDATED", Object.fromEntries(handles.map((h) => [h.platform, h.handle ? displayHandle(h.platform, h.handle) : null])));
  } catch (err) {
    return { error: `Not saved: ${reasonFor(err)}` };
  }
  revalidatePath("/me/profile");
  refresh();
  return { ok: true, message: "Saved ✓ Adverts you subscribe to on X and Instagram are sent to these accounts." };
}
