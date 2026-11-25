"use server";

import type { Platform } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ensureAllContainers } from "@/lib/channels";
import { normalizeHandle, validateHandle } from "@/lib/handles";
import { isStaff, requireViewer } from "@/lib/session";
import { disconnectWahaSession } from "@/lib/waha-lifecycle";
import { assistedWhatsappStatus, type AssistedWhatsappView } from "@/lib/whatsapp-requests";
import { disconnectOwnedSocialAccount, verifyOwnedSocialAccount } from "@/lib/owned-social-accounts";

type Result = { ok: boolean; message: string };
const platforms = ["FACEBOOK", "INSTAGRAM", "X", "TIKTOK"] as const;
type SocialPlatform = (typeof platforms)[number];

async function user() {
  return requireViewer();
}

export async function saveAccountHandle(platform: Platform, value: string): Promise<Result> {
  const viewer = await user();
  if (!platforms.includes(platform as SocialPlatform)) return { ok: false, message: "Unsupported platform." };
  const problem = validateHandle(platform, value);
  if (problem) return { ok: false, message: problem };
  await ensureAllContainers(viewer.id);
  await prisma.channel.update({
    where: { ownerId_platform: { ownerId: viewer.id, platform } },
    data: { handle: normalizeHandle(platform, value) },
  });
  revalidatePath("/me/accounts");
  return { ok: true, message: "Handle saved. Sign in with the provider to authorize this account." };
}

export async function disconnectOwnedAccount(id: string): Promise<Result> {
  const viewer = await user();
  if (!(await disconnectOwnedSocialAccount(viewer.id, id))) return { ok: false, message: "Connected account not found." };
  revalidatePath("/me/accounts");
  return { ok: true, message: "Disconnected locally. Revoke the app at the provider as well if desired." };
}

export async function checkOwnedAccount(id: string): Promise<Result> {
  const viewer = await user();
  try {
    await verifyOwnedSocialAccount(viewer.id, id);
    return { ok: true, message: "Provider authorization verified now. Publishing permissions can still vary." };
  } catch (error) {
    console.error("Social account verification failed:", error);
    return { ok: false, message: "Could not verify authorization. The provider may be unavailable, or access may have expired or been revoked. Try again or reconnect." };
  }
}

export async function requestWhatsapp(): Promise<Result> {
  const viewer = await user();
  const existing = await prisma.whatsappConnectionRequest.findUnique({ where: { userId: viewer.id } });
  if (isStaff(viewer.role) && !existing) return { ok: false, message: "Manage your WhatsApp session on Channels." };
  if (existing && ["PENDING", "PREPARING", "IN_PROGRESS", "EXPIRING", "CONNECTED"].includes(existing.status)) {
    return { ok: false, message: "You already have an active WhatsApp request or connection." };
  }
  if (!existing) {
    await prisma.whatsappConnectionRequest.create({ data: { userId: viewer.id } });
  } else {
    const updated = await prisma.whatsappConnectionRequest.updateMany({
      where: { id: existing.id, status: { in: ["EXPIRED", "FAILED", "CANCELLED"] } },
      data: { status: "PENDING", qrExpiresAt: null, error: null },
    });
    if (!updated.count) return { ok: false, message: "You already have an active WhatsApp request or connection." };
  }
  revalidatePath("/me/accounts");
  return { ok: true, message: "Request submitted. An administrator must start your QR session." };
}

export async function getOwnedWhatsappStatus(): Promise<AssistedWhatsappView> {
  const viewer = await user();
  return assistedWhatsappStatus(viewer.id);
}

export async function disconnectOwnedWhatsapp(): Promise<Result> {
  const viewer = await user();
  const request = await prisma.whatsappConnectionRequest.findUnique({ where: { userId: viewer.id } });
  if (!request || request.status !== "CONNECTED") return { ok: false, message: "No connected WhatsApp account was found." };
  try {
    await disconnectWahaSession(viewer.id);
    await prisma.whatsappConnectionRequest.updateMany({
      where: { userId: viewer.id, status: "CONNECTED" },
      data: { status: "CANCELLED", qrExpiresAt: null, error: null },
    });
    return { ok: true, message: "WhatsApp disconnected." };
  } catch (error) {
    console.error("WhatsApp disconnect failed:", error);
    return { ok: false, message: "Could not disconnect WhatsApp. Please try again or contact an administrator." };
  }
}
