"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logActivity, requireStaff, requireSuperAdmin } from "@/lib/session";
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
  const actor = await requireStaff();
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { error: "User not found." };
  // Only the super admin can sign out staff.
  if (target.role !== "USER" && actor.role !== "SUPER_ADMIN") return { error: "Only the super admin can sign out staff." };
  const res = await prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await logActivity(userId, "SESSIONS_REVOKED", { by: actor.email, count: res.count }, actor.id);
  refresh();
  return { ok: true, message: `Signed out of ${res.count} ${res.count === 1 ? "session" : "sessions"}.` };
}

// Signs out one device. Same rule as above: only the super admin can sign out staff.
export async function revokeUserSession(sessionId: string): Promise<AdminState> {
  const actor = await requireStaff();
  const session = await prisma.userSession.findUnique({ where: { id: sessionId }, include: { user: true } });
  if (!session) return { error: "Session not found." };
  if (session.user.role !== "USER" && actor.role !== "SUPER_ADMIN") return { error: "Only the super admin can sign out staff." };
  if (session.revokedAt) return { ok: true, message: "Already signed out." };
  await prisma.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  await logActivity(session.userId, "SESSION_REVOKED", { by: actor.email, session: sessionId.slice(-6) }, actor.id);
  refresh();
  return { ok: true, message: "Signed out." };
}

// ---- Roles (super admin only) ------------------------------------------------------------

export async function setRole(userId: string, role: "USER" | "ADMIN"): Promise<AdminState> {
  const actor = await requireSuperAdmin();
  if (userId === actor.id) return { error: "You can't change your own role." };
  if (role !== "USER" && role !== "ADMIN") return { error: "Unknown role." };
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { error: "User not found." };
  if (target.role === "SUPER_ADMIN") return { error: "The super admin's role can't be changed here." };
  if (target.role === role) return { ok: true };
  await prisma.user.update({ where: { id: userId }, data: { role } });
  // Takes effect on their next request: roles are read from the database every time.
  await logActivity(userId, "ROLE_CHANGE", { from: target.role, to: role, by: actor.email }, actor.id);
  refresh();
  return { ok: true, message: `${target.name ?? target.email} is now ${role === "ADMIN" ? "an admin" : "a user"}.` };
}
