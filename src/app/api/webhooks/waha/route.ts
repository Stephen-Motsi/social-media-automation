import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

function validHmac(raw: string, secret: string, supplied: string | null) {
  if (!supplied) return false;
  const header = supplied.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
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
  if (!validHmac(raw, secret, supplied)) return new NextResponse("Invalid signature", { status: 401 });

  const event = await prisma.webhookEvent.create({
    data: { object: "waha", payload: payload as object },
  });

  const eventName = typeof payload.event === "string" ? payload.event : "";
  if (eventName === "session.status" || payload.status) {
    const status = typeof payload.status === "string"
      ? payload.status
      : typeof payload.payload === "object" && payload.payload && typeof (payload.payload as Record<string, unknown>).status === "string"
        ? String((payload.payload as Record<string, unknown>).status)
        : null;
    if (status) {
      await prisma.whatsappSession.update({
        where: { id: session.id },
        data: { status, lastStatusAt: new Date() },
      });
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
