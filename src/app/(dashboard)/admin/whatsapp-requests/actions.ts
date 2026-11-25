"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/session";
import { WAHA_QR_WINDOW_MS, wahaConfigured } from "@/lib/waha";
import { connectWahaSession, disconnectWahaSession, getWahaView } from "@/lib/waha-lifecycle";

export async function startWhatsappRequest(id: string): Promise<{ ok: boolean; message: string }> {
  await requireStaff();
  if (!(await wahaConfigured())) return { ok: false, message: "Configure WAHA in Channels first." };
  const request = await prisma.whatsappConnectionRequest.findUnique({ where: { id } });
  if (!request || !["PENDING", "PREPARING", "IN_PROGRESS", "EXPIRING", "EXPIRED", "FAILED"].includes(request.status)) {
    return { ok: false, message: "This request cannot be started." };
  }
  if (["PREPARING", "EXPIRING"].includes(request.status) && request.updatedAt.getTime() > Date.now() - 120_000) {
    return { ok: false, message: "This request is being processed. Try again shortly." };
  }
  const claimed = await prisma.whatsappConnectionRequest.updateMany({
    where: { id, status: request.status, updatedAt: request.updatedAt },
    data: { status: "PREPARING", qrExpiresAt: null, error: null },
  });
  if (!claimed.count) return { ok: false, message: "Request changed. Refresh and try again." };
  try {
    const existing = await prisma.whatsappSession.findUnique({ where: { userId: request.userId }, select: { id: true } });
    if (existing) await disconnectWahaSession(request.userId);
    await prisma.whatsappSession.updateMany({
      where: { userId: request.userId },
      data: { authMethod: "QR", phoneNumber: null, qrData: null, qrGeneratedAt: null, qrExpiresAt: null, pairingCode: null, pairingCodeExpiresAt: null },
    });
    const view = await connectWahaSession(request.userId);
    if (view.error || view.status === "FAILED" || view.status === "CONNECTION_ERROR") throw new Error(view.error ?? "Could not start the WhatsApp session.");
    const expiresAt = new Date(Date.now() + WAHA_QR_WINDOW_MS);
    const started = await prisma.whatsappConnectionRequest.updateMany({
      where: { id, status: "PREPARING" },
      data: { status: "IN_PROGRESS", qrExpiresAt: expiresAt },
    });
    if (!started.count) throw new Error("Request changed while the session was starting.");
    revalidatePath("/admin/whatsapp-requests");
    return { ok: true, message: "Session started. The user can scan their QR code for five minutes." };
  } catch (error) {
    console.error("WhatsApp request start failed:", error);
    await prisma.whatsappConnectionRequest.updateMany({
      where: { id, status: "PREPARING" },
      data: { status: "FAILED", error: "The administrator could not start the session. Please request assistance again." },
    });
    return { ok: false, message: "Could not start the session. Check WAHA configuration and server logs." };
  }
}

export async function checkWhatsappRequest(id: string): Promise<{ ok: boolean; message: string }> {
  await requireStaff();
  const request = await prisma.whatsappConnectionRequest.findUnique({ where: { id } });
  if (!request || !["IN_PROGRESS", "CONNECTED"].includes(request.status)) {
    return { ok: false, message: "There is no active session for this request." };
  }
  try {
    const view = await getWahaView(request.userId);
    revalidatePath("/admin/whatsapp-requests");
    return { ok: true, message: `WAHA status: ${view.status}. The QR code is visible only to the requesting user.` };
  } catch (error) {
    console.error("WhatsApp request status failed:", error);
    return { ok: false, message: "Could not check the session. Check WAHA and server logs." };
  }
}
