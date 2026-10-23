"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logActivity, requireStaff, requireSuperAdmin } from "@/lib/session";
import { listAdvert, postAdvertToPlatforms } from "@/lib/adverts";

export type AdminState = { ok?: boolean; error?: string; message?: string } | undefined;

const refresh = () => {
  revalidatePath("/admin", "layout");
  revalidatePath("/");
  revalidatePath("/me");
};

// ---- Adverts -------------------------------------------------------------------------

export async function setListed(advertId: string, listed: boolean, postNow = false): Promise<AdminState> {
  await requireStaff();
  const advert = await prisma.post.findFirst({ where: { id: advertId, status: "DRAFT", channelId: null } });
  if (!advert) return { error: "Advert not found." };
  if (listed) {
    if (!advert.title) return { error: "Give the advert a title before listing it." };
    if (advert.targetPlatforms.length === 0) return { error: "Choose at least one target platform before listing it." };
    const checks = (advert.checks as { platform: string; status: string }[] | null) ?? [];
    const blocked = checks.filter((c) => c.status === "block" && advert.targetPlatforms.includes(c.platform as never)).map((c) => c.platform);
    if (blocked.length === advert.targetPlatforms.length) return { error: "This advert can't be posted on any of its platforms. See its checks." };
    const r = await listAdvert(advertId, postNow);
    refresh();
    return {
      ok: true,
      message: `Listed for users.${r.posted.length ? ` Posting on ${r.posted.join(", ")}.` : ""}${r.skipped.length ? ` Not posted: ${r.skipped.join("; ")}.` : ""}`,
    };
  }
  await prisma.post.update({ where: { id: advertId }, data: { listedAt: null } });
  refresh();
  return { ok: true, message: "Unlisted. Users can't subscribe to it any more." };
}

export async function postNow(advertId: string): Promise<AdminState> {
  await requireStaff();
  const r = await postAdvertToPlatforms(advertId);
  refresh();
  return r.posted.length
    ? { ok: true, message: `Posting on ${r.posted.join(", ")}.${r.skipped.length ? ` Not posted: ${r.skipped.join("; ")}.` : ""}` }
    : { error: r.skipped.join("; ") || "No social platforms to post to." };
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
