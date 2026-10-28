"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logActivity, requireStaff, withAdminAudit } from "@/lib/session";
import { advertStatus, cancelPendingSends, postAdvertToPlatforms, publishAdvert, type PlatformOutcome } from "@/lib/adverts";
import { reasonFor } from "@/lib/errors";

export type AdminState = { ok?: boolean; error?: string; message?: string } | undefined;

const refresh = () => {
  revalidatePath("/admin", "layout");
  revalidatePath("/");
  revalidatePath("/me");
};

// ---- Adverts -------------------------------------------------------------------------

export type PublishState = { ok: true; outcomes: PlatformOutcome[] } | { ok: false; error: string };

// sendAt: ISO time from the browser (empty = now). autoSend: WhatsApp subscribers get it without
// a separate approval (publishing is the approval).
export async function publish(advertId: string, opts: { sendAt?: string | null; autoSend?: boolean } = {}): Promise<PublishState> {
  const viewer = await requireStaff();
  const sendAt = opts.sendAt ? new Date(opts.sendAt) : null;
  if (sendAt && Number.isNaN(sendAt.getTime())) return { ok: false, error: "that send time isn't a valid date." };
  const report = await publishAdvert(advertId, { sendAt, autoSend: opts.autoSend ?? true });
  if (!report.ok) return report;
  await logActivity(viewer.id, "ADVERT_PUBLISHED", { advert: advertId, sendAt: sendAt?.toISOString() ?? "now" }).catch(() => null);
  refresh();
  return { ok: true, outcomes: report.outcomes };
}

// Where a just-published advert stands, polled by the Publish / Post now buttons.
export async function publishProgress(advertId: string): Promise<PlatformOutcome[]> {
  await requireStaff();
  return advertStatus(advertId);
}

export async function unlist(advertId: string): Promise<AdminState> {
  await requireStaff();
  try {
    const advert = await prisma.post.findFirst({ where: { id: advertId, status: "DRAFT", channelId: null } });
    if (!advert) return { error: "Advert not found." };
    await prisma.post.update({ where: { id: advertId }, data: { listedAt: null } });
    const cancelled = await cancelPendingSends(advertId, "Cancelled: the advert was unlisted.");
    refresh();
    return { ok: true, message: `Unlisted. Users can't subscribe to it any more.${cancelled ? " Scheduled posts were cancelled." : ""}` };
  } catch (err) {
    return { error: `Not unlisted: ${reasonFor(err)}` };
  }
}

export async function postNow(advertId: string): Promise<PublishState> {
  await requireStaff();
  try {
    const outcomes = await postAdvertToPlatforms(advertId);
    refresh();
    if (outcomes.length === 0) return { ok: false, error: "no social platforms to post to (WhatsApp goes to subscribers' numbers)." };
    if (!outcomes.some((o) => o.ok)) return { ok: false, error: outcomes.map((o) => o.message).join(" ") };
    return { ok: true, outcomes };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}

// ---- Users ---------------------------------------------------------------------------

export async function signOutEverywhere(userId: string): Promise<AdminState> {
  const result = await withAdminAudit<AdminState>("SESSIONS_REVOKED", async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) return { result: { error: "User not found." }, event: null };
    const res = await tx.userSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return {
      result: { ok: true, message: `Signed out of ${res.count} ${res.count === 1 ? "session" : "sessions"}.` },
      event: res.count ? { action: "SESSIONS_REVOKED", targetUserId: target.id, detail: { count: res.count } } : null,
    };
  });
  if (result?.ok) refresh();
  return result;
}

// Signs out one device. Session management is reserved for super admins.
export async function revokeUserSession(sessionId: string): Promise<AdminState> {
  const result = await withAdminAudit<AdminState>("SESSION_REVOKED", async (tx) => {
    const session = await tx.userSession.findUnique({ where: { id: sessionId }, select: { id: true, userId: true, revokedAt: true } });
    if (!session) return { result: { error: "Session not found." }, event: null };
    if (session.revokedAt) return { result: { ok: true, message: "Already signed out." }, event: null };
    const revoked = await tx.userSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!revoked.count) return { result: { ok: true, message: "Already signed out." }, event: null };
    return {
      result: { ok: true, message: "Signed out." },
      event: { action: "SESSION_REVOKED", targetUserId: session.userId, detail: null },
    };
  });
  if (result?.ok) refresh();
  return result;
}

// ---- Roles (super admin only) ------------------------------------------------------------

export async function setRole(userId: string, role: "USER" | "ADMIN"): Promise<AdminState> {
  const result = await withAdminAudit<AdminState>("ROLE_CHANGE", async (tx, actor) => {
    if (userId === actor.id) return { result: { error: "You can't change your own role." }, event: null };
    if (role !== "USER" && role !== "ADMIN") return { result: { error: "Unknown role." }, event: null };
    const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true } });
    if (!target) return { result: { error: "User not found." }, event: null };
    if (target.role === "SUPER_ADMIN") {
      return { result: { error: "The super admin's role can't be changed here." }, event: null };
    }
    if (target.role === role) return { result: { ok: true }, event: null };
    await tx.user.update({ where: { id: target.id }, data: { role } });
    return {
      result: { ok: true, message: `${target.name ?? target.email} is now ${role === "ADMIN" ? "an admin" : "a user"}.` },
      event: { action: "ROLE_CHANGE", targetUserId: target.id, detail: { from: target.role, to: role } },
    };
  });
  if (result?.message) refresh();
  return result;
}
