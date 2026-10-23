import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Server-side access checks. auth() is already verified against the database (src/auth.ts),
// so the role here is the current one and revoked sessions come back as signed out.

export type Viewer = { id: string; email: string; name: string | null; image: string | null; role: Role; sessionId: string };

export const isStaff = (role?: string | null) => role === "ADMIN" || role === "SUPER_ADMIN";

export async function getViewer(): Promise<Viewer | null> {
  const session = await auth();
  const u = session?.user as Partial<Viewer> | undefined;
  return u?.id && u.sessionId ? (u as Viewer) : null;
}

// For pages: send people to the right place instead of erroring.
export async function pageViewer(need: "user" | "staff" | "super" = "user") {
  const v = await getViewer();
  if (!v) {
    // A session cookie is present but its database session was revoked or expired. Middleware
    // (which can't reach the database) still sees a signed cookie, so send them to the sign-in
    // page with ?expired=1, which it lets through instead of bouncing back here.
    const jar = await cookies();
    const stale = jar.getAll().some((c) => c.name.endsWith("authjs.session-token"));
    redirect(stale ? "/login?expired=1" : "/login");
  }
  if (need === "staff" && !isStaff(v.role)) redirect("/me");
  if (need === "super" && v.role !== "SUPER_ADMIN") redirect(isStaff(v.role) ? "/admin" : "/me");
  return v;
}

// For server actions and API routes: refuse.
export class AccessError extends Error {}
export async function requireViewer() {
  const v = await getViewer();
  if (!v) throw new AccessError("Please sign in again.");
  return v;
}
export async function requireStaff() {
  const v = await requireViewer();
  if (!isStaff(v.role)) throw new AccessError("Only admins can do this.");
  return v;
}
export async function requireSuperAdmin() {
  const v = await requireViewer();
  if (v.role !== "SUPER_ADMIN") throw new AccessError("Only the super admin can do this.");
  return v;
}

export async function clientIp() {
  try {
    const h = await headers();
    return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function logActivity(userId: string, action: string, detail?: Record<string, unknown>, actorId?: string) {
  await prisma.activityLog.create({ data: { userId, action, detail: detail as object | undefined, ip: await clientIp(), actorId } });
}
