import { prisma } from "@/lib/db";
import { disconnectWahaSession, getWahaView } from "@/lib/waha-lifecycle";
import { hasVerifiedWahaIdentity } from "@/lib/waha-identity";

export type AssistedWhatsappView = {
  status: string;
  qr: string | null;
  qrExpiresAt: string | null;
  account: string | null;
  phone: string | null;
  message: string | null;
};

export async function assistedWhatsappStatus(userId: string): Promise<AssistedWhatsappView> {
  const request = await prisma.whatsappConnectionRequest.findUnique({ where: { userId } });
  const empty = { qr: null, qrExpiresAt: null, account: null, phone: null, message: null };
  if (!request) return { status: "NOT_REQUESTED", ...empty };
  if (request.status !== "IN_PROGRESS" && request.status !== "CONNECTED") {
    return { status: request.status, ...empty, message: request.error };
  }
  if (request.status === "IN_PROGRESS" && request.qrExpiresAt && request.qrExpiresAt.getTime() <= Date.now()) {
    await expireWhatsappRequest(request.id, request.qrExpiresAt);
    const current = await prisma.whatsappConnectionRequest.findUniqueOrThrow({ where: { userId } });
    return { status: current.status, ...empty, message: current.error };
  }
  const view = await getWahaView(userId);
  const current = await prisma.whatsappConnectionRequest.findUniqueOrThrow({ where: { userId } });
  if (current.status !== request.status || current.qrExpiresAt?.getTime() !== request.qrExpiresAt?.getTime()) {
    return { status: current.status, ...empty };
  }
  if (request.status === "IN_PROGRESS" && request.qrExpiresAt && request.qrExpiresAt.getTime() <= Date.now()) {
    await expireWhatsappRequest(request.id, request.qrExpiresAt);
    const latest = await prisma.whatsappConnectionRequest.findUniqueOrThrow({ where: { userId } });
    return { status: latest.status, ...empty, message: latest.error };
  }
  if (view.status === "WORKING" && !view.pairingMismatch) {
    const session = await prisma.whatsappSession.findUnique({ where: { userId }, select: { accountId: true, activeIdentity: true, status: true } });
    if (!session || !hasVerifiedWahaIdentity(session)) return { status: "CONNECTION_ERROR", ...empty, message: "WhatsApp is responding but its account identity could not be verified. Try again." };
    const updated = await prisma.whatsappConnectionRequest.updateMany({
      where: {
        id: request.id,
        status: request.status,
        qrExpiresAt: request.qrExpiresAt,
        ...(request.status === "IN_PROGRESS" ? { AND: [{ qrExpiresAt: { gt: new Date() } }] } : {}),
      },
      data: { status: "CONNECTED", qrExpiresAt: null, error: null },
    });
    if (!updated.count) return { status: "CHANGED", ...empty, message: "Request changed. Refresh the status." };
    return { status: "CONNECTED", ...empty, account: view.account, phone: view.phone };
  }
  if (view.status === "FAILED" || view.status === "LOGGED_OUT" || view.status === "DISCONNECTED" || view.pairingMismatch
    || (request.status === "CONNECTED" && (view.status === "STOPPED" || view.status === "NOT_CREATED"))) {
    await prisma.whatsappConnectionRequest.updateMany({
      where: { id: request.id, status: request.status, qrExpiresAt: request.qrExpiresAt },
      data: { status: "FAILED", error: view.error ?? "WhatsApp connection failed or was logged out. Request assistance to reconnect." },
    });
    return { status: "FAILED", ...empty, message: view.error ?? "WhatsApp connection failed or was logged out. Request assistance to reconnect." };
  }
  if (request.status === "CONNECTED") {
    return { status: "CONNECTION_ERROR", ...empty, message: "WhatsApp is not currently connected. Check again or request assistance." };
  }
  if (!request.qrExpiresAt || request.qrExpiresAt.getTime() <= Date.now()) {
    return { status: "EXPIRED", ...empty, message: "The QR window expired. Ask an administrator to refresh it." };
  }
  return {
    status: view.status,
    qr: view.qr,
    qrExpiresAt: request.qrExpiresAt.toISOString(),
    account: null,
    phone: null,
    message: view.error ? "Could not retrieve the QR code. An administrator can retry." : null,
  };
}

export async function expireWhatsappRequest(id: string, expiresAt: Date) {
  const claimed = await prisma.whatsappConnectionRequest.updateMany({
    where: { id, status: "IN_PROGRESS", qrExpiresAt: expiresAt },
    data: { status: "EXPIRING", error: null },
  });
  if (!claimed.count) return false;
  const request = await prisma.whatsappConnectionRequest.findUniqueOrThrow({ where: { id } });
  try {
    await disconnectWahaSession(request.userId);
    await prisma.whatsappConnectionRequest.updateMany({
      where: { id, status: "EXPIRING", qrExpiresAt: expiresAt },
      data: { status: "EXPIRED", error: "The QR window expired. Ask an administrator to refresh it." },
    });
  } catch (error) {
    console.error("Could not stop expired WhatsApp session:", error);
    await prisma.whatsappConnectionRequest.updateMany({
      where: { id, status: "EXPIRING", qrExpiresAt: expiresAt },
      data: { status: "FAILED", error: "Could not stop the expired session. Contact an administrator." },
    });
  }
  return true;
}

export async function expireWhatsappRequests() {
  const expired = await prisma.whatsappConnectionRequest.findMany({
    where: { status: "IN_PROGRESS", qrExpiresAt: { lte: new Date() } },
    select: { id: true, qrExpiresAt: true },
    take: 20,
  });
  for (const request of expired) {
    if (request.qrExpiresAt) await expireWhatsappRequest(request.id, request.qrExpiresAt);
  }
}
