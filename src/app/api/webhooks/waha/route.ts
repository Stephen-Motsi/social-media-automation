import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getWahaQr, wahaQrExpiryMs } from "@/lib/waha";

function validHmac(raw: string, secret: string, supplied: string | null, algorithmHeader: string | null) {
  if (!supplied) return false;
  const header = supplied.replace(/^sha(256|512)=/i, "").trim().toLowerCase();
  const algorithmValue = algorithmHeader?.trim().toLowerCase();
  const algorithms = algorithmValue === "sha256" || algorithmValue === "sha512"
    ? [algorithmValue]
    : ["sha512", "sha256"];
  for (const algorithm of algorithms) {
    const expected = createHmac(algorithm, secret).update(raw).digest("hex");
    if (header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const sessionName = typeof payload.session === "string"
    ? payload.session
    : typeof (payload.payload as Record<string, unknown> | undefined)?.session === "string"
      ? String((payload.payload as Record<string, unknown>).session)
      : null;
  if (!sessionName) return new NextResponse("Missing session", { status: 400 });

  const session = await prisma.whatsappSession.findUnique({ where: { sessionName } });
  if (!session) return new NextResponse("Unknown session", { status: 404 });
  let secret: string;
  try {
    secret = decrypt(session.webhookSecretEncrypted);
  } catch {
    return new NextResponse("Webhook configuration error", { status: 500 });
  }
  const supplied = req.headers.get("x-webhook-hmac")
    ?? req.headers.get("x-webhook-signature")
    ?? req.headers.get("x-hub-signature-256");
  const algorithmHeader = req.headers.get("x-webhook-hmac-algorithm");
  if (!validHmac(raw, secret, supplied, algorithmHeader)) return new NextResponse("Invalid signature", { status: 401 });

  const fingerprint = createHash("sha256").update(raw).digest("hex");
  const duplicate = await prisma.webhookEvent.findUnique({ where: { fingerprint } });
  if (duplicate) return NextResponse.json({ received: true, duplicate: true });

  const event = await prisma.webhookEvent.create({
    data: { object: "waha", payload: payload as object, fingerprint },
  });

  const eventName = typeof payload.event === "string" ? payload.event : "";
  if (eventName === "session.status" || payload.status) {
    const status = typeof payload.status === "string"
      ? payload.status
      : typeof payload.payload === "object" && payload.payload && typeof (payload.payload as Record<string, unknown>).status === "string"
        ? String((payload.payload as Record<string, unknown>).status)
        : null;
    if (status) {
      const normalized = status.trim().toUpperCase().replace(/[\s-]+/g, "_");
      await prisma.whatsappSession.update({
        where: { id: session.id },
        data: {
          status: normalized,
          previousStatus: session.status === normalized ? session.previousStatus : session.status,
          lastStatusAt: new Date(),
          stateVersion: { increment: 1 },
          ...(normalized !== "SCAN_QR_CODE" ? { qrGeneratedAt: null, qrExpiresAt: null } : {}),
          ...(normalized === "WORKING" ? { recoveryAttemptCount: 0, lastRecoveryAt: null, lastError: null } : {}),
        },
      });
      if (normalized === "SCAN_QR_CODE") {
        const generation = session.qrGenerationCount + 1;
        const freshQr = await getWahaQr(session.sessionName).catch((error: unknown) => {
          console.error(`[WAHA] QR retrieval failed for ${session.sessionName}:`, error instanceof Error ? error.message : error);
          return { qr: null };
        });
        await prisma.whatsappSession.update({
          where: { id: session.id },
          data: {
            qrGeneratedAt: freshQr.qr ? new Date() : null,
            qrExpiresAt: freshQr.qr ? new Date(Date.now() + wahaQrExpiryMs(generation)) : null,
            qrGenerationCount: generation,
            lastError: freshQr.qr ? null : "WAHA has not produced a QR code yet.",
          },
        });
      }
      if (normalized === "WORKING" && typeof payload.me === "object" && payload.me) {
        const me = payload.me as Record<string, unknown>;
        const id = typeof me.id === "string" ? me.id : null;
        const phone = id?.split("@")[0] ?? null;
        await prisma.whatsappSession.update({
          where: { id: session.id },
          data: {
            accountId: id,
            accountPhone: phone?.replace(/\D/g, "") || null,
            accountName: typeof me.pushName === "string" ? me.pushName : null,
            accountPushName: typeof me.pushName === "string" ? me.pushName : null,
            accountInfo: me as object,
            qrGeneratedAt: null,
            qrExpiresAt: null,
          },
        });
      }
    }
  }

  const payloadObj = payload.payload && typeof payload.payload === "object"
    ? payload.payload as Record<string, unknown>
    : payload;
  const ack = payloadObj.ack && typeof payloadObj.ack === "object"
    ? payloadObj.ack as Record<string, unknown>
    : payload.ack && typeof payload.ack === "object"
      ? payload.ack as Record<string, unknown>
      : null;
  if (ack) {
    const messageId = typeof ack.id === "string" ? ack.id
      : typeof payloadObj.id === "string" ? payloadObj.id : null;
    const ackValue = typeof ack.ack === "number" ? ack.ack : typeof ack.ack === "string" ? Number(ack.ack) : null;
    if (messageId && ackValue !== null) {
      const status = ackValue >= 3 ? "READ" : ackValue === 2 ? "DELIVERED" : ackValue === 1 ? "SENT" : ackValue <= 0 ? "FAILED" : null;
      if (status) {
        await prisma.delivery.updateMany({
          where: { externalId: messageId },
          data: { status, ...(status === "FAILED" ? { error: typeof ack.ackName === "string" ? ack.ackName : "WAHA reported delivery failure" } : {}) },
        });
      }
    }
  }

  await prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  return NextResponse.json({ received: true });
}
