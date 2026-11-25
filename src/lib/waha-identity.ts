import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const WAHA_IDENTITY_CONFLICT = "This WhatsApp account is already connected to another user.";
export const WAHA_IDENTITY_UNKNOWN = "The WhatsApp account identity could not be verified.";
export const WAHA_SESSION_CHANGED = "WhatsApp session changed. Check its status again.";

export function normalizeWahaIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const identity = value.trim().toLowerCase();
  const phone = /^([0-9]{8,15})(?::[0-9]+)?@(?:c\.us|s\.whatsapp\.net)$/.exec(identity);
  if (phone) return phone[1];
  return /^[0-9]{8,15}$/.test(identity) ? identity : null;
}

export function hasVerifiedWahaIdentity(session: { status: string; accountId: string | null; activeIdentity: string | null }) {
  const identity = normalizeWahaIdentity(session.accountId);
  return session.status === "WORKING" && identity !== null && identity === session.activeIdentity;
}

export async function claimWahaIdentity(userId: string, stateVersion: number, account: Record<string, unknown>) {
  const rawId = account.id ?? account.jid ?? account.phone;
  const identity = normalizeWahaIdentity(rawId);
  if (!identity || typeof rawId !== "string") return { ok: false as const, error: WAHA_IDENTITY_UNKNOWN };
  try {
    const updated = await prisma.whatsappSession.updateMany({
      where: { userId, stateVersion, status: { not: "STOPPING" } },
      data: {
        status: "WORKING",
        activeIdentity: identity,
        accountId: rawId,
        accountPhone: identity,
        accountInfo: account as object,
        accountPushName: typeof account.pushName === "string" ? account.pushName : (typeof account.pushname === "string" ? account.pushname : null),
        accountName: typeof account.pushName === "string" ? account.pushName : (typeof account.pushname === "string" ? account.pushname : null),
        lastStatusAt: new Date(),
        lastError: null,
        recoveryAttemptCount: 0,
        lastRecoveryAt: null,
        pairingCode: null,
        pairingCodeExpiresAt: null,
        qrData: null,
        qrGeneratedAt: null,
        qrExpiresAt: null,
        stateVersion: { increment: 1 },
      },
    });
    if (!updated.count) return { ok: false as const, error: WAHA_SESSION_CHANGED };
    return { ok: true as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, error: WAHA_IDENTITY_CONFLICT };
    }
    throw error;
  }
}
