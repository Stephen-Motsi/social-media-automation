import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { Prisma as PrismaRuntime, type Prisma, type Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { createAdminAuditRunner } from "@/lib/audit-core";
export { createAdminAuditRunner } from "@/lib/audit-core";
export type { AdminAuditAction, AdminAuditOutcome, AdminAuditRecord } from "@/lib/audit-core";

// Server-side access checks. auth() is already verified against the database (src/auth.ts),
// so the role here is the current one and revoked sessions come back as signed out.

export type Viewer = { id: string; email: string; name: string | null; image: string | null; role: Role; sessionId: string };

export const isStaff = (role?: string | null) => role === "ADMIN" || role === "SUPER_ADMIN";

const roles = new Set<string>(["USER", "ADMIN", "SUPER_ADMIN"]);

function isViewer(value: unknown): value is Viewer {
  if (!value || typeof value !== "object") return false;
  const viewer = value as Record<string, unknown>;
  return (
    typeof viewer.id === "string" &&
    viewer.id.length > 0 &&
    typeof viewer.email === "string" &&
    viewer.email.length > 0 &&
    (viewer.name === null || typeof viewer.name === "string") &&
    (viewer.image === null || typeof viewer.image === "string") &&
    typeof viewer.sessionId === "string" &&
    viewer.sessionId.length > 0 &&
    typeof viewer.role === "string" &&
    roles.has(viewer.role)
  );
}

export async function getViewer(): Promise<Viewer | null> {
  const session = await auth();
  const user: unknown = session?.user;
  return isViewer(user) ? user : null;
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

// These policy assertions consume only the viewer produced by the trusted auth() context.
export function requireAuthenticatedViewer(viewer: unknown): Viewer {
  if (!isViewer(viewer)) throw new AccessError("Please sign in again.");
  return viewer;
}

export function requireStaffViewer(viewer: unknown): Viewer {
  const authenticated = requireAuthenticatedViewer(viewer);
  if (!isStaff(authenticated.role)) throw new AccessError("Only admins can do this.");
  return authenticated;
}

export function requireSuperAdminViewer(viewer: unknown): Viewer {
  const authenticated = requireAuthenticatedViewer(viewer);
  if (authenticated.role !== "SUPER_ADMIN") throw new AccessError("Only the super admin can do this.");
  return authenticated;
}

export async function requireViewer() {
  return requireAuthenticatedViewer(await getViewer());
}

export async function requireStaff() {
  return requireStaffViewer(await getViewer());
}

export async function requireSuperAdmin() {
  return requireSuperAdminViewer(await getViewer());
}

export const withAdminAudit = createAdminAuditRunner<Prisma.TransactionClient>({
  getActor: requireSuperAdmin,
  getIp: clientIp,
  transaction: (operation) => prisma.$transaction(operation),
  async createAudit(tx, record) {
    await tx.activityLog.create({
      data: {
        userId: record.targetUserId,
        actorId: record.actorId,
        action: record.action,
        detail: record.detail === null ? PrismaRuntime.JsonNull : (record.detail as Prisma.InputJsonValue),
        ip: record.ip,
      },
    });
  },
});

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
